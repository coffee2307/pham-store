# PHAM P0-P1: scoped manual deployment to the EXISTING live Shopify theme.
# This file does NOT create, duplicate or publish a theme.
# Shopify Admin connector cannot write to MAIN; run this manually with
# an authenticated Shopify CLI session only after reviewing the file list.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

$store = 'yszwe3-yd.myshopify.com'
$mainThemeId = '167387103488'

$files = @(
  'assets/pham-campaign.js',
  'sections/pham-reservation-gateway.liquid',
  'blocks/_announcement.liquid',
  'blocks/_blog-post-description.liquid',
  'sections/pham-article.liquid',
  'sections/pham-blog-grid.liquid',
  'sections/pham-product-focus.liquid',
  'sections/pham-product-spotlight.liquid',
  'snippets/meta-tags.liquid',
  'snippets/pham-seo-description.liquid',
  'snippets/pham-structured-data.liquid',
  'snippets/resource-card.liquid',
  'snippets/pham-richtext-plain.liquid'
)

$head = (git rev-parse HEAD).Trim()
$origin = (git rev-parse origin/main).Trim()
if ($LASTEXITCODE -ne 0 -or $head -ne $origin) {
  throw 'Local and origin/main are not synchronized. Stop before deploying.'
}

$dirty = @(git status --porcelain --untracked-files=no)
if ($dirty.Count -gt 0) {
  throw 'Tracked working tree has uncommitted changes. Stop before deploying.'
}

foreach ($file in $files) {
  if (-not (Test-Path -LiteralPath (Join-Path $root $file))) {
    throw "Missing required theme file: $file"
  }
}

Write-Host 'PHAM - P0/P1 MANUAL PUSH TO EXISTING MAIN THEME'
Write-Host "Store: $store"
Write-Host "Existing live theme ID: $mainThemeId"
Write-Host "Commit: $head"
Write-Host 'Only these 13 files will be uploaded:'
$files | ForEach-Object { Write-Host " - $_" }
Write-Host 'No config/settings_data.json, products, prices or policies will be changed.'
Write-Host 'No theme will be created or published.'
Write-Host ''
Write-Host 'Check the target theme ID against Online Store > Themes before proceeding.'
$answer = Read-Host 'To proceed, enter the exact text: UPDATE MAIN 167387103488'
if ($answer -ne 'UPDATE MAIN 167387103488') {
  throw 'Cancelled; no files uploaded.'
}

$cliArgs = @('theme', 'push', '--store', $store, '--theme', $mainThemeId,
             '--allow-live', '--nodelete')
foreach ($file in $files) {
  $cliArgs += @('--only', $file)
}
& shopify @cliArgs
if ($LASTEXITCODE -ne 0) {
  throw "Shopify CLI returned exit code $LASTEXITCODE; check authentication and theme permissions."
}
Write-Host 'Scoped P0-P1 theme push finished. Verify live pages and payment gates.'
