$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $ProjectRoot

Write-Host "Building the latest Masar CRM update..."
npm run build
if ($LASTEXITCODE -ne 0) { throw "The production build failed." }

Write-Host "Publishing the update to Cloudflare..."
npx wrangler deploy --config wrangler.jsonc --keep-vars
if ($LASTEXITCODE -ne 0) { throw "The Cloudflare deployment failed." }

Write-Host ""
Write-Host "Update published successfully."
Write-Host "https://masar-crm.masar-crm-ahmed-fathy.workers.dev"
