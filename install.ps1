# GBP Sphere installer for Windows (PowerShell).
#
#   irm https://raw.githubusercontent.com/sakibsphere/GBP-Sphere/main/install.ps1 | iex
#
# Downloads the latest release zip from GitHub into %USERPROFILE%\SphereGMB and opens that
# folder. Chrome does not let a script install an extension, so you finish with three clicks
# ("Load unpacked"). Run the same command again later to update: the folder is reused, so the
# extension keeps its settings and you only press the reload arrow in chrome://extensions.

$ErrorActionPreference = 'Stop'
$repo = 'sakibsphere/GBP-Sphere'
$target = if ($env:SPHEREGMB_DIR) { $env:SPHEREGMB_DIR } else { Join-Path $env:USERPROFILE 'SphereGMB' }
$zipUrl = "https://github.com/$repo/releases/latest/download/sphere-gmb.zip"
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("sphere-gmb-" + [guid]::NewGuid().ToString('N'))
$zip = "$tmp.zip"

Write-Host "Downloading GBP Sphere from github.com/$repo ..."
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
# SPHEREGMB_ZIP (a local zip) and SPHEREGMB_DIR exist only for testing the installer.
if ($env:SPHEREGMB_ZIP) { Copy-Item $env:SPHEREGMB_ZIP $zip } else { Invoke-WebRequest -Uri $zipUrl -OutFile $zip -UseBasicParsing }

Expand-Archive -Path $zip -DestinationPath $tmp -Force
if (-not (Test-Path (Join-Path $tmp 'manifest.json'))) { throw 'The download does not look like the extension (no manifest.json).' }

# Replace the old copy but keep the same folder, so Chrome treats it as the same extension.
if (Test-Path $target) { Get-ChildItem $target -Force | Remove-Item -Recurse -Force }
else { New-Item -ItemType Directory -Path $target | Out-Null }
Copy-Item -Path (Join-Path $tmp '*') -Destination $target -Recurse -Force
Remove-Item $zip, $tmp -Recurse -Force -ErrorAction SilentlyContinue

$version = (Get-Content (Join-Path $target 'manifest.json') -Raw | ConvertFrom-Json).version
Write-Host ""
Write-Host "GBP Sphere v$version is in: $target" -ForegroundColor Green
Write-Host ""
Write-Host "First time? Finish in your browser (Chrome, Edge, Brave):"
Write-Host "  1. Open chrome://extensions  (edge://extensions or brave://extensions)"
Write-Host "  2. Turn on 'Developer mode' (top right)"
Write-Host "  3. Click 'Load unpacked' and choose: $target"
Write-Host ""
Write-Host "Updating? Click the reload arrow on the GBP Sphere card in chrome://extensions."
if (-not $env:SPHEREGMB_ZIP) { Start-Process explorer.exe $target }
