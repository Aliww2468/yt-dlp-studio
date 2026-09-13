param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot),
    [switch]$CheckOnly,
    [switch]$UpdateEngine,
    [switch]$FunctionsOnly
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Root = [IO.Path]::GetFullPath($Root)
$bin = Join-Path $Root 'bin'
$headers = @{ 'User-Agent' = 'yt-dlp-studio-installer' }
$script:rebootRequired = $false

function Probe([string]$File, [string]$Arguments) {
    if (-not $File -or -not (Test-Path -LiteralPath $File -PathType Leaf)) { return $null }
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $File; $info.Arguments = $Arguments
    $info.UseShellExecute = $false; $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
    $p = New-Object Diagnostics.Process
    $p.StartInfo = $info
    try {
        if (-not $p.Start()) { return $null }
        $out = $p.StandardOutput.ReadToEndAsync(); $err = $p.StandardError.ReadToEndAsync()
        if (-not $p.WaitForExit(15000)) { $p.Kill(); return $null }
        if ($p.ExitCode -eq 0) { return $out.Result }
    } catch { return $null } finally { $p.Dispose() }
    return $null
}

function Candidates([string]$Name) {
    Join-Path $bin $Name
    $manifest = Join-Path $Root 'dependencies.json'
    if (Test-Path -LiteralPath $manifest) {
        try {
            $saved = Get-Content -LiteralPath $manifest -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($Name -eq 'node.exe' -and $saved.node) { $saved.node }
            if ($Name -eq 'yt-dlp.exe' -and $saved.engine) { $saved.engine }
            if ($Name -eq 'ffmpeg.exe' -and $saved.ffmpegDir) { Join-Path $saved.ffmpegDir $Name }
        } catch { }
    }
    Get-Command $Name -CommandType Application -All -ErrorAction SilentlyContinue | ForEach-Object Source
}

function Find-Node {
    foreach ($file in (Candidates 'node.exe' | Select-Object -Unique)) {
        $version = Probe $file '--version'
        if ($version -match '^v(\d+)\.' -and [int]$Matches[1] -ge 22 -and ([string](Probe $file '-p process.arch')).Trim() -eq 'x64') { return $file }
    }
    return $null
}
function Find-Engine {
    foreach ($file in (Candidates 'yt-dlp.exe' | Select-Object -Unique)) {
        if ((Probe $file '--ignore-config --no-plugin-dirs --version') -match '^20\d\d\.\d\d\.\d\d' -and (Probe $file '--ignore-config --no-plugin-dirs --help') -match '--js-runtimes') { return $file }
    }
    return $null
}
function Find-FFmpeg {
    foreach ($file in (Candidates 'ffmpeg.exe' | Select-Object -Unique)) {
        $folder = Split-Path -Parent $file
        if ((Probe $file '-version') -match '^ffmpeg version' -and (Probe (Join-Path $folder 'ffprobe.exe') '-version') -match '^ffprobe version') { return $folder }
    }
    return $null
}
function Find-DesktopRuntime {
    $runtime = Join-Path $env:ProgramFiles 'dotnet\dotnet.exe'
    $versions = Probe $runtime '--list-runtimes'
    return ($versions -match '(?m)^Microsoft.WindowsDesktop.App 8\.0\.\d+ ' -and $versions -match '(?m)^Microsoft.NETCore.App 8\.0\.\d+ ')
}
function Find-WebView {
    foreach ($key in @('HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}')) {
        $value = Get-ItemProperty -LiteralPath $key -Name pv -ErrorAction SilentlyContinue
        if ($value.pv -and $value.pv -ne '0.0.0.0') { return $true }
    }
    return $false
}
function Fetch([string]$Url, [string]$Destination) {
    if (-not $Url.StartsWith('https://')) { throw '下载地址必须使用 HTTPS。' }
    Write-Output ('正在下载：' + [IO.Path]::GetFileName($Destination))
    $request = [Net.HttpWebRequest]::Create($Url)
    $request.UserAgent = 'yt-dlp-studio-installer'; $request.Timeout = 30000; $request.ReadWriteTimeout = 60000
    $response = $request.GetResponse()
    try {
        $stream = $response.GetResponseStream(); $target = [IO.File]::Create($Destination)
        try {
            $buffer = New-Object byte[] 262144; $total = 0L; $last = [DateTime]::UtcNow
            while (($count = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                $target.Write($buffer, 0, $count); $total += $count
                if (([DateTime]::UtcNow - $last).TotalSeconds -ge 2) {
                    $progress = if ($response.ContentLength -gt 0) { ' / ' + [math]::Round($response.ContentLength / 1MB, 1) + ' MB' } else { ' MB' }
                    Write-Output ('已下载 ' + [math]::Round($total / 1MB, 1) + $progress)
                    $last = [DateTime]::UtcNow
                }
            }
        } finally { $target.Dispose(); $stream.Dispose() }
    } finally { $response.Dispose() }
}
function Verify-Hash([string]$File, [string]$Expected, [string]$Algorithm = 'SHA256') {
    if (-not $Expected -or (Get-FileHash -LiteralPath $File -Algorithm $Algorithm).Hash -ne $Expected) { throw ('文件校验失败：' + [IO.Path]::GetFileName($File)) }
}
function Run-MicrosoftInstaller([string]$File, [string]$Arguments) {
    $signature = Get-AuthenticodeSignature -LiteralPath $File
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation(?:,|$)') { throw 'Microsoft 安装程序签名校验失败。' }
    Write-Output '正在安装系统组件；如 Windows 请求授权，请确认后继续。'
    $p = Start-Process -FilePath $File -ArgumentList $Arguments -Wait -PassThru
    if ($p.ExitCode -eq 3010) { $script:rebootRequired = $true }
    elseif ($p.ExitCode -ne 0) { throw ('组件安装未完成，退出码：' + $p.ExitCode) }
}
function Extract-One([string]$Zip, [string]$Name, [string]$Destination) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($Zip)
    try {
        $entry = $archive.Entries | Where-Object Name -eq $Name | Select-Object -First 1
        if (-not $entry) { throw ('压缩包缺少 ' + $Name) }
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $Destination, $true)
    } finally { $archive.Dispose() }
}

function Install-Dependencies {
$scratch = $null
try {
    if (-not [Environment]::Is64BitOperatingSystem -or -not [Environment]::Is64BitProcess) { throw '请在 Windows x64 中运行安装程序。' }
    $node = Find-Node; $engine = Find-Engine; $ffmpeg = Find-FFmpeg
    $desktop = Find-DesktopRuntime; $webview = Find-WebView
    $status = [ordered]@{ '.NET Desktop 8 x64'=$desktop; 'WebView2'=$webview; 'Node.js 22+ x64'=[bool]$node; 'yt-dlp'=[bool]$engine; 'FFmpeg + FFprobe'=[bool]$ffmpeg }
    foreach ($name in $status.Keys) { Write-Output ($name + '：' + $(if ($status[$name]) { '已检测到，将复用' } else { '缺少，需要下载' })) }
    if ($CheckOnly) { return }
    New-Item -ItemType Directory -Force -Path $bin | Out-Null
    $scratch = Join-Path $Root ('dependency-download-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $scratch | Out-Null
    if (-not $UpdateEngine) {
        if (-not $desktop) {
            $metadata = Invoke-RestMethod 'https://builds.dotnet.microsoft.com/dotnet/release-metadata/8.0/releases.json' -Headers $headers
            $runtimeFile = $metadata.releases[0].windowsdesktop.files | Where-Object { $_.rid -eq 'win-x64' -and $_.name -like '*.exe' } | Select-Object -First 1
            if (-not $runtimeFile) { throw '无法获取 .NET Desktop 下载信息。' }
            $file = Join-Path $scratch 'windowsdesktop-runtime.exe'
            Fetch $runtimeFile.url $file; Verify-Hash $file $runtimeFile.hash 'SHA512'
            Run-MicrosoftInstaller $file '/install /quiet /norestart'
            if (-not (Find-DesktopRuntime)) { throw '.NET Desktop 安装后未通过检测，请重启电脑后重试。' }
            Write-Output '.NET Desktop：已安装'
        }
        if (-not $webview) {
            $file = Join-Path $scratch 'MicrosoftEdgeWebview2Setup.exe'
            Fetch 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' $file
            Run-MicrosoftInstaller $file '/silent /install'
            if (-not (Find-WebView)) { throw 'WebView2 安装后未通过检测，请重试。' }
            Write-Output 'WebView2：已安装'
        }
        if (-not $node) {
            $versions = Invoke-RestMethod 'https://nodejs.org/dist/index.json' -Headers $headers
            $version = ($versions | Where-Object { $_.version -match '^v24\.' -and $_.lts } | Select-Object -First 1).version
            if (-not $version) { throw '无法获取 Node.js LTS 下载信息。' }
            $name = 'node-' + $version + '-win-x64.zip'
            $url = 'https://nodejs.org/dist/' + $version + '/'
            $zip = Join-Path $scratch $name
            Fetch ($url + $name) $zip
            $sumFile = Join-Path $scratch 'SHASUMS256.txt'; Fetch ($url + 'SHASUMS256.txt') $sumFile
            $sums = [IO.File]::ReadAllText($sumFile)
            $expected = (($sums -split "`n" | Where-Object { $_.Trim().EndsWith('  ' + $name) }) -split '\s+')[0]
            Verify-Hash $zip $expected
            $node = Join-Path $bin 'node.exe'; Extract-One $zip 'node.exe' $node
            if (-not (Find-Node)) { throw 'Node.js 安装后未通过检测。' }
            Write-Output 'Node.js：已下载到软件目录'
        }
    }
    if (-not $engine -or $UpdateEngine) {
        $release = Invoke-RestMethod 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest' -Headers $headers
        $asset = $release.assets | Where-Object name -eq 'yt-dlp.exe' | Select-Object -First 1
        $sumsAsset = $release.assets | Where-Object name -eq 'SHA2-256SUMS' | Select-Object -First 1
        if (-not $asset -or -not $sumsAsset) { throw '无法获取 yt-dlp 下载信息。' }
        $file = Join-Path $scratch 'yt-dlp.exe'; Fetch $asset.browser_download_url $file
        $sumFile = Join-Path $scratch 'SHA2-256SUMS'; Fetch $sumsAsset.browser_download_url $sumFile
        $sums = [IO.File]::ReadAllText($sumFile)
        $expected = (($sums -split "`n" | Where-Object { $_ -match '\s+\*?yt-dlp\.exe\s*$' }) -split '\s+')[0]
        Verify-Hash $file $expected
        $engine = Join-Path $bin 'yt-dlp.exe'; Move-Item -LiteralPath $file -Destination $engine -Force
        if (-not (Find-Engine)) { throw 'yt-dlp 安装后未通过检测。' }
        Write-Output 'yt-dlp：已下载到软件目录'
    }
    if ($UpdateEngine) { return }
    if (-not $ffmpeg) {
        $release = Invoke-RestMethod 'https://api.github.com/repos/yt-dlp/FFmpeg-Builds/releases/latest' -Headers $headers
        $asset = $release.assets | Where-Object name -eq 'ffmpeg-master-latest-win64-gpl.zip' | Select-Object -First 1
        if (-not $asset -or $asset.digest -notmatch '^sha256:([a-fA-F0-9]{64})$') { throw '无法获取 FFmpeg 下载信息或校验值，请稍后重试。' }
        $expected = $Matches[1]; $zip = Join-Path $scratch 'ffmpeg.zip'
        Fetch $asset.browser_download_url $zip; Verify-Hash $zip $expected
        foreach ($name in @('ffmpeg.exe','ffprobe.exe')) { Extract-One $zip $name (Join-Path $bin $name) }
        $ffmpeg = Find-FFmpeg
        if (-not $ffmpeg) { throw 'FFmpeg 安装后未通过检测。' }
        Write-Output 'FFmpeg + FFprobe：已下载到软件目录'
    }
    $configuration = @{ node=$node; engine=$engine; ffmpegDir=$ffmpeg } | ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path $Root 'dependencies.json'), $configuration, (New-Object Text.UTF8Encoding($false)))
    Write-Output '组件检查完成，全部可用。'
    if ($script:rebootRequired) { Write-Output '系统组件要求重启电脑，建议重启后打开软件。' }
}
finally {
    if ($scratch -and (Test-Path -LiteralPath $scratch)) {
        $resolvedScratch = [IO.Path]::GetFullPath($scratch)
        if ($resolvedScratch.StartsWith($Root.TrimEnd('\') + '\dependency-download-', [StringComparison]::OrdinalIgnoreCase)) { Remove-Item -LiteralPath $resolvedScratch -Recurse -Force -ErrorAction SilentlyContinue }
    }
}
}
if (-not $FunctionsOnly) {
    try { Install-Dependencies } catch { Write-Output ('失败：' + $_.Exception.Message); exit 1 }
}
