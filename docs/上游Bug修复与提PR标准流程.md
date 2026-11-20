# 上游 Bug 修复与提 PR 标准流程

> 适用于「双轨分支」架构的 fork 二次开发项目：`main` 分支永久镜像上游、`custom`（或同名开发分支）承载二开改动。
> 本文档基于 `deepseek-chat-manager` 项目修复「会话右键菜单漂移」bug 并向上游 `deepseek-ai/chat-demo` 提交 PR 的实战经验提炼。

---

## 0. 适用前提

- 项目采用双轨分支：`main` = 上游镜像（零二开代码），开发分支承载全部定制。
- 已在远端建立自己的仓库（不要求与上游有 GitHub fork 关系）。
- 已配置 `git` + `gh`（GitHub CLI，已认证）。

若尚未双轨，先确保 `main` 干净对齐上游，再开始本流程。

---

## 1. 发现问题与复现

1. 明确记录**复现条件**（如「选中第 10 条以后的会话」「鼠标移向删除项」），越精确越利于验证。
2. 尽量截图/录屏留证，标注现象（如「菜单漂移到屏幕左上角」）。
3. 判断问题类型：
   - 纯逻辑 bug（可单测/静态验证）
   - 交互/视觉 bug（必须浏览器端到端验证）

---

## 2. 定位根因

- 优先静态分析：读相关源码，追踪数据流/事件流。
- 交互类 bug 用浏览器工具实测（元素坐标、`getBoundingClientRect()`、visibility 变化）。
- 关键原则：**找到「通用根因」而非「表象」**，为后续通用防御修复铺路。

---

## 3. 溯源判断：fork 本身 vs 二开引入

这是决定「能否提 PR 给上游」的核心一步，**用 git 追溯而非猜测**：

```bash
# 1) 文件是否为上游原生（出现在 main 的 Initial commit 即原生）
git log --oneline main -- <file>

# 2) 二开过程中是否改过该文件（差异仅本次修复 = 上游原生缺陷）
git diff main custom -- <file>
```

判定表：

| 现象 | 结论 | 是否可提上游 PR |
| :--- | :--- | :--- |
| 文件在 `main` 存在，`main..custom` 差异仅本次修复 | **上游存量缺陷** | ✅ 可（干净修复） |
| 文件是二开新增/大量修改 | 二开引入的问题 | ❌ 与上游无关 |
| 文件上游原生，但二开改动导致行为变化 | 二开改动诱发的暴露 | ⚠️ 需分离分析 |

> 本次实战：`anchored.ts` 在 `main` 的 Initial commit 就存在、`main..custom` 差异仅本次 +5 行修复 → 判定为上游原生缺陷，二开「大量会话导入」只是提高了暴露概率。

---

## 4. 修复策略

1. **通用防御优先于局部补丁**：在底层 hook / 公共组件修复，让所有调用方受益，而非只给当前出问题的组件打补丁。
2. 修复保持**最小、独立、无二开依赖**（便于后续剥离成上游 PR）。
3. 不夹带任何与本次修复无关的改动（格式、重构、顺手优化）。

---

## 5. 验证

```bash
pnpm type    # 类型检查（tsc）
pnpm lint    # 静态检查（oxlint）
```

- 逻辑 bug：补充单测或独立脚本验证边界。
- 交互 bug：**必须浏览器端到端复测**，严格复现第 1 步的条件，确认修复前后坐标/行为变化。

---

## 6. 提交到开发分支（日常修复）

```bash
git add -A
git commit -m "fix(<scope>): <修复描述>"
git push origin custom
```

commit message 遵循 Conventional Commits：`fix(scope): ...` / `feat(scope): ...` / `docs: ...`。

---

## 7. 准备上游 PR：造干净分支

**不能直接拿开发分支提 PR**（它含大量二开改动）。基于上游镜像造「只含本次修复」的分支：

```bash
# 1) 基于上游镜像 main 建干净分支
git checkout -b fix/<issue-name> main

# 2) 只摘取本次修复的 commit
git cherry-pick <fix-commit>

# 3) 确认分支历史干净（只有 cherry-pick 的修复，父提交是上游版本）
git log --oneline -3
```

---

## 8. 推送并提 PR

### 8.1 建立 fork 关系（若与上游无 GitHub fork）

```bash
gh repo fork <upstream-owner>/<upstream-repo> --clone=false
```

验证 fork 的 parent 正确：

```bash
gh repo view <you>/<upstream-repo> --json isFork,parent
```

### 8.2 推送干净分支到 fork

```bash
git push https://github.com/<you>/<upstream-repo>.git fix/<issue-name>:fix/<issue-name>
```

### 8.3 提 PR 的两个坑（实测踩过）

| 方式 | 结果 | 说明 |
| :--- | :--- | :--- |
| `gh pr create --repo <upstream> --head <you>:<branch>` | ❌ 权限拒绝 | GraphQL `does not have the correct permissions to execute CreatePullRequest`；REST `404`。gh 的 OAuth token 对无写权限的上游仓库无法跨仓库建 PR |
| `gh pr create --repo <you>/<fork> --head <branch>` | ⚠️ 误建 | 会创建 **fork 内部 PR**（`crossRepo=false`），base 是 fork 自己的 `main`，不是上游 |

**正确做法**：技术准备（fork + 推分支）用命令行完成，**最终 PR 走网页或邮件**：

- 网页：打开跨仓库 compare 链接
  ```
  https://github.com/<upstream-owner>/<upstream-repo>/compare/main...<you>:fix/<issue-name>
  ```
- 邮件：把分支信息 + PR 描述发给上游维护者。

---

## 9. PR 描述模板（三段式）

```markdown
## Problem
<一句话描述现象 + 触发条件>

## Root cause
<根因：链路 + 关键机制，引用具体文件/逻辑>

## Fix
<修复方式：改了什么、为什么通用、影响范围>
```

---

## 10. 全流程 Checklist

- [ ] 1. 明确复现条件，截图留证
- [ ] 2. 静态定位根因（通用根因优先）
- [ ] 3. git 溯源：`git log main -- <file>` + `git diff main custom -- <file>`
- [ ] 4. 判定 bug 归属（上游存量 / 二开引入）
- [ ] 5. 通用防御式最小修复，无夹带改动
- [ ] 6. `pnpm type` + `pnpm lint` 通过
- [ ] 7. 交互 bug 浏览器端到端复测
- [ ] 8. 提交开发分支 `fix(scope): ...`
- [ ] 9. 基于 `main` 建干净分支 + `cherry-pick` 修复
- [ ] 10. fork 上游 + 推干净分支
- [ ] 11. 网页 compare 链接 / 邮件提交 PR（三段式描述）

---

## 附：关键命令速查

```bash
# 溯源
git log --oneline main -- <file>
git diff main custom -- <file>

# 干净分支
git checkout -b fix/<name> main
git cherry-pick <fix-commit>
git push -u origin fix/<name>

# fork 与验证
gh repo fork <upstream-owner>/<upstream-repo> --clone=false
gh repo view <you>/<upstream-repo> --json isFork,parent

# 推送到 fork
git push https://github.com/<you>/<upstream-repo>.git fix/<name>:fix/<name>
```
