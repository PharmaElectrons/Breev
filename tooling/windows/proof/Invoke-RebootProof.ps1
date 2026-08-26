#Requires -Version 5.1

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("Prepare", "Collect")]
  [string] $Action,

  [Parameter(Mandatory = $true)]
  [Guid] $RunId,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-f]{40}$')]
  [string] $SourceCommit,

  [Parameter(Mandatory = $true)]
  [string] $SnapshotId,

  [string] $OutputPath = (Join-Path $env:ProgramData "Breev\state\issue-34-reboot.json")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$taskName = "BreevIssue34NoLoginProof"
$probeSource = Join-Path $PSScriptRoot "Capture-StartupState.ps1"
$probeDestination = Join-Path $env:ProgramData "Breev\state\issue-34-startup-probe.ps1"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "The reboot proof controller requires an elevated administrator token"
}

if ($Action -eq "Prepare") {
  Remove-Item -LiteralPath $OutputPath -Force -ErrorAction SilentlyContinue
  Copy-Item -LiteralPath $probeSource -Destination $probeDestination -Force
  $previousBootTime = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString("o")
  $arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$probeDestination`" -OutputPath `"$OutputPath`" -RunId `"$RunId`" -SourceCommit `"$SourceCommit`" -SnapshotId `"$SnapshotId`" -PreviousBootTimeUtc `"$previousBootTime`""
  $taskAction = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument $arguments
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $taskPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
  Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $trigger -Principal $taskPrincipal -Force | Out-Null
  Write-Output "Reboot the disposable Windows VM without signing in. The SYSTEM task will record service and health state before Explorer starts."
  exit 0
}

if (-not (Test-Path -LiteralPath $OutputPath -PathType Leaf)) {
  throw "The no-login startup probe did not produce evidence"
}
$result = Get-Content -LiteralPath $OutputPath -Raw | ConvertFrom-Json
if (-not $result.passed -or
    $result.runId -ne $RunId.ToString() -or
    $result.sourceCommit -ne $SourceCommit -or
    $result.snapshotId -ne $SnapshotId -or
    $result.capturedBy -ne "NT AUTHORITY\SYSTEM" -or
    $result.explorerProcessCount -ne 0 -or
    @($result.interactiveSessions).Count -ne 0 -or
    @($result.interactiveLogonEvents).Count -ne 0) {
  throw "The no-login startup proof failed"
}
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
Remove-Item -LiteralPath $probeDestination -Force
Write-Output $OutputPath
