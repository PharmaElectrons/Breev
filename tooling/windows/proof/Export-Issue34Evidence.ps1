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
  [string] $ArchivePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$EvidenceRoot = [IO.Path]::GetFullPath($EvidenceRoot).TrimEnd('\')
$ArchivePath = [IO.Path]::GetFullPath($ArchivePath)
$expectedSuffix = "\artifacts\windows\evidence\$($RunId.ToString())"
$expectedArchive = "C:\Windows\Temp\breev-issue34-$($RunId.ToString()).zip"
if (-not $EvidenceRoot.EndsWith($expectedSuffix, [StringComparison]::OrdinalIgnoreCase)) {
  throw "The export root is outside the correlated issue-34 evidence directory"
}
if (-not $ArchivePath.Equals($expectedArchive, [StringComparison]::OrdinalIgnoreCase)) {
  throw "The export archive must use the exact disposable issue-34 temporary path"
}
if (-not (Test-Path -LiteralPath $EvidenceRoot -PathType Container)) {
  throw "The issue-34 evidence directory does not exist"
}

$files = @(Get-ChildItem -LiteralPath $EvidenceRoot -File -Recurse)
$jsonFiles = @($files | Where-Object { $_.Extension -eq ".json" })
if ($jsonFiles.Count -lt 7) {
  throw "The pre-restore evidence set is incomplete"
}
foreach ($jsonFile in $jsonFiles) {
  $value = Get-Content -LiteralPath $jsonFile.FullName -Raw | ConvertFrom-Json
  if ($value.PSObject.Properties.Name -contains "runId" -and $value.runId -ne $RunId.ToString()) {
    throw "Evidence contains a mismatched run ID: $($jsonFile.FullName)"
  }
  if ($value.PSObject.Properties.Name -contains "sourceCommit" -and $value.sourceCommit -ne $SourceCommit) {
    throw "Evidence contains a mismatched source commit: $($jsonFile.FullName)"
  }
  if ($value.PSObject.Properties.Name -contains "snapshotId" -and $value.snapshotId -ne $SnapshotId) {
    throw "Evidence contains a mismatched snapshot ID: $($jsonFile.FullName)"
  }
}

$textFiles = @($files | Where-Object { $_.Extension.ToLowerInvariant() -in @(".json", ".txt", ".log") })
$forbiddenPatterns = @(
  '-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
  'postgres(?:ql)?://[^\s"'']+',
  'BREEV_WINDOWS_CERTIFICATE_PASSWORD\s*='
)
foreach ($textFile in $textFiles) {
  $content = Get-Content -LiteralPath $textFile.FullName -Raw
  foreach ($pattern in $forbiddenPatterns) {
    if ($content -match $pattern) {
      throw "Evidence export rejected secret-like content in $($textFile.FullName)"
    }
  }
}

Remove-Item -LiteralPath $ArchivePath -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $EvidenceRoot "*") -DestinationPath $ArchivePath -CompressionLevel Optimal
$result = [ordered]@{
  schemaVersion = 1
  runId = $RunId.ToString()
  sourceCommit = $SourceCommit
  snapshotId = $SnapshotId
  machineId = (Get-CimInstance Win32_ComputerSystemProduct).UUID
  fileCount = $files.Count
  jsonFileCount = $jsonFiles.Count
  archivePath = $ArchivePath
  archiveSha256 = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  archiveBytes = (Get-Item -LiteralPath $ArchivePath).Length
  createdAtUtc = [DateTime]::UtcNow.ToString("o")
  passed = $true
}
[Console]::Out.WriteLine(($result | ConvertTo-Json -Compress))
