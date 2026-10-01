#!/usr/bin/env pwsh
<#
.SYNOPSIS
  起一个开发用的 DSH 测试宿主：加载本插件，并打开宿主半区热重载。

.DESCRIPTION
  宿主半区（lib/*.js）在 DSH 启动时被冻结成模块图，改完通常必须重启 DSH——而重启会
  掐断正在跑的 agent 会话。本脚本另起一个测试宿主跑在别的端口，并补上 HMR 需要的
  config.base，于是改完 lib/*.js 立即生效，主会话不受影响。

  为什么要脚本而不是直接提交一份 yml：HMR 的 base 必须是**本机绝对路径**的 file://
  URL，天然机器相关。脚本按自身位置推算路径，生成 scripts/dev-overlay.local.yml
  （已 gitignore），仓库里不留任何机器路径。

  适用范围：只有**宿主半区**的改动需要它。只改 src/client.ts（浏览器半区）的话，
  刷新浏览器即可，不必起测试宿主。

.PARAMETER Port
  测试宿主端口，默认 43121。

.PARAMETER ProfileName
  DSH profile 名，默认 web。

.PARAMETER NoHmr
  不注入 HMR 覆盖层，只起一个测试宿主（改宿主半区就得重启它）。

.EXAMPLE
  pwsh -File scripts/dev-host.ps1

.EXAMPLE
  pwsh -File scripts/dev-host.ps1 -Port 43122 -NoHmr
#>
[CmdletBinding()]
param(
  [int]$Port = 43121,
  [string]$ProfileName = 'web',
  [switch]$NoHmr
)

$ErrorActionPreference = 'Stop'

# 子进程（尤其 stdout 被重定向/管道时）默认可能用系统 ANSI 代码页输出，中文会乱码。
# 显式钉成 UTF-8；没有控制台时忽略失败。
try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch { }

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$libDir = Join-Path $repoRoot 'lib'
$entry = Join-Path $libDir 'index.js'
if (-not (Test-Path $entry)) {
  throw "找不到 $entry —— 先跑 npm run build。"
}

$dshCmd = Get-Command dsh -ErrorAction SilentlyContinue
if ($null -eq $dshCmd) {
  throw "PATH 上找不到 dsh。它通常由 DeepSeek Harness 安装器放进 PATH；也可以改用 dsh.ps1 的绝对路径调用。"
}

# 插件必须已经装进 profile：HMR 覆盖层只负责补 base，不会替你加载插件。
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
$installed = Join-Path $dshHome "profiles\$ProfileName\node_modules\dsh-game-material-master"
if (-not (Test-Path $installed)) {
  Write-Warning "profile '$ProfileName' 里没找到本插件，测试宿主里不会出现「游戏素材大师」。"
  Write-Warning "先安装：dsh plugin --profile $ProfileName add `"$repoRoot`""
}

$dshArgs = @('--profile', $ProfileName)

if (-not $NoHmr) {
  # 覆盖 profile 里已有的 hmr 行，给它补上必填的 base。
  #   · 不能 insert 一个 @deepseek-ai/cordis-plugin-hmr：那个包在 DSH 0.2.0-rc.2 里
  #     已经不存在了，插进去会静默失效（宿主照常启动、没有热重载、不报错）。
  #   · base 会被 new URL(base, ctx.baseUrl) 解析，所以必须是 file:// URL；
  #     写成 G:/... 会被当成 g: scheme 而抛 ERR_INVALID_URL_SCHEME。
  #   · config 是整体替换、不做深合并，root / debounce 要一起写全。
  $libUrl = 'file:///' + ($libDir -replace '\\', '/')
  $overlay = Join-Path $PSScriptRoot 'dev-overlay.local.yml'
  $content = @"
# 由 scripts/dev-host.ps1 生成 —— 含本机绝对路径，已 gitignore，请勿提交。
- id: hmr
  name: '@deepseek-ai/dsh-hmr'
  config:
    base: $libUrl
    root: ["."]
    debounce: 150
"@
  # 显式写无 BOM 的 UTF-8：带 BOM 会让 YAML 解析出问题。
  [System.IO.File]::WriteAllText($overlay, $content, [System.Text.UTF8Encoding]::new($false))
  $dshArgs += @('--patch', $overlay)
  Write-Host "HMR base     : $libUrl"
}

$dshArgs += @('--port', "$Port", '--no-open')

Write-Host "启动测试宿主 : dsh $($dshArgs -join ' ')"
Write-Host "探针         : http://127.0.0.1:$Port/dsh-game-material-master/_health  (builtAtMs 变了才算吃到新代码)"
Write-Host "提示         : 与日常 GUI 共享 `$DSH_HOME，别同时跑批任务。"
Write-Host ""

& $dshCmd.Source @dshArgs
exit $LASTEXITCODE
