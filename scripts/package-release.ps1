$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $root ('build\package-' + [guid]::NewGuid().ToString('N'))
$release = Join-Path $root 'release'
New-Item -ItemType Directory -Force -Path $stage,$release | Out-Null
foreach ($folder in @('public','lib','licenses')) { Copy-Item -LiteralPath (Join-Path $root $folder) -Destination $stage -Recurse }
foreach ($name in @('yt-dlp Studio.exe','server.mjs','README.md','启动.vbs','启动.cmd','安装下载组件.cmd')) { Copy-Item -LiteralPath (Join-Path $root $name) -Destination $stage }
New-Item -ItemType Directory -Path (Join-Path $stage 'bin'),(Join-Path $stage 'scripts') | Out-Null
foreach ($name in @('node.exe','yt-dlp.exe','ffmpeg.exe','ffprobe.exe')) { Copy-Item -LiteralPath (Join-Path $root ('bin\'+$name)) -Destination (Join-Path $stage 'bin') }
foreach ($name in @('setup.ps1','pick-folder.ps1','build-tray.ps1','TrayApp.cs','launch.ps1')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $stage 'scripts') }
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$refs = @('/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.IO.Compression.dll','/reference:System.IO.Compression.FileSystem.dll','/reference:Microsoft.CSharp.dll')
$source = Join-Path $PSScriptRoot 'Installer.cs'
& $compiler /nologo /target:winexe /platform:x64 /optimize+ /codepage:65001 /define:UNINSTALL ('/out:'+(Join-Path $stage 'Uninstall.exe')) @refs $source
if ($LASTEXITCODE -ne 0) { throw 'Uninstaller compilation failed' }
$zip = Join-Path $release 'yt-dlp-Studio-1.0.0-win-x64-portable.zip'
if (Test-Path -LiteralPath $zip) { throw 'Release ZIP already exists; choose a new version or archive it first.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($stage,$zip,[IO.Compression.CompressionLevel]::Optimal,$false)
$setup = Join-Path $release 'yt-dlp-Studio-1.0.0-win-x64-Setup.exe'
& $compiler /nologo /target:winexe /platform:x64 /optimize+ /codepage:65001 ('/win32icon:'+(Join-Path $root 'desktop\app.ico')) ('/resource:'+$zip+',payload.zip') ('/out:'+$setup) @refs $source
if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed' }
Get-ChildItem -LiteralPath $release -File | Where-Object Extension -in '.exe','.zip' | ForEach-Object { (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()+'  '+$_.Name } | Set-Content (Join-Path $release 'SHA256SUMS.txt') -Encoding ascii
Get-ChildItem -LiteralPath $release -File | Select-Object Name,Length
