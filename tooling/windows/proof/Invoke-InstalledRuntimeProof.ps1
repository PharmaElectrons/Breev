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

  [switch] $DisposableEnvironmentAcknowledged,
  [switch] $BitLockerRecoveryCustodyAcknowledged,
  [switch] $DevelopmentOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$dataRoot = Join-Path $env:ProgramData "Breev"
$apiServiceName = "BreevLocalApi"
$postgresqlServiceName = "BreevPostgreSQL"
$checks = [Collections.Generic.List[object]]::new()
$result = [ordered]@{
  schemaVersion = 1
  runId = $RunId.ToString()
  sourceCommit = $SourceCommit
  snapshotId = $SnapshotId
  startedAtUtc = [DateTime]::UtcNow.ToString("o")
  source = "tooling/windows/proof/Invoke-InstalledRuntimeProof.ps1"
  developmentOnly = [bool] $DevelopmentOnly
  certificationEligible = $false
  machine = $null
  artifacts = $null
  signing = [ordered]@{}
  checks = $checks
  passed = $false
  error = $null
  completedAtUtc = $null
}

function Add-Check {
  param(
    [string] $Name,
    [bool] $Passed,
    [object] $Details = $null
  )

  $checks.Add([ordered]@{ name = $Name; passed = $Passed; details = $Details })
  if (-not $Passed) {
    throw "Proof check failed: $Name"
  }
}

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "The installed-runtime proof requires an elevated administrator token"
  }
}

function Get-MachineGate {
  $windowsRegistry = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion"
  $operatingSystem = Get-CimInstance Win32_OperatingSystem
  $computer = Get-CimInstance Win32_ComputerSystem
  $physicalMemory = @(Get-CimInstance Win32_PhysicalMemory)
  $processors = @(Get-CimInstance Win32_Processor)
  $systemDrive = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($env:SystemDrive)'"
  $systemPartition = Get-Partition -DriveLetter ($env:SystemDrive).TrimEnd(':')
  $systemDisk = Get-Disk -Number $systemPartition.DiskNumber
  $physicalDisks = @(Get-PhysicalDisk | Select-Object DeviceId, FriendlyName, MediaType, BusType, Size)
  $systemPhysicalDisks = @($physicalDisks | Where-Object { $_.DeviceId.ToString() -eq $systemDisk.Number.ToString() })
  $systemDriveOnEligibleSsd = $systemPhysicalDisks.Count -eq 1 -and
    $systemPhysicalDisks[0].MediaType -eq "SSD" -and $systemDisk.Size -ge 256GB
  $videoControllers = @(Get-CimInstance Win32_VideoController | Select-Object Name, CurrentHorizontalResolution, CurrentVerticalResolution)
  $bitLocker = Get-BitLockerVolume -MountPoint $env:SystemDrive
  $latestHotfix = Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 1
  $powerOutput = (& powercfg.exe /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) { throw "Could not read the active sleep timeout" }
  $acSleepMatch = [regex]::Match($powerOutput, 'Current AC Power Setting Index:\s+0x([0-9a-fA-F]+)')
  $dcSleepMatch = [regex]::Match($powerOutput, 'Current DC Power Setting Index:\s+0x([0-9a-fA-F]+)')
  if (-not $acSleepMatch.Success -or -not $dcSleepMatch.Success) {
    throw "Could not parse the active AC and DC sleep timeouts on the required English Windows image"
  }
  $hibernateEnabled = Test-Path -LiteralPath (Join-Path $env:SystemDrive "hiberfil.sys")
  $updateSession = New-Object -ComObject Microsoft.Update.Session
  $updateSearcher = $updateSession.CreateUpdateSearcher()
  $pendingUpdateSearch = $updateSearcher.Search("IsInstalled=0 and IsHidden=0 and Type='Software'")
  $pendingSoftwareUpdates = [Collections.Generic.List[object]]::new()
  for ($updateIndex = 0; $updateIndex -lt $pendingUpdateSearch.Updates.Count; $updateIndex++) {
    $update = $pendingUpdateSearch.Updates.Item($updateIndex)
    $pendingSoftwareUpdates.Add([ordered]@{ title = $update.Title; rebootRequired = [bool] $update.RebootRequired })
  }
  $pendingRestart = (Test-Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending") -or
    (Test-Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired") -or
    ($null -ne (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager" -Name PendingFileRenameOperations -ErrorAction SilentlyContinue))
  $activation = @(Get-CimInstance SoftwareLicensingProduct -Filter "ApplicationID='55c92734-d682-4d71-983e-d6ec3f16059f' AND PartialProductKey IS NOT NULL" | Where-Object { $_.LicenseStatus -eq 1 })
  $secureBoot = try { Confirm-SecureBootUEFI } catch { $false }
  $tpm = Get-Tpm
  $gate = [ordered]@{
    productName = $operatingSystem.Caption -replace '^Microsoft ', ''
    editionId = $windowsRegistry.EditionID
    displayVersion = $windowsRegistry.DisplayVersion
    build = $operatingSystem.BuildNumber
    architecture = $operatingSystem.OSArchitecture
    productType = $operatingSystem.ProductType
    activated = $activation.Count -gt 0
    secureBoot = [bool] $secureBoot
    tpmPresent = [bool] $tpm.TpmPresent
    tpmReady = [bool] $tpm.TpmReady
    logicalProcessors = $computer.NumberOfLogicalProcessors
    memoryBytes = [uint64] $computer.TotalPhysicalMemory
    installedMemoryBytes = [uint64] @($physicalMemory | Measure-Object -Property Capacity -Sum).Sum
    model = $computer.Model
    machineId = (Get-CimInstance Win32_ComputerSystemProduct).UUID
    physicalCores = @($processors | Measure-Object -Property NumberOfCores -Sum).Sum
    systemDriveBytes = [uint64] $systemDrive.Size
    systemDisk = $systemDisk | Select-Object Number, FriendlyName, BusType, Size
    systemPhysicalDisk = if ($systemPhysicalDisks.Count -eq 1) { $systemPhysicalDisks[0] } else { $null }
    systemDriveOnEligibleSsd = [bool] $systemDriveOnEligibleSsd
    physicalDisks = $physicalDisks
    display = $videoControllers
    bitLockerProtection = $bitLocker.ProtectionStatus.ToString()
    bitLockerVolumeStatus = $bitLocker.VolumeStatus.ToString()
    bitLockerRecoveryProtectorCount = @($bitLocker.KeyProtector | Where-Object { $_.KeyProtectorType -eq "RecoveryPassword" }).Count
    bitLockerRecoveryCustodyAcknowledged = [bool] $BitLockerRecoveryCustodyAcknowledged
    latestHotfixInstalledOnUtc = if ($null -eq $latestHotfix) { $null } else { $latestHotfix.InstalledOn.ToUniversalTime().ToString("o") }
    acSleepTimeoutSeconds = [Convert]::ToUInt32($acSleepMatch.Groups[1].Value, 16)
    dcSleepTimeoutSeconds = [Convert]::ToUInt32($dcSleepMatch.Groups[1].Value, 16)
    hibernateEnabled = [bool] $hibernateEnabled
    pendingRestart = [bool] $pendingRestart
    pendingSoftwareUpdates = $pendingSoftwareUpdates
  }
  $eligible = $gate.productName -eq "Windows 11 Pro" -and
    $gate.editionId -eq "Professional" -and
    $gate.displayVersion -eq "25H2" -and
    $gate.architecture -eq "64-bit" -and
    $gate.productType -eq 1 -and
    $gate.activated -and
    $gate.secureBoot -and
    $gate.tpmPresent -and
    $gate.tpmReady -and
    $gate.logicalProcessors -ge 4 -and
    $gate.physicalCores -ge 4 -and
    $gate.installedMemoryBytes -ge 8GB -and
    $gate.systemDriveOnEligibleSsd -and
    @($gate.display | Where-Object { $_.CurrentHorizontalResolution -ge 1366 -and $_.CurrentVerticalResolution -ge 768 }).Count -gt 0 -and
    $gate.bitLockerProtection -eq "On" -and
    $gate.bitLockerVolumeStatus -eq "FullyEncrypted" -and
    $gate.bitLockerRecoveryProtectorCount -gt 0 -and
    $gate.bitLockerRecoveryCustodyAcknowledged -and
    $gate.acSleepTimeoutSeconds -eq 0 -and
    $gate.dcSleepTimeoutSeconds -eq 0 -and
    -not $gate.hibernateEnabled -and
    -not $gate.pendingRestart -and
    $gate.pendingSoftwareUpdates.Count -eq 0 -and
    $null -ne $gate.latestHotfixInstalledOnUtc -and
    ([DateTime]::Parse($gate.latestHotfixInstalledOnUtc).ToUniversalTime() -ge [DateTime]::UtcNow.AddDays(-45))
  return [ordered]@{ facts = $gate; eligible = $eligible }
}

function Invoke-Installer {
  param(
    [string] $Path,
    [switch] $Repair,
    [string] $InjectFailure = "None",
    [switch] $ExpectFailure
  )

  $arguments = [Collections.Generic.List[string]]::new()
  $arguments.Add("/S")
  $arguments.Add("/allusers")
  if ($Repair) { $arguments.Add("/repair") }
  $previousFailure = $env:BREEV_WINDOWS_INJECT_FAILURE
  try {
    $env:BREEV_WINDOWS_INJECT_FAILURE = $InjectFailure
    $process = Start-Process -FilePath $Path -ArgumentList $arguments -Wait -PassThru
  } finally {
    $env:BREEV_WINDOWS_INJECT_FAILURE = $previousFailure
  }
  if ($ExpectFailure) {
    if ($process.ExitCode -eq 0) { throw "The injected installer failure unexpectedly succeeded" }
  } elseif ($process.ExitCode -ne 0) {
    $lifecyclePath = Join-Path $dataRoot "state\lifecycle.json"
    if (Test-Path -LiteralPath $lifecyclePath -PathType Leaf) {
      $lifecycle = Get-Content -LiteralPath $lifecyclePath -Raw | ConvertFrom-Json
      $lifecycleError = if ($lifecycle.PSObject.Properties["error"]) { $lifecycle.error } else { "not recorded" }
      throw "The installer failed with exit code $($process.ExitCode); lifecycle error: $lifecycleError"
    }
    throw "The installer failed with exit code $($process.ExitCode) before the lifecycle wrote a state record"
  }
  return $process.ExitCode
}

function Get-InjectedLifecycleFailureEvidence {
  param([string] $ExpectedFailurePoint)

  $lifecyclePath = Join-Path $dataRoot "state\lifecycle.json"
  if (-not (Test-Path -LiteralPath $lifecyclePath -PathType Leaf)) {
    throw "The injected Builder lifecycle failure did not write its state record"
  }
  $lifecycle = Get-Content -LiteralPath $lifecyclePath -Raw | ConvertFrom-Json
  $evidence = [ordered]@{
    path = $lifecyclePath
    sha256 = (Get-FileHash -LiteralPath $lifecyclePath -Algorithm SHA256).Hash.ToLowerInvariant()
    action = $lifecycle.action
    status = $lifecycle.status
    failurePoint = $lifecycle.failurePoint
    error = $lifecycle.error
    matched = $lifecycle.action -eq "Install" -and
      $lifecycle.status -eq "failed-data-preserved" -and
      $lifecycle.failurePoint -eq $ExpectedFailurePoint -and
      $lifecycle.error -eq "Injected lifecycle failure at $ExpectedFailurePoint"
  }
  if (-not $evidence.matched) {
    throw "The failed Builder installer did not reach the expected $ExpectedFailurePoint lifecycle seam"
  }
  return $evidence
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
  throw "The local API did not return to healthy"
}

function Get-HealthResponse {
  Add-Type -AssemblyName System.Net.Http
  $client = [Net.Http.HttpClient]::new()
  $client.Timeout = [TimeSpan]::FromSeconds(5)
  try {
    $response = $client.GetAsync("http://127.0.0.1:31310/health").GetAwaiter().GetResult()
    try {
      $content = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
      return [ordered]@{ statusCode = [int] $response.StatusCode; body = ($content | ConvertFrom-Json) }
    } finally {
      $response.Dispose()
    }
  } finally {
    $client.Dispose()
  }
}

function Get-PayloadRoot {
  $payloadRoot = Join-Path $env:ProgramFiles "Breev\resources\windows-payload"
  if (-not (Test-Path -LiteralPath $payloadRoot -PathType Container)) {
    throw "The machine-wide Breev payload is missing"
  }
  return $payloadRoot
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
    [ValidateSet("runtime", "schema-owner")][string] $Role,
    [string] $Sql,
    [switch] $ExpectFailure
  )

  $payloadRoot = Get-PayloadRoot
  $psql = Join-Path $payloadRoot "postgresql\bin\psql.exe"
  $connection = Read-DatabaseConnection -Role $Role
  $previousPassword = $env:PGPASSWORD
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $env:PGPASSWORD = $connection.password
    $ErrorActionPreference = "Continue"
    $output = & $psql --no-psqlrc --set=ON_ERROR_STOP=1 --host=127.0.0.1 --port=$($connection.port) --username=$($connection.user) --dbname=$($connection.database) --tuples-only --no-align --command=$Sql 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
    $env:PGPASSWORD = $previousPassword
  }
  if ($ExpectFailure) {
    if ($exitCode -eq 0) { throw "A forbidden database operation unexpectedly succeeded" }
  } elseif ($exitCode -ne 0) {
    throw "A database proof query failed"
  }
  return ($output -join "`n").Trim()
}

function Get-ExactDirectoryAclEvidence {
  param(
    [string] $Path,
    [string[]] $ExpectedSids
  )

  $acl = Get-Acl -LiteralPath $Path
  $rules = @($acl.Access | ForEach-Object {
    $sid = try {
      $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    } catch {
      $_.IdentityReference.Value
    }
    [ordered]@{
      sid = $sid
      accessControlType = $_.AccessControlType.ToString()
      fileSystemRights = [int] $_.FileSystemRights
      inheritanceFlags = [int] $_.InheritanceFlags
      propagationFlags = [int] $_.PropagationFlags
      inherited = [bool] $_.IsInherited
    }
  })
  $expectedInheritance = [int] (
    [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
  )
  $unexpectedRules = @($rules | Where-Object {
    $_.sid -notin $ExpectedSids -or
    $_.accessControlType -ne "Allow" -or
    $_.fileSystemRights -ne [int] [Security.AccessControl.FileSystemRights]::FullControl -or
    $_.inheritanceFlags -ne $expectedInheritance -or
    $_.propagationFlags -ne [int] [Security.AccessControl.PropagationFlags]::None -or
    $_.inherited
  })
  $missingSids = @($ExpectedSids | Where-Object {
    $expectedSid = $_
    @($rules | Where-Object { $_.sid -eq $expectedSid }).Count -ne 1
  })
  return [ordered]@{
    path = $Path
    sddl = $acl.Sddl
    protected = [bool] $acl.AreAccessRulesProtected
    expectedSids = @($ExpectedSids)
    rules = $rules
    exact = $acl.AreAccessRulesProtected -and $unexpectedRules.Count -eq 0 -and $missingSids.Count -eq 0 -and
      $rules.Count -eq $ExpectedSids.Count
  }
}

function Get-PreservationMarker {
  $payloadRoot = Get-PayloadRoot
  $controlData = & (Join-Path $payloadRoot "postgresql\bin\pg_controldata.exe") (Join-Path $dataRoot "postgresql")
  if ($LASTEXITCODE -ne 0) { throw "Could not read PostgreSQL control data" }
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
  $payloadRoot = Get-PayloadRoot
  $controlData = & (Join-Path $payloadRoot "postgresql\bin\pg_controldata.exe") (Join-Path $dataRoot "postgresql")
  if ($LASTEXITCODE -ne 0) { throw "Could not read PostgreSQL control state" }
  $stateLines = @($controlData | Where-Object { $_ -match '^Database cluster state:' })
  if ($stateLines.Count -ne 1) { throw "PostgreSQL control data did not report exactly one cluster state" }
  return ($stateLines[0] -replace '^Database cluster state:\s*', '').Trim()
}

function Test-PreservationMarker {
  param([object] $Expected)
  $installationId = (Get-Content -LiteralPath (Join-Path $dataRoot "config\installation.json") -Raw | ConvertFrom-Json).installationId
  $installationConfigHash = (Get-FileHash -LiteralPath (Join-Path $dataRoot "config\installation.json") -Algorithm SHA256).Hash.ToLowerInvariant()
  $runtimeHash = (Get-FileHash -LiteralPath (Join-Path $dataRoot "config\database-url") -Algorithm SHA256).Hash.ToLowerInvariant()
  $ownerHash = (Get-FileHash -LiteralPath (Join-Path $dataRoot "config\schema-owner-url") -Algorithm SHA256).Hash.ToLowerInvariant()
  $postgresqlConfigHash = (Get-FileHash -LiteralPath (Join-Path $dataRoot "postgresql\postgresql.conf") -Algorithm SHA256).Hash.ToLowerInvariant()
  $postgresqlHbaHash = (Get-FileHash -LiteralPath (Join-Path $dataRoot "postgresql\pg_hba.conf") -Algorithm SHA256).Hash.ToLowerInvariant()
  $baseMatches = $installationId -eq $Expected.installationId -and
    $installationConfigHash -eq $Expected.installationConfigHash -and
    $runtimeHash -eq $Expected.runtimeConfigHash -and
    $ownerHash -eq $Expected.ownerConfigHash -and
    $postgresqlConfigHash -eq $Expected.postgresqlConfigHash -and
    $postgresqlHbaHash -eq $Expected.postgresqlHbaHash -and
    (Get-Content -LiteralPath (Join-Path $dataRoot "postgresql\PG_VERSION") -Raw).Trim() -eq "18"
  if (-not $baseMatches) { return $false }
  if ($null -eq (Get-Service -Name $apiServiceName -ErrorAction SilentlyContinue)) { return $true }
  return (Get-PreservationMarker).databaseSystemIdentifier -eq $Expected.databaseSystemIdentifier
}

function Get-ServiceEvidence {
  param([string] $PayloadRoot)

  $services = foreach ($name in @($apiServiceName, $postgresqlServiceName)) {
    $service = Get-CimInstance Win32_Service -Filter "Name='$name'"
    $serviceRegistry = Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\$name"
    $childExecutablePath = if ($name -eq $apiServiceName) {
      Join-Path $PayloadRoot "node\node.exe"
    } else {
      Join-Path $PayloadRoot "postgresql\bin\postgres.exe"
    }
    $child = Get-CimInstance Win32_Process | Where-Object {
      $_.ParentProcessId -eq $service.ProcessId -and $_.ExecutablePath -eq $childExecutablePath
    } | Select-Object -First 1
    [ordered]@{
      name = $service.Name
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
      expectedChildExecutablePath = $childExecutablePath
    }
  }
  return @($services)
}

function Test-ExactServices {
  param([object[]] $Services)

  return $Services.Count -eq 2 -and
    @($Services | Where-Object {
      $_.state -ne "Running" -or $_.startMode -ne "Auto" -or
      $_.startName -ne "NT SERVICE\$($_.name)" -or $_.dependencies.Count -ne 0 -or
      $_.serviceSidType -ne 3 -or $_.failureActionsOnNonCrashFailures -ne 1 -or
      -not $_.wrapperPathMatches -or $_.childProcessId -eq 0 -or
      $_.childParentProcessId -ne $_.processId -or $_.childExecutablePath -ne $_.expectedChildExecutablePath
    }).Count -eq 0 -and
    @($Services | ForEach-Object { $_.processId } | Select-Object -Unique).Count -eq 2
}

function ConvertTo-CommandLineToken {
  param([string] $Value)
  if ($Value.Contains('"')) { throw "A proof command-line token contains an unsupported quote" }
  return '"' + $Value + '"'
}

function Invoke-ServiceAclProbe {
  param(
    [string] $PayloadRoot,
    [string] $ServiceName,
    [string] $LogName,
    [string] $AllowedPath,
    [string[]] $DeniedPaths
  )

  $originalImagePath = (Get-CimInstance Win32_Service -Filter "Name='$ServiceName'").PathName
  $logRoot = Join-Path $dataRoot "logs\$LogName"
  $probePath = Join-Path $logRoot "issue34-service-acl-probe.ps1"
  $probeOutputPath = Join-Path $logRoot "issue34-service-acl-probe.json"
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot "ServiceAclProbe.ps1") -Destination $probePath -Force
  Remove-Item -LiteralPath $probeOutputPath -Force -ErrorAction SilentlyContinue

  $shawlPath = Join-Path $PayloadRoot "service-wrapper\shawl.exe"
  $powerShellPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  $arguments = @(
    (ConvertTo-CommandLineToken $shawlPath),
    "run", "--name", $ServiceName, "--no-restart",
    "--log-dir", (ConvertTo-CommandLineToken $logRoot),
    "--cwd", (ConvertTo-CommandLineToken $logRoot),
    "--", (ConvertTo-CommandLineToken $powerShellPath),
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", (ConvertTo-CommandLineToken $probePath),
    "-AllowedPath", (ConvertTo-CommandLineToken $AllowedPath),
    "-DeniedPaths", (ConvertTo-CommandLineToken ($DeniedPaths -join "||")),
    "-OutputPath", (ConvertTo-CommandLineToken $probeOutputPath)
  )

  $probeResult = $null
  $probeFailure = $null
  $cleanupErrors = [Collections.Generic.List[string]]::new()
  try {
    Stop-Service -Name $ServiceName
    (Get-Service -Name $ServiceName).WaitForStatus("Stopped", [TimeSpan]::FromSeconds(75))
    & sc.exe failure $ServiceName "reset=" "86400" "actions=" "none/0/none/0/none/0" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not suspend $ServiceName recovery for its bounded ACL probe" }
    & sc.exe failureflag $ServiceName "0" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not suspend $ServiceName non-crash recovery for its bounded ACL probe" }
    $probeCommandChange = Invoke-CimMethod -InputObject (Get-CimInstance Win32_Service -Filter "Name='$ServiceName'") `
      -MethodName Change -Arguments @{ PathName = ($arguments -join " ") }
    if ($probeCommandChange.ReturnValue -ne 0) {
      throw "Could not configure the $ServiceName ACL probe through SCM; Win32_Service.Change returned $($probeCommandChange.ReturnValue)"
    }
    Start-Service -Name $ServiceName
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    while ([DateTime]::UtcNow -lt $deadline -and -not (Test-Path -LiteralPath $probeOutputPath -PathType Leaf)) {
      Start-Sleep -Milliseconds 250
    }
    if (-not (Test-Path -LiteralPath $probeOutputPath -PathType Leaf)) {
      throw "The $ServiceName identity ACL probe did not produce a result"
    }
    $probeResult = Get-Content -LiteralPath $probeOutputPath -Raw | ConvertFrom-Json
  } catch {
    $probeFailure = $_
  } finally {
    try {
      Stop-Service -Name $ServiceName -Force -ErrorAction Stop
      (Get-Service -Name $ServiceName).WaitForStatus("Stopped", [TimeSpan]::FromSeconds(75))
    } catch {
      $cleanupErrors.Add("stop: $($_.Exception.Message)")
    }
    $commandRestored = $false
    try {
      $restoreCommandChange = Invoke-CimMethod -InputObject (Get-CimInstance Win32_Service -Filter "Name='$ServiceName'") `
        -MethodName Change -Arguments @{ PathName = $originalImagePath }
      if ($restoreCommandChange.ReturnValue -ne 0) {
        throw "Win32_Service.Change returned $($restoreCommandChange.ReturnValue)"
      }
      $commandRestored = $true
    } catch {
      $cleanupErrors.Add("command: $($_.Exception.Message)")
    }
    try {
      & sc.exe failure $ServiceName "reset=" "86400" "actions=" "restart/5000/restart/15000/restart/30000" | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "sc.exe exited with $LASTEXITCODE" }
    } catch {
      $cleanupErrors.Add("recovery: $($_.Exception.Message)")
    }
    try {
      & sc.exe failureflag $ServiceName "1" | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "sc.exe exited with $LASTEXITCODE" }
    } catch {
      $cleanupErrors.Add("non-crash recovery: $($_.Exception.Message)")
    }
    if ($commandRestored) {
      try {
        Start-Service -Name $ServiceName
        Wait-Healthy | Out-Null
      } catch {
        $cleanupErrors.Add("restart: $($_.Exception.Message)")
      }
    }
    try {
      Remove-Item -LiteralPath $probePath -Force -ErrorAction Stop
    } catch {
      $cleanupErrors.Add("probe removal: $($_.Exception.Message)")
    }
  }
  if ($cleanupErrors.Count -gt 0) {
    $originalMessage = if ($null -eq $probeFailure) { "ACL probe completed" } else { $probeFailure.Exception.Message }
    throw "$originalMessage; $ServiceName restoration failed: $($cleanupErrors -join '; ')"
  }
  if ($null -ne $probeFailure) { throw $probeFailure }
  if ($null -eq $probeResult) { throw "The $ServiceName ACL probe produced no result" }
  return $probeResult
}

function Assert-Witness {
  param([string] $WitnessId)
  $count = Invoke-Psql -Role runtime -Sql "SELECT count(*) FROM public.issue34_witness WHERE id = '$WitnessId';"
  return $count -eq "1"
}

function Wait-ServiceProcess {
  param(
    [string] $ExecutableName,
    [int] $PreviousProcessId,
    [int] $ParentProcessId,
    [string] $ExecutablePath,
    [int] $TimeoutSeconds = 60
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    $process = Get-CimInstance Win32_Process -Filter "Name='$ExecutableName'" | Where-Object {
      $_.ProcessId -ne $PreviousProcessId -and
      $_.ParentProcessId -eq $ParentProcessId -and
      $_.ExecutablePath -eq $ExecutablePath
    } | Select-Object -First 1
    if ($null -ne $process) { return $process }
    Start-Sleep -Milliseconds 250
  }
  throw "$ExecutableName was not restarted"
}

function Wait-ServiceWrapperRestart {
  param(
    [string] $ServiceName,
    [int] $PreviousProcessId,
    [int] $TimeoutSeconds = 90
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    $service = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'"
    if ($service.State -eq "Running" -and $service.ProcessId -ne 0 -and $service.ProcessId -ne $PreviousProcessId) {
      return $service
    }
    Start-Sleep -Milliseconds 250
  }
  throw "The SCM did not recover $ServiceName after its wrapper process crashed"
}

function Get-ProcessTreeIds {
  param([int] $RootProcessId)

  $all = @(Get-CimInstance Win32_Process)
  $found = [Collections.Generic.List[int]]::new()
  $pending = [Collections.Generic.Queue[int]]::new()
  $pending.Enqueue($RootProcessId)
  while ($pending.Count -gt 0) {
    $processId = $pending.Dequeue()
    if (-not $found.Contains($processId)) {
      $found.Add($processId)
      $all | Where-Object { $_.ParentProcessId -eq $processId } | ForEach-Object { $pending.Enqueue([int] $_.ProcessId) }
    }
  }
  return @($found)
}

function Wait-ProcessTreeExit {
  param([int[]] $ProcessIds, [int] $TimeoutSeconds = 30)

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    $live = @(Get-Process -Id $ProcessIds -ErrorAction SilentlyContinue)
    if ($live.Count -eq 0) { return $true }
    Start-Sleep -Milliseconds 200
  }
  return $false
}

function Get-BreevInstalledProducts {
  return @(@(
    Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue
    Get-ItemProperty "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue
  ) | Where-Object {
    $displayName = $_.PSObject.Properties["DisplayName"]
    $displayVersion = $_.PSObject.Properties["DisplayVersion"]
    $publisher = $_.PSObject.Properties["Publisher"]
    $null -ne $displayName -and $null -ne $displayVersion -and $null -ne $publisher -and
      $displayVersion.Value -match '^\d+\.\d+\.\d+$' -and
      $displayName.Value -eq "Breev $($displayVersion.Value)" -and
      $publisher.Value -eq "Breev"
  })
}

function Get-UninstallerPath {
  $entries = @((Get-BreevInstalledProducts) | Where-Object {
    -not [string]::IsNullOrWhiteSpace($_.UninstallString)
  } | Select-Object -ExpandProperty UninstallString -Unique)
  if ($entries.Count -ne 1) { throw "Could not identify exactly one Breev uninstaller" }
  $match = [regex]::Match($entries[0], '^"?([^"].*?\.exe)"?(?:\s|$)')
  if (-not $match.Success) { throw "The Breev uninstall command is invalid" }
  return $match.Groups[1].Value
}

function Get-InstalledVersion {
  $entries = @(Get-BreevInstalledProducts)
  if ($entries.Count -ne 1) { throw "Could not identify exactly one installed Breev product" }
  return $entries[0].DisplayVersion
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
  if ($files.Count -eq 0) { throw "The installed Builder candidate contains no signable files" }
  $productExecutables = @($files | Where-Object {
    [IO.Path]::GetExtension($_.path).ToLowerInvariant() -eq ".exe" -and
      [IO.Path]::GetDirectoryName($_.path).TrimEnd('\') -eq $normalizedRoot
  })
  return [ordered]@{
    root = $Root
    files = $files
    allSignaturesValid = @($files | Where-Object { $_.signatureStatus -ne "Valid" }).Count -eq 0
    productExecutables = $productExecutables
    productExecutablesSignedByExpectedCertificate = $productExecutables.Count -ge 2 -and
      @($productExecutables | Where-Object { $_.signerThumbprint -ne $ExpectedSignerThumbprint }).Count -eq 0
  }
}

function Wait-NoBreevListeners {
  param([int] $TimeoutSeconds = 30)

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in @(31310, 31311) })
    if ($listeners.Count -eq 0) { return $true }
    Start-Sleep -Milliseconds 200
  } while ([DateTime]::UtcNow -lt $deadline)
  return $false
}

Assert-Administrator
if (-not $DisposableEnvironmentAcknowledged) {
  throw "Refusing destructive lifecycle tests without -DisposableEnvironmentAcknowledged"
}
$InstallerPath = [IO.Path]::GetFullPath($InstallerPath)
$UpdateInstallerPath = [IO.Path]::GetFullPath($UpdateInstallerPath)
$OutputPath = [IO.Path]::GetFullPath($OutputPath)
$ExpectedSignerThumbprint = $ExpectedSignerThumbprint.Replace(" ", "").ToUpperInvariant()
foreach ($path in @($InstallerPath, $UpdateInstallerPath)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "A required installer is missing" }
}
$result["artifacts"] = [ordered]@{
  installer = [ordered]@{ version = $InstallerVersion; sha256 = (Get-FileHash -LiteralPath $InstallerPath -Algorithm SHA256).Hash.ToLowerInvariant() }
  updateInstaller = [ordered]@{ version = $UpdateInstallerVersion; sha256 = (Get-FileHash -LiteralPath $UpdateInstallerPath -Algorithm SHA256).Hash.ToLowerInvariant() }
}
foreach ($version in @($InstallerVersion, $UpdateInstallerVersion)) {
  if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "Installer versions must be three-part semantic versions" }
}
if (([version] $InstallerVersion) -ge ([version] $UpdateInstallerVersion)) {
  throw "The update installer version must be greater than the clean installer version"
}
if ($InstallerVersion -ne "0.0.0" -or $UpdateInstallerVersion -ne "0.0.1") {
  throw "The correlated issue-34 proof versions must be 0.0.0 and 0.0.1"
}

try {
  $machineGate = Get-MachineGate
  $result["machine"] = $machineGate.facts
  $result.certificationEligible = [bool] $machineGate.eligible
  if (-not $machineGate.eligible -and -not $DevelopmentOnly) {
    throw "This machine is not an eligible Windows 11 Pro 25H2 certification candidate"
  }
  Add-Check -Name "supported-machine-gate" -Passed ($machineGate.eligible -or $DevelopmentOnly) -Details $machineGate

  Add-Check -Name "clean-snapshot" -Passed (
    -not (Test-Path -LiteralPath $dataRoot) -and
    -not (Test-Path -LiteralPath (Join-Path $env:ProgramFiles "Breev")) -and
    @(Get-BreevInstalledProducts).Count -eq 0 -and
    $null -eq (Get-Service -Name $apiServiceName -ErrorAction SilentlyContinue) -and
    $null -eq (Get-Service -Name $postgresqlServiceName -ErrorAction SilentlyContinue)
  )

  Invoke-Installer -Path $InstallerPath | Out-Null
  $health = Wait-Healthy
  Add-Check -Name "clean-install-version" -Passed ((Get-InstalledVersion) -eq $InstallerVersion) -Details @{ expected = $InstallerVersion; actual = (Get-InstalledVersion) }
  $installRoot = Join-Path $env:ProgramFiles "Breev"
  $result.signing["expectedSignerThumbprint"] = $ExpectedSignerThumbprint
  $result.signing["afterInstall"] = Get-InstalledSigningCoverage -Root $installRoot
  Add-Check -Name "installed-files-signed-after-clean-install" -Passed (
    $result.signing.afterInstall.allSignaturesValid -and
    $result.signing.afterInstall.productExecutablesSignedByExpectedCertificate
  ) -Details $result.signing.afterInstall
  $payloadRoot = Get-PayloadRoot
  $serviceEvidence = Get-ServiceEvidence -PayloadRoot $payloadRoot
  Add-Check -Name "independent-auto-services" -Passed (
    Test-ExactServices -Services @($serviceEvidence)
  ) -Details $serviceEvidence

  $payloadManifest = Get-Content -LiteralPath (Join-Path $payloadRoot "payload-manifest.json") -Raw | ConvertFrom-Json
  $payloadLock = Get-Content -LiteralPath (Join-Path $payloadRoot "payload-lock.json") -Raw | ConvertFrom-Json
  $runtimeHashes = [Collections.Generic.List[object]]::new()
  $runtimeProvenance = [Collections.Generic.List[object]]::new()
  foreach ($component in $payloadManifest.components) {
    $lockedComponents = @($payloadLock.components | Where-Object { $_.name -eq $component.name })
    $provenanceMatches = $lockedComponents.Count -eq 1 -and
      $lockedComponents[0].version -eq $component.version -and
      $lockedComponents[0].archive -eq $component.archive -and
      $lockedComponents[0].sha256 -eq $component.sha256 -and
      @($lockedComponents[0].executableHashes.PSObject.Properties | Where-Object {
        $manifestHash = $component.sourceExecutableHashes.PSObject.Properties[$_.Name]
        $null -eq $manifestHash -or $manifestHash.Value -ne $_.Value
      }).Count -eq 0
    $runtimeProvenance.Add([ordered]@{ name = $component.name; passed = $provenanceMatches })
    $componentRoot = if ($component.name -eq "shawl") { "service-wrapper" } else { $component.name }
    foreach ($executable in $component.executableHashes.PSObject.Properties) {
      $installedPath = Join-Path (Join-Path $payloadRoot $componentRoot) $executable.Name
      $actualHash = (Get-FileHash -LiteralPath $installedPath -Algorithm SHA256).Hash.ToLowerInvariant()
      $runtimeHashes.Add([ordered]@{ path = $installedPath; expected = $executable.Value; actual = $actualHash; passed = $actualHash -eq $executable.Value })
    }
  }
  Add-Check -Name "pinned-runtime-set" -Passed (
    $payloadManifest.components[0].version -eq "24.19.0" -and
    $payloadManifest.components[1].version -eq "18.6-1" -and
    $payloadManifest.components[2].version -eq "1.9.0" -and
    @($runtimeProvenance | Where-Object { -not $_.passed }).Count -eq 0 -and
    @($runtimeHashes | Where-Object { -not $_.passed }).Count -eq 0
  ) -Details @{ components = $payloadManifest.components; provenance = $runtimeProvenance; executableHashes = $runtimeHashes }

  $postgresqlServiceSid = ([Security.Principal.NTAccount]::new("NT SERVICE\$postgresqlServiceName")).Translate(
    [Security.Principal.SecurityIdentifier]
  ).Value
  $postgresqlAclExpectedSids = @("S-1-5-18", "S-1-5-32-544", $postgresqlServiceSid)
  $postgresqlAclEvidence = Get-ExactDirectoryAclEvidence `
    -Path (Join-Path $dataRoot "postgresql") `
    -ExpectedSids $postgresqlAclExpectedSids
  Add-Check -Name "dedicated-protected-postgresql-data-directory" -Passed (
    $postgresqlAclEvidence.exact
  ) -Details $postgresqlAclEvidence

  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 31311 | Select-Object LocalAddress, LocalPort, OwningProcess)
  Add-Check -Name "postgresql-loopback-listeners" -Passed (
    $listeners.Count -gt 0 -and
    @($listeners | Where-Object { $_.LocalAddress -notin @("127.0.0.1", "::1") }).Count -eq 0
  ) -Details $listeners

  $roleRows = Invoke-Psql -Role schema-owner -Sql "SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolreplication, rolbypassrls FROM pg_roles WHERE rolname IN ('breev_app','breev_schema_owner') ORDER BY rolname;"
  $roleMembershipRows = Invoke-Psql -Role schema-owner -Sql "SELECT member_role.rolname || '|' || granted_role.rolname FROM pg_auth_members membership JOIN pg_roles member_role ON member_role.oid = membership.member JOIN pg_roles granted_role ON granted_role.oid = membership.roleid WHERE member_role.rolname IN ('breev_app','breev_schema_owner') ORDER BY member_role.rolname, granted_role.rolname;"
  Add-Check -Name "separate-least-privilege-database-roles" -Passed (
    $roleRows -match 'breev_app\|f\|f\|f\|f\|f\|f' -and
    $roleRows -match 'breev_schema_owner\|f\|f\|f\|f\|f\|f' -and
    [string]::IsNullOrWhiteSpace($roleMembershipRows)
  ) -Details @{ attributes = $roleRows; memberships = $roleMembershipRows }
  Invoke-Psql -Role runtime -Sql "CREATE TABLE public.issue34_forbidden(id integer);" -ExpectFailure | Out-Null
  Invoke-Psql -Role runtime -Sql "SET ROLE breev_schema_owner;" -ExpectFailure | Out-Null
  Add-Check -Name "runtime-role-cannot-own-or-assume-schema-owner" -Passed $true

  $apiServiceAclProbe = Invoke-ServiceAclProbe -PayloadRoot $payloadRoot -ServiceName $apiServiceName -LogName "local-api" `
    -AllowedPath (Join-Path $dataRoot "config\database-url") `
    -DeniedPaths @((Join-Path $dataRoot "config\schema-owner-url"), (Join-Path $dataRoot "postgresql\PG_VERSION"))
  $postgresqlServiceAclProbe = Invoke-ServiceAclProbe -PayloadRoot $payloadRoot -ServiceName $postgresqlServiceName -LogName "postgresql" `
    -AllowedPath (Join-Path $dataRoot "postgresql\PG_VERSION") `
    -DeniedPaths @((Join-Path $dataRoot "config\database-url"), (Join-Path $payloadRoot "local-api\dist\main.cjs"))
  Add-Check -Name "least-privilege-service-account-boundaries" -Passed (
    $apiServiceAclProbe.passed -and
    $apiServiceAclProbe.identity -eq "NT SERVICE\$apiServiceName" -and
    $apiServiceAclProbe.allowedRead -and
    @($apiServiceAclProbe.deniedReads | Where-Object { -not $_.blocked }).Count -eq 0 -and
    $apiServiceAclProbe.outputWrite -and
    $postgresqlServiceAclProbe.passed -and
    $postgresqlServiceAclProbe.identity -eq "NT SERVICE\$postgresqlServiceName" -and
    $postgresqlServiceAclProbe.allowedRead -and
    @($postgresqlServiceAclProbe.deniedReads | Where-Object { -not $_.blocked }).Count -eq 0 -and
    $postgresqlServiceAclProbe.outputWrite
  ) -Details @{ localApi = $apiServiceAclProbe; postgresql = $postgresqlServiceAclProbe }

  Invoke-Psql -Role schema-owner -Sql "CREATE TABLE public.issue34_witness(id text PRIMARY KEY, value text NOT NULL);" | Out-Null
  $witnessId = [Guid]::NewGuid().ToString()
  Invoke-Psql -Role runtime -Sql "INSERT INTO public.issue34_witness(id, value) VALUES ('$witnessId', 'committed');" | Out-Null
  $preservationMarker = Get-PreservationMarker
  Add-Check -Name "initial-local-cycle" -Passed (Assert-Witness -WitnessId $witnessId) -Details $health

  Stop-Service -Name $postgresqlServiceName
  (Get-Service -Name $postgresqlServiceName).WaitForStatus("Stopped", [TimeSpan]::FromSeconds(60))
  $postgresqlStoppedControlState = Get-PostgresqlControlState
  Add-Check -Name "postgresql-service-stop-clean-shutdown" -Passed (
    $postgresqlStoppedControlState -eq "shut down"
  ) -Details @{ clusterState = $postgresqlStoppedControlState }
  $degraded = Get-HealthResponse
  Add-Check -Name "api-independent-while-postgresql-stopped" -Passed (
    $degraded.statusCode -eq 503 -and $degraded.body.database -eq "unavailable" -and
    (Get-Service -Name $apiServiceName).Status -eq "Running"
  ) -Details $degraded
  Start-Service -Name $postgresqlServiceName
  Wait-Healthy | Out-Null

  $apiWrapper = Get-CimInstance Win32_Service -Filter "Name='$apiServiceName'"
  $nodeProcesses = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
    $_.ParentProcessId -eq $apiWrapper.ProcessId -and $_.ExecutablePath -eq (Join-Path $payloadRoot "node\node.exe")
  })
  if ($nodeProcesses.Count -ne 1) { throw "Could not identify exactly one local API Node service child" }
  $nodeProcess = $nodeProcesses[0]
  Stop-Process -Id $nodeProcess.ProcessId -Force
  $newNodeProcess = Wait-ServiceProcess -ExecutableName "node.exe" -PreviousProcessId $nodeProcess.ProcessId -ParentProcessId $apiWrapper.ProcessId -ExecutablePath (Join-Path $payloadRoot "node\node.exe")
  Wait-Healthy | Out-Null
  Add-Check -Name "api-crash-recovery" -Passed ($newNodeProcess.ProcessId -ne $nodeProcess.ProcessId) -Details @{ before = $nodeProcess.ProcessId; after = $newNodeProcess.ProcessId }

  $apiWrapperBefore = Get-CimInstance Win32_Service -Filter "Name='$apiServiceName'"
  $apiOldTree = Get-ProcessTreeIds -RootProcessId $apiWrapperBefore.ProcessId
  Stop-Process -Id $apiWrapperBefore.ProcessId -Force
  $apiWrapperAfter = Wait-ServiceWrapperRestart -ServiceName $apiServiceName -PreviousProcessId $apiWrapperBefore.ProcessId
  $apiOldTreeExited = Wait-ProcessTreeExit -ProcessIds $apiOldTree
  $apiChildAfterWrapperCrash = Wait-ServiceProcess -ExecutableName "node.exe" -PreviousProcessId $newNodeProcess.ProcessId -ParentProcessId $apiWrapperAfter.ProcessId -ExecutablePath (Join-Path $payloadRoot "node\node.exe")
  Wait-Healthy | Out-Null
  Add-Check -Name "api-wrapper-crash-recovery" -Passed (
    $apiWrapperAfter.ProcessId -ne $apiWrapperBefore.ProcessId -and
    $apiOldTreeExited -and
    $apiChildAfterWrapperCrash.ParentProcessId -eq $apiWrapperAfter.ProcessId
  ) -Details @{ before = $apiWrapperBefore.ProcessId; oldTree = $apiOldTree; oldTreeExited = $apiOldTreeExited; after = $apiWrapperAfter.ProcessId; newChild = $apiChildAfterWrapperCrash.ProcessId }

  $transactionId = [Guid]::NewGuid().ToString()
  $transactionSqlPath = Join-Path $dataRoot "state\issue-34-mid-transaction.sql"
  @("BEGIN;", "INSERT INTO public.issue34_witness(id, value) VALUES ('$transactionId', 'must-roll-back');", "SELECT pg_sleep(120);", "COMMIT;") | Set-Content -LiteralPath $transactionSqlPath -Encoding ASCII
  $runtime = Read-DatabaseConnection -Role runtime
  $previousPassword = $env:PGPASSWORD
  $previousApplicationName = $env:PGAPPNAME
  try {
    $env:PGPASSWORD = $runtime.password
    $env:PGAPPNAME = "breev-issue-34-mid-transaction"
    $psqlPath = Join-Path $payloadRoot "postgresql\bin\psql.exe"
    $psqlArguments = "--no-psqlrc --set=ON_ERROR_STOP=1 --host=127.0.0.1 --port=$($runtime.port) --username=$($runtime.user) --dbname=$($runtime.database) --file=`"$transactionSqlPath`""
    $transactionProcess = Start-Process -FilePath $psqlPath -ArgumentList $psqlArguments -PassThru -WindowStyle Hidden
  } finally {
    $env:PGPASSWORD = $previousPassword
    $env:PGAPPNAME = $previousApplicationName
  }
  $transactionActive = $false
  $transactionDeadline = [DateTime]::UtcNow.AddSeconds(15)
  while ([DateTime]::UtcNow -lt $transactionDeadline) {
    if ((Invoke-Psql -Role runtime -Sql "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'breev-issue-34-mid-transaction' AND state = 'active';") -eq "1") {
      $transactionActive = $true
      break
    }
    Start-Sleep -Milliseconds 200
  }
  if (-not $transactionActive) {
    Stop-Process -Id $transactionProcess.Id -Force -ErrorAction SilentlyContinue
    throw "The interrupted transaction never reached its active seam"
  }
  $postgresqlWrapper = Get-CimInstance Win32_Service -Filter "Name='$postgresqlServiceName'"
  $postgresqlMainProcesses = @(Get-CimInstance Win32_Process -Filter "Name='postgres.exe'" | Where-Object {
    $_.ParentProcessId -eq $postgresqlWrapper.ProcessId -and $_.ExecutablePath -eq (Join-Path $payloadRoot "postgresql\bin\postgres.exe")
  })
  if ($postgresqlMainProcesses.Count -ne 1) { throw "Could not identify exactly one PostgreSQL main service child" }
  $postgresqlMain = $postgresqlMainProcesses[0]
  Stop-Process -Id $postgresqlMain.ProcessId -Force
  $newPostgresqlMain = Wait-ServiceProcess -ExecutableName "postgres.exe" -PreviousProcessId $postgresqlMain.ProcessId -ParentProcessId $postgresqlWrapper.ProcessId -ExecutablePath (Join-Path $payloadRoot "postgresql\bin\postgres.exe")
  Wait-Healthy | Out-Null
  if (-not $transactionProcess.WaitForExit(30000)) {
    Stop-Process -Id $transactionProcess.Id -Force
    throw "The interrupted transaction client did not exit"
  }
  $rolledBackCount = Invoke-Psql -Role runtime -Sql "SELECT count(*) FROM public.issue34_witness WHERE id = '$transactionId';"
  Add-Check -Name "restart-mid-transaction-is-atomic" -Passed (
    $rolledBackCount -eq "0" -and (Assert-Witness -WitnessId $witnessId)
  ) -Details @{ terminatedProcessId = $postgresqlMain.ProcessId; transactionExitCode = $transactionProcess.ExitCode }
  Remove-Item -LiteralPath $transactionSqlPath -Force

  $postgresqlWrapperBefore = Get-CimInstance Win32_Service -Filter "Name='$postgresqlServiceName'"
  $postgresqlOldTree = Get-ProcessTreeIds -RootProcessId $postgresqlWrapperBefore.ProcessId
  Stop-Process -Id $postgresqlWrapperBefore.ProcessId -Force
  $postgresqlWrapperAfter = Wait-ServiceWrapperRestart -ServiceName $postgresqlServiceName -PreviousProcessId $postgresqlWrapperBefore.ProcessId
  $postgresqlOldTreeExited = Wait-ProcessTreeExit -ProcessIds $postgresqlOldTree
  $postgresqlChildAfterWrapperCrash = Wait-ServiceProcess -ExecutableName "postgres.exe" -PreviousProcessId $newPostgresqlMain.ProcessId -ParentProcessId $postgresqlWrapperAfter.ProcessId -ExecutablePath (Join-Path $payloadRoot "postgresql\bin\postgres.exe")
  Wait-Healthy | Out-Null
  Add-Check -Name "postgresql-wrapper-crash-recovery" -Passed (
    $postgresqlWrapperAfter.ProcessId -ne $postgresqlWrapperBefore.ProcessId -and
    $postgresqlOldTreeExited -and
    $postgresqlChildAfterWrapperCrash.ParentProcessId -eq $postgresqlWrapperAfter.ProcessId -and
    (Assert-Witness -WitnessId $witnessId)
  ) -Details @{ before = $postgresqlWrapperBefore.ProcessId; oldTree = $postgresqlOldTree; oldTreeExited = $postgresqlOldTreeExited; after = $postgresqlWrapperAfter.ProcessId; newChild = $postgresqlChildAfterWrapperCrash.ProcessId }

  $apiEntryPath = Join-Path $payloadRoot "local-api\dist\main.cjs"
  $apiEntryHash = (Get-FileHash -LiteralPath $apiEntryPath -Algorithm SHA256).Hash.ToLowerInvariant()
  Stop-Service -Name $apiServiceName
  Add-Content -LiteralPath $apiEntryPath -Value "`n// issue-34 intentional repair corruption" -Encoding UTF8
  $corruptedApiEntryHash = (Get-FileHash -LiteralPath $apiEntryPath -Algorithm SHA256).Hash.ToLowerInvariant()
  Add-Check -Name "repair-seam-corruption-created" -Passed ($corruptedApiEntryHash -ne $apiEntryHash)
  $unexpectedAclSid = "S-1-5-32-546"
  $postgresqlDataRoot = Join-Path $dataRoot "postgresql"
  $unexpectedChildAclPath = Join-Path $postgresqlDataRoot "PG_VERSION"
  & icacls.exe $postgresqlDataRoot "/grant" "*${unexpectedAclSid}:(RX)" "/Q" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not create the intentional repair ACL seam" }
  & icacls.exe $unexpectedChildAclPath "/grant" "*${unexpectedAclSid}:R" "/Q" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not create the intentional descendant repair ACL seam" }
  $unexpectedAclEvidence = Get-ExactDirectoryAclEvidence `
    -Path $postgresqlDataRoot `
    -ExpectedSids $postgresqlAclExpectedSids
  $unexpectedChildAclSids = @((Get-Acl -LiteralPath $unexpectedChildAclPath).Access | ForEach-Object {
    $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
  })
  Add-Check -Name "repair-seam-unexpected-access-created" -Passed (
    -not $unexpectedAclEvidence.exact -and
    @($unexpectedAclEvidence.rules | Where-Object { $_.sid -eq $unexpectedAclSid }).Count -eq 1 -and
    $unexpectedAclSid -in $unexpectedChildAclSids
  ) -Details @{ root = $unexpectedAclEvidence; descendant = $unexpectedChildAclPath; descendantSids = $unexpectedChildAclSids }
  Invoke-Installer -Path $InstallerPath -Repair | Out-Null
  Wait-Healthy | Out-Null
  Add-Check -Name "repair-restores-corrupted-binary" -Passed (
    (Get-FileHash -LiteralPath $apiEntryPath -Algorithm SHA256).Hash.ToLowerInvariant() -eq $apiEntryHash
  )
  Add-Check -Name "repair-preserves-data-and-configuration" -Passed (
    (Test-PreservationMarker -Expected $preservationMarker) -and (Assert-Witness -WitnessId $witnessId)
  )
  $repairedAclEvidence = Get-ExactDirectoryAclEvidence `
    -Path $postgresqlDataRoot `
    -ExpectedSids $postgresqlAclExpectedSids
  $repairedChildAclSids = @((Get-Acl -LiteralPath $unexpectedChildAclPath).Access | ForEach-Object {
    $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
  })
  Add-Check -Name "repair-removes-unexpected-access" -Passed (
    $repairedAclEvidence.exact -and
    @($repairedAclEvidence.rules | Where-Object { $_.sid -eq $unexpectedAclSid }).Count -eq 0 -and
    $unexpectedAclSid -notin $repairedChildAclSids
  ) -Details @{ root = $repairedAclEvidence; descendant = $unexpectedChildAclPath; descendantSids = $repairedChildAclSids }
  $result.signing["afterRepair"] = Get-InstalledSigningCoverage -Root $installRoot
  Add-Check -Name "installed-files-signed-after-repair" -Passed (
    $result.signing.afterRepair.allSignaturesValid -and
    $result.signing.afterRepair.productExecutablesSignedByExpectedCertificate
  ) -Details $result.signing.afterRepair

  foreach ($failurePoint in @("AfterDataPrepared", "AfterPostgreSqlService", "AfterApiService", "BeforeReadiness")) {
    $failureExitCode = Invoke-Installer -Path $InstallerPath -InjectFailure $failurePoint -ExpectFailure
    $failureEvidence = Get-InjectedLifecycleFailureEvidence -ExpectedFailurePoint $failurePoint
    Add-Check -Name "failed-install-$failurePoint-preserves-data-and-configuration" -Passed (
      $failureEvidence.matched -and (Test-PreservationMarker -Expected $preservationMarker)
    ) -Details @{ exitCode = $failureExitCode; lifecycle = $failureEvidence }
    Invoke-Installer -Path $InstallerPath | Out-Null
    Wait-Healthy | Out-Null
    Add-Check -Name "failed-install-$failurePoint-recovers" -Passed (Assert-Witness -WitnessId $witnessId)
  }

  $preUpdateServiceEvidence = Get-ServiceEvidence -PayloadRoot $payloadRoot
  $preUpdateProcessIds = @($preUpdateServiceEvidence | ForEach-Object {
    Get-ProcessTreeIds -RootProcessId $_.processId
  } | Sort-Object -Unique)
  $updateStartedAtUtc = [DateTime]::UtcNow
  Invoke-Installer -Path $UpdateInstallerPath | Out-Null
  Wait-Healthy | Out-Null
  Add-Check -Name "installer-update-version" -Passed ((Get-InstalledVersion) -eq $UpdateInstallerVersion) -Details @{ expected = $UpdateInstallerVersion; actual = (Get-InstalledVersion) }
  $postUpdatePayloadRoot = Get-PayloadRoot
  $postUpdateServiceEvidence = Get-ServiceEvidence -PayloadRoot $postUpdatePayloadRoot
  $updateTreeExited = Wait-ProcessTreeExit -ProcessIds $preUpdateProcessIds
  $updateLifecycle = Get-Content -LiteralPath (Join-Path $dataRoot "state\lifecycle.json") -Raw | ConvertFrom-Json
  $updateLifecycleMatched = $updateLifecycle.action -eq "Install" -and
    $updateLifecycle.status -eq "healthy" -and
    [string]::IsNullOrEmpty($updateLifecycle.failurePoint) -and
    [DateTime]::Parse($updateLifecycle.completedAtUtc).ToUniversalTime() -ge $updateStartedAtUtc
  Add-Check -Name "installer-update-replaces-service-trees" -Passed (
    $updateTreeExited -and
    (Test-ExactServices -Services @($postUpdateServiceEvidence)) -and
    @($postUpdateServiceEvidence | Where-Object {
      $_.processId -in $preUpdateProcessIds -or $_.childProcessId -in $preUpdateProcessIds
    }).Count -eq 0 -and
    $updateLifecycleMatched
  ) -Details @{
    before = $preUpdateServiceEvidence
    previousProcessIds = $preUpdateProcessIds
    previousTreesExited = $updateTreeExited
    after = $postUpdateServiceEvidence
    lifecycle = $updateLifecycle
  }
  $payloadRoot = $postUpdatePayloadRoot
  Add-Check -Name "installer-update-preserves-data-and-configuration" -Passed (
    (Test-PreservationMarker -Expected $preservationMarker) -and (Assert-Witness -WitnessId $witnessId)
  )
  $result.signing["afterUpdate"] = Get-InstalledSigningCoverage -Root $installRoot
  Add-Check -Name "installed-files-signed-after-update" -Passed (
    $result.signing.afterUpdate.allSignaturesValid -and
    $result.signing.afterUpdate.productExecutablesSignedByExpectedCertificate
  ) -Details $result.signing.afterUpdate

  $uninstallerPath = Get-UninstallerPath
  $preUninstallServices = Get-ServiceEvidence -PayloadRoot $payloadRoot
  $preUninstallProcessIds = @($preUninstallServices | ForEach-Object {
    Get-ProcessTreeIds -RootProcessId $_.processId
  } | Sort-Object -Unique)
  $uninstallProcess = Start-Process -FilePath $uninstallerPath -ArgumentList @("/S", "/allusers") -Wait -PassThru
  $uninstallTreeExited = Wait-ProcessTreeExit -ProcessIds $preUninstallProcessIds
  $uninstallPortsClosed = Wait-NoBreevListeners
  $remainingListeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in @(31310, 31311) } | Select-Object LocalAddress, LocalPort, OwningProcess)
  Add-Check -Name "uninstall-completes" -Passed (
    $uninstallProcess.ExitCode -eq 0 -and
    $uninstallTreeExited -and $uninstallPortsClosed -and
    $null -eq (Get-Service -Name $apiServiceName -ErrorAction SilentlyContinue) -and
    $null -eq (Get-Service -Name $postgresqlServiceName -ErrorAction SilentlyContinue) -and
    -not (Test-Path -LiteralPath (Join-Path $env:ProgramFiles "Breev")) -and
    @(Get-BreevInstalledProducts).Count -eq 0
  ) -Details @{ exitCode = $uninstallProcess.ExitCode; serviceTreesBefore = $preUninstallProcessIds; serviceTreesExited = $uninstallTreeExited; remainingListeners = $remainingListeners }
  Add-Check -Name "uninstall-preserves-data-and-configuration" -Passed (Test-PreservationMarker -Expected $preservationMarker)

  Invoke-Installer -Path $UpdateInstallerPath | Out-Null
  Wait-Healthy | Out-Null
  $reinstalledServiceEvidence = Get-ServiceEvidence -PayloadRoot (Get-PayloadRoot)
  $reinstalledServicesAreExact = (Test-ExactServices -Services @($reinstalledServiceEvidence)) -and
    @($reinstalledServiceEvidence | Where-Object {
      $_.processId -in $preUninstallProcessIds -or $_.childProcessId -in $preUninstallProcessIds
    }).Count -eq 0
  $result.signing["afterReinstall"] = Get-InstalledSigningCoverage -Root $installRoot
  Add-Check -Name "installed-files-signed-after-reinstall" -Passed (
    $result.signing.afterReinstall.allSignaturesValid -and
    $result.signing.afterReinstall.productExecutablesSignedByExpectedCertificate
  ) -Details $result.signing.afterReinstall
  Add-Check -Name "reinstall-opens-preserved-data" -Passed (
    $reinstalledServicesAreExact -and
    (Test-PreservationMarker -Expected $preservationMarker) -and
    (Assert-Witness -WitnessId $witnessId)
  ) -Details @{ services = $reinstalledServiceEvidence; previousProcessIds = $preUninstallProcessIds }

  $result.passed = @($checks | Where-Object { -not $_.passed }).Count -eq 0
} catch {
  $result["error"] = $_.Exception.Message
} finally {
  $result["completedAtUtc"] = [DateTime]::UtcNow.ToString("o")
  $outputRoot = Split-Path -Parent $OutputPath
  New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
  $result | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
}

if (-not $result.passed) {
  throw "The installed-runtime proof failed. See $OutputPath"
}
Write-Output $OutputPath
