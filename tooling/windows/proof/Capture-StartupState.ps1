#Requires -Version 5.1

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $OutputPath,

  [Parameter(Mandatory = $true)]
  [Guid] $RunId,

  [Parameter(Mandatory = $true)]
  [string] $SourceCommit,

  [Parameter(Mandatory = $true)]
  [string] $SnapshotId,

  [Parameter(Mandatory = $true)]
  [DateTime] $PreviousBootTimeUtc
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$startedAt = [DateTime]::UtcNow
$health = $null
$deadline = $startedAt.AddMinutes(3)
while ([DateTime]::UtcNow -lt $deadline) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:31310/health" -TimeoutSec 2
    $body = $response.Content | ConvertFrom-Json
    if ($response.StatusCode -eq 200 -and $body.status -eq "healthy" -and $body.database -eq "available") {
      $health = $body
      break
    }
  } catch {
    Start-Sleep -Milliseconds 500
  }
}

$serviceEvidence = foreach ($serviceName in @("BreevLocalApi", "BreevPostgreSQL")) {
  $service = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
  [ordered]@{
    name = $service.Name
    state = $service.State
    startMode = $service.StartMode
    startName = $service.StartName
    processId = $service.ProcessId
  }
}
$explorerProcessCount = @(Get-CimInstance Win32_Process -Filter "Name='explorer.exe'").Count
$operatingSystem = Get-CimInstance Win32_OperatingSystem
$bootTime = $operatingSystem.LastBootUpTime.ToUniversalTime()
$allInteractiveSessions = @(Get-CimInstance Win32_LogonSession | Where-Object { $_.LogonType -in @(2, 10, 11, 12, 13) } | ForEach-Object {
  $session = $_
  $accounts = @(Get-CimAssociatedInstance -InputObject $session -Association Win32_LoggedOnUser | ForEach-Object {
    [ordered]@{ name = "$($_.Domain)\$($_.Name)"; sid = $_.SID }
  })
  [ordered]@{ logonId = $session.LogonId; logonType = $session.LogonType; startTimeUtc = $session.StartTime.ToUniversalTime().ToString("o"); accounts = $accounts }
})
$nonUserSidPattern = '^S-1-5-(18|19|20)$|^S-1-5-(80|82|90|96)-'
# Session records without an associated user are incomplete system records, not
# proof that an interactive user logged on.
$interactiveSessions = @($allInteractiveSessions | Where-Object {
  @($_.accounts | Where-Object { $_.sid -notmatch $nonUserSidPattern }).Count -gt 0
})
# Get-WinEvent interprets StartTime as local time while Win32_OperatingSystem
# gives a UTC DateTime here. Query in local time, then compare events in UTC.
$allInteractiveLogonEvents = @(Get-WinEvent -FilterHashtable @{ LogName = "Security"; Id = 4624; StartTime = $bootTime.ToLocalTime() } -ErrorAction Stop | Where-Object {
  $_.TimeCreated.ToUniversalTime() -ge $bootTime
} | ForEach-Object {
  $xml = [xml] $_.ToXml()
  $logonType = [int] (($xml.Event.EventData.Data | Where-Object { $_.Name -eq "LogonType" }).'#text')
  if ($logonType -in @(2, 10, 11, 12, 13)) {
    [ordered]@{
      recordId = $_.RecordId
      logonType = $logonType
      targetUser = (($xml.Event.EventData.Data | Where-Object { $_.Name -eq "TargetUserName" }).'#text')
      targetUserSid = (($xml.Event.EventData.Data | Where-Object { $_.Name -eq "TargetUserSid" }).'#text')
      virtualAccount = (($xml.Event.EventData.Data | Where-Object { $_.Name -eq "VirtualAccount" }).'#text')
      timeCreatedUtc = $_.TimeCreated.ToUniversalTime().ToString("o")
    }
  }
})
$interactiveLogonEvents = @($allInteractiveLogonEvents | Where-Object { $_.targetUserSid -notmatch $nonUserSidPattern })
$serviceStartEvidence = foreach ($service in $serviceEvidence) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($service.processId)"
  [ordered]@{ name = $service.name; processId = $service.processId; processCreatedAtUtc = $process.CreationDate.ToUniversalTime().ToString("o") }
}

$result = [ordered]@{
  schemaVersion = 1
  runId = $RunId.ToString()
  sourceCommit = $SourceCommit
  snapshotId = $SnapshotId
  machineId = (Get-CimInstance Win32_ComputerSystemProduct).UUID
  capturedBy = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  startedAtUtc = $startedAt.ToString("o")
  completedAtUtc = [DateTime]::UtcNow.ToString("o")
  previousBootTimeUtc = $PreviousBootTimeUtc.ToUniversalTime().ToString("o")
  bootTimeUtc = $bootTime.ToString("o")
  explorerProcessCount = $explorerProcessCount
  allInteractiveSessions = $allInteractiveSessions
  interactiveSessions = $interactiveSessions
  allInteractiveLogonEvents = $allInteractiveLogonEvents
  interactiveLogonEvents = $interactiveLogonEvents
  services = $serviceEvidence
  serviceStarts = $serviceStartEvidence
  health = $health
  passed = ($null -ne $health) -and
    (@($serviceEvidence | Where-Object { $_.state -ne "Running" -or $_.startMode -ne "Auto" }).Count -eq 0) -and
    ($bootTime -gt $PreviousBootTimeUtc.ToUniversalTime()) -and
    ($interactiveSessions.Count -eq 0) -and
    ($interactiveLogonEvents.Count -eq 0) -and
    ($explorerProcessCount -eq 0)
}

$outputRoot = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
$temporaryPath = "$OutputPath.tmp"
[IO.File]::WriteAllText($temporaryPath, ($result | ConvertTo-Json -Depth 8) + "`n", [Text.UTF8Encoding]::new($false))
Move-Item -LiteralPath $temporaryPath -Destination $OutputPath -Force
