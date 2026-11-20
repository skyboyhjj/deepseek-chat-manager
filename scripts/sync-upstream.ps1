# sync-upstream.ps1
# 双轨分支上游同步：main 对齐官方 upstream/main，custom 在其上重放定制提交。
#
# 分支约定：
#   main     纯上游镜像，与 upstream/main 逐字节对齐（不接受本地提交）
#   custom   交付分支，承载全部定制（在 main 之上线性叠加）
#   upstream 官方仓库只读镜像（gh-proxy）
#
# 用法：
#   .\scripts\sync-upstream.ps1             # rebase 方式（默认，历史线性）
#   .\scripts\sync-upstream.ps1 -Merge      # merge 方式（保留提交哈希，推远端后更安全）
#   .\scripts\sync-upstream.ps1 -DryRun     # 只检查，不执行
#
# 说明：
#   - 执行前要求工作区干净，否则中止。
#   - 同步仅在 upstream 新增提交时才有动作；若 custom 与官方改动重叠文件会冲突并自动回滚。

[CmdletBinding()]
param(
    [switch]$Merge,   # 用 merge 代替 rebase
    [switch]$DryRun   # 只检查，不执行任何写操作
)

$ErrorActionPreference = 'Stop'

$Mirror   = 'main'
$Custom   = 'custom'
$Upstream = 'upstream'

function Fail([string]$msg) {
    Write-Host "ERROR: $msg" -ForegroundColor Red
    exit 1
}

function Info([string]$msg) {
    Write-Host "==> $msg" -ForegroundColor Cyan
}

# 1. 工作区必须干净
$dirty = git status --porcelain
if ($dirty) {
    Fail "工作区有未提交改动，请先提交或 stash 后再同步：`n$dirty"
}

# 2. 远端与分支存在性检查
$remotes = @(git remote)
if ($remotes -notcontains $Upstream) {
    Fail "缺少远端 '$Upstream'，请先执行：git remote add $Upstream <官方仓库URL>"
}

$branches = @(git branch --format '%(refname:short)')
if ($branches -notcontains $Mirror) { Fail "缺少分支 '$Mirror'" }
if ($branches -notcontains $Custom) { Fail "缺少分支 '$Custom'" }

# 3. 拉取上游
Info "git fetch $Upstream"
git fetch $Upstream
if ($LASTEXITCODE -ne 0) { Fail "fetch 失败" }

$upstreamMain = git rev-parse "$Upstream/main"
$mainSha      = git rev-parse $Mirror
$customBefore = git rev-parse $Custom

# 4. 更新 main（纯镜像，仅接受快进；拒绝本地分叉）
if ($mainSha -eq $upstreamMain) {
    Write-Host "==> $Mirror 已与 $Upstream/main 一致，跳过更新" -ForegroundColor Green
}
else {
    git merge-base --is-ancestor $Mirror "$Upstream/main"
    if ($LASTEXITCODE -ne 0) {
        Fail "$Mirror 不是纯上游镜像（存在本地提交，不可自动同步）。请人工确认后处理。"
    }
    Info "更新 $Mirror -> $Upstream/main（快进）"
    if ($DryRun) {
        Write-Host "    [dry-run] git checkout $Mirror && git merge --ff-only $Upstream/main"
    }
    else {
        git checkout $Mirror
        git merge --ff-only "$Upstream/main"
        if ($LASTEXITCODE -ne 0) { Fail "更新 $Mirror 失败" }
    }
}

# 5. 更新 custom（rebase 或 merge）
$strategy = if ($Merge) { 'merge' } else { 'rebase' }

if ($DryRun) {
    Write-Host "    [dry-run] git checkout $Custom && git $strategy $Mirror"
    exit 0
}

git checkout $Custom
Info "git $strategy $Mirror -> $Custom"

if ($Merge) {
    git merge $Mirror --no-edit
}
else {
    git rebase $Mirror
}

if ($LASTEXITCODE -ne 0) {
    # 冲突：回滚并列出冲突文件
    if ($Merge) { git merge --abort } else { git rebase --abort }
    $conflicts = git diff --name-only --diff-filter=U
    Fail "同步冲突，已回滚到 $CustomBefore。冲突文件：`n$conflicts`n请手动解决后重跑。"
}

$customAfter = git rev-parse $Custom
Write-Host "==> 完成：$Custom 已同步到 $Upstream/main" -ForegroundColor Green
Write-Host "    upstream/main : $upstreamMain"
Write-Host "    custom 同步前 : $customBefore"
Write-Host "    custom 同步后 : $customAfter"
