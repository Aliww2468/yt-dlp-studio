$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$desktop = Join-Path $root 'desktop'
$output = Join-Path $root 'build\desktop'
$node = (Get-Command node.exe -ErrorAction Stop).Source
New-Item -ItemType Directory -Force -Path (Join-Path $root 'bin') | Out-Null
if ([IO.Path]::GetFullPath($node) -ne [IO.Path]::GetFullPath((Join-Path $root 'bin\node.exe'))) {
    Copy-Item -LiteralPath $node -Destination (Join-Path $root 'bin\node.exe') -Force
}

# Code-drawn download icon, embedded in the executable and used in the title bar.
Add-Type -AssemblyName System.Drawing
$bitmap = New-Object Drawing.Bitmap 64,64
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$pen = New-Object Drawing.Pen ([Drawing.Color]::FromArgb(39,105,230)),6
$pen.StartCap = $pen.EndCap = [Drawing.Drawing2D.LineCap]::Round
$pen.LineJoin = [Drawing.Drawing2D.LineJoin]::Round
$graphics.DrawLine($pen,32,8,32,42)
$graphics.DrawLines($pen,[Drawing.Point[]]@([Drawing.Point]::new(18,28),[Drawing.Point]::new(32,42),[Drawing.Point]::new(46,28)))
$graphics.DrawLines($pen,[Drawing.Point[]]@([Drawing.Point]::new(10,46),[Drawing.Point]::new(10,56),[Drawing.Point]::new(54,56),[Drawing.Point]::new(54,46)))
$png = New-Object IO.MemoryStream
$bitmap.Save($png,[Drawing.Imaging.ImageFormat]::Png)
$stream = [IO.File]::Create((Join-Path $desktop 'app.ico'))
$writer = New-Object IO.BinaryWriter $stream
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
$writer.Write([byte]64); $writer.Write([byte]64); $writer.Write([byte]0); $writer.Write([byte]0)
$writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$png.Length); $writer.Write([uint32]22)
$writer.Write($png.ToArray())
$writer.Dispose(); $png.Dispose(); $pen.Dispose(); $graphics.Dispose(); $bitmap.Dispose()

& dotnet publish (Join-Path $desktop 'Studio.Desktop.csproj') -c Release -o $output --nologo
if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed.' }
Copy-Item -LiteralPath (Join-Path $output 'yt-dlp Studio.exe') -Destination (Join-Path $root 'yt-dlp Studio.exe') -Force
Write-Output (Join-Path $root 'yt-dlp Studio.exe')
