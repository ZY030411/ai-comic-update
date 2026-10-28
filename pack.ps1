# ============================================================
# AI Comic Workstation - portable pack script
# Run: powershell -ExecutionPolicy Bypass -File pack.ps1
# ============================================================
$ErrorActionPreference = "Stop"

$appDir = $PSScriptRoot
$out = Join-Path (Split-Path $appDir -Parent) "AI-Comic-Workstation-Portable"

if (Test-Path $out) {
  Remove-Item -LiteralPath $out -Recurse -Force
}
New-Item -ItemType Directory -Path $out | Out-Null

Write-Host "1/4 Copy Electron runtime..."
$dist = Join-Path $appDir "node_modules\electron\dist"
robocopy $dist $out /E /NFL /NDL /NJH /NJS | Out-Null

Write-Host "2/4 Rename main exe..."
Move-Item (Join-Path $out "electron.exe") (Join-Path $out "AIComicWorkstation.exe")

Write-Host "3/4 Copy app resources..."
$resApp = Join-Path $out "resources\app"
New-Item -ItemType Directory -Path $resApp | Out-Null
Copy-Item -LiteralPath (Join-Path $appDir "main.js") $resApp
Copy-Item -LiteralPath (Join-Path $appDir "preload.js") $resApp
Copy-Item -LiteralPath (Join-Path $appDir "package.json") $resApp
Copy-Item -LiteralPath (Join-Path $appDir "renderer") (Join-Path $resApp "renderer") -Recurse
Copy-Item -LiteralPath (Join-Path $appDir "samples") (Join-Path $resApp "samples") -Recurse

Write-Host "4/4 Copy runtime deps (exclude electron)..."
robocopy (Join-Path $appDir "node_modules") (Join-Path $resApp "node_modules") /E /XD electron /NFL /NDL /NJH /NJS | Out-Null

Write-Host "Done: $out"
