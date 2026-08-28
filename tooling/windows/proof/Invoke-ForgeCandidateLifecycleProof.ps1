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
$apiServiceName = "BreevLocalApi"
$postgresqlServiceName = "BreevPostgreSQL"

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
  param([string[]] $Arguments, [switch] $ExpectFailure)
  $process = Start-Process -FilePath "msiexec.exe" -ArgumentList $Arguments -Wait -PassThru
  if ($ExpectFailure -and $process.ExitCode -ne 1603) {
    throw "msiexec returned $($process.ExitCode) instead of the injected failure code 1603"
  }
  if (-not $ExpectFailure -and $process.ExitCode -ne 0) {
    throw "msiexec failed with exit code $($process.ExitCode)"
  }
  return $process.ExitCode
}

function Get-InjectedFailureEvidence {
  param([string] $ExpectedToken, [string] $LogPath)

  $markerPath = Join-Path $dataRoot "state\forge-injected-failure.txt"
  if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
    throw "The deferred Forge failure action did not write its marker"
  }
  if (-not (Test-Path -LiteralPath $LogPath -PathType Leaf)) {
    throw "The failed Forge MSI operation did not produce its verbose log"
  }
  $actualToken = (Get-Content -LiteralPath $markerPath -Raw).Trim()
  $log = Get-Content -LiteralPath $LogPath -Raw
  $evidence = [ordered]@{
    logPath = $LogPath
    markerMatched = $actualToken -eq $ExpectedToken
    markerSha256 = (Get-FileHash -LiteralPath $markerPath -Algorithm SHA256).Hash.ToLowerInvariant()
    logSha256 = (Get-FileHash -LiteralPath $LogPath -Algorithm SHA256).Hash.ToLowerInvariant()
    logBytes = (Get-Item -LiteralPath $LogPath).Length
    deferredActionLogged = $log -match 'BreevInjectedFailure'
  }
  Remove-Item -LiteralPath $markerPath -Force
  if ($evidence.logBytes -le 0 -or -not $evidence.markerMatched -or -not $evidence.deferredActionLogged) {
    throw "The failed Forge MSI operation did not reach the correlated deferred failure action"
  }
  return $evidence
}

function Get-InstalledProduct {
  $entries = @(
    Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue
    Get-ItemProperty "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue
  ) | Where-Object {
    $displayName = $_.PSObject.Properties["DisplayName"]
    $publisher = $_.PSObject.Properties["Publisher"]
    $null -ne $displayName -and $displayName.Value -eq $productName -and
      $null -ne $publisher -and $publisher.Value -eq "Breev"
  }
  return @($entries)
}

function Get-InstalledSigningCoverage {
  param([string] $Root)

  $normalizedRoot = [IO.Path]::GetFullPath($Root).TrimEnd('\')
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
  $productExecutables = @($files | Where-Object {
    [IO.Path]::GetExtension($_.path).ToLowerInvariant() -eq ".exe" -and
      [IO.Path]::GetDirectoryName($_.path).TrimEnd('\') -eq $normalizedRoot
  })
  return [ordered]@{
    root = $Root
    files = $files
    allSignaturesValid = @($files | Where-Object { $_.signatureStatus -ne "Valid" }).Count -eq 0
    productExecutables = $productExecutables
    productExecutablesSignedByExpectedCertificate = $productExecutables.Count -ge 1 -and
      @($productExecutables | Where-Object { $_.signerThumbprint -ne $ExpectedSignerThumbprint }).Count -eq 0
  }
}

function Get-InstalledPayloadRecord {
  param([string] $InstallRoot)

  $lockFiles = @(Get-ChildItem -LiteralPath $InstallRoot -File -Recurse -Filter "payload-lock.json")
  if ($lockFiles.Count -ne 1) { throw "The installed Forge candidate does not contain exactly one offline payload" }
  $payloadRoot = $lockFiles[0].Directory.FullName
  $requiredPaths = @(
    "payload-manifest.json", "payload-lock.json", "lifecycle.ps1", "bootstrap.sql",
    "node/node.exe", "postgresql/bin/postgres.exe", "service-wrapper/shawl.exe", "local-api/dist/main.js",
    "local-api/dist/migrate.js", "local-api/drizzle/meta/_journal.json"
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

function Wait-Healthy {
  param([int] $TimeoutSeconds = 90)

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:31310/health" -TimeoutSec 2
      $body = $response.Content | ConvertFrom-Json
      if ($response.StatusCode -eq 200 -and $body.status -eq "healthy" -and $body.database -eq "available") {
        return $body
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  throw "The Forge candidate services did not become healthy"
}

function Read-DatabaseConnection {
  param([ValidateSet("runtime", "schema-owner")][string] $Role)

  $name = if ($Role -eq "runtime") { "database-url" } else { "schema-owner-url" }
  $uri = [Uri]::new((Get-Content -LiteralPath (Join-Path $dataRoot "config\$name") -Raw).Trim())
  $userInfo = $uri.UserInfo.Split(':', 2)
  return [ordered]@{
    user = [Uri]::UnescapeDataString($userInfo[0])
    password = [Uri]::UnescapeDataString($userInfo[1])
    database = $uri.AbsolutePath.TrimStart('/')
    port = $uri.Port
  }
}

function Invoke-Psql {
  param(
    [string] $PayloadRoot,
    [ValidateSet("runtime", "schema-owner")][string] $Role,
    [string] $Sql
  )

  $connection = Read-DatabaseConnection -Role $Role
  $previousPassword = $env:PGPASSWORD
  try {
    $env:PGPASSWORD = $connection.password
    $output = & (Join-Path $PayloadRoot "postgresql\bin\psql.exe") --no-psqlrc --set=ON_ERROR_STOP=1 --host=127.0.0.1 --port=$($connection.port) --username=$($connection.user) --dbname=$($connection.database) --tuples-only --no-align --command=$Sql 2>&1
    if ($LASTEXITCODE -ne 0) { throw "A Forge database comparison query failed" }
    return ($output -join "`n").Trim()
  } finally {
    $env:PGPASSWORD = $previousPassword
  }
}

function Get-PreservationMarker {
  param([string] $PayloadRoot)

  $controlData = & (Join-Path $PayloadRoot "postgresql\bin\pg_controldata.exe") (Join-Path $dataRoot "postgresql")
  if ($LASTEXITCODE -ne 0) { throw "Could not read Forge PostgreSQL control data" }
  $identifierLine = $controlData | Where-Object { $_ -match '^Database system identifier:' }
  return [ordered]@{
    installationId = (Get-Content -LiteralPath (Join-Path $dataRoot "config\installation.json") -Raw | ConvertFrom-Json).installationId
    installationConfigHash = (Get-FileHash -LiteralPath (Join-Path $dataRoot "config\installation.json") -Algorithm SHA256).Hash.ToLowerInvariant()
    runtimeConfigHash = (Get-FileHash -LiteralPath (Join-Path $dataRoot "config\database-url") -Algorithm SHA256).Hash.ToLowerInvariant()
    ownerConfigHash = (Get-FileHash -LiteralPath (Join-Path $dataRoot "config\schema-owner-url") -Algorithm SHA256).Hash.ToLowerInvariant()
    postgresqlConfigHash = (Get-FileHash -LiteralPath (Join-Path $dataRoot "postgresql\postgresql.conf") -Algorithm SHA256).Hash.ToLowerInvariant()
    postgresqlHbaHash = (Get-FileHash -LiteralPath (Join-Path $dataRoot "postgresql\pg_hba.conf") -Algorithm SHA256).Hash.ToLowerInvariant()
    databaseSystemIdentifier = ($identifierLine -replace '^Database system identifier:\s*', '').Trim()
  }
}

function Get-PostgresqlControlState {
  param([string] $PayloadRoot)

  $controlData = & (Join-Path $PayloadRoot "postgresql\bin\pg_controldata.exe") (Join-Path $dataRoot "postgresql")
  if ($LASTEXITCODE -ne 0) { throw "Could not read Forge PostgreSQL control state" }
  $stateLines = @($controlData | Where-Object { $_ -match '^Database cluster state:' })
  if ($stateLines.Count -ne 1) { throw "Forge PostgreSQL control data did not report exactly one cluster state" }
  return ($stateLines[0] -replace '^Database cluster state:\s*', '').Trim()
}

function Test-PreservationMarker {
  param([object] $Expected, [string] $PayloadRoot)

  $baseMatches = (Get-Content -LiteralPath (Join-Path $dataRoot "config\installation.json") -Raw | ConvertFrom-Json).installationId -eq $Expected.installationId -and
    (Get-FileHash -LiteralPath (Join-Path $dataRoot "config\installation.json") -Algorithm SHA256).Hash.ToLowerInvariant() -eq $Expected.installationConfigHash -and
    (Get-FileHash -LiteralPath (Join-Path $dataRoot "config\database-url") -Algorithm SHA256).Hash.ToLowerInvariant() -eq $Expected.runtimeConfigHash -and
    (Get-FileHash -LiteralPath (Join-Path $dataRoot "config\schema-owner-url") -Algorithm SHA256).Hash.ToLowerInvariant() -eq $Expected.ownerConfigHash -and
    (Get-FileHash -LiteralPath (Join-Path $dataRoot "postgresql\postgresql.conf") -Algorithm SHA256).Hash.ToLowerInvariant() -eq $Expected.postgresqlConfigHash -and
    (Get-FileHash -LiteralPath (Join-Path $dataRoot "postgresql\pg_hba.conf") -Algorithm SHA256).Hash.ToLowerInvariant() -eq $Expected.postgresqlHbaHash -and
    (Get-Content -LiteralPath (Join-Path $dataRoot "postgresql\PG_VERSION") -Raw).Trim() -eq "18"
  if (-not $baseMatches -or [string]::IsNullOrWhiteSpace($PayloadRoot)) { return $baseMatches }
  return (Get-PreservationMarker -PayloadRoot $PayloadRoot).databaseSystemIdentifier -eq $Expected.databaseSystemIdentifier
}

function Test-Witness {
  param([string] $PayloadRoot, [string] $WitnessId)
  return (Invoke-Psql -PayloadRoot $PayloadRoot -Role runtime -Sql "SELECT count(*) FROM public.issue34_forge_witness WHERE id = '$WitnessId';") -eq "1"
}

function Get-ServiceEvidence {
  param([string] $PayloadRoot)

  return @(@($apiServiceName, $postgresqlServiceName) | ForEach-Object {
    $name = $_
    $service = Get-CimInstance Win32_Service -Filter "Name='$name'"
    $serviceRegistry = Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\$name"
    $childPath = if ($name -eq $apiServiceName) {
      Join-Path $PayloadRoot "node\node.exe"
    } else {
      Join-Path $PayloadRoot "postgresql\bin\postgres.exe"
    }
    $child = Get-CimInstance Win32_Process | Where-Object {
      $_.ParentProcessId -eq $service.ProcessId -and $_.ExecutablePath -eq $childPath
    } | Select-Object -First 1
    [ordered]@{
      name = $name
      state = $service.State
      startMode = $service.StartMode
      startName = $service.StartName
      processId = $service.ProcessId
      pathName = $service.PathName
      serviceSidType = $serviceRegistry.ServiceSidType
      failureActionsOnNonCrashFailures = $serviceRegistry.FailureActionsOnNonCrashFailures
      dependencies = @((Get-Service -Name $name).ServicesDependedOn | ForEach-Object { $_.Name })
      wrapperPathMatches = $service.PathName -match ('^"?' + [regex]::Escape((Join-Path $PayloadRoot "service-wrapper\shawl.exe")) + '"? run --name ' + [regex]::Escape($name) + '(?: |$)')
      childProcessId = if ($null -eq $child) { 0 } else { $child.ProcessId }
      childParentProcessId = if ($null -eq $child) { 0 } else { $child.ParentProcessId }
      childExecutablePath = if ($null -eq $child) { $null } else { $child.ExecutablePath }
      expectedChildExecutablePath = $childPath
    }
  })
}

function Test-ExactServices {
  param([object[]] $Services)
  return $Services.Count -eq 2 -and @($Services | Where-Object {
    $_.state -ne "Running" -or $_.startMode -ne "Auto" -or
    $_.startName -ne "NT SERVICE\$($_.name)" -or $_.dependencies.Count -ne 0 -or
    $_.serviceSidType -ne 3 -or $_.failureActionsOnNonCrashFailures -ne 1 -or
    -not $_.wrapperPathMatches -or $_.processId -eq 0 -or $_.childProcessId -eq 0 -or
    $_.childParentProcessId -ne $_.processId -or
    $_.childExecutablePath -ne $_.expectedChildExecutablePath
  }).Count -eq 0 -and
    @($Services | ForEach-Object { $_.processId } | Select-Object -Unique).Count -eq 2
}

function Invoke-ChildCrashRecovery {
  param(
    [string] $PayloadRoot,
    [string] $ServiceName,
    [string] $ExecutableName,
    [string] $ExecutablePath
  )

  $wrapper = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'"
  $children = @(Get-CimInstance Win32_Process -Filter "Name='$ExecutableName'" | Where-Object {
    $_.ParentProcessId -eq $wrapper.ProcessId -and $_.ExecutablePath -eq $ExecutablePath
  })
  if ($children.Count -ne 1) { throw "Could not identify the exact $ServiceName child before its crash proof" }
  $before = $children[0].ProcessId
  Stop-Process -Id $before -Force
  $deadline = [DateTime]::UtcNow.AddSeconds(90)
  do {
    $after = Get-CimInstance Win32_Process -Filter "Name='$ExecutableName'" | Where-Object {
      $_.ProcessId -ne $before -and $_.ParentProcessId -eq $wrapper.ProcessId -and $_.ExecutablePath -eq $ExecutablePath
    } | Select-Object -First 1
    if ($null -ne $after) {
      Wait-Healthy | Out-Null
      return [ordered]@{ service = $ServiceName; wrapperProcessId = $wrapper.ProcessId; before = $before; after = $after.ProcessId }
    }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "$ServiceName did not recover its child process"
}

function Get-ProcessTreeRecords {
  param([int] $RootProcessId)

  $allProcesses = @(Get-CimInstance Win32_Process)
  $found = [Collections.Generic.List[object]]::new()
  $foundIds = [Collections.Generic.HashSet[int]]::new()
  $pending = [Collections.Generic.Queue[int]]::new()
  $pending.Enqueue($RootProcessId)
  while ($pending.Count -gt 0) {
    $processId = $pending.Dequeue()
    if ($foundIds.Add($processId)) {
      $process = $allProcesses | Where-Object { $_.ProcessId -eq $processId } | Select-Object -First 1
      if ($null -eq $process) { continue }
      $found.Add([ordered]@{
        processId = [int] $process.ProcessId
        createdAtUtcTicks = $process.CreationDate.ToUniversalTime().Ticks
        executablePath = $process.ExecutablePath
      })
      $allProcesses | Where-Object { $_.ParentProcessId -eq $processId } | ForEach-Object {
        $pending.Enqueue([int] $_.ProcessId)
      }
    }
  }
  return @($found)
}

function Wait-ProcessTreeExit {
  param([object[]] $Processes, [int] $TimeoutSeconds = 30)

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    $current = @(Get-CimInstance Win32_Process)
    $sameProcesses = @($Processes | Where-Object {
      $expected = $_
      $actual = $current | Where-Object { $_.ProcessId -eq $expected.processId } | Select-Object -First 1
      $null -ne $actual -and $actual.CreationDate.ToUniversalTime().Ticks -eq $expected.createdAtUtcTicks
    })
    if ($sameProcesses.Count -eq 0) { return $true }
    Start-Sleep -Milliseconds 200
  }
  return $false
}

function Invoke-WrapperCrashRecovery {
  param(
    [string] $ServiceName,
    [string] $ExecutableName,
    [string] $ExecutablePath
  )

  $before = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'"
  $oldTree = Get-ProcessTreeRecords -RootProcessId $before.ProcessId
  Stop-Process -Id $before.ProcessId -Force
  $deadline = [DateTime]::UtcNow.AddSeconds(90)
  do {
    $after = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'"
    if ($after.State -eq "Running" -and $after.ProcessId -ne 0 -and $after.ProcessId -ne $before.ProcessId) {
      $child = Get-CimInstance Win32_Process -Filter "Name='$ExecutableName'" | Where-Object {
        $_.ParentProcessId -eq $after.ProcessId -and $_.ExecutablePath -eq $ExecutablePath
      } | Select-Object -First 1
      if ($null -ne $child) {
        $oldTreeExited = Wait-ProcessTreeExit -Processes $oldTree
        Wait-Healthy | Out-Null
        return [ordered]@{
          service = $ServiceName
          before = $before.ProcessId
          oldTree = $oldTree
          oldTreeExited = $oldTreeExited
          after = $after.ProcessId
          child = $child.ProcessId
          childParent = $child.ParentProcessId
        }
      }
    }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "The SCM did not recover the $ServiceName wrapper and child process"
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
  $outputRoot = Split-Path -Parent $OutputPath
  New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
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
  # PowerShell unwraps a single registry result. Keep every product lookup as an
  # array so one installed version still has a reliable Count and index zero.
  if (@(Get-InstalledProduct).Count -ne 0) { throw "The Forge comparison product is already installed" }
  if (Test-Path -LiteralPath $expectedInstallRoot) { throw "The Forge comparison install root already exists" }
  if (Test-Path -LiteralPath $dataRoot) { throw "The Forge comparison requires a clean restored snapshot with no Breev data" }
  $baselineServices = [ordered]@{
    localApi = $null -ne (Get-Service -Name "BreevLocalApi" -ErrorAction SilentlyContinue)
    postgresql = $null -ne (Get-Service -Name "BreevPostgreSQL" -ErrorAction SilentlyContinue)
  }
  if ($baselineServices.localApi -or $baselineServices.postgresql) {
    throw "The Forge comparison requires a clean restored snapshot with no Breev services"
  }
  $result.serviceLifecycle["beforeInstall"] = $baselineServices

  $quotedInstallerPath = '"' + $InstallerPath + '"'
  $quotedUpdateInstallerPath = '"' + $UpdateInstallerPath + '"'
  $result.operations["cleanInstallExitCode"] = Invoke-MsiExec -Arguments @("/i", $quotedInstallerPath, "/qn", "/norestart")
  $installHealth = Wait-Healthy
  $installed = @(Get-InstalledProduct)
  if ($installed.Count -ne 1) { throw "The Forge candidate did not register exactly one installed product" }
  $installRoot = [IO.Path]::GetFullPath($installed[0].InstallPath).TrimEnd('\')
  if ($installRoot -ne $expectedInstallRoot -or -not (Test-Path -LiteralPath $installRoot -PathType Container)) {
    throw "The Forge candidate installed outside its expected machine-wide root"
  }
  $result.operations["installedVersion"] = $installed[0].DisplayVersion
  $result.operations["installRoot"] = $installRoot
  $result.signing["afterInstall"] = Get-InstalledSigningCoverage -Root $installRoot
  $result.payload["afterInstall"] = Get-InstalledPayloadRecord -InstallRoot $installRoot
  $result.application["afterInstall"] = Get-InstalledAsarRecord -InstallRoot $installRoot
  if ($result.application.afterInstall.version -ne $InstallerVersion) { throw "The installed Forge application has the wrong initial version" }
  $payloadRoot = $result.payload.afterInstall.root
  $result.serviceLifecycle["afterInstall"] = Get-ServiceEvidence -PayloadRoot $payloadRoot
  if (-not (Test-ExactServices -Services @($result.serviceLifecycle.afterInstall))) {
    throw "The Forge candidate did not install the exact two service trees"
  }

  Invoke-Psql -PayloadRoot $payloadRoot -Role schema-owner -Sql "CREATE TABLE public.issue34_forge_witness(id text PRIMARY KEY, value text NOT NULL);" | Out-Null
  $witnessId = [Guid]::NewGuid().ToString()
  Invoke-Psql -PayloadRoot $payloadRoot -Role runtime -Sql "INSERT INTO public.issue34_forge_witness(id, value) VALUES ('$witnessId', 'committed');" | Out-Null
  $preservationMarker = Get-PreservationMarker -PayloadRoot $payloadRoot
  $result.dataPreservation["afterInstall"] = (Test-Witness -PayloadRoot $payloadRoot -WitnessId $witnessId) -and
    $installHealth.status -eq "healthy"

  Stop-Service -Name $postgresqlServiceName
  (Get-Service -Name $postgresqlServiceName).WaitForStatus("Stopped", [TimeSpan]::FromSeconds(60))
  $result.serviceLifecycle["postgresqlStoppedControlState"] = Get-PostgresqlControlState -PayloadRoot $payloadRoot
  Start-Service -Name $postgresqlServiceName
  Wait-Healthy | Out-Null

  $result.serviceLifecycle["apiChildRecovery"] = Invoke-ChildCrashRecovery `
    -PayloadRoot $payloadRoot `
    -ServiceName $apiServiceName `
    -ExecutableName "node.exe" `
    -ExecutablePath (Join-Path $payloadRoot "node\node.exe")
  $result.serviceLifecycle["postgresqlChildRecovery"] = Invoke-ChildCrashRecovery `
    -PayloadRoot $payloadRoot `
    -ServiceName $postgresqlServiceName `
    -ExecutableName "postgres.exe" `
    -ExecutablePath (Join-Path $payloadRoot "postgresql\bin\postgres.exe")
  $result.serviceLifecycle["apiWrapperRecovery"] = Invoke-WrapperCrashRecovery `
    -ServiceName $apiServiceName `
    -ExecutableName "node.exe" `
    -ExecutablePath (Join-Path $payloadRoot "node\node.exe")
  $result.serviceLifecycle["postgresqlWrapperRecovery"] = Invoke-WrapperCrashRecovery `
    -ServiceName $postgresqlServiceName `
    -ExecutableName "postgres.exe" `
    -ExecutablePath (Join-Path $payloadRoot "postgresql\bin\postgres.exe")
  $result.serviceLifecycle["afterRecovery"] = Get-ServiceEvidence -PayloadRoot $payloadRoot

  $failedRepairToken = "issue-34-injected-failure"
  $failedRepairLog = Join-Path $outputRoot "forge-failed-repair.log"
  Remove-Item -LiteralPath @((Join-Path $dataRoot "state\forge-injected-failure.txt"), $failedRepairLog) -Force -ErrorAction SilentlyContinue
  # msiexec /fa discarded BREEVFORGEINJECTFAILURE before the deferred action.
  # The explicit /i repair form preserves the public property in the MSI session.
  $result.operations["failedRepairExitCode"] = Invoke-MsiExec `
    -Arguments @("/i", $quotedInstallerPath, "REINSTALL=ALL", "REINSTALLMODE=amus", "BREEVFORGEINJECTFAILURE=1", "/qn", "/norestart", "/l*v", ('"' + $failedRepairLog + '"')) `
    -ExpectFailure
  $result.operations["failedRepairMarker"] = Get-InjectedFailureEvidence -ExpectedToken $failedRepairToken -LogPath $failedRepairLog
  Wait-Healthy | Out-Null
  $afterFailedRepair = @(Get-InstalledProduct)
  if ($afterFailedRepair.Count -ne 1 -or $afterFailedRepair[0].DisplayVersion -ne $InstallerVersion) {
    throw "The failed Forge repair did not roll back to the installed version"
  }
  $result.signing["afterFailedRepair"] = Get-InstalledSigningCoverage -Root $installRoot
  $result.payload["afterFailedRepair"] = Get-InstalledPayloadRecord -InstallRoot $installRoot
  $result.application["afterFailedRepair"] = Get-InstalledAsarRecord -InstallRoot $installRoot
  $payloadRoot = $result.payload.afterFailedRepair.root
  $result.serviceLifecycle["afterFailedRepair"] = Get-ServiceEvidence -PayloadRoot $payloadRoot
  $result.dataPreservation["afterFailedRepair"] = (Test-PreservationMarker -Expected $preservationMarker -PayloadRoot $payloadRoot) -and
    (Test-Witness -PayloadRoot $payloadRoot -WitnessId $witnessId)

  $repairTargetPath = $result.application.afterInstall.path
  $repairTargetHash = (Get-FileHash -LiteralPath $repairTargetPath -Algorithm SHA256).Hash.ToLowerInvariant()
  Corrupt-LastByte -Path $repairTargetPath
  $result.operations["repairCorruptionCreated"] = (Get-FileHash -LiteralPath $repairTargetPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $repairTargetHash

  $result.operations["repairExitCode"] = Invoke-MsiExec -Arguments @("/fa", $quotedInstallerPath, "/qn", "/norestart")
  Wait-Healthy | Out-Null
  $result.operations["repairRestoredMsiFile"] = (Get-FileHash -LiteralPath $repairTargetPath -Algorithm SHA256).Hash.ToLowerInvariant() -eq $repairTargetHash
  $result.signing["afterRepair"] = Get-InstalledSigningCoverage -Root $installRoot
  $result.payload["afterRepair"] = Get-InstalledPayloadRecord -InstallRoot $installRoot
  $result.application["afterRepair"] = Get-InstalledAsarRecord -InstallRoot $installRoot
  $payloadRoot = $result.payload.afterRepair.root
  $result.serviceLifecycle["afterRepair"] = Get-ServiceEvidence -PayloadRoot $payloadRoot
  $result.dataPreservation["afterRepair"] = (Test-PreservationMarker -Expected $preservationMarker -PayloadRoot $payloadRoot) -and
    (Test-Witness -PayloadRoot $payloadRoot -WitnessId $witnessId)

  $failedUpdateToken = "issue-34-injected-failure"
  $failedUpdateLog = Join-Path $outputRoot "forge-failed-update.log"
  Remove-Item -LiteralPath @((Join-Path $dataRoot "state\forge-injected-failure.txt"), $failedUpdateLog) -Force -ErrorAction SilentlyContinue
  $result.operations["failedUpdateExitCode"] = Invoke-MsiExec `
    -Arguments @("/i", $quotedUpdateInstallerPath, "BREEVFORGEINJECTFAILURE=1", "/qn", "/norestart", "/l*v", ('"' + $failedUpdateLog + '"')) `
    -ExpectFailure
  $result.operations["failedUpdateMarker"] = Get-InjectedFailureEvidence -ExpectedToken $failedUpdateToken -LogPath $failedUpdateLog
  Wait-Healthy | Out-Null
  $afterFailedUpdate = @(Get-InstalledProduct)
  if ($afterFailedUpdate.Count -ne 1 -or $afterFailedUpdate[0].DisplayVersion -ne $InstallerVersion) {
    throw "The failed Forge update did not restore the prior installed version"
  }
  $result.signing["afterFailedUpdate"] = Get-InstalledSigningCoverage -Root $installRoot
  $result.payload["afterFailedUpdate"] = Get-InstalledPayloadRecord -InstallRoot $installRoot
  $result.application["afterFailedUpdate"] = Get-InstalledAsarRecord -InstallRoot $installRoot
  $payloadRoot = $result.payload.afterFailedUpdate.root
  $result.serviceLifecycle["afterFailedUpdate"] = Get-ServiceEvidence -PayloadRoot $payloadRoot
  $result.dataPreservation["afterFailedUpdate"] = (Test-PreservationMarker -Expected $preservationMarker -PayloadRoot $payloadRoot) -and
    (Test-Witness -PayloadRoot $payloadRoot -WitnessId $witnessId)

  $preUpdateServiceEvidence = @($result.serviceLifecycle.afterFailedUpdate)
  $preUpdateProcesses = @($preUpdateServiceEvidence | ForEach-Object {
    Get-ProcessTreeRecords -RootProcessId $_.processId
  } | Sort-Object -Property processId -Unique)
  $preUpdateProcessIds = @($preUpdateProcesses | ForEach-Object { $_.processId })
  $result.operations["updateExitCode"] = Invoke-MsiExec -Arguments @("/i", $quotedUpdateInstallerPath, "/qn", "/norestart")
  Wait-Healthy | Out-Null
  $updated = @(Get-InstalledProduct)
  if ($updated.Count -ne 1) { throw "The Forge candidate update did not leave exactly one installed product" }
  $updatedInstallRoot = [IO.Path]::GetFullPath($updated[0].InstallPath).TrimEnd('\')
  if ($updatedInstallRoot -ne $installRoot) { throw "The Forge candidate update changed its machine-wide root" }
  $result.operations["updatedVersion"] = $updated[0].DisplayVersion
  $result.signing["afterUpdate"] = Get-InstalledSigningCoverage -Root $installRoot
  $result.payload["afterUpdate"] = Get-InstalledPayloadRecord -InstallRoot $installRoot
  $result.application["afterUpdate"] = Get-InstalledAsarRecord -InstallRoot $installRoot
  if ($result.application.afterUpdate.version -ne $UpdateInstallerVersion) { throw "The installed Forge application has the wrong update version" }
  $payloadRoot = $result.payload.afterUpdate.root
  $result.serviceLifecycle["afterUpdate"] = Get-ServiceEvidence -PayloadRoot $payloadRoot
  $updateTreesExited = Wait-ProcessTreeExit -Processes $preUpdateProcesses
  $result.serviceLifecycle["updateTransition"] = [ordered]@{
    before = $preUpdateServiceEvidence
    previousProcesses = $preUpdateProcesses
    previousProcessIds = $preUpdateProcessIds
    previousTreesExited = $updateTreesExited
    after = $result.serviceLifecycle.afterUpdate
    freshProcesses = @($result.serviceLifecycle.afterUpdate | Where-Object {
      $_.processId -in $preUpdateProcessIds -or $_.childProcessId -in $preUpdateProcessIds
    }).Count -eq 0
  }
  $result.dataPreservation["afterUpdate"] = (Test-PreservationMarker -Expected $preservationMarker -PayloadRoot $payloadRoot) -and
    (Test-Witness -PayloadRoot $payloadRoot -WitnessId $witnessId)

  $result.operations["uninstallExitCode"] = Invoke-MsiExec -Arguments @("/x", $quotedUpdateInstallerPath, "/qn", "/norestart")
  $result.operations["uninstalled"] = @(Get-InstalledProduct).Count -eq 0
  $result.operations["installRootRemoved"] = -not (Test-Path -LiteralPath $installRoot)
  $result.serviceLifecycle["afterUninstall"] = [ordered]@{
    localApi = $null -ne (Get-Service -Name $apiServiceName -ErrorAction SilentlyContinue)
    postgresql = $null -ne (Get-Service -Name $postgresqlServiceName -ErrorAction SilentlyContinue)
  }
  $result.dataPreservation["afterUninstall"] = Test-PreservationMarker -Expected $preservationMarker -PayloadRoot ""

  $result.operations["reinstallExitCode"] = Invoke-MsiExec -Arguments @("/i", $quotedUpdateInstallerPath, "/qn", "/norestart")
  Wait-Healthy | Out-Null
  $reinstalled = @(Get-InstalledProduct)
  if ($reinstalled.Count -ne 1 -or $reinstalled[0].DisplayVersion -ne $UpdateInstallerVersion) {
    throw "The Forge candidate did not reinstall its update version"
  }
  $result.signing["afterReinstall"] = Get-InstalledSigningCoverage -Root $installRoot
  $result.payload["afterReinstall"] = Get-InstalledPayloadRecord -InstallRoot $installRoot
  $result.application["afterReinstall"] = Get-InstalledAsarRecord -InstallRoot $installRoot
  $payloadRoot = $result.payload.afterReinstall.root
  $result.serviceLifecycle["afterReinstall"] = Get-ServiceEvidence -PayloadRoot $payloadRoot
  $result.dataPreservation["afterReinstall"] = (Test-PreservationMarker -Expected $preservationMarker -PayloadRoot $payloadRoot) -and
    (Test-Witness -PayloadRoot $payloadRoot -WitnessId $witnessId)

  $result.operations["finalUninstallExitCode"] = Invoke-MsiExec -Arguments @("/x", $quotedUpdateInstallerPath, "/qn", "/norestart")
  $result.operations["finalUninstalled"] = @(Get-InstalledProduct).Count -eq 0 -and
    -not (Test-Path -LiteralPath $installRoot) -and
    $null -eq (Get-Service -Name $apiServiceName -ErrorAction SilentlyContinue) -and
    $null -eq (Get-Service -Name $postgresqlServiceName -ErrorAction SilentlyContinue)
  $result.dataPreservation["afterFinalUninstall"] = Test-PreservationMarker -Expected $preservationMarker -PayloadRoot ""
  $result.signing["installedGapObserved"] = -not $result.signing.afterInstall.allSignaturesValid -or
    -not $result.signing.afterRepair.allSignaturesValid -or
    -not $result.signing.afterUpdate.allSignaturesValid -or
    -not $result.signing.afterReinstall.allSignaturesValid
  $result.serviceLifecycle["integratesRequiredServices"] = Test-ExactServices -Services @($result.serviceLifecycle.afterInstall)
  $result.serviceLifecycle["repair"] = (Test-ExactServices -Services @($result.serviceLifecycle.afterRepair)) -and $result.dataPreservation.afterRepair
  $result.serviceLifecycle["update"] = (Test-ExactServices -Services @($result.serviceLifecycle.afterUpdate)) -and
    $result.serviceLifecycle.updateTransition.previousTreesExited -and
    $result.serviceLifecycle.updateTransition.freshProcesses -and
    $result.dataPreservation.afterUpdate
  $result.serviceLifecycle["failedRepairRecovery"] = (Test-ExactServices -Services @($result.serviceLifecycle.afterFailedRepair)) -and
    $result.dataPreservation.afterFailedRepair
  $result.serviceLifecycle["failedUpdateRecovery"] = (Test-ExactServices -Services @($result.serviceLifecycle.afterFailedUpdate)) -and
    $result.dataPreservation.afterFailedUpdate -and
    $result.application.afterFailedUpdate.version -eq $InstallerVersion
  $result.serviceLifecycle["recovery"] = (Test-ExactServices -Services @($result.serviceLifecycle.afterRecovery)) -and
    $result.serviceLifecycle.postgresqlStoppedControlState -eq "shut down" -and
    $result.serviceLifecycle.apiChildRecovery.before -ne $result.serviceLifecycle.apiChildRecovery.after -and
    $result.serviceLifecycle.postgresqlChildRecovery.before -ne $result.serviceLifecycle.postgresqlChildRecovery.after -and
    $result.serviceLifecycle.apiWrapperRecovery.before -ne $result.serviceLifecycle.apiWrapperRecovery.after -and
    $result.serviceLifecycle.apiWrapperRecovery.oldTreeExited -and
    $result.serviceLifecycle.apiWrapperRecovery.childParent -eq $result.serviceLifecycle.apiWrapperRecovery.after -and
    $result.serviceLifecycle.postgresqlWrapperRecovery.before -ne $result.serviceLifecycle.postgresqlWrapperRecovery.after -and
    $result.serviceLifecycle.postgresqlWrapperRecovery.oldTreeExited -and
    $result.serviceLifecycle.postgresqlWrapperRecovery.childParent -eq $result.serviceLifecycle.postgresqlWrapperRecovery.after
  $result.serviceLifecycle["reinstall"] = Test-ExactServices -Services @($result.serviceLifecycle.afterReinstall)
  $result["comparisonExecuted"] = $result.operations.uninstalled -and
    $result.operations.finalUninstalled -and
    $result.operations.installedVersion -eq $InstallerVersion -and
    $result.operations.updatedVersion -eq $UpdateInstallerVersion -and
    $result.operations.repairCorruptionCreated -and
    $result.operations.repairRestoredMsiFile -and
    $result.operations.failedRepairExitCode -eq 1603 -and
    $result.operations.failedUpdateExitCode -eq 1603 -and
    $result.operations.failedRepairMarker.markerMatched -and
    $result.operations.failedRepairMarker.deferredActionLogged -and
    $result.operations.failedRepairMarker.logBytes -gt 0 -and
    $result.operations.failedUpdateMarker.markerMatched -and
    $result.operations.failedUpdateMarker.deferredActionLogged -and
    $result.operations.failedUpdateMarker.logBytes -gt 0 -and
    $result.operations.installRootRemoved -and
    $result.application.afterInstall.version -eq $InstallerVersion -and
    $result.application.afterRepair.version -eq $InstallerVersion -and
    $result.application.afterFailedRepair.version -eq $InstallerVersion -and
    $result.application.afterUpdate.version -eq $UpdateInstallerVersion -and
    $result.application.afterReinstall.version -eq $UpdateInstallerVersion -and
    $result.serviceLifecycle.integratesRequiredServices -and
    $result.serviceLifecycle.repair -and
    $result.serviceLifecycle.update -and
    $result.serviceLifecycle.failedRepairRecovery -and
    $result.serviceLifecycle.failedUpdateRecovery -and
    $result.serviceLifecycle.recovery -and
    $result.serviceLifecycle.reinstall -and
    -not $result.serviceLifecycle.afterUninstall.localApi -and
    -not $result.serviceLifecycle.afterUninstall.postgresql -and
    $result.signing.afterInstall.files.Count -gt 0 -and
    $result.signing.afterFailedRepair.files.Count -gt 0 -and
    $result.signing.afterRepair.files.Count -gt 0 -and
    $result.signing.afterFailedUpdate.files.Count -gt 0 -and
    $result.signing.afterUpdate.files.Count -gt 0 -and
    $result.signing.afterReinstall.files.Count -gt 0 -and
    $result.signing.installedGapObserved -and
    $result.payload.afterInstall.files.Count -eq 10 -and
    $result.payload.afterRepair.files.Count -eq 10 -and
    $result.payload.afterFailedRepair.files.Count -eq 10 -and
    $result.payload.afterFailedUpdate.files.Count -eq 10 -and
    $result.payload.afterUpdate.files.Count -eq 10 -and
    $result.payload.afterReinstall.files.Count -eq 10 -and
    $result.dataPreservation.afterInstall -and
    $result.dataPreservation.afterRepair -and
    $result.dataPreservation.afterFailedRepair -and
    $result.dataPreservation.afterFailedUpdate -and
    $result.dataPreservation.afterUpdate -and
    $result.dataPreservation.afterUninstall -and
    $result.dataPreservation.afterReinstall -and
    $result.dataPreservation.afterFinalUninstall
  $result["meetsIssueRequirements"] = $result.comparisonExecuted -and
    $result.signing.afterInstall.allSignaturesValid -and
    $result.signing.afterInstall.productExecutablesSignedByExpectedCertificate -and
    $result.signing.afterRepair.allSignaturesValid -and
    $result.signing.afterRepair.productExecutablesSignedByExpectedCertificate -and
    $result.signing.afterUpdate.allSignaturesValid -and
    $result.signing.afterUpdate.productExecutablesSignedByExpectedCertificate -and
    $result.signing.afterReinstall.allSignaturesValid -and
    $result.signing.afterReinstall.productExecutablesSignedByExpectedCertificate
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
