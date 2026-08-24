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
  [string] $EvidenceRoot,

  [Parameter(Mandatory = $true)]
  [string] $ArchivePath,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-f]{64}$')]
  [string] $ExpectedArchiveSha256
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem

$EvidenceRoot = [IO.Path]::GetFullPath($EvidenceRoot).TrimEnd('\')
$ArchivePath = [IO.Path]::GetFullPath($ArchivePath)
$expectedSuffix = "\artifacts\windows\evidence\$($RunId.ToString())"
$expectedArchive = "C:\Windows\Temp\breev-issue34-$($RunId.ToString()).zip"
if (-not $EvidenceRoot.EndsWith($expectedSuffix, [StringComparison]::OrdinalIgnoreCase)) {
  throw "The import root is outside the correlated issue-34 evidence directory"
}
if (-not $ArchivePath.Equals($expectedArchive, [StringComparison]::OrdinalIgnoreCase)) {
  throw "The import archive must use the exact disposable issue-34 temporary path"
}
if ((Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedArchiveSha256) {
  throw "The evidence archive changed while held outside the restored guest"
}

$stagingRoot = Join-Path $env:TEMP "breev-issue34-import-$($RunId.ToString())"
Remove-Item -LiteralPath $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $stagingRoot | Out-Null
try {
  $archive = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
  try {
    foreach ($entry in $archive.Entries) {
      $segments = $entry.FullName.Replace('\', '/').Split(@('/'), [StringSplitOptions]::RemoveEmptyEntries)
      if ($entry.FullName.StartsWith('/') -or $entry.FullName -match '^[A-Za-z]:' -or $segments -contains '..') {
        throw "The evidence archive contains an unsafe path"
      }
    }
  } finally {
    $archive.Dispose()
  }
  [IO.Compression.ZipFile]::ExtractToDirectory($ArchivePath, $stagingRoot)

  $jsonFiles = @(Get-ChildItem -LiteralPath $stagingRoot -File -Recurse -Filter "*.json")
  if ($jsonFiles.Count -lt 7) { throw "The imported pre-restore evidence set is incomplete" }
  foreach ($jsonFile in $jsonFiles) {
    $value = Get-Content -LiteralPath $jsonFile.FullName -Raw | ConvertFrom-Json
    if ($value.PSObject.Properties.Name -contains "runId" -and $value.runId -ne $RunId.ToString()) {
      throw "Imported evidence contains a mismatched run ID"
    }
    if ($value.PSObject.Properties.Name -contains "sourceCommit" -and $value.sourceCommit -ne $SourceCommit) {
      throw "Imported evidence contains a mismatched source commit"
    }
    if ($value.PSObject.Properties.Name -contains "snapshotId" -and $value.snapshotId -ne $SnapshotId) {
      throw "Imported evidence contains a mismatched snapshot ID"
    }
  }

  New-Item -ItemType Directory -Force -Path $EvidenceRoot | Out-Null
  foreach ($file in @(Get-ChildItem -LiteralPath $stagingRoot -File -Recurse)) {
    $relativePath = $file.FullName.Substring($stagingRoot.Length).TrimStart('\')
    $destination = Join-Path $EvidenceRoot $relativePath
    if (Test-Path -LiteralPath $destination -PathType Leaf) {
      if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash) {
        throw "The restored baseline contains conflicting evidence: $relativePath"
      }
      continue
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $destination
  }

  $result = [ordered]@{
    schemaVersion = 1
    runId = $RunId.ToString()
    sourceCommit = $SourceCommit
    snapshotId = $SnapshotId
    machineId = (Get-CimInstance Win32_ComputerSystemProduct).UUID
    archiveSha256 = $ExpectedArchiveSha256
    importedFileCount = @(Get-ChildItem -LiteralPath $stagingRoot -File -Recurse).Count
    importedAtUtc = [DateTime]::UtcNow.ToString("o")
    passed = $true
  }
  [IO.File]::WriteAllText((Join-Path $EvidenceRoot "host-import.json"), ($result | ConvertTo-Json -Depth 4) + "`n", [Text.UTF8Encoding]::new($false))
  [Console]::Out.WriteLine(($result | ConvertTo-Json -Compress))
} finally {
  Remove-Item -LiteralPath $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $ArchivePath -Force -ErrorAction SilentlyContinue
}
