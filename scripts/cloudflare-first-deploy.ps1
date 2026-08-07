param(
  [string]$DatabaseName = "masar-crm-production",
  [ValidateSet("weur", "eeur", "apac", "oc", "wnam", "enam")]
  [string]$Location = "weur",
  [switch]$ForceDataImport
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $ProjectRoot

Write-Host "Checking Cloudflare sign-in..."
$identity = npx wrangler whoami 2>&1 | Out-String
if ($LASTEXITCODE -ne 0 -or $identity -match "not authenticated") {
  Write-Host "A browser window will open for Cloudflare authorization."
  npx wrangler login
  if ($LASTEXITCODE -ne 0) { throw "Cloudflare sign-in was not completed." }
}

$configText = Get-Content -Raw -LiteralPath "wrangler.jsonc"
if ($configText -notmatch '"database_id"\s*:') {
  Write-Host "Creating the production D1 database..."
  npx wrangler d1 create $DatabaseName --binding DB --location $Location --update-config
  if ($LASTEXITCODE -ne 0) { throw "Could not create the production D1 database." }

  # Wrangler appends the resolved binding when the config starts with an
  # auto-provisioning placeholder. Keep only the concrete production binding.
  $config = Get-Content -Raw -LiteralPath "wrangler.jsonc" | ConvertFrom-Json
  $resolvedBinding = @($config.d1_databases | Where-Object { $_.database_id })[-1]
  if (-not $resolvedBinding) { throw "Cloudflare did not return a D1 database ID." }
  $config.d1_databases = @($resolvedBinding)
  $config | ConvertTo-Json -Depth 100 | Set-Content -Encoding utf8 -LiteralPath "wrangler.jsonc"
}

$countJson = npx wrangler d1 execute DB --remote --config wrangler.jsonc --json --command "SELECT COUNT(*) AS count FROM students;"
if ($LASTEXITCODE -ne 0) { throw "Could not inspect the production D1 database." }
$remoteStudentCount = [int]((($countJson | ConvertFrom-Json)[0].results)[0].count)

if ($remoteStudentCount -gt 0 -and -not $ForceDataImport) {
  Write-Host "Production already contains $remoteStudentCount students; preserving its data."
} else {
  Write-Host "Creating a clean production snapshot from the local CRM data..."
  python scripts/export-d1-snapshot.py
  if ($LASTEXITCODE -ne 0) { throw "Could not export the local database." }

  Write-Host "Importing CRM data into Cloudflare D1..."
  npx wrangler d1 execute DB --remote --yes --config wrangler.jsonc --file .deploy/latest-production.sql
  if ($LASTEXITCODE -ne 0) { throw "The D1 import did not complete." }
}

Write-Host "Building the production application..."
npm run build
if ($LASTEXITCODE -ne 0) { throw "The production build failed." }

Write-Host "Publishing Masar CRM..."
npx wrangler deploy --config wrangler.jsonc --keep-vars
if ($LASTEXITCODE -ne 0) { throw "The Cloudflare deployment failed." }

Write-Host "Verifying the production database..."
npx wrangler d1 execute DB --remote --config wrangler.jsonc --command "SELECT (SELECT COUNT(*) FROM students) AS students, (SELECT COUNT(*) FROM student_records) AS student_records, (SELECT COUNT(*) FROM leads) AS leads, (SELECT COUNT(*) FROM call_records) AS calls;"
if ($LASTEXITCODE -ne 0) { throw "The deployment finished, but database verification failed." }

Write-Host "Cloudflare deployment completed successfully."
