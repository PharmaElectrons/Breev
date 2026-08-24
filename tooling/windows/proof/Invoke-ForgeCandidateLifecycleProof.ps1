#Requires -Version 5.1

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $InstallerPath,

  [Parameter(Mandatory = $true)]
  [string] $UpdateInstallerPath,

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
$productName = "Breev Forge Comparison (Machine)"
$dataRoot = Join-Path $env:ProgramData "Breev"
$sentinelRoot = Join-Path $dataRoot "issue-34-forge-comparison"
$sentinelPath = Join-Path $sentinelRoot "preservation-sentinel.json"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "The Forge lifecycle comparison requires an elevated administrator token"
}
if (-not $DisposableEnvironmentAcknowledged) {
  throw "Refusing the installer comparison without -DisposableEnvironmentAcknowledged"
}
if ($InstallerVersion -ne "0.0.0" -or $UpdateInstallerVersion -ne "0.0.1") {
  throw "The correlated issue-34 proof versions must be 0.0.0 and 0.0.1"
}

function Invoke-MsiExec {
  param([string[]] $Arguments)
  $process = Start-Process -FilePath "msiexec.exe" -ArgumentList $Arguments -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "msiexec failed with exit code $($process.ExitCode)"
  }
  return $process.ExitCode
}

function Get-InstalledProduct {
  $entries = @(
    Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue
    Get-ItemProperty "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue
  ) | Where-Object { $_.DisplayName -eq $productName -and $_.Publisher -eq "Breev" }
  return @($entries)
}

function Get-InstalledSigningCoverage {
  param([string] $Root)

  $extensions = @(".exe", ".dll", ".node", ".sys", ".efi", ".scr", ".msi", ".cat", ".cab", ".xap", ".vbs", ".wsf", ".ps1")
  $files = @(Get-ChildItem -LiteralPath $Root -File -Recurse | Where-Object {
    $_.Extension.ToLowerInvariant() -in $extensions
  } | ForEach-Object {
    $signature = Get-AuthenticodeSignature -LiteralPath $_.FullName
    [ordered]@{
      path = $_.FullName
      sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      signatureStatus = $signature.Status.ToString()
      signerThumbprint = if ($null -eq $signature.SignerCertificate) { $null } else { $signature.SignerCertificate.Thumbprint }
    }
  })
  if ($files.Count -eq 0) { throw "The installed Forge candidate contains no signable files" }
  return [ordered]@{
    root = $Root
    files = $files
    allSignedByExpectedCertificate = @($files | Where-Object {
      $_.signatureStatus -ne "Valid" -or $_.signerThumbprint -ne $ExpectedSignerThumbprint
    }).Count -eq 0
  }
}

function Get-InstalledPayloadRecord {
  param([string] $InstallRoot)

  $lockFiles = @(Get-ChildItem -LiteralPath $InstallRoot -File -Recurse -Filter "payload-lock.json")
  if ($lockFiles.Count -ne 1) { throw "The installed Forge candidate does not contain exactly one offline payload" }
  $payloadRoot = $lockFiles[0].Directory.FullName
  $requiredPaths = @(
    "payload-manifest.json", "payload-lock.json", "lifecycle.ps1", "bootstrap.sql",
    "node/node.exe", "postgresql/bin/postgres.exe", "service-wrapper/shawl.exe", "local-api/dist/main.js"
  )
  $files = foreach ($relativePath in $requiredPaths) {
    $path = Join-Path $payloadRoot $relativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "The installed Forge payload is incomplete" }
    [ordered]@{ path = $relativePath; sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() }
  }
  $manifest = Get-Content -LiteralPath (Join-Path $payloadRoot "payload-manifest.json") -Raw | ConvertFrom-Json
  foreach ($component in $manifest.components) {
    $componentRoot = if ($component.name -eq "shawl") { "service-wrapper" } else { $component.name }
    foreach ($executable in $component.executableHashes.PSObject.Properties) {
      $actualHash = (Get-FileHash -LiteralPath (Join-Path (Join-Path $payloadRoot $componentRoot) $executable.Name) -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($actualHash -ne $executable.Value) { throw "The installed Forge payload manifest has a stale runtime hash" }
    }
  }
  return [ordered]@{
    root = $payloadRoot
    files = @($files)
    payloadLockSha256 = (Get-FileHash -LiteralPath $lockFiles[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

function Corrupt-LastByte {
  param([string] $Path)

  $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  try {
    if ($stream.Length -eq 0) { throw "Cannot corrupt an empty MSI-owned file" }
    [void] $stream.Seek(-1, [IO.SeekOrigin]::End)
    $lastByte = $stream.ReadByte()
    [void] $stream.Seek(-1, [IO.SeekOrigin]::End)
    $stream.WriteByte($lastByte -bxor 0x01)
  } finally {
    $stream.Dispose()
  }
}

function Get-InstalledAsarRecord {
  param([string] $InstallRoot)

  $asarFiles = @(Get-ChildItem -LiteralPath $InstallRoot -File -Recurse -Filter "app.asar")
  if ($asarFiles.Count -ne 1) { throw "The installed Forge candidate has an ambiguous application ASAR" }
  $version = (& node.exe (Join-Path $PSScriptRoot "read-asar-package-version.mjs") --asar $asarFiles[0].FullName).Trim()
  if ($LASTEXITCODE -ne 0) { throw "Could not read the installed Forge application version" }
  return [ordered]@{
    path = $asarFiles[0].FullName
    sha256 = (Get-FileHash -LiteralPath $asarFiles[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    version = $version
  }
}

$result = [ordered]@{
  schemaVersion = 1
  runId = $RunId.ToString()
  sourceCommit = $SourceCommit
  snapshotId = $SnapshotId
  machineId = (Get-CimInstance Win32_ComputerSystemProduct).UUID
  candidate = "electron-forge-7.11.2-maker-wix-7.11.2"
  startedAtUtc = [DateTime]::UtcNow.ToString("o")
  operations = [ordered]@{}
  serviceLifecycle = [ordered]@{}
  dataPreservation = [ordered]@{}
  payload = [ordered]@{}
  application = [ordered]@{}
  signing = [ordered]@{ expectedSignerThumbprint = $ExpectedSignerThumbprint.ToUpperInvariant() }
  comparisonExecuted = $false
  meetsIssueRequirements = $false
  error = $null
  completedAtUtc = $null
}

try {
  $InstallerPath = [IO.Path]::GetFullPath($InstallerPath)
  $UpdateInstallerPath = [IO.Path]::GetFullPath($UpdateInstallerPath)
  $OutputPath = [IO.Path]::GetFullPath($OutputPath)
  $ExpectedSignerThumbprint = $ExpectedSignerThumbprint.ToUpperInvariant()
  $expectedInstallRoot = [IO.Path]::GetFullPath((Join-Path $env:ProgramFiles "Breev Forge Comparison")).TrimEnd('\')
  foreach ($path in @($InstallerPath, $UpdateInstallerPath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "A Forge candidate MSI is missing" }
    if ($path.Contains('"')) { throw "An MSI path contains an unsupported quote" }
  }
  $result["artifacts"] = [ordered]@{
    installer = [ordered]@{ version = $InstallerVersion; sha256 = (Get-FileHash -LiteralPath $InstallerPath -Algorithm SHA256).Hash.ToLowerInvariant() }
    updateInstaller = [ordered]@{ version = $UpdateInstallerVersion; sha256 = (Get-FileHash -LiteralPath $UpdateInstallerPath -Algorithm SHA256).Hash.ToLowerInvariant() }
  }
  if ($InstallerVersion -notmatch '^\d+\.\d+\.\d+$' -or
      $UpdateInstallerVersion -notmatch '^\d+\.\d+\.\d+$' -or
      ([version] $InstallerVersion) -ge ([version] $UpdateInstallerVersion)) {
    throw "The Forge proof requires two distinct increasing versions"
  }
  if ((Get-InstalledProduct).Count -ne 0) { throw "The Forge comparison product is already installed" }
  if (Test-Path -LiteralPath $expectedInstallRoot) { throw "The Forge comparison install root already exists" }
  $baselineServices = [ordered]@{
    localApi = $null -ne (Get-Service -Name "BreevLocalApi" -ErrorAction SilentlyContinue)
    postgresql = $null -ne (Get-Service -Name "BreevPostgreSQL" -ErrorAction SilentlyContinue)
  }
  if ($baselineServices.localApi -or $baselineServices.postgresql) {
    throw "The Forge comparison requires a clean restored snapshot with no Breev services"
  }
  $result.serviceLifecycle["beforeInstall"] = $baselineServices

  New-Item -ItemType Directory -Force -Path $sentinelRoot | Out-Null
  [ordered]@{ id = [Guid]::NewGuid().ToString(); value = "synthetic-disposable-data" } |
    ConvertTo-Json | Set-Content -LiteralPath $sentinelPath -Encoding UTF8
  $expectedSentinelHash = (Get-FileHash -LiteralPath $sentinelPath -Algorithm SHA256).Hash.ToLowerInvariant()

  $quotedInstallerPath = '"' + $InstallerPath + '"'
  $quotedUpdateInstallerPath = '"' + $UpdateInstallerPath + '"'
  $result.operations["cleanInstallExitCode"] = Invoke-MsiExec -Arguments @("/i", $quotedInstallerPath, "/qn", "/norestart")
  $installed = Get-InstalledProduct
  if ($installed.Count -ne 1) { throw "The Forge candidate did not register exactly one installed product" }
  $installRoot = [IO.Path]::GetFullPath($installed[0].InstallPath).TrimEnd('\')
  if ($installRoot -ne $expectedInstallRoot -or -not (Test-Path -LiteralPath $installRoot -PathType Container)) {
    throw "The Forge candidate installed outside its expected machine-wide root"
  }
  $result.operations["installedVersion"] = $installed[0].DisplayVersion
  $result.operations["installRoot"] = $installRoot
  $result.serviceLifecycle["afterInstall"] = [ordered]@{
    localApi = $null -ne (Get-Service -Name "BreevLocalApi" -ErrorAction SilentlyContinue)
    postgresql = $null -ne (Get-Service -Name "BreevPostgreSQL" -ErrorAction SilentlyContinue)
  }
  $result.signing["afterInstall"] = Get-InstalledSigningCoverage -Root $installRoot
  $result.payload["afterInstall"] = Get-InstalledPayloadRecord -InstallRoot $installRoot
  $result.application["afterInstall"] = Get-InstalledAsarRecord -InstallRoot $installRoot
  if ($result.application.afterInstall.version -ne $InstallerVersion) { throw "The installed Forge application has the wrong initial version" }

  $repairTargetPath = $result.application.afterInstall.path
  $repairTargetHash = (Get-FileHash -LiteralPath $repairTargetPath -Algorithm SHA256).Hash.ToLowerInvariant()
  Corrupt-LastByte -Path $repairTargetPath
  $result.operations["repairCorruptionCreated"] = (Get-FileHash -LiteralPath $repairTargetPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $repairTargetHash

  $result.operations["repairExitCode"] = Invoke-MsiExec -Arguments @("/fa", $quotedInstallerPath, "/qn", "/norestart")
  $result.operations["repairRestoredMsiFile"] = (Get-FileHash -LiteralPath $repairTargetPath -Algorithm SHA256).Hash.ToLowerInvariant() -eq $repairTargetHash
  $result.dataPreservation["afterRepair"] = (Get-FileHash -LiteralPath $sentinelPath -Algorithm SHA256).Hash.ToLowerInvariant() -eq $expectedSentinelHash

  $result.operations["updateExitCode"] = Invoke-MsiExec -Arguments @("/i", $quotedUpdateInstallerPath, "/qn", "/norestart")
  $updated = Get-InstalledProduct
  if ($updated.Count -ne 1) { throw "The Forge candidate update did not leave exactly one installed product" }
  $updatedInstallRoot = [IO.Path]::GetFullPath($updated[0].InstallPath).TrimEnd('\')
  if ($updatedInstallRoot -ne $installRoot) { throw "The Forge candidate update changed its machine-wide root" }
  $result.operations["updatedVersion"] = $updated[0].DisplayVersion
  $result.signing["afterUpdate"] = Get-InstalledSigningCoverage -Root $installRoot
  $result.payload["afterUpdate"] = Get-InstalledPayloadRecord -InstallRoot $installRoot
  $result.application["afterUpdate"] = Get-InstalledAsarRecord -InstallRoot $installRoot
  if ($result.application.afterUpdate.version -ne $UpdateInstallerVersion) { throw "The installed Forge application has the wrong update version" }
  $result.dataPreservation["afterUpdate"] = (Get-FileHash -LiteralPath $sentinelPath -Algorithm SHA256).Hash.ToLowerInvariant() -eq $expectedSentinelHash

  $result.operations["uninstallExitCode"] = Invoke-MsiExec -Arguments @("/x", $quotedUpdateInstallerPath, "/qn", "/norestart")
  $result.operations["uninstalled"] = (Get-InstalledProduct).Count -eq 0
  $result.operations["installRootRemoved"] = -not (Test-Path -LiteralPath $installRoot)
  $result.dataPreservation["afterUninstall"] = (Get-FileHash -LiteralPath $sentinelPath -Algorithm SHA256).Hash.ToLowerInvariant() -eq $expectedSentinelHash
  $result.signing["installedGapObserved"] = -not $result.signing.afterInstall.allSignedByExpectedCertificate -or
    -not $result.signing.afterUpdate.allSignedByExpectedCertificate
  $result.serviceLifecycle["integratesRequiredServices"] = $result.serviceLifecycle.afterInstall.localApi -and $result.serviceLifecycle.afterInstall.postgresql
  $result.serviceLifecycle["repair"] = "unsupported-no-service-authoring"
  $result.serviceLifecycle["update"] = "unsupported-no-service-authoring"
  $result.serviceLifecycle["recovery"] = "unsupported-no-service-authoring"
  $result["comparisonExecuted"] = $result.operations.uninstalled -and
    $result.operations.installedVersion -eq $InstallerVersion -and
    $result.operations.updatedVersion -eq $UpdateInstallerVersion -and
    $result.operations.repairCorruptionCreated -and
    $result.operations.repairRestoredMsiFile -and
    $result.operations.installRootRemoved -and
    $result.application.afterInstall.version -eq $InstallerVersion -and
    $result.application.afterUpdate.version -eq $UpdateInstallerVersion -and
    -not $result.serviceLifecycle.afterInstall.localApi -and
    -not $result.serviceLifecycle.afterInstall.postgresql -and
    $result.signing.afterInstall.files.Count -gt 0 -and
    $result.signing.afterUpdate.files.Count -gt 0 -and
    $result.signing.installedGapObserved -and
    $result.payload.afterInstall.files.Count -eq 8 -and
    $result.payload.afterUpdate.files.Count -eq 8 -and
    $result.dataPreservation.afterRepair -and
    $result.dataPreservation.afterUpdate -and
    $result.dataPreservation.afterUninstall
  $result["meetsIssueRequirements"] = $result.comparisonExecuted -and
    $result.serviceLifecycle.integratesRequiredServices -and
    $result.signing.afterInstall.allSignedByExpectedCertificate -and
    $result.signing.afterUpdate.allSignedByExpectedCertificate
} catch {
  $result["error"] = $_.Exception.Message
} finally {
  $result["completedAtUtc"] = [DateTime]::UtcNow.ToString("o")
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutputPath) | Out-Null
  [IO.File]::WriteAllText($OutputPath, ($result | ConvertTo-Json -Depth 10) + "`n", [Text.UTF8Encoding]::new($false))
}

if (-not $result.comparisonExecuted) {
  throw "The Forge installer lifecycle comparison did not complete"
}
Write-Output $OutputPath
