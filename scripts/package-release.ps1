param([string]$OutputDirectory = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$work = Join-Path $root ('build\package-' + [guid]::NewGuid().ToString('N'))
$release = if ($OutputDirectory) { [IO.Path]::GetFullPath($OutputDirectory) } else { Join-Path $root ('release\' + $version) }
New-Item -ItemType Directory -Force -Path $work,$release | Out-Null
$zip = Join-Path $release ('yt-dlp-Studio-' + $version + '-win-x64-portable.zip')
$setup = Join-Path $release ('yt-dlp-Studio-' + $version + '-win-x64-Setup.exe')
if ((Test-Path -LiteralPath $zip) -or (Test-Path -LiteralPath $setup)) { throw 'Release files already exist; choose another OutputDirectory.' }
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$refs = @('/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.IO.Compression.dll','/reference:System.IO.Compression.FileSystem.dll','/reference:Microsoft.CSharp.dll')
$source = Join-Path $PSScriptRoot 'Installer.cs'
Add-Type -AssemblyName System.IO.Compression.FileSystem
foreach ($mode in @('portable','online')) {
    $stage = Join-Path $work $mode
    $publish = Join-Path $work ($mode + '-desktop')
    $selfContained = if ($mode -eq 'portable') { 'true' } else { 'false' }
    & dotnet publish (Join-Path $root 'desktop\Studio.Desktop.csproj') -c Release -o $publish --nologo "-p:SelfContained=$selfContained" '-p:PublishSingleFile=true'
    if ($LASTEXITCODE -ne 0) { throw "Desktop build failed: $mode" }
    New-Item -ItemType Directory -Path $stage | Out-Null
    Get-ChildItem -LiteralPath $publish | Where-Object Extension -ne '.xml' | Copy-Item -Destination $stage -Recurse
    foreach ($folder in @('public','lib','licenses')) { Copy-Item -LiteralPath (Join-Path $root $folder) -Destination $stage -Recurse }
    foreach ($name in @('server.mjs','README.md','启动.vbs','启动.cmd','安装下载组件.cmd')) { Copy-Item -LiteralPath (Join-Path $root $name) -Destination $stage }
    New-Item -ItemType Directory -Path (Join-Path $stage 'scripts') | Out-Null
    foreach ($name in @('setup.ps1','ensure-dependencies.ps1','pick-folder.ps1','build-tray.ps1','TrayApp.cs','launch.ps1')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $stage 'scripts') }
    if ($mode -eq 'portable') {
        New-Item -ItemType Directory -Path (Join-Path $stage 'bin') | Out-Null
        foreach ($name in @('node.exe','yt-dlp.exe','ffmpeg.exe','ffprobe.exe')) { Copy-Item -LiteralPath (Join-Path $root ('bin\'+$name)) -Destination (Join-Path $stage 'bin') }
        [IO.Compression.ZipFile]::CreateFromDirectory($stage,$zip,[IO.Compression.CompressionLevel]::Optimal,$false)
    } else {
        & $compiler /nologo /target:winexe /platform:x64 /optimize+ /codepage:65001 /define:UNINSTALL ('/out:'+(Join-Path $stage 'Uninstall.exe')) @refs $source
        if ($LASTEXITCODE -ne 0) { throw 'Uninstaller compilation failed' }
        $payload = Join-Path $work 'online-payload.zip'
        [IO.Compression.ZipFile]::CreateFromDirectory($stage,$payload,[IO.Compression.CompressionLevel]::Optimal,$false)
        & $compiler /nologo /target:winexe /platform:x64 /optimize+ /codepage:65001 ('/win32icon:'+(Join-Path $root 'desktop\app.ico')) ('/resource:'+$payload+',payload.zip') ('/out:'+$setup) @refs $source
        if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed' }
    }
}
@($setup,$zip) | ForEach-Object { (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant()+'  '+[IO.Path]::GetFileName($_) } | Set-Content (Join-Path $release 'SHA256SUMS.txt') -Encoding ascii
Get-ChildItem -LiteralPath $release -File | Select-Object Name,Length
