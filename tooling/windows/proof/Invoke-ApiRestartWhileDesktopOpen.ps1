#Requires -Version 5.1

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $ReadyPath,

  [Parameter(Mandatory = $true)]
  [string] $CompletePath,

  [Parameter(Mandatory = $true)]
  [Guid] $RunId,

  [Parameter(Mandatory = $true)]
  [string] $ExpectedDesktopPath,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-f]{40}$')]
  [string] $SourceCommit,

  [Parameter(Mandatory = $true)]
  [string] $SnapshotId
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$serviceName = "BreevLocalApi"
$ReadyPath = [IO.Path]::GetFullPath($ReadyPath)
$CompletePath = [IO.Path]::GetFullPath($CompletePath)
$ExpectedDesktopPath = [IO.Path]::GetFullPath($ExpectedDesktopPath)
$stoppedPath = "$CompletePath.stopped"
$unavailablePath = "$ReadyPath.unavailable"

function Write-JsonUtf8NoBom {
  param([string] $Path, [object] $Value)
  $json = $Value | ConvertTo-Json -Depth 8
  [IO.File]::WriteAllText($Path, $json + "`n", [Text.UTF8Encoding]::new($false))
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "The API restart controller requires an elevated administrator token"
}

$result = [ordered]@{
  schemaVersion = 1
  runId = $RunId.ToString()
  sourceCommit = $SourceCommit
  snapshotId = $SnapshotId
  machineId = (Get-CimInstance Win32_ComputerSystemProduct).UUID
  desktopExecutableSha256 = (Get-FileHash -LiteralPath $ExpectedDesktopPath -Algorithm SHA256).Hash.ToLowerInvariant()
  readyMarker = $null
  serviceProcessIdBefore = $null
  serviceProcessIdAfter = $null
  health = $null
  passed = $false
  error = $null
  completedAtUtc = $null
}

try {
  $deadline = [DateTime]::UtcNow.AddMinutes(2)
  while ([DateTime]::UtcNow -lt $deadline -and -not (Test-Path -LiteralPath $ReadyPath -PathType Leaf)) {
    Start-Sleep -Milliseconds 200
  }
  if (-not (Test-Path -LiteralPath $ReadyPath -PathType Leaf)) {
    throw "The standard-user desktop did not produce its restart-ready marker"
  }
  $result["readyMarker"] = Get-Content -LiteralPath $ReadyPath -Raw | ConvertFrom-Json
  if ($result.readyMarker.runId -ne $RunId.ToString()) {
    throw "The desktop ready marker belongs to a different run"
  }
  $desktopProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($result.readyMarker.desktopProcessId)"
  if ($null -eq $desktopProcess -or $desktopProcess.ExecutablePath -ne $ExpectedDesktopPath) {
    throw "The ready marker does not identify the expected live desktop executable"
  }
  $desktopOwner = Invoke-CimMethod -InputObject $desktopProcess -MethodName GetOwnerSid
  if ($desktopOwner.ReturnValue -ne 0 -or $desktopOwner.Sid -ne $result.readyMarker.desktopUserSid) {
    throw "The ready marker desktop is not owned by the standard proof user"
  }
  $before = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
  $result["serviceProcessIdBefore"] = $before.ProcessId
  Stop-Service -Name $serviceName -Force
  (Get-Service -Name $serviceName).WaitForStatus("Stopped", [TimeSpan]::FromSeconds(60))
  $apiUnavailable = $false
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:31310/health" -TimeoutSec 2
    $apiUnavailable = $response.StatusCode -ne 200
  } catch {
    $apiUnavailable = $true
  }
  Write-JsonUtf8NoBom -Path $stoppedPath -Value ([ordered]@{
    schemaVersion = 1
    runId = $RunId.ToString()
    sourceCommit = $SourceCommit
    snapshotId = $SnapshotId
    apiUnavailable = $apiUnavailable
    stoppedAtUtc = [DateTime]::UtcNow.ToString("o")
  })
  if (-not $apiUnavailable) { throw "The API remained reachable after its service stopped" }

  $deadline = [DateTime]::UtcNow.AddSeconds(45)
  while ([DateTime]::UtcNow -lt $deadline -and -not (Test-Path -LiteralPath $unavailablePath -PathType Leaf)) {
    Start-Sleep -Milliseconds 200
  }
  if (-not (Test-Path -LiteralPath $unavailablePath -PathType Leaf)) {
    throw "The open desktop did not report the API outage"
  }
  $unavailableMarker = Get-Content -LiteralPath $unavailablePath -Raw | ConvertFrom-Json
  if ($unavailableMarker.runId -ne $RunId.ToString() -or $unavailableMarker.desktopProcessId -ne $desktopProcess.ProcessId) {
    throw "The desktop outage marker does not match the active run"
  }

  Start-Service -Name $serviceName
  (Get-Service -Name $serviceName).WaitForStatus("Running", [TimeSpan]::FromSeconds(60))

  $health = $null
  $deadline = [DateTime]::UtcNow.AddSeconds(60)
  while ([DateTime]::UtcNow -lt $deadline) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:31310/health" -TimeoutSec 2
      $body = $response.Content | ConvertFrom-Json
      if ($response.StatusCode -eq 200 -and $body.status -eq "healthy" -and $body.database -eq "available") {
        $health = $body
        break
      }
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }
  $after = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
  $result["serviceProcessIdAfter"] = $after.ProcessId
  $result["health"] = $health
  $result["passed"] = $null -ne $health -and
    $before.ProcessId -ne 0 -and
    $after.ProcessId -ne 0 -and
    $before.ProcessId -ne $after.ProcessId
} catch {
  $result["error"] = $_.Exception.Message
} finally {
  try {
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($null -ne $service -and $service.Status -ne [ServiceProcess.ServiceControllerStatus]::Running) {
      Start-Service -Name $serviceName
      (Get-Service -Name $serviceName).WaitForStatus("Running", [TimeSpan]::FromSeconds(60))
    }
  } catch {
    $result["passed"] = $false
    $recoveryMessage = "API service recovery failed: $($_.Exception.Message)"
    $result["error"] = if ([string]::IsNullOrWhiteSpace($result.error)) {
      $recoveryMessage
    } else {
      "$($result.error); $recoveryMessage"
    }
  }
  $result["completedAtUtc"] = [DateTime]::UtcNow.ToString("o")
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $CompletePath) | Out-Null
  Write-JsonUtf8NoBom -Path $CompletePath -Value $result
}

if (-not $result.passed) {
  throw "The API restart while Electron was open failed"
}
Write-Output $CompletePath
