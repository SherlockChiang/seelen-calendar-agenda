# Renders the Seelen store images into docs/store/ with headless Chrome.
# Needs `npm run preview` running (serves dev/store.html on port 5199).
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root "docs\store"
New-Item -ItemType Directory -Force $out | Out-Null
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$profileDir = Join-Path $env:TEMP "gcal-agenda-store-chrome"

$assets = @(
  @{ name = "screenshot-en.png"; query = "asset=screenshot&lang=en"; size = "1920,1080" },
  @{ name = "screenshot-zh.png"; query = "asset=screenshot&lang=zh-CN"; size = "1920,1080" },
  @{ name = "banner.png"; query = "asset=banner&lang=en"; size = "2100,900" },
  @{ name = "portrait.png"; query = "asset=portrait"; size = "512,512" }
)
foreach ($a in $assets) {
  $file = Join-Path $out $a.name
  Start-Process -FilePath $chrome -Wait -WindowStyle Hidden -ArgumentList @(
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--user-data-dir=$profileDir", "--virtual-time-budget=4000",
    "--window-size=$($a.size)", "--screenshot=$file",
    "http://127.0.0.1:5199/dev/store.html?$($a.query)"
  )
  Write-Output "$($a.name): $((Get-Item $file).Length) bytes"
}
