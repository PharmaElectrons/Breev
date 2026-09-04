#Requires -Version 5.1

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $PackagingRoot,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-f]{40}$')]
  [string] $SourceCommit,

  [Parameter(Mandatory = $true)]
  [string] $OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw "Windows CI evidence must be created on Windows"
}
foreach ($name in @("GITHUB_ACTIONS", "GITHUB_REPOSITORY", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_SERVER_URL", "GITHUB_WORKFLOW")) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
    throw "Missing GitHub Actions correlation: $name"
  }
}
if ($env:GITHUB_ACTIONS -ne "true" -or $env:GITHUB_REPOSITORY -ne "PharmaElectrons/Breev" -or (& git rev-parse HEAD).Trim() -ne $SourceCommit) {
  throw "The Windows CI environment does not match this Breev source commit"
}

$PackagingRoot = [IO.Path]::GetFullPath($PackagingRoot)
$packagingPath = Join-Path $PackagingRoot "packaging-results.json"
$packaging = Get-Content -LiteralPath $packagingPath -Raw | ConvertFrom-Json
$versions = @($packaging.versions)
if (-not $packaging.cleanSource -or $packaging.sourceCommit -ne $SourceCommit -or
    (@($versions | Select-Object -ExpandProperty version | Sort-Object) -join ',') -ne "0.0.0,0.0.1" -or
    [string]::IsNullOrWhiteSpace($packaging.payloadLockSha256)) {
  throw "The Windows CI packaging comparison is incomplete or uncorrelated"
}
$fuseResults = foreach ($version in $versions) {
  foreach ($candidate in @("electron-builder", "electron-forge")) {
    $path = Join-Path $PackagingRoot "$($version.version)\$candidate\fuses.json"
    $fuses = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    [ordered]@{ version = $version.version; candidate = $candidate; passed = [bool] $fuses.passed; executableSha256 = $fuses.executableSha256 }
  }
}
if (@($fuseResults).Count -ne 4 -or @($fuseResults | Where-Object { -not $_.passed }).Count -ne 0) {
  throw "A Windows CI candidate did not have the required Electron fuse wire"
}

$result = [ordered]@{
  schemaVersion = 1
  sourceCommit = $SourceCommit
  environmentPurpose = "windows-build-validation-only"
  certificationEvidence = $false
  repository = $env:GITHUB_REPOSITORY
  workflow = $env:GITHUB_WORKFLOW
  workflowRunId = [uint64] $env:GITHUB_RUN_ID
  workflowRunAttempt = [uint32] $env:GITHUB_RUN_ATTEMPT
  workflowRunUrl = "$($env:GITHUB_SERVER_URL)/$($env:GITHUB_REPOSITORY)/actions/runs/$($env:GITHUB_RUN_ID)"
  runner = [ordered]@{
    name = $env:RUNNER_NAME
    os = $env:RUNNER_OS
    architecture = $env:RUNNER_ARCH
    windows = Get-ComputerInfo | Select-Object WindowsProductName, WindowsVersion, OsBuildNumber, OsArchitecture
  }
  candidateVersions = @($versions | Select-Object -ExpandProperty version)
  payloadLockSha256 = $packaging.payloadLockSha256
  fuses = @($fuseResults)
  checks = [ordered]@{
    lint = $true
    format = $true
    strictTypecheck = $true
    build = $true
    unit = $true
    bothWindowsCandidatesBuilt = $true
  }
  completedAtUtc = [DateTime]::UtcNow.ToString("o")
  passed = $true
}
$OutputPath = [IO.Path]::GetFullPath($OutputPath)
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutputPath) | Out-Null
[IO.File]::WriteAllText($OutputPath, ($result | ConvertTo-Json -Depth 8) + "`n", [Text.UTF8Encoding]::new($false))
Write-Output $OutputPath
