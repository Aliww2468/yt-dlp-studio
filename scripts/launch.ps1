param([ValidateRange(1024, 65535)][int]$Port = 47831)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$app = Join-Path $root 'yt-dlp Studio.exe'
if (-not (Test-Path -LiteralPath $app)) { throw 'Missing yt-dlp Studio.exe. Run scripts/build-desktop.ps1 first.' }
# The desktop process owns single-instance activation; no browser is launched.
Start-Process -FilePath $app -WorkingDirectory $root