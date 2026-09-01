#Requires -Version 5.1

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $InstallerPath,

  [Parameter(Mandatory = $true)]
  [string] $UpdateInstallerPath,

  [Parameter(Mandatory = $true)]
  [string] $MainEvidencePath,

  [Parameter(Mandatory = $true)]
  [string] $OutputPath,

  [string] $InstallerVersion = "0.0.0",
  [string] $UpdateInstallerVersion = "0.0.1",

  [Parameter(Mandatory = $true)]
  [Guid] $RunId,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-f]{40}$')]
  [string] $SourceCommit,

  [Parameter(Mandatory = $true)]
  [string] $SnapshotId,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9A-Fa-f]{40}$')]
  [string] $ExpectedSignerThumbprint,

  [switch] $DisposableEnvironmentAcknowledged
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$dataRoot = Join-Path $env:ProgramData "Breev"
$installRoot = Join-Path $env:ProgramFiles "Breev"
$rolePath = Join-Path $dataRoot "config\device-role"
$terminalRoot = Join-Path $dataRoot "config\terminal"
$witnessPath = Join-Path $terminalRoot "installer-proof-witness.txt"
$apiServiceName = "BreevLocalApi"
$postgresqlServiceName = "BreevPostgreSQL"
$firewallGroup = "Breev"
$breevPorts = @(31310, 31311, 31312)
$checks = [Collections.Generic.List[object]]::new()
$result = [ordered]@{
  schemaVersion = 1
  role = "terminal"
  runId = $RunId.ToString()
  sourceCommit = $SourceCommit
  snapshotId = $SnapshotId
  startedAtUtc = [DateTime]::UtcNow.ToString("o")
  source = "tooling/windows/proof/Invoke-TerminalInstallerProof.ps1"
  mainEvidence = $null
  artifacts = $null
  machine = $null
  checks = $checks
  passed = $false
  error = $null
  completedAtUtc = $null
}

function Add-Check {
  param(
    [string] $Name,
    [bool] $Passed,
    [object] $Details = $null
  )

  $checks.Add([ordered]@{ name = $Name; passed = $Passed; details = $Details })
  if (-not $Passed) { throw "Proof check failed: $Name" }
}

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "The Terminal installer proof requires an elevated administrator token"
  }
}

function Get-BreevInstalledProducts {
  return @(@(
    Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue
    Get-ItemProperty "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue
  ) | Where-Object {
    $displayName = $_.PSObject.Properties["DisplayName"]
    $displayVersion = $_.PSObject.Properties["DisplayVersion"]
    $publisher = $_.PSObject.Properties["Publisher"]
    $null -ne $displayName -and $null -ne $displayVersion -and $null -ne $publisher -and
      $displayVersion.Value -match '^\d+\.\d+\.\d+$' -and
      $displayName.Value -eq "Breev $($displayVersion.Value)" -and
      $publisher.Value -eq "Breev"
  })
}

function Get-InstalledVersion {
  $products = @(Get-BreevInstalledProducts)
  if ($products.Count -ne 1) { throw "Could not identify exactly one installed Breev product" }
  return $products[0].DisplayVersion
}

function Get-UninstallerPath {
  $commands = @((Get-BreevInstalledProducts) | Where-Object {
    -not [string]::IsNullOrWhiteSpace($_.UninstallString)
  } | Select-Object -ExpandProperty UninstallString -Unique)
  if ($commands.Count -ne 1) { throw "Could not identify exactly one Breev uninstaller" }
  $match = [regex]::Match($commands[0], '^"?([^"].*?\.exe)"?(?:\s|$)')
  if (-not $match.Success) { throw "The Breev uninstall command is invalid" }
  return $match.Groups[1].Value
}

function Get-TerminalFacts {
  $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {
    $_.LocalPort -in $breevPorts
  } | Select-Object LocalAddress, LocalPort, OwningProcess)
  $firewallRules = @(Get-NetFirewallRule -Group $firewallGroup -ErrorAction SilentlyContinue |
    Select-Object Name, DisplayName, Enabled, Direction, Action)
  $mainStatePaths = @(
    (Join-Path $dataRoot "config\database-url"),
    (Join-Path $dataRoot "config\schema-owner-url"),
    (Join-Path $dataRoot "config\main-device.json"),
    (Join-Path $dataRoot "postgresql")
  )

  return [ordered]@{
    role = if (Test-Path -LiteralPath $rolePath -PathType Leaf) {
      Get-Content -LiteralPath $rolePath -Raw
    } else { $null }
    terminalRootExists = Test-Path -LiteralPath $terminalRoot -PathType Container
    mainStatePathsPresent = @($mainStatePaths | Where-Object { Test-Path -LiteralPath $_ })
    apiServicePresent = $null -ne (Get-Service -Name $apiServiceName -ErrorAction SilentlyContinue)
    postgresqlServicePresent = $null -ne (Get-Service -Name $postgresqlServiceName -ErrorAction SilentlyContinue)
    firewallRules = $firewallRules
    listeners = $listeners
  }
}

function Test-TerminalFacts {
  param([object] $Facts)

  return $Facts.role -ceq "terminal" -and
    $Facts.terminalRootExists -and
    @($Facts.mainStatePathsPresent).Count -eq 0 -and
    -not $Facts.apiServicePresent -and
    -not $Facts.postgresqlServicePresent -and
    @($Facts.firewallRules).Count -eq 0 -and
    @($Facts.listeners).Count -eq 0
}

function Add-TerminalInvariantCheck {
  param(
    [string] $Name,
    [string] $ExpectedWitnessSha256 = ""
  )

  $facts = Get-TerminalFacts
  $witnessSha256 = if (Test-Path -LiteralPath $witnessPath -PathType Leaf) {
    (Get-FileHash -LiteralPath $witnessPath -Algorithm SHA256).Hash.ToLowerInvariant()
  } else { $null }
  $witnessMatches = [string]::IsNullOrEmpty($ExpectedWitnessSha256) -or
    $witnessSha256 -eq $ExpectedWitnessSha256
  Add-Check -Name $Name -Passed ((Test-TerminalFacts -Facts $facts) -and $witnessMatches) -Details ([ordered]@{
    facts = $facts
    witnessSha256 = $witnessSha256
    expectedWitnessSha256 = if ([string]::IsNullOrEmpty($ExpectedWitnessSha256)) { $null } else { $ExpectedWitnessSha256 }
  })
}

function Invoke-Installer {
  param(
    [string] $Path,
    [string[]] $Arguments,
    [string] $InjectFailure = "None"
  )

  $previousFailure = $env:BREEV_WINDOWS_INJECT_FAILURE
  try {
    $env:BREEV_WINDOWS_INJECT_FAILURE = $InjectFailure
    $process = Start-Process -FilePath $Path -ArgumentList $Arguments -Wait -PassThru
  } finally {
    $env:BREEV_WINDOWS_INJECT_FAILURE = $previousFailure
  }
  return $process.ExitCode
}

function Test-InstallerSignature {
  param([string] $Path)

  $signature = Get-AuthenticodeSignature -LiteralPath $Path
  return [ordered]@{
    status = $signature.Status.ToString()
    signerThumbprint = if ($null -eq $signature.SignerCertificate) { $null } else { $signature.SignerCertificate.Thumbprint }
    valid = $signature.Status -eq "Valid" -and $null -ne $signature.SignerCertificate -and
      $signature.SignerCertificate.Thumbprint -eq $ExpectedSignerThumbprint
  }
}

try {
  Assert-Administrator
  if (-not $DisposableEnvironmentAcknowledged) {
    throw "Refusing destructive lifecycle tests without -DisposableEnvironmentAcknowledged"
  }

  $InstallerPath = [IO.Path]::GetFullPath($InstallerPath)
  $UpdateInstallerPath = [IO.Path]::GetFullPath($UpdateInstallerPath)
  $MainEvidencePath = [IO.Path]::GetFullPath($MainEvidencePath)
  $OutputPath = [IO.Path]::GetFullPath($OutputPath)
  $ExpectedSignerThumbprint = $ExpectedSignerThumbprint.Replace(" ", "").ToUpperInvariant()
  foreach ($path in @($InstallerPath, $UpdateInstallerPath, $MainEvidencePath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required proof input is missing: $path" }
  }
  foreach ($version in @($InstallerVersion, $UpdateInstallerVersion)) {
    if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "Installer versions must be three-part semantic versions" }
  }
  if (([version] $InstallerVersion) -ge ([version] $UpdateInstallerVersion)) {
    throw "The update installer version must be greater than the clean installer version"
  }

  $mainEvidence = Get-Content -LiteralPath $MainEvidencePath -Raw | ConvertFrom-Json
  $machineId = (Get-CimInstance Win32_ComputerSystemProduct).UUID
  $result.machine = [ordered]@{
    machineId = $machineId
    operatingSystem = (Get-CimInstance Win32_OperatingSystem).Caption
    architecture = (Get-CimInstance Win32_OperatingSystem).OSArchitecture
  }
  $result.mainEvidence = [ordered]@{
    path = $MainEvidencePath
    sha256 = (Get-FileHash -LiteralPath $MainEvidencePath -Algorithm SHA256).Hash.ToLowerInvariant()
    passed = [bool] $mainEvidence.passed
  }
  Add-Check -Name "main-proof-correlates" -Passed (
    $mainEvidence.passed -and
    $mainEvidence.source -eq "tooling/windows/proof/Invoke-InstalledRuntimeProof.ps1" -and
    $mainEvidence.runId -eq $RunId.ToString() -and
    $mainEvidence.sourceCommit -eq $SourceCommit -and
    $mainEvidence.snapshotId -eq $SnapshotId -and
    $mainEvidence.machine.machineId -eq $machineId
  ) -Details $result.mainEvidence

  $initialSignature = Test-InstallerSignature -Path $InstallerPath
  $updateSignature = Test-InstallerSignature -Path $UpdateInstallerPath
  $result.artifacts = [ordered]@{
    installer = [ordered]@{
      version = $InstallerVersion
      sha256 = (Get-FileHash -LiteralPath $InstallerPath -Algorithm SHA256).Hash.ToLowerInvariant()
      signature = $initialSignature
    }
    updateInstaller = [ordered]@{
      version = $UpdateInstallerVersion
      sha256 = (Get-FileHash -LiteralPath $UpdateInstallerPath -Algorithm SHA256).Hash.ToLowerInvariant()
      signature = $updateSignature
    }
  }
  Add-Check -Name "installers-use-expected-signature" -Passed (
    $initialSignature.valid -and $updateSignature.valid
  ) -Details $result.artifacts

  $cleanFacts = Get-TerminalFacts
  Add-Check -Name "clean-disposable-snapshot" -Passed (
    -not (Test-Path -LiteralPath $dataRoot) -and
    -not (Test-Path -LiteralPath $installRoot) -and
    @(Get-BreevInstalledProducts).Count -eq 0 -and
    -not $cleanFacts.apiServicePresent -and
    -not $cleanFacts.postgresqlServicePresent -and
    @($cleanFacts.firewallRules).Count -eq 0 -and
    @($cleanFacts.listeners).Count -eq 0
  ) -Details $cleanFacts

  $invalidExitCode = Invoke-Installer -Path $InstallerPath -Arguments @("/S", "/allusers", "/ROLE=invalid")
  Add-Check -Name "invalid-role-fails-before-install" -Passed (
    $invalidExitCode -eq 87 -and
    -not (Test-Path -LiteralPath $dataRoot) -and
    -not (Test-Path -LiteralPath $installRoot) -and
    @(Get-BreevInstalledProducts).Count -eq 0
  ) -Details @{ exitCode = $invalidExitCode }

  $installExitCode = Invoke-Installer -Path $InstallerPath -Arguments @("/S", "/allusers", "/ROLE=terminal")
  Add-Check -Name "silent-terminal-install-completes" -Passed (
    $installExitCode -eq 0 -and (Get-InstalledVersion) -eq $InstallerVersion
  ) -Details @{ exitCode = $installExitCode; version = (Get-InstalledVersion) }
  Add-TerminalInvariantCheck -Name "clean-install-has-terminal-only-footprint"

  [Guid]::NewGuid().ToString() | Set-Content -LiteralPath $witnessPath -Encoding ASCII -NoNewline
  $witnessSha256 = (Get-FileHash -LiteralPath $witnessPath -Algorithm SHA256).Hash.ToLowerInvariant()

  $repairExitCode = Invoke-Installer -Path $InstallerPath -Arguments @("/S", "/allusers", "/repair")
  Add-Check -Name "repair-completes" -Passed ($repairExitCode -eq 0) -Details @{ exitCode = $repairExitCode }
  Add-TerminalInvariantCheck -Name "repair-preserves-role-and-terminal-state" -ExpectedWitnessSha256 $witnessSha256

  $conflictExitCode = Invoke-Installer -Path $InstallerPath -Arguments @("/S", "/allusers", "/ROLE=main")
  Add-Check -Name "role-conversion-is-refused" -Passed ($conflictExitCode -eq 87) -Details @{ exitCode = $conflictExitCode }
  Add-TerminalInvariantCheck -Name "refused-conversion-preserves-terminal-state" -ExpectedWitnessSha256 $witnessSha256

  $failureExitCode = Invoke-Installer -Path $InstallerPath -Arguments @("/S", "/allusers", "/repair") -InjectFailure "AfterDataPrepared"
  Add-Check -Name "injected-repair-failure-is-reported" -Passed ($failureExitCode -ne 0) -Details @{ exitCode = $failureExitCode; failurePoint = "AfterDataPrepared" }
  Add-TerminalInvariantCheck -Name "failed-repair-preserves-terminal-state" -ExpectedWitnessSha256 $witnessSha256

  $recoveryExitCode = Invoke-Installer -Path $InstallerPath -Arguments @("/S", "/allusers", "/repair")
  Add-Check -Name "repair-recovers-after-injected-failure" -Passed ($recoveryExitCode -eq 0) -Details @{ exitCode = $recoveryExitCode }
  Add-TerminalInvariantCheck -Name "recovered-repair-preserves-terminal-state" -ExpectedWitnessSha256 $witnessSha256

  $updateExitCode = Invoke-Installer -Path $UpdateInstallerPath -Arguments @("/S", "/allusers")
  Add-Check -Name "silent-update-preserves-installed-role" -Passed (
    $updateExitCode -eq 0 -and (Get-InstalledVersion) -eq $UpdateInstallerVersion
  ) -Details @{ exitCode = $updateExitCode; version = (Get-InstalledVersion) }
  Add-TerminalInvariantCheck -Name "update-preserves-role-and-terminal-state" -ExpectedWitnessSha256 $witnessSha256

  $uninstallerPath = Get-UninstallerPath
  $uninstallProcess = Start-Process -FilePath $uninstallerPath -ArgumentList @("/S", "/allusers") -Wait -PassThru
  Add-Check -Name "uninstall-removes-application-only" -Passed (
    $uninstallProcess.ExitCode -eq 0 -and
    -not (Test-Path -LiteralPath $installRoot) -and
    @(Get-BreevInstalledProducts).Count -eq 0
  ) -Details @{ exitCode = $uninstallProcess.ExitCode }
  Add-TerminalInvariantCheck -Name "uninstall-preserves-role-and-terminal-state" -ExpectedWitnessSha256 $witnessSha256

  $reinstallExitCode = Invoke-Installer -Path $UpdateInstallerPath -Arguments @("/S", "/allusers")
  Add-Check -Name "reinstall-detects-preserved-role" -Passed (
    $reinstallExitCode -eq 0 -and (Get-InstalledVersion) -eq $UpdateInstallerVersion
  ) -Details @{ exitCode = $reinstallExitCode; version = (Get-InstalledVersion) }
  Add-TerminalInvariantCheck -Name "reinstall-opens-preserved-terminal-state" -ExpectedWitnessSha256 $witnessSha256

  $result.passed = @($checks | Where-Object { -not $_.passed }).Count -eq 0
} catch {
  $result.error = $_.Exception.Message
} finally {
  $result.completedAtUtc = [DateTime]::UtcNow.ToString("o")
  $outputRoot = Split-Path -Parent ([IO.Path]::GetFullPath($OutputPath))
  New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
  $result | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
}

if (-not $result.passed) {
  throw "The Terminal installer proof failed. See $OutputPath"
}
Write-Output $OutputPath
