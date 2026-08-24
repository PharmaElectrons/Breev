#Requires -Version 5.1

[CmdletBinding()]
param(
  [string] $OutputRoot = (Join-Path $PSScriptRoot "../../../artifacts/windows/wix314")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$OutputRoot = [IO.Path]::GetFullPath($OutputRoot)
$artifactsRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../../../artifacts/windows"))
$artifactsPrefix = $artifactsRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $OutputRoot.StartsWith($artifactsPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw "The WiX output must be a child of the Windows artifacts directory"
}

$lock = Get-Content -LiteralPath (Join-Path $PSScriptRoot "tool-lock.json") -Raw | ConvertFrom-Json
if ($lock.schemaVersion -ne 1 -or $lock.wix.version -ne "3.14.1") {
  throw "The Forge comparison tool lock is incompatible"
}

$cacheRoot = Join-Path $artifactsRoot "cache"
$archivePath = Join-Path $cacheRoot $lock.wix.archive
New-Item -ItemType Directory -Force -Path $cacheRoot | Out-Null

$downloadRequired = -not (Test-Path -LiteralPath $archivePath -PathType Leaf)
if (-not $downloadRequired) {
  $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  $downloadRequired = $actualHash -ne $lock.wix.sha256
}
if ($downloadRequired) {
  Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
  Invoke-WebRequest -UseBasicParsing -Uri $lock.wix.url -OutFile $archivePath
}

$actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $lock.wix.sha256) {
  throw "The WiX archive does not match the pinned hash"
}

if (Test-Path -LiteralPath $OutputRoot) {
  Remove-Item -LiteralPath $OutputRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
Expand-Archive -LiteralPath $archivePath -DestinationPath $OutputRoot

foreach ($tool in @("candle.exe", "light.exe")) {
  if (-not (Test-Path -LiteralPath (Join-Path $OutputRoot $tool) -PathType Leaf)) {
    throw "The pinned WiX archive is missing $tool"
  }
}

Write-Output $OutputRoot
