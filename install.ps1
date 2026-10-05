# dsh-session-shred installer (Windows)
# Copies the plugin to a stable location (~/.dsh/local-plugins) and installs it
# into the desktop and web profiles via `dsh plugin add`, then adds it to each
# profile's bundle list.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File install.ps1
# After it finishes, restart DSH (refresh the web page / restart the app).

$ErrorActionPreference = 'Stop'

$Home = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$StableDir = Join-Path $Home 'local-plugins\dsh-session-shred'
$Profiles = @('desktop', 'web')

$Node = Join-Path $Home 'dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
if (-not (Test-Path $Node)) {
  $Node = (Get-Command node -ErrorAction SilentlyContinue).Source
}
$DshBin = Join-Path $env:APPDATA 'npm\node_modules\@deepseek-ai\dsh\lib\bin.js'
if (-not (Test-Path $DshBin)) {
  throw '未找到 dsh CLI（%APPDATA%\npm\node_modules\@deepseek-ai\dsh\lib\bin.js）'
}

# 1. Copy plugin source to a stable location (exclude node_modules, .git).
Write-Host "==> 复制插件到 $StableDir"
if (Test-Path $StableDir) { Remove-Item $StableDir -Recurse -Force }
New-Item -ItemType Directory -Path $StableDir -Force | Out-Null
$Src = $PSScriptRoot
Copy-Item (Join-Path $Src 'package.json') $StableDir
Copy-Item (Join-Path $Src 'cordis.patch.yml') $StableDir
Copy-Item (Join-Path $Src 'README.md') $StableDir
Copy-Item (Join-Path $Src 'lib') $StableDir -Recurse

# 2. Install into each profile.
foreach ($p in $Profiles) {
  $profileDir = Join-Path $Home "profiles\$p"
  if (-not (Test-Path (Join-Path $profileDir 'package.json'))) {
    Write-Host "跳过 profile '$p'（不存在）"
    continue
  }
  Write-Host "==> 安装到 profile '$p'"
  & $Node $DshBin plugin --profile $p add "file:$StableDir"
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "profile '$p' 安装返回码 $LASTEXITCODE"
  }
}

# 3. Ensure the bundle is listed in each profile's dsh.profile.bundles.
foreach ($p in $Profiles) {
  $manifest = Join-Path $Home "profiles\$p\package.json"
  if (-not (Test-Path $manifest)) { continue }
  $json = Get-Content $manifest -Raw | ConvertFrom-Json
  $bundles = @($json.dsh.profile.bundles)
  if ($bundles -notcontains 'dsh-session-shred') {
    $bundles += 'dsh-session-shred'
    $json.dsh.profile.bundles = $bundles
    $json | ConvertTo-Json -Depth 20 | Set-Content $manifest -Encoding UTF8
    Write-Host "已把 dsh-session-shred 加入 profile '$p' 的 bundles"
  } else {
    Write-Host "profile '$p' 已包含 dsh-session-shred"
  }
}

Write-Host ''
Write-Host '安装完成。请重启 DSH（刷新网页 / 重启桌面应用）后生效。'
