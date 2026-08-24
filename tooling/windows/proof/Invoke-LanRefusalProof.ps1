#Requires -Version 5.1

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("Prepare", "Collect")]
  [string] $Action,

  [Parameter(Mandatory = $true)]
  [string] $WindowsLanAddress,

  [Parameter(Mandatory = $true)]
  [string] $PeerAddress,

  [Parameter(Mandatory = $true)]
  [Guid] $RunId,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-f]{40}$')]
  [string] $SourceCommit,

  [Parameter(Mandatory = $true)]
  [string] $SnapshotId,

  [string] $PeerResultPath,

  [string] $OutputPath = (Join-Path $env:ProgramData "Breev\state\issue-34-lan-refusal.json")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$port = 31311
$firewallRuleName = "BreevIssue34PostgresqlLanProbe"
$statePath = "$OutputPath.prepared"

function Invoke-LoopbackSqlProbe {
  $payloadRoot = Join-Path $env:ProgramFiles "Breev\resources\windows-payload"
  $uri = [Uri]::new((Get-Content -LiteralPath (Join-Path $env:ProgramData "Breev\config\database-url") -Raw).Trim())
  $userInfo = $uri.UserInfo.Split(':', 2)
  $previousPassword = $env:PGPASSWORD
  try {
    $env:PGPASSWORD = [Uri]::UnescapeDataString($userInfo[1])
    $output = & (Join-Path $payloadRoot "postgresql\bin\psql.exe") --no-psqlrc --set=ON_ERROR_STOP=1 --host=127.0.0.1 --port=$($uri.Port) --username=$([Uri]::UnescapeDataString($userInfo[0])) --dbname=$($uri.AbsolutePath.TrimStart('/')) --tuples-only --no-align --command="SELECT 1;" 2>&1
    if ($LASTEXITCODE -ne 0 -or ($output -join "`n").Trim() -ne "1") { throw "The same-window loopback SQL probe failed" }
  } finally {
    $env:PGPASSWORD = $previousPassword
  }
  return [ordered]@{ host = "127.0.0.1"; port = $uri.Port; result = 1; completedAtUtc = [DateTime]::UtcNow.ToString("o") }
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "The LAN refusal proof controller requires an elevated administrator token"
}
try {
  [void] [Net.IPAddress]::Parse($WindowsLanAddress)
  [void] [Net.IPAddress]::Parse($PeerAddress)
} catch {
  throw "The LAN proof requires literal IP addresses"
}
if ($WindowsLanAddress -eq $PeerAddress -or $WindowsLanAddress -match '^127\.' -or $PeerAddress -match '^127\.') {
  throw "The Windows and peer addresses must be different non-loopback hosts"
}

if ($Action -eq "Prepare") {
  if ($null -eq (Get-NetIPAddress -AddressFamily IPv4 -IPAddress $WindowsLanAddress -ErrorAction SilentlyContinue)) {
    throw "The requested LAN address is not assigned to this Windows machine"
  }
  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port | Select-Object LocalAddress, LocalPort, OwningProcess)
  if ($listeners.Count -eq 0 -or @($listeners | Where-Object { $_.LocalAddress -notin @("127.0.0.1", "::1") }).Count -ne 0) {
    throw "PostgreSQL is not exclusively listening on loopback"
  }
  Remove-NetFirewallRule -DisplayName $firewallRuleName -ErrorAction SilentlyContinue
  New-NetFirewallRule -DisplayName $firewallRuleName -Direction Inbound -Action Allow -Enabled True -Profile Any -Protocol TCP -LocalAddress $WindowsLanAddress -LocalPort $port -RemoteAddress $PeerAddress | Out-Null
  $loopback = Invoke-LoopbackSqlProbe
  $state = [ordered]@{
    schemaVersion = 1
    runId = $RunId.ToString()
    sourceCommit = $SourceCommit
    snapshotId = $SnapshotId
    windowsMachine = $env:COMPUTERNAME
    windowsMachineId = (Get-CimInstance Win32_ComputerSystemProduct).UUID
    windowsLanAddress = $WindowsLanAddress
    peerAddress = $PeerAddress
    port = $port
    listeners = $listeners
    loopbackBeforePeer = $loopback
    firewallRule = $firewallRuleName
    preparedAtUtc = [DateTime]::UtcNow.ToString("o")
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $statePath) | Out-Null
  $state | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $statePath -Encoding UTF8
  Write-Output "Run probe-lan-refusal.mjs on $PeerAddress against ${WindowsLanAddress}:$port, copy its JSON to Windows, then run Collect."
  exit 0
}

$result = $null
try {
  if ([string]::IsNullOrWhiteSpace($PeerResultPath) -or -not (Test-Path -LiteralPath $PeerResultPath -PathType Leaf)) {
    throw "Collect requires the independent peer result JSON"
  }
  if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) {
    throw "The LAN proof was not prepared on this snapshot"
  }
  $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  $peer = Get-Content -LiteralPath $PeerResultPath -Raw | ConvertFrom-Json
  $listenersAfter = @(Get-NetTCPConnection -State Listen -LocalPort $port | Select-Object LocalAddress, LocalPort, OwningProcess)
  $loopbackAfterPeer = Invoke-LoopbackSqlProbe
  $collectTime = [DateTime]::UtcNow
  $passed = $peer.passed -and
    $state.runId -eq $RunId.ToString() -and
    $state.sourceCommit -eq $SourceCommit -and
    $state.snapshotId -eq $SnapshotId -and
    $peer.runId -eq $RunId.ToString() -and
    $peer.sourceCommit -eq $SourceCommit -and
    $peer.snapshotId -eq $SnapshotId -and
    $peer.outcome -eq "refused" -and
    $peer.connectionRefused -and
    $peer.errorCode -eq "ECONNREFUSED" -and
    $peer.target.host -eq $state.windowsLanAddress -and
    $peer.target.port -eq $port -and
    $peer.probeMachine -ne $state.windowsMachine -and
    $peer.sourceAddress -eq $state.peerAddress -and
    $peer.expectedSourceAddress -eq $state.peerAddress -and
    $peer.sourceAddressAssigned -and
    @($peer.sourceInterfaces | Where-Object { $_.address -eq $state.peerAddress -and -not $_.internal }).Count -gt 0 -and
    ([DateTime]::Parse($peer.startedAtUtc).ToUniversalTime() -ge [DateTime]::Parse($state.preparedAtUtc).ToUniversalTime()) -and
    ([DateTime]::Parse($peer.completedAtUtc).ToUniversalTime() -le $collectTime) -and
    ([DateTime]::Parse($state.preparedAtUtc).ToUniversalTime() -ge $collectTime.AddMinutes(-10)) -and
    $listenersAfter.Count -gt 0 -and
    @($listenersAfter | Where-Object { $_.LocalAddress -notin @("127.0.0.1", "::1") }).Count -eq 0
  $result = [ordered]@{
    schemaVersion = 1
    runId = $RunId.ToString()
    sourceCommit = $SourceCommit
    snapshotId = $SnapshotId
    windows = $state
    independentPeer = $peer
    listenersAfterPeer = $listenersAfter
    loopbackAfterPeer = $loopbackAfterPeer
    passed = [bool] $passed
    completedAtUtc = $collectTime.ToString("o")
  }
  [IO.File]::WriteAllText($OutputPath, ($result | ConvertTo-Json -Depth 10) + "`n", [Text.UTF8Encoding]::new($false))
} finally {
  Remove-NetFirewallRule -DisplayName $firewallRuleName -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
}

if ($null -eq $result -or -not $result.passed) {
  throw "The independent-machine PostgreSQL LAN refusal proof failed"
}
Write-Output $OutputPath
