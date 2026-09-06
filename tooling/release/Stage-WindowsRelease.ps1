#Requires -Version 7.4

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $BuilderOutputRoot,

  [Parameter(Mandatory = $true)]
  [string] $ReleaseRoot,

  [Parameter(Mandatory = $true)]
  [string] $ReleaseTag,

  [Parameter(Mandatory = $true)]
  [string] $ReleaseVersion,

  [Parameter(Mandatory = $true)]
  [string] $SourceCommit,

  [Parameter(Mandatory = $true)]
  [ValidateSet("unsigned-development", "signed-production")]
  [string] $SigningMode,

  [string] $ExpectedSignerThumbprint = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if (-not $IsWindows) {
  throw "Windows release artifacts must be verified on Windows"
}
if ($ReleaseVersion -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$' -or
    $ReleaseTag -ne "v$ReleaseVersion") {
  throw "The release tag and version must be matching stable SemVer"
}
if ($SourceCommit -notmatch '^[0-9a-f]{40}$') {
  throw "The source commit must be a full lowercase Git SHA"
}

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../.."))
$builderRoot = [IO.Path]::GetFullPath($BuilderOutputRoot)
$stagingRoot = [IO.Path]::GetFullPath($ReleaseRoot)
if (Test-Path -LiteralPath $stagingRoot) {
  throw "The release staging directory must not already exist: $stagingRoot"
}

$installer = Join-Path $builderRoot "BreevSetup.exe"
$blockmap = Join-Path $builderRoot "BreevSetup.exe.blockmap"
$applicationRoot = Join-Path $builderRoot "win-unpacked"
$applicationExecutable = Join-Path $applicationRoot "Breev.exe"
$applicationAsar = Join-Path $applicationRoot "resources/app.asar"
$packagedPayloadLock = Join-Path $applicationRoot "resources/windows-payload/payload-lock.json"
$sourcePayloadLock = Join-Path $repoRoot "apps/local-api/windows/payload-lock.json"

foreach ($requiredFile in @(
  $installer,
  $blockmap,
  $applicationExecutable,
  $applicationAsar,
  $packagedPayloadLock,
  $sourcePayloadLock
)) {
  if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
    throw "Missing release output: $requiredFile"
  }
  if ((Get-Item -LiteralPath $requiredFile).Length -eq 0) {
    throw "Release output is empty: $requiredFile"
  }
}

$sourcePayloadLockHash = (Get-FileHash -LiteralPath $sourcePayloadLock -Algorithm SHA256).Hash.ToLowerInvariant()
$packagedPayloadLockHash = (Get-FileHash -LiteralPath $packagedPayloadLock -Algorithm SHA256).Hash.ToLowerInvariant()
if ($packagedPayloadLockHash -ne $sourcePayloadLockHash) {
  throw "The packaged Windows payload lock differs from the source release lock"
}

$signerMetadata = $null
if ($SigningMode -eq "signed-production") {
  $expectedThumbprint = $ExpectedSignerThumbprint.Replace(" ", "").ToUpperInvariant()
  if ($expectedThumbprint -notmatch '^[0-9A-F]{40}$') {
    throw "The expected production signer thumbprint is invalid"
  }

  $signableExtensions = @(
    ".exe", ".dll", ".node", ".sys", ".efi", ".scr", ".msi",
    ".cat", ".cab", ".xap", ".vbs", ".wsf", ".ps1"
  )
  $signedFiles = @($installer) + @(
    Get-ChildItem -LiteralPath $applicationRoot -File -Recurse |
      Where-Object { $_.Extension.ToLowerInvariant() -in $signableExtensions } |
      Select-Object -ExpandProperty FullName
  )
  if ($signedFiles.Count -lt 2) {
    throw "The packaged application has no signable payload"
  }

  $installerSignature = $null
  foreach ($signedFile in $signedFiles) {
    $signature = Get-AuthenticodeSignature -LiteralPath $signedFile
    $signerThumbprint = if ($null -eq $signature.SignerCertificate) {
      $null
    } else {
      $signature.SignerCertificate.Thumbprint.Replace(" ", "").ToUpperInvariant()
    }
    if ($signature.Status.ToString() -ne "Valid" -or
        $signerThumbprint -ne $expectedThumbprint) {
      throw "Invalid or unexpected Authenticode signer: $signedFile"
    }
    if ($signedFile -eq $installer) {
      $installerSignature = $signature
    }
  }

  $signerMetadata = [ordered]@{
    thumbprint = $expectedThumbprint
    subject = $installerSignature.SignerCertificate.Subject
    issuer = $installerSignature.SignerCertificate.Issuer
    validUntilUtc = $installerSignature.SignerCertificate.NotAfter.ToUniversalTime().ToString("o")
    signedFileCount = $signedFiles.Count
  }
} else {
  $installerSignature = Get-AuthenticodeSignature -LiteralPath $installer
  if ($installerSignature.Status.ToString() -eq "Valid") {
    throw "The unsigned-development workflow unexpectedly produced a signed installer"
  }
}

$packagedVersion = (& node.exe (Join-Path $repoRoot "tooling/windows/proof/read-asar-package-version.mjs") --asar $applicationAsar).Trim()
if ($LASTEXITCODE -ne 0 -or $packagedVersion -ne $ReleaseVersion) {
  throw "The packaged application version does not match the release version"
}

New-Item -ItemType Directory -Path $stagingRoot | Out-Null
$fusesPath = Join-Path $stagingRoot "fuses.json"
$null = & node.exe (Join-Path $repoRoot "tooling/windows/proof/read-fuses.mjs") --executable $applicationExecutable --output $fusesPath
if ($LASTEXITCODE -ne 0) {
  throw "Electron fuse verification failed"
}

Copy-Item -LiteralPath $installer -Destination (Join-Path $stagingRoot "BreevSetup.exe")
Copy-Item -LiteralPath $blockmap -Destination (Join-Path $stagingRoot "BreevSetup.exe.blockmap")

$metadata = [ordered]@{
  schemaVersion = 1
  releaseKind = if ($SigningMode -eq "signed-production") { "production" } else { "development-test" }
  publishable = $SigningMode -eq "signed-production"
  signingMode = $SigningMode
  tag = $ReleaseTag
  version = $ReleaseVersion
  sourceCommit = $SourceCommit
  payloadLockSha256 = $sourcePayloadLockHash
  signer = $signerMetadata
  repository = $env:GITHUB_REPOSITORY
  runnerImage = $env:ImageOS
  workflowRun = "$($env:GITHUB_SERVER_URL)/$($env:GITHUB_REPOSITORY)/actions/runs/$($env:GITHUB_RUN_ID)"
}
$metadataPath = Join-Path $stagingRoot "release-metadata.json"
[IO.File]::WriteAllText(
  $metadataPath,
  ($metadata | ConvertTo-Json -Depth 5) + [Environment]::NewLine,
  [Text.UTF8Encoding]::new($false)
)

$hashLines = Get-ChildItem -LiteralPath $stagingRoot -File |
  Sort-Object Name |
  ForEach-Object {
    $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $($_.Name)"
  }
[IO.File]::WriteAllLines(
  (Join-Path $stagingRoot "SHA256SUMS.txt"),
  $hashLines,
  [Text.ASCIIEncoding]::new()
)

Write-Output $stagingRoot
