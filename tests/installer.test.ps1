$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$testRoot = Join-Path $project ('build\installer-tests-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
. (Join-Path $project 'scripts\ensure-dependencies.ps1') -Root $testRoot -FunctionsOnly
function Assert($Condition, $Message) { if (-not $Condition) { throw $Message } }

# Real binaries and real system runtime discovery, with network forbidden.
$env:PATH = (Join-Path $project 'bin') + ';' + $env:PATH
function Fetch { throw 'Network must not be used when all dependencies exist' }
$CheckOnly = $true
Install-Dependencies
Assert (-not (Test-Path (Join-Path $testRoot 'dependencies.json'))) 'CheckOnly modified configuration'
$CheckOnly = $false
Install-Dependencies
$config = Get-Content (Join-Path $testRoot 'dependencies.json') -Raw -Encoding UTF8 | ConvertFrom-Json
Assert ($config.engine -eq (Join-Path $project 'bin\yt-dlp.exe')) 'External engine path was not saved'
Assert (@(Get-ChildItem (Join-Path $testRoot 'bin') -File).Count -eq 0) 'Existing dependencies were copied'
Write-Output 'PASS: actual installed components reused without downloads or copying'

# Controlled fixtures exercise every missing-component branch without installing system software.
$fixture = [Text.Encoding]::UTF8.GetBytes('verified fixture')
$fixtureFile = Join-Path $testRoot 'fixture'
[IO.File]::WriteAllBytes($fixtureFile, $fixture)
$sha256 = (Get-FileHash $fixtureFile -Algorithm SHA256).Hash
$sha512 = (Get-FileHash $fixtureFile -Algorithm SHA512).Hash
$script:downloads = @(); $script:installed = @(); $script:failDownload = $false; $script:badHash = $false
function Candidates([string]$Name) { Join-Path $bin $Name }
function Find-DesktopRuntime { return ('dotnet' -in $script:installed) }
function Find-WebView { return ('webview' -in $script:installed) }
function Run-MicrosoftInstaller([string]$File, [string]$Arguments) {
    if ([IO.Path]::GetFileName($File) -eq 'windowsdesktop-runtime.exe') { $script:installed += 'dotnet' }
    else { $script:installed += 'webview' }
}
function Probe([string]$File, [string]$Arguments) {
    if (-not (Test-Path -LiteralPath $File)) { return $null }
    switch ([IO.Path]::GetFileName($File)) {
        'node.exe' { if ($Arguments -eq '--version') { return 'v24.0.0' }; return 'x64' }
        'yt-dlp.exe' { if ($Arguments -like '*--help') { return '--js-runtimes' }; return '2026.08.19' }
        'ffmpeg.exe' { return 'ffmpeg version test' }
        'ffprobe.exe' { return 'ffprobe version test' }
    }
}
function Invoke-RestMethod([string]$Uri, $Headers) {
    if ($Uri -like '*release-metadata*') { return @{releases=@(@{windowsdesktop=@{files=@(@{rid='win-x64';name='runtime.exe';url='https://fixture/runtime';hash=$sha512})}})} }
    if ($Uri -like '*nodejs.org*') { return @(@{version='v24.0.0';lts='test'}) }
    if ($Uri -like '*FFmpeg-Builds*') { return @{assets=@(@{name='ffmpeg-master-latest-win64-gpl.zip';browser_download_url='https://fixture/ffmpeg';digest=('sha256:'+$sha256)})} }
    return @{assets=@(@{name='yt-dlp.exe';browser_download_url='https://fixture/yt-dlp'},@{name='SHA2-256SUMS';browser_download_url='https://fixture/SHA2-256SUMS'})}
}
function Fetch([string]$Url, [string]$Destination) {
    $script:downloads += $Url
    if ($script:failDownload) { throw 'Simulated network failure' }
    if ($Url -like '*SHASUMS256.txt') { [IO.File]::WriteAllText($Destination, $sha256 + '  node-v24.0.0-win-x64.zip'); return }
    if ($Url -like '*SHA2-256SUMS') { [IO.File]::WriteAllText($Destination, $sha256 + '  yt-dlp.exe'); return }
    [IO.File]::WriteAllBytes($Destination, $fixture)
    if ($script:badHash) { [IO.File]::WriteAllText($Destination, 'corrupt') }
}
function Extract-One([string]$Zip, [string]$Name, [string]$Destination) { Copy-Item -LiteralPath $fixtureFile -Destination $Destination }
$Root = Join-Path $testRoot 'missing'; $bin = Join-Path $Root 'bin'
Install-Dependencies
Assert (Test-Path (Join-Path $Root 'dependencies.json')) 'Missing components did not produce configuration'
Assert ($script:installed.Count -eq 2) 'System prerequisite install branches not exercised'
Assert (@(Get-ChildItem $bin -File).Count -eq 4) 'Download tools were not provisioned'
$before = $script:downloads.Count
Install-Dependencies
Assert ($before -eq $script:downloads.Count) 'Second install downloaded existing components again'
Write-Output 'PASS: missing components provisioned; second run reused all components (controlled fixtures)'

foreach ($failure in @('network','checksum')) {
    $Root = Join-Path $testRoot $failure; $bin = Join-Path $Root 'bin'
    $script:failDownload = $failure -eq 'network'; $script:badHash = $failure -eq 'checksum'
    $failed = $false
    try { Install-Dependencies } catch { $failed = $true }
    Assert $failed ('Expected failure: ' + $failure)
    Assert (-not (Test-Path (Join-Path $Root 'dependencies.json'))) 'Failed download marked install ready'
    Assert (@(Get-ChildItem $Root -Directory -Filter 'dependency-download-*').Count -eq 0) 'Temporary download not cleaned'
}
Write-Output 'PASS: network and checksum failures stop installation and clean temporary files'
