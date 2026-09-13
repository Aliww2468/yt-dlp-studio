$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$bin = Join-Path $root 'bin'
New-Item -ItemType Directory -Force -Path $bin | Out-Null
$headers = @{ 'User-Agent' = 'yt-dlp-studio-local' }
function Download($url, $dest) {
    & curl.exe --fail --location --retry 3 --connect-timeout 20 --output $dest $url
    if ($LASTEXITCODE -ne 0) { throw "Download failed: $url" }
}
if (-not (Test-Path -LiteralPath (Join-Path $bin 'yt-dlp.exe'))) {
    Write-Host 'Downloading official yt-dlp...'
    $release = Invoke-RestMethod 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest' -Headers $headers
    $asset = $release.assets | Where-Object name -eq 'yt-dlp.exe'
    $dest = Join-Path $bin 'yt-dlp.download'
    Download $asset.browser_download_url $dest
    $sumsFile = Join-Path $bin 'SHA2-256SUMS'
    Download ($release.assets | Where-Object name -eq 'SHA2-256SUMS').browser_download_url $sumsFile
    $sums = Get-Content -LiteralPath $sumsFile -Raw
    $expected = (($sums -split "`n" | Where-Object { $_ -match '\s+\*?yt-dlp\.exe\s*$' }) -split '\s+')[0]
    if (-not $expected -or (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash -ne $expected) { throw 'yt-dlp checksum mismatch' }
    Move-Item -LiteralPath $dest -Destination (Join-Path $bin 'yt-dlp.exe') -Force
}
if (-not (Test-Path -LiteralPath (Join-Path $bin 'ffmpeg.exe')) -or -not (Test-Path -LiteralPath (Join-Path $bin 'ffprobe.exe'))) {
    Write-Host 'Downloading FFmpeg from yt-dlp/FFmpeg-Builds...'
    $release = Invoke-RestMethod 'https://api.github.com/repos/yt-dlp/FFmpeg-Builds/releases/latest' -Headers $headers
    $asset = $release.assets | Where-Object name -eq 'ffmpeg-master-latest-win64-gpl.zip'
    if (-not $asset) { throw 'Windows FFmpeg release asset was not found' }
    $zip = Join-Path $bin 'ffmpeg-download.zip'
    Download $asset.browser_download_url $zip
    if ($asset.digest -and $asset.digest.StartsWith('sha256:')) {
        if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne $asset.digest.Substring(7)) { throw 'FFmpeg checksum mismatch' }
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($zip)
    try {
        foreach ($name in @('ffmpeg.exe', 'ffprobe.exe')) {
            $entry = $archive.Entries | Where-Object { $_.Name -eq $name } | Select-Object -First 1
            if (-not $entry) { throw "Missing $name in archive" }
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $bin $name), $true)
        }
    } finally { $archive.Dispose() }
    Remove-Item -LiteralPath $zip
}
& (Join-Path $bin 'yt-dlp.exe') --version
& (Join-Path $bin 'ffmpeg.exe') -version | Select-Object -First 1
Write-Host 'All download components are ready.'
