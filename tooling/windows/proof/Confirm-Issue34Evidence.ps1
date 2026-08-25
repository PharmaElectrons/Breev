#Requires -Version 5.1

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [Guid] $RunId,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-f]{40}$')]
  [string] $SourceCommit,

  [Parameter(Mandatory = $true)]
  [string] $SnapshotId,

  [Parameter(Mandatory = $true)]
  [string] $PackagingRoot,

  [Parameter(Mandatory = $true)]
  [string] $RuntimeResultPath,

  [Parameter(Mandatory = $true)]
  [string] $StandardUserResultPath,

  [Parameter(Mandatory = $true)]
  [string] $ApiRestartResultPath,

  [Parameter(Mandatory = $true)]
  [string] $RebootResultPath,

  [Parameter(Mandatory = $true)]
  [string] $LanResultPath,

  [Parameter(Mandatory = $true)]
  [string] $ForgeLifecycleResultPath,

  [Parameter(Mandatory = $true)]
  [string] $BuilderAsarIntegrityResultPath,

  [Parameter(Mandatory = $true)]
  [string] $ForgeAsarIntegrityResultPath,

  [Parameter(Mandatory = $true)]
  [string] $HostBaselineResultPath,

  [Parameter(Mandatory = $true)]
  [string] $HostRestoreResultPath,

  [Parameter(Mandatory = $true)]
  [string] $HostExportResultPath,

  [Parameter(Mandatory = $true)]
  [string] $HostImportResultPath,

  [Parameter(Mandatory = $true)]
  [string] $HostRebootResultPath,

  [Parameter(Mandatory = $true)]
  [string] $OfflineNetworkResultPath,

  [Parameter(Mandatory = $true)]
  [string] $HostNetworkRestoreResultPath,

  [Parameter(Mandatory = $true)]
  [string] $WindowsCiResultPath,

  [Parameter(Mandatory = $true)]
  [string] $PhysicalProfileResultPath,

  [Parameter(Mandatory = $true)]
  [string] $OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Read-Json {
  param([string] $Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Required evidence is missing: $Path" }
  return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Get-RuntimeCheck {
  param([object] $Runtime, [string] $Name)
  $matches = @($Runtime.checks | Where-Object { $_.name -eq $Name })
  return $matches.Count -eq 1 -and $matches[0].passed
}

function Add-Criterion {
  param(
    [Collections.Generic.List[object]] $Criteria,
    [string] $Id,
    [string] $Requirement,
    [bool] $Passed,
    [string[]] $Evidence
  )
  $Criteria.Add([ordered]@{ id = $Id; requirement = $Requirement; passed = $Passed; evidence = $Evidence })
}

$PackagingRoot = [IO.Path]::GetFullPath($PackagingRoot)
$runtime = Read-Json ([IO.Path]::GetFullPath($RuntimeResultPath))
$standardUser = Read-Json ([IO.Path]::GetFullPath($StandardUserResultPath))
$apiRestart = Read-Json ([IO.Path]::GetFullPath($ApiRestartResultPath))
$reboot = Read-Json ([IO.Path]::GetFullPath($RebootResultPath))
$lan = Read-Json ([IO.Path]::GetFullPath($LanResultPath))
$forge = Read-Json ([IO.Path]::GetFullPath($ForgeLifecycleResultPath))
$builderAsarIntegrity = Read-Json ([IO.Path]::GetFullPath($BuilderAsarIntegrityResultPath))
$forgeAsarIntegrity = Read-Json ([IO.Path]::GetFullPath($ForgeAsarIntegrityResultPath))
$hostBaseline = Read-Json ([IO.Path]::GetFullPath($HostBaselineResultPath))
$hostRestore = Read-Json ([IO.Path]::GetFullPath($HostRestoreResultPath))
$hostExport = Read-Json ([IO.Path]::GetFullPath($HostExportResultPath))
$hostImport = Read-Json ([IO.Path]::GetFullPath($HostImportResultPath))
$hostReboot = Read-Json ([IO.Path]::GetFullPath($HostRebootResultPath))
$offlineNetwork = Read-Json ([IO.Path]::GetFullPath($OfflineNetworkResultPath))
$networkRestore = Read-Json ([IO.Path]::GetFullPath($HostNetworkRestoreResultPath))
$windowsCi = Read-Json ([IO.Path]::GetFullPath($WindowsCiResultPath))
$physicalProfile = Read-Json ([IO.Path]::GetFullPath($PhysicalProfileResultPath))
$packagingPath = Join-Path $PackagingRoot "packaging-results.json"
$packaging = Read-Json $packagingPath
$criteria = [Collections.Generic.List[object]]::new()

$packagingVersions = @($packaging.versions)
$initialPackaging = @($packagingVersions | Where-Object { $_.version -eq "0.0.0" })
$updatePackaging = @($packagingVersions | Where-Object { $_.version -eq "0.0.1" })
$machineId = $runtime.machine.machineId
$correlatedRunEvidence = @($runtime, $standardUser, $apiRestart, $reboot, $lan, $forge, $builderAsarIntegrity, $forgeAsarIntegrity, $packaging, $hostReboot, $offlineNetwork, $networkRestore, $hostExport, $hostImport)
$sameMachineEvidence = @($packaging, $runtime, $standardUser, $apiRestart, $reboot, $forge, $builderAsarIntegrity, $forgeAsarIntegrity)
$correlationPassed = $initialPackaging.Count -eq 1 -and $updatePackaging.Count -eq 1 -and
  @($correlatedRunEvidence | Where-Object {
    $_.runId -ne $RunId.ToString() -or $_.sourceCommit -ne $SourceCommit -or $_.snapshotId -ne $SnapshotId
  }).Count -eq 0 -and
  $hostBaseline.runId -eq $RunId.ToString() -and
  $hostBaseline.sourceCommit -eq $SourceCommit -and
  $hostBaseline.snapshotId -eq $SnapshotId -and
  $hostBaseline.schemaVersion -eq 1 -and
  $hostBaseline.passed -and
  $hostBaseline.domain -eq "breev-issue-34-win11" -and
  $hostBaseline.machineType -eq "pc-q35-11.1" -and
  $hostBaseline.virtualization -eq "kvm" -and
  $hostBaseline.windowsIsoSha256 -eq "768984706b909479417b2368438909440f2967ff05c6a9195ed2667254e465e3" -and
  $hostBaseline.windowsIsoBytes -eq 8471603200 -and
  $hostBaseline.configuredDiskBytes -ge 256GB -and
  (@($hostBaseline.indivisibleState | Sort-Object) -join ',') -eq "disk,domain-xml,swtpm,uefi-nvram" -and
  @(@($hostBaseline.diskSha256, $hostBaseline.nvramSha256, $hostBaseline.tpmSha256, $hostBaseline.domainXmlSha256) | Where-Object { $_ -notmatch '^[0-9a-f]{64}$' }).Count -eq 0 -and
  $hostBaseline.domainUuid -eq $machineId -and
  $hostRestore.runId -eq $RunId.ToString() -and
  $hostRestore.sourceCommit -eq $SourceCommit -and
  $hostRestore.snapshotId -eq $SnapshotId -and
  $hostRestore.domainUuid -eq $hostBaseline.domainUuid -and
  $hostRestore.passed -and
  (@($hostRestore.indivisibleState | Sort-Object) -join ',') -eq "disk,domain-xml,swtpm,uefi-nvram" -and
  $hostRestore.diskSha256 -eq $hostBaseline.diskSha256 -and
  $hostRestore.nvramSha256 -eq $hostBaseline.nvramSha256 -and
  $hostRestore.tpmSha256 -eq $hostBaseline.tpmSha256 -and
  $hostRestore.domainXmlSha256 -eq $hostBaseline.domainXmlSha256 -and
  $hostExport.passed -and
  $hostExport.domainUuid -eq $hostBaseline.domainUuid -and
  $hostExport.archiveSha256 -match '^[0-9a-f]{64}$' -and
  $hostExport.archiveBytes -gt 0 -and
  $hostExport.guest.passed -and
  $hostExport.guest.machineId -eq $machineId -and
  $hostExport.guest.archiveSha256 -eq $hostExport.archiveSha256 -and
  $hostExport.guest.archiveBytes -eq $hostExport.archiveBytes -and
  $hostImport.passed -and
  $hostImport.machineId -eq $machineId -and
  $hostImport.archiveSha256 -eq $hostExport.archiveSha256 -and
  @($sameMachineEvidence | Where-Object {
    $candidateMachineId = if ($_.PSObject.Properties.Name -contains "machineId") { $_.machineId } else { $_.machine.machineId }
    $candidateMachineId -ne $machineId
  }).Count -eq 0 -and
  $lan.windows.windowsMachineId -eq $machineId -and
  $runtime.artifacts.installer.sha256 -eq $initialPackaging[0].electronBuilderNsis.sha256 -and
  $runtime.artifacts.updateInstaller.sha256 -eq $updatePackaging[0].electronBuilderNsis.sha256 -and
  $runtime.signing.expectedSignerThumbprint -eq $packaging.signing.certificateThumbprint -and
  $forge.artifacts.installer.sha256 -eq $initialPackaging[0].electronForgeWix.sha256 -and
  $forge.artifacts.updateInstaller.sha256 -eq $updatePackaging[0].electronForgeWix.sha256 -and
  $builderAsarIntegrity.candidate -eq "electron-builder" -and
  $builderAsarIntegrity.version -eq "0.0.1" -and
  $builderAsarIntegrity.executableSha256 -eq $updatePackaging[0].electronBuilderExecutable.sha256 -and
  $builderAsarIntegrity.asarSha256 -eq $updatePackaging[0].electronBuilderAsar.sha256 -and
  $forgeAsarIntegrity.candidate -eq "electron-forge" -and
  $forgeAsarIntegrity.version -eq "0.0.1" -and
  $forgeAsarIntegrity.executableSha256 -eq $updatePackaging[0].electronForgeExecutable.sha256 -and
  $forgeAsarIntegrity.asarSha256 -eq $updatePackaging[0].electronForgeAsar.sha256 -and
  $standardUser.desktopExecutableSha256 -eq $updatePackaging[0].electronBuilderExecutable.sha256 -and
  $apiRestart.desktopExecutableSha256 -eq $standardUser.desktopExecutableSha256 -and
  $hostReboot.domainUuid -eq $hostBaseline.domainUuid -and
  $offlineNetwork.domainUuid -eq $hostBaseline.domainUuid -and
  $networkRestore.domainUuid -eq $hostBaseline.domainUuid -and
  $offlineNetwork.passed -and
  @($offlineNetwork.liveNetworks).Count -eq 1 -and
  $offlineNetwork.liveNetworks[0] -eq "breev-issue-34-isolated" -and
  @($offlineNetwork.inactiveNetworks).Count -eq 1 -and
  $offlineNetwork.inactiveNetworks[0] -eq "breev-issue-34-isolated" -and
  ([DateTime]::Parse($offlineNetwork.recordedAtUtc).ToUniversalTime() -le [DateTime]::Parse($standardUser.startedAtUtc).ToUniversalTime()) -and
  ([DateTime]::Parse($standardUser.completedAtUtc).ToUniversalTime() -le [DateTime]::Parse($hostReboot.rebootRequestedAtUtc).ToUniversalTime()) -and
  ([DateTime]::Parse($reboot.bootTimeUtc).ToUniversalTime() -ge [DateTime]::Parse($hostReboot.rebootRequestedAtUtc).ToUniversalTime()) -and
  ([DateTime]::Parse($reboot.bootTimeUtc).ToUniversalTime() -le [DateTime]::Parse($hostReboot.guestAgentReturnedAtUtc).ToUniversalTime()) -and
  ([DateTime]::Parse($networkRestore.recordedAtUtc).ToUniversalTime() -ge [DateTime]::Parse($hostReboot.guestAgentReturnedAtUtc).ToUniversalTime()) -and
  ([DateTime]::Parse($hostExport.exportedAtUtc).ToUniversalTime() -ge [DateTime]::Parse($networkRestore.recordedAtUtc).ToUniversalTime()) -and
  ([DateTime]::Parse($hostBaseline.capturedAtUtc).ToUniversalTime() -le [DateTime]::Parse($runtime.startedAtUtc).ToUniversalTime()) -and
  ([DateTime]::Parse($hostRestore.restoredAtUtc).ToUniversalTime() -ge [DateTime]::Parse($hostExport.exportedAtUtc).ToUniversalTime()) -and
  ([DateTime]::Parse($hostImport.importedAtUtc).ToUniversalTime() -ge [DateTime]::Parse($hostRestore.restoredAtUtc).ToUniversalTime()) -and
  ([DateTime]::Parse($hostImport.importedAtUtc).ToUniversalTime() -le [DateTime]::Parse($forge.startedAtUtc).ToUniversalTime()) -and
  $networkRestore.passed -and
  (@($networkRestore.liveNetworks | Sort-Object) -join ',') -eq "breev-issue-34-isolated,default" -and
  (@($networkRestore.inactiveNetworks | Sort-Object) -join ',') -eq "breev-issue-34-isolated,default" -and
  $hostReboot.viewerProcessCountAtRequest -eq 0 -and
  $hostReboot.spiceClientCountAtRequest -eq 0 -and
  $hostReboot.passed

if (-not $correlationPassed) {
  throw "Evidence correlation failed; stale, mixed-machine, mixed-artifact, or mixed-snapshot results are not accepted"
}
$signedCandidates = $packagingVersions.Count -eq 2 -and @($packagingVersions | Where-Object {
  $_.electronBuilderNsis.signatureStatus -ne "Valid" -or
  $_.electronBuilderExecutable.signatureStatus -ne "Valid" -or
  -not $_.electronBuilderTamper.rejected -or
  $_.electronForgeWix.signatureStatus -ne "Valid" -or
  $_.electronForgeExecutable.signatureStatus -ne "Valid" -or
  @($_.electronBuilderSigningCoverage | Where-Object { $_.signatureStatus -ne "Valid" }).Count -ne 0 -or
  @($_.electronForgeSigningCoverage | Where-Object { $_.signatureStatus -ne "Valid" }).Count -ne 0 -or
  -not $_.electronForgeTamper.rejected
}).Count -eq 0
$signedByComparisonCertificate = $packaging.signing.required -and
  $packaging.signing.certificatePurpose -eq "issue-34-comparison-only" -and
  $packaging.signing.coveragePolicy -eq "valid-authenticode-with-product-artifacts-comparison-signed" -and
  $packaging.signing.trustStoreLocation -eq "LocalMachine\Root" -and
  -not $packaging.signing.productionTrusted -and
  -not [string]::IsNullOrWhiteSpace($packaging.signing.certificateThumbprint) -and
  -not [string]::IsNullOrWhiteSpace($packaging.signing.publicCertificate.sha256) -and
  $packaging.signing.publicCertificate.size -gt 0 -and
  @($packagingVersions | Where-Object {
    $_.electronBuilderApplicationVersion -ne $_.version -or
    $_.electronForgeApplicationVersion -ne $_.version -or
    $_.electronBuilderNsis.signerThumbprint -ne $packaging.signing.certificateThumbprint -or
    $_.electronBuilderExecutable.signerThumbprint -ne $packaging.signing.certificateThumbprint -or
    $_.electronForgeWix.signerThumbprint -ne $packaging.signing.certificateThumbprint -or
    $_.electronForgeExecutable.signerThumbprint -ne $packaging.signing.certificateThumbprint
  }).Count -eq 0
$samePinnedPayload = -not [string]::IsNullOrWhiteSpace($packaging.payloadLockSha256) -and
  @($packagingVersions | Where-Object {
    $_.electronBuilderPayload.payloadLockSha256 -ne $packaging.payloadLockSha256 -or
    $_.electronForgePayload.payloadLockSha256 -ne $packaging.payloadLockSha256 -or
    @($_.electronBuilderPayload.files).Count -ne 8 -or
    @($_.electronForgePayload.files).Count -ne 8
  }).Count -eq 0
$forgeInstalledSigningMeasured = $forge.signing.expectedSignerThumbprint -eq $packaging.signing.certificateThumbprint -and
  $forge.signing.installedGapObserved -and
  @($forge.signing.afterInstall.files).Count -gt 0 -and
  @($forge.signing.afterFailedRepair.files).Count -gt 0 -and
  @($forge.signing.afterRepair.files).Count -gt 0 -and
  @($forge.signing.afterFailedUpdate.files).Count -gt 0 -and
  @($forge.signing.afterUpdate.files).Count -gt 0 -and
  @($forge.signing.afterReinstall.files).Count -gt 0 -and
  @($forge.signing.afterInstall.files | Where-Object {
    $_.path.EndsWith("\BreevForgeComparison.exe") -and
    $_.sha256 -ne $initialPackaging[0].electronForgeExecutable.sha256 -and $_.signatureStatus -ne "Valid"
  }).Count -eq 1 -and
  @($forge.signing.afterFailedRepair.files | Where-Object {
    $_.path.EndsWith("\BreevForgeComparison.exe") -and
    $_.sha256 -ne $initialPackaging[0].electronForgeExecutable.sha256 -and $_.signatureStatus -ne "Valid"
  }).Count -eq 1 -and
  @($forge.signing.afterRepair.files | Where-Object {
    $_.path.EndsWith("\BreevForgeComparison.exe") -and
    $_.sha256 -ne $initialPackaging[0].electronForgeExecutable.sha256 -and $_.signatureStatus -ne "Valid"
  }).Count -eq 1 -and
  @($forge.signing.afterFailedUpdate.files | Where-Object {
    $_.path.EndsWith("\BreevForgeComparison.exe") -and
    $_.sha256 -ne $initialPackaging[0].electronForgeExecutable.sha256 -and $_.signatureStatus -ne "Valid"
  }).Count -eq 1 -and
  @($forge.signing.afterUpdate.files | Where-Object {
    $_.path.EndsWith("\BreevForgeComparison.exe") -and
    $_.sha256 -ne $updatePackaging[0].electronForgeExecutable.sha256 -and $_.signatureStatus -ne "Valid"
  }).Count -eq 1 -and
  @($forge.signing.afterReinstall.files | Where-Object {
    $_.path.EndsWith("\BreevForgeComparison.exe") -and
    $_.sha256 -ne $updatePackaging[0].electronForgeExecutable.sha256 -and $_.signatureStatus -ne "Valid"
  }).Count -eq 1 -and
  $forge.application.afterInstall.sha256 -eq $initialPackaging[0].electronForgeAsar.sha256 -and
  $forge.application.afterInstall.version -eq "0.0.0" -and
  $forge.application.afterFailedRepair.sha256 -eq $initialPackaging[0].electronForgeAsar.sha256 -and
  $forge.application.afterFailedRepair.version -eq "0.0.0" -and
  $forge.application.afterRepair.sha256 -eq $initialPackaging[0].electronForgeAsar.sha256 -and
  $forge.application.afterRepair.version -eq "0.0.0" -and
  $forge.application.afterFailedUpdate.sha256 -eq $initialPackaging[0].electronForgeAsar.sha256 -and
  $forge.application.afterFailedUpdate.version -eq "0.0.0" -and
  $forge.application.afterUpdate.sha256 -eq $updatePackaging[0].electronForgeAsar.sha256 -and
  $forge.application.afterUpdate.version -eq "0.0.1" -and
  $forge.application.afterReinstall.sha256 -eq $updatePackaging[0].electronForgeAsar.sha256 -and
  $forge.application.afterReinstall.version -eq "0.0.1" -and
  $forge.payload.afterInstall.payloadLockSha256 -eq $packaging.payloadLockSha256 -and
  $forge.payload.afterFailedRepair.payloadLockSha256 -eq $packaging.payloadLockSha256 -and
  $forge.payload.afterRepair.payloadLockSha256 -eq $packaging.payloadLockSha256 -and
  $forge.payload.afterFailedUpdate.payloadLockSha256 -eq $packaging.payloadLockSha256 -and
  $forge.payload.afterUpdate.payloadLockSha256 -eq $packaging.payloadLockSha256 -and
  $forge.payload.afterReinstall.payloadLockSha256 -eq $packaging.payloadLockSha256 -and
  $forge.operations.repairCorruptionCreated -and
  $forge.operations.repairRestoredMsiFile -and
  $forge.operations.failedRepairExitCode -eq 1603 -and
  $forge.operations.failedUpdateExitCode -eq 1603 -and
  $forge.operations.failedRepairMarker.markerMatched -and
  $forge.operations.failedRepairMarker.deferredActionLogged -and
  $forge.operations.failedRepairMarker.logBytes -gt 0 -and
  -not [string]::IsNullOrWhiteSpace($forge.operations.failedRepairMarker.logSha256) -and
  $forge.operations.failedUpdateMarker.markerMatched -and
  $forge.operations.failedUpdateMarker.deferredActionLogged -and
  $forge.operations.failedUpdateMarker.logBytes -gt 0 -and
  -not [string]::IsNullOrWhiteSpace($forge.operations.failedUpdateMarker.logSha256) -and
  $forge.operations.installRootRemoved -and
  $forge.operations.finalUninstalled -and
  $forge.serviceLifecycle.integratesRequiredServices -and
  $forge.serviceLifecycle.repair -and
  $forge.serviceLifecycle.update -and
  $forge.serviceLifecycle.failedRepairRecovery -and
  $forge.serviceLifecycle.failedUpdateRecovery -and
  $forge.serviceLifecycle.recovery -and
  $forge.serviceLifecycle.reinstall -and
  $forge.dataPreservation.afterInstall -and
  $forge.dataPreservation.afterRepair -and
  $forge.dataPreservation.afterFailedRepair -and
  $forge.dataPreservation.afterFailedUpdate -and
  $forge.dataPreservation.afterUpdate -and
  $forge.dataPreservation.afterUninstall -and
  $forge.dataPreservation.afterReinstall -and
  $forge.dataPreservation.afterFinalUninstall
$builderInstalledSigningMeasured = $runtime.signing.expectedSignerThumbprint -eq $packaging.signing.certificateThumbprint -and
  $runtime.signing.afterInstall.allSignaturesValid -and
  $runtime.signing.afterInstall.productExecutablesSignedByExpectedCertificate -and
  $runtime.signing.afterRepair.allSignaturesValid -and
  $runtime.signing.afterRepair.productExecutablesSignedByExpectedCertificate -and
  $runtime.signing.afterUpdate.allSignaturesValid -and
  $runtime.signing.afterUpdate.productExecutablesSignedByExpectedCertificate -and
  $runtime.signing.afterReinstall.allSignaturesValid -and
  $runtime.signing.afterReinstall.productExecutablesSignedByExpectedCertificate -and
  @($runtime.signing.afterInstall.files | Where-Object { $_.sha256 -eq $initialPackaging[0].electronBuilderExecutable.sha256 }).Count -eq 1 -and
  @($runtime.signing.afterUpdate.files | Where-Object { $_.sha256 -eq $updatePackaging[0].electronBuilderExecutable.sha256 }).Count -eq 1 -and
  @($runtime.signing.afterReinstall.files | Where-Object { $_.sha256 -eq $updatePackaging[0].electronBuilderExecutable.sha256 }).Count -eq 1
$fuseResults = foreach ($version in $packagingVersions) {
  $builderFuse = Read-Json (Join-Path $PackagingRoot "$($version.version)\electron-builder\fuses.json")
  $forgeFuse = Read-Json (Join-Path $PackagingRoot "$($version.version)\electron-forge\fuses.json")
  [ordered]@{ passed = $builderFuse.passed -and $builderFuse.executableSha256 -eq $version.electronBuilderExecutable.sha256 }
  [ordered]@{ passed = $forgeFuse.passed -and $forgeFuse.executableSha256 -eq $version.electronForgeExecutable.sha256 }
}
$allFuses = @($fuseResults).Count -eq 4 -and @($fuseResults | Where-Object { -not $_.passed }).Count -eq 0
$windowsCiPassed = $windowsCi.schemaVersion -eq 1 -and $windowsCi.passed -and
  $windowsCi.sourceCommit -eq $SourceCommit -and
  $windowsCi.environmentPurpose -eq "windows-build-validation-only" -and
  -not $windowsCi.certificationEvidence -and
  $windowsCi.repository -eq "PharmaElectrons/PharmaElectrons" -and
  $windowsCi.workflow -eq "Verify" -and $windowsCi.workflowRunId -gt 0 -and
  $windowsCi.workflowRunUrl -eq "https://github.com/PharmaElectrons/PharmaElectrons/actions/runs/$($windowsCi.workflowRunId)" -and
  $windowsCi.runner.os -eq "Windows" -and $windowsCi.runner.architecture -eq "X64" -and
  (@($windowsCi.candidateVersions | Sort-Object) -join ',') -eq "0.0.0,0.0.1" -and
  $windowsCi.payloadLockSha256 -eq $packaging.payloadLockSha256 -and
  @($windowsCi.fuses).Count -eq 4 -and @($windowsCi.fuses | Where-Object { -not $_.passed }).Count -eq 0 -and
  @($windowsCi.checks.PSObject.Properties | Where-Object { -not $_.Value }).Count -eq 0
$physicalProfilePassed = $physicalProfile.schemaVersion -eq 1 -and $physicalProfile.passed -and
  $physicalProfile.sourceCommit -eq $SourceCommit -and
  $physicalProfile.evidenceKind -eq "non-destructive-physical-profile" -and
  -not $physicalProfile.pharmacyDataUsed -and
  $physicalProfile.facts.productName -eq "Windows 11 Pro" -and
  $physicalProfile.facts.editionId -eq "Professional" -and
  $physicalProfile.facts.displayVersion -eq "25H2" -and
  $physicalProfile.facts.architecture -eq "64-bit" -and
  $physicalProfile.facts.physicalMachineOperatorAttested -and
  @($physicalProfile.facts.knownVirtualPlatformIndicators).Count -eq 0 -and
  $physicalProfile.facts.activated -and $physicalProfile.facts.secureBoot -and
  $physicalProfile.facts.tpmPresent -and $physicalProfile.facts.tpmReady -and
  $physicalProfile.application.candidate -eq "electron-builder" -and
  $physicalProfile.application.version -eq "0.0.1" -and
  $physicalProfile.application.executableSha256 -eq $updatePackaging[0].electronBuilderExecutable.sha256 -and
  $physicalProfile.application.asarSha256 -eq $updatePackaging[0].electronBuilderAsar.sha256 -and
  $physicalProfile.application.signatureStatus -eq "Valid" -and
  $physicalProfile.application.signerThumbprint -eq $packaging.signing.certificateThumbprint -and
  $physicalProfile.application.comparisonCertificateSha256 -eq $packaging.signing.publicCertificate.sha256 -and
  $physicalProfile.application.temporaryTrustRemoved -and
  $physicalProfile.application.fuseWirePassed -and
  $physicalProfile.application.launchObservedMainUnavailable -and
  $physicalProfile.application.cleanupPassed -and
  @($physicalProfile.application.remainingProcessIds).Count -eq 0

Add-Criterion $criteria "SUPPORTED-ENVIRONMENT" "Windows CI and a non-destructive signed-application launch on the physical Windows 11 Pro profile both pass; destructive lifecycle evidence remains confined to the disposable VM." (
  $windowsCiPassed -and $physicalProfilePassed -and $runtime.certificationEligible
) @($WindowsCiResultPath, $PhysicalProfileResultPath, $RuntimeResultPath)

Add-Criterion $criteria "AC-1" "Two independent auto-start services use pinned binaries, distinct service identities, a protected PostgreSQL directory, and separate least-privilege database roles." (
  $runtime.certificationEligible -and
  (Get-RuntimeCheck $runtime "independent-auto-services") -and
  (Get-RuntimeCheck $runtime "pinned-runtime-set") -and
  (Get-RuntimeCheck $runtime "postgresql-service-stop-clean-shutdown") -and
  (Get-RuntimeCheck $runtime "dedicated-protected-postgresql-data-directory") -and
  (Get-RuntimeCheck $runtime "separate-least-privilege-database-roles") -and
  (Get-RuntimeCheck $runtime "runtime-role-cannot-own-or-assume-schema-owner") -and
  (Get-RuntimeCheck $runtime "least-privilege-service-account-boundaries")
) @($RuntimeResultPath)

Add-Criterion $criteria "AC-2" "PostgreSQL accepts only loopback connections and an independent LAN machine receives an active refusal." (
  (Get-RuntimeCheck $runtime "postgresql-loopback-listeners") -and $lan.passed
) @($RuntimeResultPath, $LanResultPath)

Add-Criterion $criteria "AC-3" "Closing every Electron window and force-killing its complete process tree leave the local API handshake healthy." (
  $standardUser.checks.desktopExitsWhenLastWindowCloses -and
  $standardUser.checks.apiHealthyAfterEveryWindowCloses -and
  $standardUser.checks.completeElectronTreeForceKilled -and
  $standardUser.checks.apiHealthyAfterElectronTreeKill
) @($StandardUserResultPath)

Add-Criterion $criteria "AC-4" "Both services recover after reboot without interactive login." (
  $reboot.passed -and $hostReboot.passed -and
  $reboot.capturedBy -eq "NT AUTHORITY\SYSTEM" -and
  $reboot.explorerProcessCount -eq 0 -and
  @($reboot.interactiveSessions).Count -eq 0 -and
  @($reboot.interactiveLogonEvents).Count -eq 0
) @($RebootResultPath, $HostRebootResultPath)

Add-Criterion $criteria "AC-5" "A standard user completes the current local workflow offline, including an API restart while Electron remains open." (
  $standardUser.passed -and
  $offlineNetwork.passed -and
  $standardUser.checks.standardUser -and
  $standardUser.checks.internetDisconnected -and
  $standardUser.checks.desktopReady -and
  $standardUser.checks.desktopObservedApiOutage -and
  $standardUser.checks.desktopReadyAfterApiRestart -and
  $standardUser.checks.standardUserCannotReadRuntimeSecret -and
  $standardUser.checks.standardUserCannotReadPostgresqlData -and
  $standardUser.checks.standardUserCannotWriteProtectedData -and
  $apiRestart.passed
) @($StandardUserResultPath, $ApiRestartResultPath, $OfflineNetworkResultPath)

Add-Criterion $criteria "AC-6" "Both ADR 0004 packaging candidates are built and executed across signing, fuses, lifecycle, repair, update, and recovery, with the losing production dependencies isolated." (
  $signedCandidates -and $signedByComparisonCertificate -and $samePinnedPayload -and $builderInstalledSigningMeasured -and $forgeInstalledSigningMeasured -and $allFuses -and
  $builderAsarIntegrity.passed -and $forgeAsarIntegrity.passed -and
  $forge.comparisonExecuted -and -not $forge.meetsIssueRequirements -and $runtime.passed
) @($packagingPath, $BuilderAsarIntegrityResultPath, $ForgeAsarIntegrityResultPath, $ForgeLifecycleResultPath, $RuntimeResultPath)

Add-Criterion $criteria "AC-7" "Clean install, repair, update, failed installation, uninstall, and reinstall preserve the database and configuration." (
  (Get-RuntimeCheck $runtime "clean-snapshot") -and
  (Get-RuntimeCheck $runtime "initial-local-cycle") -and
  (Get-RuntimeCheck $runtime "repair-seam-corruption-created") -and
  (Get-RuntimeCheck $runtime "repair-restores-corrupted-binary") -and
  (Get-RuntimeCheck $runtime "repair-preserves-data-and-configuration") -and
  (Get-RuntimeCheck $runtime "installer-update-version") -and
  (Get-RuntimeCheck $runtime "installer-update-preserves-data-and-configuration") -and
  (Get-RuntimeCheck $runtime "uninstall-completes") -and
  (Get-RuntimeCheck $runtime "uninstall-preserves-data-and-configuration") -and
  (Get-RuntimeCheck $runtime "reinstall-opens-preserved-data") -and
  @($runtime.checks | Where-Object { $_.name -like "failed-install-*-preserves-data-and-configuration" -and $_.passed }).Count -eq 4 -and
  @($runtime.checks | Where-Object { $_.name -like "failed-install-*-recovers" -and $_.passed }).Count -eq 4
) @($RuntimeResultPath)

Add-Criterion $criteria "AC-8" "The complete Stage 1a local health/version-handshake cycle succeeds with the internet disconnected, including desktop close, force-kill, and restart." (
  $standardUser.passed -and
  $standardUser.checks.internetDisconnected -and
  $offlineNetwork.passed -and
  $standardUser.checks.initialApiHealth -and
  $standardUser.checks.desktopReady -and
  $standardUser.checks.apiHealthyAfterEveryWindowCloses -and
  $standardUser.checks.apiHealthyAfterElectronTreeKill -and
  $standardUser.checks.desktopRestartsReady
) @($StandardUserResultPath, $OfflineNetworkResultPath)

Add-Criterion $criteria "RECOVERY" "API/PostgreSQL child crashes, PostgreSQL interruption mid-transaction, and API restart with Electron open recover correctly." (
  (Get-RuntimeCheck $runtime "api-crash-recovery") -and
  (Get-RuntimeCheck $runtime "api-wrapper-crash-recovery") -and
  (Get-RuntimeCheck $runtime "restart-mid-transaction-is-atomic") -and
  (Get-RuntimeCheck $runtime "postgresql-wrapper-crash-recovery") -and
  (Get-RuntimeCheck $runtime "api-independent-while-postgresql-stopped") -and
  $apiRestart.passed -and $standardUser.checks.desktopReadyAfterApiRestart
) @($RuntimeResultPath, $ApiRestartResultPath, $StandardUserResultPath)

$result = [ordered]@{
  schemaVersion = 1
  runId = $RunId.ToString()
  sourceCommit = $SourceCommit
  snapshotId = $SnapshotId
  createdAtUtc = [DateTime]::UtcNow.ToString("o")
  certificationCandidate = $runtime.machine
  criteria = $criteria
  passed = @($criteria | Where-Object { -not $_.passed }).Count -eq 0
}
$OutputPath = [IO.Path]::GetFullPath($OutputPath)
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutputPath) | Out-Null
[IO.File]::WriteAllText($OutputPath, ($result | ConvertTo-Json -Depth 14) + "`n", [Text.UTF8Encoding]::new($false))
if (-not $result.passed) { throw "Issue #34 evidence is incomplete or failed" }
Write-Output $OutputPath
