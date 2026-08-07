$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $ProjectRoot

$BackupDirectory = Join-Path $ProjectRoot ".deploy\online-backups"
New-Item -ItemType Directory -Force -Path $BackupDirectory | Out-Null
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Output = Join-Path $BackupDirectory "masar-crm-online-$Timestamp.sql"

Write-Host "Downloading a protected backup from Cloudflare D1..."
npx wrangler d1 export DB --remote --skip-confirmation --config wrangler.jsonc --output $Output
if ($LASTEXITCODE -ne 0) { throw "The online database backup failed." }

Write-Host ""
Write-Host "Backup saved successfully:"
Write-Host $Output
