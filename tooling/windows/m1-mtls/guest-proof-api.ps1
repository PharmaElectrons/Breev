[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("Start", "Stop")]
  [string] $Action,

  [Parameter(Mandatory = $true)]
  [string] $ProofRoot,

  [string] $IssuerDirectory,

  [string] $WindowsAddress,

  [ValidateRange(1, 65535)]
  [int] $LanPort = 31312
)

$ErrorActionPreference = "Stop"
$serviceName = "BreevLocalApi"
$dataRoot = "C:\ProgramData\Breev"
$payloadRoot = "C:\Program Files\Breev\resources\windows-payload"
$apiRoot = Join-Path $payloadRoot "local-api"
$apiReadableRoot = Join-Path $dataRoot "logs\local-api\m1-mtls-proof"
$restorePath = Join-Path $ProofRoot "service-restore.json"

function Invoke-ScConfig {
  param([string] $BinaryPath)

  $output = & sc.exe config $serviceName "binPath=" $BinaryPath 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Could not configure the proof API service: $($output -join ' ')"
  }
}

function Wait-LoopbackHealth {
  param([int] $TimeoutSeconds = 60)

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:31310/health" -TimeoutSec 2
      $body = $response.Content | ConvertFrom-Json
      if ($response.StatusCode -eq 200 -and $body.status -eq "healthy" -and $body.database -eq "available") {
        return
      }
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }
  throw "The proof API did not become healthy"
}

function Restore-InstalledService {
  if (-not (Test-Path -LiteralPath $restorePath -PathType Leaf)) {
    return
  }
  $restore = Get-Content -LiteralPath $restorePath -Raw | ConvertFrom-Json
  if ($restore.serviceName -ne $serviceName -or [string]::IsNullOrWhiteSpace($restore.binaryPath)) {
    throw "The saved BreevLocalApi service definition is invalid"
  }
  $service = Get-Service -Name $serviceName -ErrorAction Stop
  if ($service.Status -ne [ServiceProcess.ServiceControllerStatus]::Stopped) {
    Stop-Service -Name $serviceName -Force
    $service.WaitForStatus([ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromSeconds(30))
  }
  Invoke-ScConfig -BinaryPath $restore.binaryPath
  Remove-Item -LiteralPath $restorePath -Force
  Start-Service -Name $serviceName
  (Get-Service -Name $serviceName).WaitForStatus(
    [ServiceProcess.ServiceControllerStatus]::Running,
    [TimeSpan]::FromSeconds(30)
  )
  Wait-LoopbackHealth
}

if ($Action -eq "Stop") {
  Restore-InstalledService
  [pscustomobject]@{ action = "stop"; restored = -not (Test-Path -LiteralPath $restorePath) } |
    ConvertTo-Json -Compress
  exit 0
}

if ([string]::IsNullOrWhiteSpace($WindowsAddress)) {
  throw "-WindowsAddress is required for Start"
}
if ([string]::IsNullOrWhiteSpace($IssuerDirectory)) {
  throw "-IssuerDirectory is required for Start"
}
$parsedAddress = $null
if (-not [Net.IPAddress]::TryParse($WindowsAddress, [ref] $parsedAddress) -or
    [Net.IPAddress]::IsLoopback($parsedAddress) -or
    $parsedAddress.Equals([Net.IPAddress]::Any) -or
    $parsedAddress.Equals([Net.IPAddress]::IPv6Any)) {
  throw "-WindowsAddress must be a concrete non-loopback address"
}
if ($LanPort -eq 31310 -or $LanPort -eq 31311) {
  throw "The LAN API port must differ from loopback API 31310 and PostgreSQL 31311"
}
if ($null -eq (Get-NetIPAddress -IPAddress $parsedAddress.IPAddressToString -ErrorAction SilentlyContinue)) {
  throw "-WindowsAddress is not assigned to this guest"
}
foreach ($required in @(
  (Join-Path $payloadRoot "service-wrapper\shawl.exe"),
  (Join-Path $payloadRoot "node\node.exe"),
  (Join-Path $apiRoot "dist\main.js"),
  (Join-Path $dataRoot "config\database-url"),
  (Join-Path $dataRoot "config\main-device.json"),
  (Join-Path $ProofRoot "licence-key-override.mjs"),
  (Join-Path $IssuerDirectory "licence-public-keys.json")
)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    throw "Required proof input is missing: $required"
  }
}
if (Test-Path -LiteralPath $restorePath) {
  throw "A previous proof service swap still needs restoration"
}

$service = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
if ($null -eq $service -or $service.StartName -ne "NT SERVICE\BreevLocalApi") {
  throw "BreevLocalApi is not installed under its dedicated service identity"
}
if ((Get-Service -Name $serviceName).Status -ne [ServiceProcess.ServiceControllerStatus]::Running) {
  throw "BreevLocalApi must be healthy before the proof service is substituted"
}
Wait-LoopbackHealth

New-Item -ItemType Directory -Force -Path $ProofRoot, $apiReadableRoot | Out-Null
Copy-Item -LiteralPath (Join-Path $ProofRoot "licence-key-override.mjs") `
  -Destination (Join-Path $apiReadableRoot "licence-key-override.mjs") -Force
Copy-Item -LiteralPath (Join-Path $IssuerDirectory "licence-public-keys.json") `
  -Destination (Join-Path $apiReadableRoot "licence-public-keys.json") -Force

[ordered]@{
  schemaVersion = 1
  serviceName = $serviceName
  binaryPath = $service.PathName
} | ConvertTo-Json | Set-Content -LiteralPath $restorePath -Encoding UTF8

function Quote-CommandArgument {
  param([string] $Value)
  return '"' + $Value.Replace('"', '\"') + '"'
}

$shawl = Join-Path $payloadRoot "service-wrapper\shawl.exe"
$node = Join-Path $payloadRoot "node\node.exe"
$override = Join-Path $apiReadableRoot "licence-key-override.mjs"
$publicKeys = Join-Path $apiReadableRoot "licence-public-keys.json"
$arguments = @(
  (Quote-CommandArgument $shawl), "run", "--name", $serviceName,
  "--restart", "--restart-delay", "2000", "--stop-timeout", "30000", "--kill-process-tree",
  "--log-dir", (Quote-CommandArgument (Join-Path $dataRoot "logs\local-api")),
  "--log-as", "wrapper", "--log-cmd-as", "m1-mtls-proof",
  "--cwd", (Quote-CommandArgument $apiRoot),
  "--env", "API_HOST=127.0.0.1", "--env", "API_PORT=31310",
  "--env", "DATABASE_URL_FILE=C:\ProgramData\Breev\config\database-url",
  "--env", "BREEV_BACKUP_DIRECTORY=C:\ProgramData\Breev\backups",
  "--env", "BREEV_MAIN_DEVICE_FILE=C:\ProgramData\Breev\config\main-device.json",
  "--env", "BREEV_LAN_API_HOST=$($parsedAddress.IPAddressToString)",
  "--env", "BREEV_LAN_API_PORT=$LanPort",
  "--env", "BREEV_M1_MTLS_LICENCE_PUBLIC_KEYS_FILE=$publicKeys",
  "--", (Quote-CommandArgument $node), "--import", (Quote-CommandArgument $override), "dist\main.js"
)
$proofBinaryPath = $arguments -join " "

try {
  Stop-Service -Name $serviceName -Force
  (Get-Service -Name $serviceName).WaitForStatus(
    [ServiceProcess.ServiceControllerStatus]::Stopped,
    [TimeSpan]::FromSeconds(30)
  )
  Invoke-ScConfig -BinaryPath $proofBinaryPath
  Start-Service -Name $serviceName
  (Get-Service -Name $serviceName).WaitForStatus(
    [ServiceProcess.ServiceControllerStatus]::Running,
    [TimeSpan]::FromSeconds(30)
  )
  Wait-LoopbackHealth
  $listener = Get-NetTCPConnection -State Listen -LocalAddress $parsedAddress.IPAddressToString `
    -LocalPort $LanPort -ErrorAction SilentlyContinue
  if ($null -eq $listener) {
    throw "The proof API is not listening on the requested LAN endpoint"
  }
} catch {
  $failure = $_
  Restore-InstalledService
  throw $failure
}

[pscustomobject]@{
  action = "start"
  host = $parsedAddress.IPAddressToString
  lanPort = $LanPort
  serviceIdentity = $service.StartName
  tlsProcess = "installed-local-api"
} | ConvertTo-Json -Compress
