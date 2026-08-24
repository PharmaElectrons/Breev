#Requires -Version 5.1

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-f]{40}$')]
  [string] $SourceCommit,

  [Parameter(Mandatory = $true)]
  [string] $OutputPath,

  [Parameter(Mandatory = $true)]
  [string] $PackagingResultPath,

  [Parameter(Mandatory = $true)]
  [string] $BuilderApplicationRoot,

  [string] $ApplicationScreenshotPath,

  [switch] $PhysicalMachineAcknowledged,
  [switch] $BitLockerRecoveryCustodyAcknowledged
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "The physical-profile proof requires an elevated administrator token"
}
if (-not $PhysicalMachineAcknowledged) {
  throw "The operator must attest that this is a disposable or non-pharmacy physical Windows test machine"
}

function Get-ProcessTreeIds {
  param([int] $RootProcessId)

  $allProcesses = @(Get-CimInstance Win32_Process)
  $found = [Collections.Generic.List[int]]::new()
  $pending = [Collections.Generic.Queue[int]]::new()
  $pending.Enqueue($RootProcessId)
  while ($pending.Count -gt 0) {
    $processId = $pending.Dequeue()
    if ($found.Contains($processId)) { continue }
    $found.Add($processId)
    $allProcesses | Where-Object { $_.ParentProcessId -eq $processId } | ForEach-Object {
      $pending.Enqueue([int] $_.ProcessId)
    }
  }
  return @($found)
}

function Wait-ProcessTreeExit {
  param([int[]] $ProcessIds, [int] $TimeoutSeconds = 15)

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $remaining = @(Get-Process -Id $ProcessIds -ErrorAction SilentlyContinue)
    if ($remaining.Count -eq 0) { return @() }
    Start-Sleep -Milliseconds 200
  } while ([DateTime]::UtcNow -lt $deadline)
  return @($remaining | Select-Object -ExpandProperty Id)
}

$PackagingResultPath = [IO.Path]::GetFullPath($PackagingResultPath)
$BuilderApplicationRoot = [IO.Path]::GetFullPath($BuilderApplicationRoot)
$packaging = Get-Content -LiteralPath $PackagingResultPath -Raw | ConvertFrom-Json
$packagedVersions = @($packaging.versions | Where-Object { $_.version -eq "0.0.1" })
if ($packaging.sourceCommit -ne $SourceCommit -or $packagedVersions.Count -ne 1) {
  throw "The physical profile requires the correlated 0.0.1 packaging result"
}
if ((Get-Service -Name "BreevLocalApi", "BreevPostgreSQL" -ErrorAction SilentlyContinue).Count -ne 0 -or
    (Test-Path -LiteralPath (Join-Path $env:ProgramData "Breev")) -or
    (Test-Path -LiteralPath (Join-Path $env:ProgramFiles "Breev"))) {
  throw "The physical profile must run on a non-pharmacy machine without an installed Breev runtime"
}

$builderExecutable = Join-Path $BuilderApplicationRoot "Breev.exe"
$builderAsar = Join-Path $BuilderApplicationRoot "resources\app.asar"
foreach ($path in @($builderExecutable, $builderAsar)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "The retained Builder application is incomplete"
  }
}
$packagedVersion = $packagedVersions[0]
$builderExecutableHash = (Get-FileHash -LiteralPath $builderExecutable -Algorithm SHA256).Hash.ToLowerInvariant()
$builderAsarHash = (Get-FileHash -LiteralPath $builderAsar -Algorithm SHA256).Hash.ToLowerInvariant()
$builderSignature = Get-AuthenticodeSignature -LiteralPath $builderExecutable
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ("breev-issue-34-physical-" + [Guid]::NewGuid().ToString())
$fuseResultPath = Join-Path $temporaryRoot "fuses.json"
$profileRoot = Join-Path $temporaryRoot "profile"
$applicationProcess = $null
$launchObservedMainUnavailable = $false
$cleanupErrors = [Collections.Generic.List[string]]::new()
$remainingApplicationProcessIds = @()
New-Item -ItemType Directory -Force -Path $temporaryRoot | Out-Null
try {
  & node.exe (Join-Path $PSScriptRoot "read-fuses.mjs") --executable $builderExecutable --output $fuseResultPath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "The physical profile could not verify the Electron fuse wire" }
  $fuses = Get-Content -LiteralPath $fuseResultPath -Raw | ConvertFrom-Json
  $applicationVersion = (& node.exe (Join-Path $PSScriptRoot "read-asar-package-version.mjs") --asar $builderAsar).Trim()
  if ($LASTEXITCODE -ne 0) { throw "The physical profile could not read the packaged application version" }

  $applicationProcess = Start-Process -FilePath $builderExecutable `
    -ArgumentList @("--force-renderer-accessibility", "--user-data-dir=`"$profileRoot`"") `
    -PassThru
  $uiArguments = @(
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", (Join-Path $PSScriptRoot "../../../apps/desktop/test/windows/DesktopUiAutomation.ps1"),
    "-Action", "WaitForText", "-ProcessId", $applicationProcess.Id.ToString(),
    "-ExpectedText", "Main unavailable", "-TimeoutSeconds", "30"
  )
  if (-not [string]::IsNullOrWhiteSpace($ApplicationScreenshotPath)) {
    $uiArguments += @("-ScreenshotPath", [IO.Path]::GetFullPath($ApplicationScreenshotPath))
  }
  $uiProcess = Start-Process -FilePath "powershell.exe" -ArgumentList $uiArguments -Wait -PassThru
  $launchObservedMainUnavailable = $uiProcess.ExitCode -eq 0
} finally {
  if ($null -ne $applicationProcess) {
    $applicationProcessTree = Get-ProcessTreeIds -RootProcessId $applicationProcess.Id
    if (@(Get-Process -Id $applicationProcessTree -ErrorAction SilentlyContinue).Count -gt 0) {
      & taskkill.exe /PID $applicationProcess.Id /T /F 2>&1 | Out-Null
    }
    $remainingApplicationProcessIds = Wait-ProcessTreeExit -ProcessIds $applicationProcessTree
    if ($remainingApplicationProcessIds.Count -gt 0) {
      $cleanupErrors.Add("Electron process cleanup left PIDs: $($remainingApplicationProcessIds -join ',')")
    }
  }
  try {
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction Stop
  } catch {
    $cleanupErrors.Add("Temporary application profile cleanup failed: $($_.Exception.Message)")
  }
  if (Test-Path -LiteralPath $temporaryRoot) {
    $cleanupErrors.Add("The temporary application profile still exists")
  }
}

$applicationFacts = [ordered]@{
  candidate = "electron-builder"
  version = $applicationVersion
  executableSha256 = $builderExecutableHash
  asarSha256 = $builderAsarHash
  signatureStatus = $builderSignature.Status.ToString()
  signerThumbprint = if ($null -eq $builderSignature.SignerCertificate) { $null } else { $builderSignature.SignerCertificate.Thumbprint }
  fuseWirePassed = [bool] $fuses.passed
  launchObservedMainUnavailable = [bool] $launchObservedMainUnavailable
  cleanupPassed = $cleanupErrors.Count -eq 0
  cleanupErrors = @($cleanupErrors)
  remainingProcessIds = @($remainingApplicationProcessIds)
}
$applicationPassed = $applicationFacts.version -eq "0.0.1" -and
  $applicationFacts.executableSha256 -eq $packagedVersion.electronBuilderExecutable.sha256 -and
  $applicationFacts.asarSha256 -eq $packagedVersion.electronBuilderAsar.sha256 -and
  $applicationFacts.signerThumbprint -eq $packaging.signing.certificateThumbprint -and
  $applicationFacts.fuseWirePassed -and
  $fuses.executableSha256 -eq $applicationFacts.executableSha256 -and
  $applicationFacts.launchObservedMainUnavailable -and
  $applicationFacts.cleanupPassed

$windowsRegistry = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion"
$operatingSystem = Get-CimInstance Win32_OperatingSystem
$computer = Get-CimInstance Win32_ComputerSystem
$physicalMemory = @(Get-CimInstance Win32_PhysicalMemory)
$processors = @(Get-CimInstance Win32_Processor)
$systemPartition = Get-Partition -DriveLetter ($env:SystemDrive).TrimEnd(':')
$systemDisk = Get-Disk -Number $systemPartition.DiskNumber
$physicalDisks = @(Get-PhysicalDisk | Select-Object DeviceId, FriendlyName, MediaType, BusType, Size)
$systemPhysicalDisks = @($physicalDisks | Where-Object { $_.DeviceId.ToString() -eq $systemDisk.Number.ToString() })
$systemDriveOnEligibleSsd = $systemPhysicalDisks.Count -eq 1 -and
  $systemPhysicalDisks[0].MediaType -eq "SSD" -and $systemDisk.Size -ge 256GB
$videoControllers = @(Get-CimInstance Win32_VideoController | Select-Object Name, CurrentHorizontalResolution, CurrentVerticalResolution)
$bitLocker = Get-BitLockerVolume -MountPoint $env:SystemDrive
$latestHotfix = Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 1
$powerOutput = (& powercfg.exe /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0) { throw "Could not read the active sleep timeout" }
$acSleepMatch = [regex]::Match($powerOutput, 'Current AC Power Setting Index:\s+0x([0-9a-fA-F]+)')
$dcSleepMatch = [regex]::Match($powerOutput, 'Current DC Power Setting Index:\s+0x([0-9a-fA-F]+)')
if (-not $acSleepMatch.Success -or -not $dcSleepMatch.Success) {
  throw "Could not parse sleep timeouts on the required English Windows candidate"
}
$hibernateEnabled = Test-Path -LiteralPath (Join-Path $env:SystemDrive "hiberfil.sys")
$updateSession = New-Object -ComObject Microsoft.Update.Session
$pendingUpdateSearch = $updateSession.CreateUpdateSearcher().Search("IsInstalled=0 and IsHidden=0 and Type='Software'")
$pendingSoftwareUpdates = @(
  for ($index = 0; $index -lt $pendingUpdateSearch.Updates.Count; $index++) {
    $update = $pendingUpdateSearch.Updates.Item($index)
    [ordered]@{ title = $update.Title; rebootRequired = [bool] $update.RebootRequired }
  }
)
$pendingRestart = (Test-Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending") -or
  (Test-Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired") -or
  ($null -ne (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager" -Name PendingFileRenameOperations -ErrorAction SilentlyContinue))
$activation = @(Get-CimInstance SoftwareLicensingProduct -Filter "ApplicationID='55c92734-d682-4d71-983e-d6ec3f16059f' AND PartialProductKey IS NOT NULL" | Where-Object { $_.LicenseStatus -eq 1 })
$secureBoot = try { Confirm-SecureBootUEFI } catch { $false }
$tpm = Get-Tpm
$modelIdentity = "$($computer.Manufacturer) $($computer.Model)"
$knownVirtualPlatformIndicators = @(
  if ($modelIdentity -match '(?i)(qemu|kvm|virtualbox|vmware|virtual machine|parallels|xen|bochs|bhyve|hyper-v)') {
    $modelIdentity
  }
)
$facts = [ordered]@{
  productName = $operatingSystem.Caption -replace '^Microsoft ', ''
  editionId = $windowsRegistry.EditionID
  displayVersion = $windowsRegistry.DisplayVersion
  build = $operatingSystem.BuildNumber
  architecture = $operatingSystem.OSArchitecture
  productType = $operatingSystem.ProductType
  activated = $activation.Count -gt 0
  manufacturer = $computer.Manufacturer
  model = $computer.Model
  physicalMachineOperatorAttested = [bool] $PhysicalMachineAcknowledged
  knownVirtualPlatformIndicators = $knownVirtualPlatformIndicators
  hypervisorPresent = [bool] $computer.HypervisorPresent
  secureBoot = [bool] $secureBoot
  tpmPresent = [bool] $tpm.TpmPresent
  tpmReady = [bool] $tpm.TpmReady
  logicalProcessors = $computer.NumberOfLogicalProcessors
  physicalCores = @($processors | Measure-Object -Property NumberOfCores -Sum).Sum
  installedMemoryBytes = [uint64] @($physicalMemory | Measure-Object -Property Capacity -Sum).Sum
  systemDisk = $systemDisk | Select-Object Number, FriendlyName, BusType, Size
  systemPhysicalDisk = if ($systemPhysicalDisks.Count -eq 1) { $systemPhysicalDisks[0] } else { $null }
  systemDriveOnEligibleSsd = [bool] $systemDriveOnEligibleSsd
  physicalDisks = $physicalDisks
  display = $videoControllers
  bitLockerProtection = $bitLocker.ProtectionStatus.ToString()
  bitLockerVolumeStatus = $bitLocker.VolumeStatus.ToString()
  bitLockerRecoveryProtectorCount = @($bitLocker.KeyProtector | Where-Object { $_.KeyProtectorType -eq "RecoveryPassword" }).Count
  bitLockerRecoveryCustodyAcknowledged = [bool] $BitLockerRecoveryCustodyAcknowledged
  acSleepTimeoutSeconds = [Convert]::ToUInt32($acSleepMatch.Groups[1].Value, 16)
  dcSleepTimeoutSeconds = [Convert]::ToUInt32($dcSleepMatch.Groups[1].Value, 16)
  hibernateEnabled = [bool] $hibernateEnabled
  pendingRestart = [bool] $pendingRestart
  pendingSoftwareUpdates = $pendingSoftwareUpdates
  latestHotfixInstalledOnUtc = if ($null -eq $latestHotfix) { $null } else { $latestHotfix.InstalledOn.ToUniversalTime().ToString("o") }
}
$passed = $facts.productName -eq "Windows 11 Pro" -and
  $facts.editionId -eq "Professional" -and $facts.displayVersion -eq "25H2" -and
  $facts.architecture -eq "64-bit" -and $facts.productType -eq 1 -and $facts.activated -and
  $facts.physicalMachineOperatorAttested -and @($facts.knownVirtualPlatformIndicators).Count -eq 0 -and
  $facts.secureBoot -and $facts.tpmPresent -and $facts.tpmReady -and
  $facts.logicalProcessors -ge 4 -and $facts.physicalCores -ge 4 -and $facts.installedMemoryBytes -ge 8GB -and
  $facts.systemDriveOnEligibleSsd -and
  @($facts.display | Where-Object { $_.CurrentHorizontalResolution -ge 1366 -and $_.CurrentVerticalResolution -ge 768 }).Count -gt 0 -and
  $facts.bitLockerProtection -eq "On" -and $facts.bitLockerVolumeStatus -eq "FullyEncrypted" -and
  $facts.bitLockerRecoveryProtectorCount -gt 0 -and $facts.bitLockerRecoveryCustodyAcknowledged -and
  $facts.acSleepTimeoutSeconds -eq 0 -and $facts.dcSleepTimeoutSeconds -eq 0 -and -not $facts.hibernateEnabled -and
  -not $facts.pendingRestart -and @($facts.pendingSoftwareUpdates).Count -eq 0 -and
  $null -ne $facts.latestHotfixInstalledOnUtc -and
  ([DateTime]::Parse($facts.latestHotfixInstalledOnUtc).ToUniversalTime() -ge [DateTime]::UtcNow.AddDays(-45)) -and
  $applicationPassed
$result = [ordered]@{
  schemaVersion = 1
  sourceCommit = $SourceCommit
  evidenceKind = "non-destructive-physical-profile"
  pharmacyDataUsed = $false
  facts = $facts
  application = $applicationFacts
  completedAtUtc = [DateTime]::UtcNow.ToString("o")
  passed = [bool] $passed
}
$OutputPath = [IO.Path]::GetFullPath($OutputPath)
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutputPath) | Out-Null
[IO.File]::WriteAllText($OutputPath, ($result | ConvertTo-Json -Depth 8) + "`n", [Text.UTF8Encoding]::new($false))
if (-not $passed) { throw "The physical Windows profile does not meet the supported-environment gate" }
Write-Output $OutputPath
