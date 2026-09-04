# ==============================================================================
# Breev Installation Identifiers Extractor
# Run this script on any client machine to retrieve their Pharmacy & Device IDs.
# ==============================================================================

$ErrorActionPreference = 'SilentlyContinue'

Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host "         BREEV INSTALLATION IDENTIFIERS EXTRACTOR        " -ForegroundColor Cyan
Write-Host "========================================================`n" -ForegroundColor Cyan

# 1. Main Device ID
$mainDeviceId = $null
$configPath = "$env:ProgramData\Breev\config\main-device.json"

if (Test-Path -LiteralPath $configPath) {
    try {
        $json = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
        $mainDeviceId = $json.deviceId
    } catch {
        # Permissions or parse error
    }
}

if ($mainDeviceId) {
    Write-Host "  Main Device ID : " -NoNewline -ForegroundColor White
    Write-Host "$mainDeviceId" -ForegroundColor Green
} else {
    Write-Host "  Main Device ID : " -NoNewline -ForegroundColor White
    Write-Host "Not found (Run as Administrator or ensure Breev is installed)" -ForegroundColor Red
}

# 2. Pharmacy ID from PostgreSQL
$pharmacyId = $null
$pharmacyName = $null

# Search for bundled psql in Program Files
$psqlPath = (Get-ChildItem -Path "C:\Program Files\Breev\resources\windows-payload\postgresql\bin\psql.exe" -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
if (-not $psqlPath) {
    $psqlPath = (Get-ChildItem -Path "C:\Program Files" -Filter "psql.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
}

# Try connection on standard Breev ports (31311, 5432)
$portsToTry = @(31311, 5432)
$passwordsToTry = @("migrator_secret_password")

# Also read dynamic password from schema-owner-url if accessible
$schemaOwnerFile = "$env:ProgramData\Breev\config\schema-owner-url"
if (Test-Path $schemaOwnerFile) {
    try {
        $url = Get-Content $schemaOwnerFile -Raw
        if ($url -match "postgresql://[^:]+:([^@]+)@([^:]+):(\d+)/(.+)") {
            $passwordsToTry += $matches[1]
            $portsToTry = @([int]$matches[3]) + $portsToTry
        }
    } catch {}
}

if ($psqlPath) {
    foreach ($port in $portsToTry) {
        foreach ($pwd in $passwordsToTry) {
            $env:PGPASSWORD = $pwd
            $data = & $psqlPath -U breev_schema_owner -d breev_local -h 127.0.0.1 -p $port -t -A -F " | " -c "SELECT id, name FROM pharmacies LIMIT 1;" 2>$null
            if ($data) {
                $parts = $data.Split('|').Trim()
                $pharmacyId = $parts[0]
                $pharmacyName = $parts[1]
                break
            }
        }
        if ($pharmacyId) { break }
    }
}

if ($pharmacyId) {
    Write-Host "  Pharmacy ID    : " -NoNewline -ForegroundColor White
    Write-Host "$pharmacyId" -ForegroundColor Green
    Write-Host "  Pharmacy Name  : " -NoNewline -ForegroundColor White
    Write-Host "$pharmacyName" -ForegroundColor Gray
} else {
    Write-Host "  Pharmacy ID    : " -NoNewline -ForegroundColor White
    Write-Host "Unable to query database (Run as Administrator or start Breev service)" -ForegroundColor Red
}

Write-Host "`n========================================================`n" -ForegroundColor Cyan
