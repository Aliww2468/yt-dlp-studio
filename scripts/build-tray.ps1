$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $PSScriptRoot 'TrayApp.cs'
$output = Join-Path $root 'bin\yt-dlp-tray.exe'
if ((Test-Path -LiteralPath $output) -and (Get-Item -LiteralPath $output).LastWriteTimeUtc -ge (Get-Item -LiteralPath $source).LastWriteTimeUtc) { exit 0 }
$framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
if (-not (Test-Path -LiteralPath (Join-Path $framework 'csc.exe'))) { $framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319' }
$compiler = Join-Path $framework 'csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'Windows .NET Framework 4 compiler is unavailable.' }
New-Item -ItemType Directory -Force -Path (Join-Path $root 'bin') | Out-Null
& $compiler /nologo /target:winexe /optimize+ /codepage:65001 "/out:$output" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Net.Http.dll /reference:System.Web.Extensions.dll $source
if ($LASTEXITCODE -ne 0) { throw 'Unable to build the Windows tray helper.' }
