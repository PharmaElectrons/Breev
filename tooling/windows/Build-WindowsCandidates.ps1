#Requires -Version 5.1

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [Guid] $RunId,

  [Parameter(Mandatory = $true)]
  [string] $SnapshotId,

  [string] $OutputRoot = (Join-Path $PSScriptRoot "../../artifacts/windows/candidates"),
  [switch] $RequireSigning
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw "Both installer candidates must be built on Windows"
}

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../.."))
$sourceCommit = (& git -C $repoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceCommit -notmatch '^[0-9a-f]{40}$') { throw "Could not identify the source commit" }
$workingTreeStatus = ((& git -C $repoRoot status --porcelain) | Out-String).Trim()
if (-not [string]::IsNullOrWhiteSpace($workingTreeStatus)) {
  throw "Candidate evidence must be built from a clean source checkout"
}
$OutputRoot = [IO.Path]::GetFullPath($OutputRoot)
$certificateFile = $env:BREEV_WINDOWS_CERTIFICATE_FILE
$certificateThumbprint = $env:BREEV_WINDOWS_CERTIFICATE_THUMBPRINT
if ($RequireSigning -and ([string]::IsNullOrWhiteSpace($certificateFile) -or [string]::IsNullOrWhiteSpace($certificateThumbprint))) {
  throw "The comparison certificate file and thumbprint are required for the signing comparison"
}
if ($RequireSigning) {
  $certificateThumbprint = $certificateThumbprint.Replace(" ", "").ToUpperInvariant()
  $signingCertificate = Get-Item -LiteralPath "Cert:\CurrentUser\My\$certificateThumbprint" -ErrorAction SilentlyContinue
  $trustedCertificate = Get-Item -LiteralPath "Cert:\CurrentUser\Root\$certificateThumbprint" -ErrorAction SilentlyContinue
  if ($null -eq $signingCertificate -or $null -eq $trustedCertificate -or
      $signingCertificate.Subject -ne "CN=Breev issue 34 comparison only" -or
      $signingCertificate.NotAfter.ToUniversalTime() -le [DateTime]::UtcNow) {
    throw "The expected temporary issue-34 comparison certificate is not installed and trusted"
  }
}
$Versions = @("0.0.0", "0.0.1")

function Invoke-Checked {
  param(
    [string] $FilePath,
    [string[]] $Arguments,
    [string] $WorkingDirectory = $repoRoot
  )

  Push-Location $WorkingDirectory
  try {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "$FilePath failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

function Get-ArtifactRecord {
  param([string] $Path)

  $signature = Get-AuthenticodeSignature -LiteralPath $Path
  return [ordered]@{
    path = $Path
    sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    size = (Get-Item -LiteralPath $Path).Length
    signatureStatus = $signature.Status.ToString()
    signerThumbprint = if ($null -eq $signature.SignerCertificate) { $null } else { $signature.SignerCertificate.Thumbprint }
  }
}

function Get-FileRecord {
  param([string] $Path)
  return [ordered]@{
    path = $Path
    sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    size = (Get-Item -LiteralPath $Path).Length
  }
}

function Get-SigningCoverage {
  param([string] $Root)

  $extensions = @(".exe", ".dll", ".node", ".sys", ".efi", ".scr", ".msi", ".cat", ".cab", ".xap", ".vbs", ".wsf", ".ps1")
  return @(Get-ChildItem -LiteralPath $Root -File -Recurse | Where-Object {
    $_.Extension.ToLowerInvariant() -in $extensions
  } | ForEach-Object { Get-ArtifactRecord -Path $_.FullName })
}

function Get-PayloadRecord {
  param([string] $Root)

  $requiredPaths = @(
    "payload-manifest.json",
    "payload-lock.json",
    "lifecycle.ps1",
    "bootstrap.sql",
    "node/node.exe",
    "postgresql/bin/postgres.exe",
    "service-wrapper/shawl.exe",
    "local-api/dist/main.js"
  )
  $files = foreach ($relativePath in $requiredPaths) {
    $path = Join-Path $Root $relativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      throw "A retained candidate is missing required payload content: $relativePath"
    }
    [ordered]@{ path = $relativePath; sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() }
  }
  $manifest = Get-Content -LiteralPath (Join-Path $Root "payload-manifest.json") -Raw | ConvertFrom-Json
  $lock = Get-Content -LiteralPath (Join-Path $Root "payload-lock.json") -Raw | ConvertFrom-Json
  if ($manifest.schemaVersion -ne 1 -or $manifest.architecture -ne "x64" -or
      @($manifest.components).Count -ne 3 -or
      @($manifest.components | Where-Object { $null -eq $_.sourceExecutableHashes }).Count -ne 0) {
    throw "A retained candidate has an invalid payload manifest"
  }
  foreach ($component in $manifest.components) {
    $componentRoot = if ($component.name -eq "shawl") { "service-wrapper" } else { $component.name }
    $lockedComponents = @($lock.components | Where-Object { $_.name -eq $component.name })
    if ($lockedComponents.Count -ne 1 -or
        @($component.executableHashes.PSObject.Properties | Where-Object {
          $actualHash = (Get-FileHash -LiteralPath (Join-Path (Join-Path $Root $componentRoot) $_.Name) -Algorithm SHA256).Hash.ToLowerInvariant()
          $actualHash -ne $_.Value
        }).Count -ne 0 -or
        @($lockedComponents[0].executableHashes.PSObject.Properties | Where-Object {
          $sourceHash = $component.sourceExecutableHashes.PSObject.Properties[$_.Name]
          $null -eq $sourceHash -or $sourceHash.Value -ne $_.Value
        }).Count -ne 0) {
      throw "A retained candidate payload does not match its installed or upstream executable hashes"
    }
  }
  return [ordered]@{
    root = $Root
    files = @($files)
    manifestSha256 = (Get-FileHash -LiteralPath (Join-Path $Root "payload-manifest.json") -Algorithm SHA256).Hash.ToLowerInvariant()
    payloadLockSha256 = (Get-FileHash -LiteralPath (Join-Path $Root "payload-lock.json") -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

function Test-TamperInvalidatesSignature {
  param([string] $Path)

  $temporaryPath = Join-Path $OutputRoot (".tamper-" + [Guid]::NewGuid().ToString() + [IO.Path]::GetExtension($Path))
  Copy-Item -LiteralPath $Path -Destination $temporaryPath
  try {
    $stream = [IO.File]::Open($temporaryPath, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try {
      if ($stream.Length -eq 0) { throw "Cannot tamper with an empty artifact" }
      [void] $stream.Seek(-1, [IO.SeekOrigin]::End)
      $lastByte = $stream.ReadByte()
      [void] $stream.Seek(-1, [IO.SeekOrigin]::End)
      $stream.WriteByte($lastByte -bxor 0x01)
    } finally {
      $stream.Dispose()
    }
    $status = (Get-AuthenticodeSignature -LiteralPath $temporaryPath).Status.ToString()
    return [ordered]@{ signatureStatusAfterTamper = $status; rejected = $status -ne "Valid" }
  } finally {
    Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
  }
}

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
Invoke-Checked -FilePath "pnpm.cmd" -Arguments @("install", "--frozen-lockfile")
Invoke-Checked -FilePath "pnpm.cmd" -Arguments @("build")
Invoke-Checked -FilePath "pnpm.cmd" -Arguments @("package:windows:payload")
$sourcePayloadLockSha256 = (Get-FileHash -LiteralPath (Join-Path $repoRoot "artifacts/windows/payload/payload-lock.json") -Algorithm SHA256).Hash.ToLowerInvariant()
Invoke-Checked -FilePath "pnpm.cmd" -Arguments @("install", "--frozen-lockfile") -WorkingDirectory (Join-Path $PSScriptRoot "forge-comparison")
Invoke-Checked -FilePath "pnpm.cmd" -Arguments @("test") -WorkingDirectory (Join-Path $PSScriptRoot "forge-comparison")

$wixRoot = & (Join-Path $PSScriptRoot "forge-comparison/prepare-wix.ps1")
$previousPath = $env:Path
$previousVersion = $env:BREEV_WINDOWS_BUILD_VERSION
$previousSigningRequirement = $env:BREEV_WINDOWS_REQUIRE_SIGNING
$results = [Collections.Generic.List[object]]::new()
try {
  $env:Path = "$wixRoot;$previousPath"
  $env:BREEV_WINDOWS_REQUIRE_SIGNING = if ($RequireSigning) { "1" } else { "0" }

  foreach ($version in $Versions) {
    if ($version -notmatch '^\d+\.\d+\.\d+$') {
      throw "Candidate versions must be three-part semantic versions"
    }
    $env:BREEV_WINDOWS_BUILD_VERSION = $version
    $versionRoot = Join-Path $OutputRoot $version
    if (Test-Path -LiteralPath $versionRoot) {
      Remove-Item -LiteralPath $versionRoot -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $versionRoot | Out-Null

    $builderOutput = Join-Path $repoRoot "artifacts/windows/electron-builder"
    Remove-Item -LiteralPath $builderOutput -Recurse -Force -ErrorAction SilentlyContinue
    Invoke-Checked -FilePath "pnpm.cmd" -Arguments @("--filter", "@breev/desktop", "package:windows")
    $builderInstaller = Join-Path $builderOutput "Breev-$version-windows-x64.exe"
    $builderExecutable = Join-Path $builderOutput "win-unpacked/Breev.exe"
    $builderDestination = Join-Path $versionRoot "electron-builder"
    New-Item -ItemType Directory -Force -Path $builderDestination | Out-Null
    $retainedBuilderInstaller = Join-Path $builderDestination "installer.exe"
    $retainedBuilderApp = Join-Path $builderDestination "app"
    Copy-Item -LiteralPath $builderInstaller -Destination $retainedBuilderInstaller
    Copy-Item -LiteralPath (Join-Path $builderOutput "win-unpacked") -Destination $retainedBuilderApp -Recurse
    $retainedBuilderExecutable = Join-Path $retainedBuilderApp "Breev.exe"
    $builderPayload = Get-PayloadRecord -Root (Join-Path $retainedBuilderApp "resources/windows-payload")
    $builderApplicationVersion = (& node.exe (Join-Path $PSScriptRoot "proof/read-asar-package-version.mjs") --asar (Join-Path $retainedBuilderApp "resources/app.asar")).Trim()
    if ($LASTEXITCODE -ne 0 -or $builderApplicationVersion -ne $version) {
      throw "The retained Builder application version does not match its installer version"
    }
    Invoke-Checked -FilePath "node.exe" -Arguments @(
      (Join-Path $PSScriptRoot "proof/read-fuses.mjs"),
      "--executable", $retainedBuilderExecutable,
      "--output", (Join-Path $builderDestination "fuses.json")
    )

    $forgeRoot = Join-Path $PSScriptRoot "forge-comparison"
    $forgeOutput = Join-Path $forgeRoot "out"
    Remove-Item -LiteralPath $forgeOutput -Recurse -Force -ErrorAction SilentlyContinue
    Invoke-Checked -FilePath "pnpm.cmd" -Arguments @("make") -WorkingDirectory $forgeRoot
    $forgeInstallers = @(Get-ChildItem -LiteralPath (Join-Path $forgeOutput "make") -Filter "*.msi" -Recurse)
    if ($forgeInstallers.Count -ne 1) {
      throw "The Forge comparison did not produce exactly one MSI"
    }
    $forgeInstaller = $forgeInstallers[0]
    $forgeExecutable = Join-Path $forgeOutput "BreevForgeComparison-win32-x64/BreevForgeComparison.exe"
    $forgeDestination = Join-Path $versionRoot "electron-forge"
    New-Item -ItemType Directory -Force -Path $forgeDestination | Out-Null
    $retainedForgeInstaller = Join-Path $forgeDestination "installer.msi"
    $retainedForgeApp = Join-Path $forgeDestination "app"
    Copy-Item -LiteralPath $forgeInstaller.FullName -Destination $retainedForgeInstaller
    Copy-Item -LiteralPath (Join-Path $forgeOutput "BreevForgeComparison-win32-x64") -Destination $retainedForgeApp -Recurse
    $retainedForgeExecutable = Join-Path $retainedForgeApp "BreevForgeComparison.exe"
    $forgePayload = Get-PayloadRecord -Root (Join-Path $retainedForgeApp "resources/payload")
    if ($builderPayload.payloadLockSha256 -ne $sourcePayloadLockSha256 -or
        $forgePayload.payloadLockSha256 -ne $sourcePayloadLockSha256) {
      throw "The two candidates do not contain the same pinned offline payload"
    }
    $forgeApplicationVersion = (& node.exe (Join-Path $PSScriptRoot "proof/read-asar-package-version.mjs") --asar (Join-Path $retainedForgeApp "resources/app.asar")).Trim()
    if ($LASTEXITCODE -ne 0 -or $forgeApplicationVersion -ne $version) {
      throw "The retained Forge application version does not match its installer version"
    }
    Invoke-Checked -FilePath "node.exe" -Arguments @(
      (Join-Path $PSScriptRoot "proof/read-fuses.mjs"),
      "--executable", $retainedForgeExecutable,
      "--output", (Join-Path $forgeDestination "fuses.json")
    )

    $builderRecord = Get-ArtifactRecord -Path $retainedBuilderInstaller
    $builderExecutableRecord = Get-ArtifactRecord -Path $retainedBuilderExecutable
    $builderAsarRecord = Get-FileRecord -Path (Join-Path $retainedBuilderApp "resources/app.asar")
    $forgeRecord = Get-ArtifactRecord -Path $retainedForgeInstaller
    $forgeExecutableRecord = Get-ArtifactRecord -Path $retainedForgeExecutable
    $forgeAsarRecord = Get-FileRecord -Path (Join-Path $retainedForgeApp "resources/app.asar")
    $builderCoverage = Get-SigningCoverage -Root $builderDestination
    $forgeCoverage = Get-SigningCoverage -Root $forgeDestination
    $builderTamper = Test-TamperInvalidatesSignature -Path $retainedBuilderInstaller
    $forgeTamper = Test-TamperInvalidatesSignature -Path $retainedForgeInstaller
    $signatureRecords = @($builderRecord, $builderExecutableRecord, $forgeRecord, $forgeExecutableRecord)
    $coverageRecords = @($signatureRecords) + @($builderCoverage) + @($forgeCoverage)
    if ($RequireSigning -and (
      @($signatureRecords | Where-Object { $_.signatureStatus -ne "Valid" }).Count -ne 0 -or
      @($builderCoverage | Where-Object { $_.signatureStatus -ne "Valid" }).Count -ne 0 -or
      @($forgeCoverage | Where-Object { $_.signatureStatus -ne "Valid" }).Count -ne 0 -or
      @($coverageRecords | Where-Object { $_.signerThumbprint -ne $certificateThumbprint }).Count -ne 0 -or
      -not $builderTamper.rejected -or -not $forgeTamper.rejected
    )) {
      throw "A required candidate signature is not valid"
    }
    $results.Add([ordered]@{
      version = $version
      electronBuilderNsis = $builderRecord
      electronBuilderExecutable = $builderExecutableRecord
      electronBuilderApplicationVersion = $builderApplicationVersion
      electronBuilderAsar = $builderAsarRecord
      electronBuilderPayload = $builderPayload
      electronBuilderSigningCoverage = $builderCoverage
      electronBuilderTamper = $builderTamper
      electronForgeWix = $forgeRecord
      electronForgeExecutable = $forgeExecutableRecord
      electronForgeApplicationVersion = $forgeApplicationVersion
      electronForgeAsar = $forgeAsarRecord
      electronForgePayload = $forgePayload
      electronForgeSigningCoverage = $forgeCoverage
      electronForgeTamper = $forgeTamper
    })
  }
} finally {
  $env:Path = $previousPath
  $env:BREEV_WINDOWS_BUILD_VERSION = $previousVersion
  $env:BREEV_WINDOWS_REQUIRE_SIGNING = $previousSigningRequirement
}

$evidence = [ordered]@{
  schemaVersion = 1
  runId = $RunId.ToString()
  snapshotId = $SnapshotId
  createdAtUtc = [DateTime]::UtcNow.ToString("o")
  sourceCommit = $sourceCommit
  cleanSource = $true
  machineId = (Get-CimInstance Win32_ComputerSystemProduct).UUID
  windows = Get-ComputerInfo | Select-Object WindowsProductName, WindowsVersion, OsBuildNumber, OsArchitecture
  signing = [ordered]@{
    required = [bool] $RequireSigning
    certificatePurpose = if ($RequireSigning) { "issue-34-comparison-only" } else { $null }
    certificateThumbprint = if ($RequireSigning) { $certificateThumbprint } else { $null }
    productionTrusted = $false
  }
  payloadLockSha256 = $sourcePayloadLockSha256
  versions = $results
}
$evidencePath = Join-Path $OutputRoot "packaging-results.json"
[IO.File]::WriteAllText($evidencePath, ($evidence | ConvertTo-Json -Depth 10) + "`n", [Text.UTF8Encoding]::new($false))
Write-Output $evidencePath
