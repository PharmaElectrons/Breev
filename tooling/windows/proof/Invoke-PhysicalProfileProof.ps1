#Requires -Version 5.1

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-f]{40}$')]
  [string] $SourceCommit,

  [Parameter(Mandatory = $true)]
  [string] $OutputPath,

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

$windowsRegistry = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion"
$operatingSystem = Get-CimInstance Win32_OperatingSystem
$computer = Get-CimInstance Win32_ComputerSystem
$physicalMemory = @(Get-CimInstance Win32_PhysicalMemory)
$processors = @(Get-CimInstance Win32_Processor)
$physicalDisks = @(Get-PhysicalDisk | Select-Object FriendlyName, MediaType, BusType, Size)
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
$hibernateEnabled = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\Power" -Name HibernateEnabled).HibernateEnabled
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
$virtualModel = $modelIdentity -match '(?i)(qemu|kvm|virtualbox|vmware|virtual machine|parallels|xen|bochs)'
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
  physicalMachineObserved = -not $virtualModel
  hypervisorPresent = [bool] $computer.HypervisorPresent
  secureBoot = [bool] $secureBoot
  tpmPresent = [bool] $tpm.TpmPresent
  tpmReady = [bool] $tpm.TpmReady
  logicalProcessors = $computer.NumberOfLogicalProcessors
  physicalCores = @($processors | Measure-Object -Property NumberOfCores -Sum).Sum
  installedMemoryBytes = [uint64] @($physicalMemory | Measure-Object -Property Capacity -Sum).Sum
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
  $facts.physicalMachineObserved -and $facts.secureBoot -and $facts.tpmPresent -and $facts.tpmReady -and
  $facts.logicalProcessors -ge 4 -and $facts.physicalCores -ge 4 -and $facts.installedMemoryBytes -ge 8GB -and
  @($facts.physicalDisks | Where-Object { $_.MediaType -eq "SSD" -and $_.Size -ge 256GB }).Count -gt 0 -and
  @($facts.display | Where-Object { $_.CurrentHorizontalResolution -ge 1366 -and $_.CurrentVerticalResolution -ge 768 }).Count -gt 0 -and
  $facts.bitLockerProtection -eq "On" -and $facts.bitLockerVolumeStatus -eq "FullyEncrypted" -and
  $facts.bitLockerRecoveryProtectorCount -gt 0 -and $facts.bitLockerRecoveryCustodyAcknowledged -and
  $facts.acSleepTimeoutSeconds -eq 0 -and $facts.dcSleepTimeoutSeconds -eq 0 -and -not $facts.hibernateEnabled -and
  -not $facts.pendingRestart -and @($facts.pendingSoftwareUpdates).Count -eq 0 -and
  $null -ne $facts.latestHotfixInstalledOnUtc -and
  ([DateTime]::Parse($facts.latestHotfixInstalledOnUtc).ToUniversalTime() -ge [DateTime]::UtcNow.AddDays(-45))
$result = [ordered]@{
  schemaVersion = 1
  sourceCommit = $SourceCommit
  evidenceKind = "non-destructive-physical-profile"
  pharmacyDataUsed = $false
  facts = $facts
  completedAtUtc = [DateTime]::UtcNow.ToString("o")
  passed = [bool] $passed
}
$OutputPath = [IO.Path]::GetFullPath($OutputPath)
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutputPath) | Out-Null
[IO.File]::WriteAllText($OutputPath, ($result | ConvertTo-Json -Depth 8) + "`n", [Text.UTF8Encoding]::new($false))
if (-not $passed) { throw "The physical Windows profile does not meet the supported-environment gate" }
Write-Output $OutputPath
