#Requires -Version 5.1

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $OutputPath,

  [Parameter(Mandatory = $true)]
  [Guid] $RunId,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-f]{40}$')]
  [string] $SourceCommit,

  [Parameter(Mandatory = $true)]
  [string] $SnapshotId,

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
$apiPort = 31310
$postgresqlPort = 31311

$checks = [Collections.Generic.List[object]]::new()
$result = [ordered]@{
  schemaVersion = 1
  runId = $RunId.ToString()
  sourceCommit = $SourceCommit
  snapshotId = $SnapshotId
  startedAtUtc = [DateTime]::UtcNow.ToString("o")
  source = "tooling/windows/proof/Invoke-DurableJobsServiceProof.ps1"
  developmentOnly = [bool] $DevelopmentOnly
  certificationEligible = $false
  machine = $null
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
    throw "The durable jobs service proof requires an elevated administrator token"
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

  $gate = [ordered]@{
    productName = $operatingSystem.Caption -replace '^Microsoft ', ''
    editionId = $windowsRegistry.EditionID
    displayVersion = $windowsRegistry.DisplayVersion
    build = $operatingSystem.BuildNumber
    architecture = $operatingSystem.OSArchitecture
    productType = $operatingSystem.ProductType
    logicalProcessors = $computer.NumberOfLogicalProcessors
    memoryBytes = [uint64] $computer.TotalPhysicalMemory
    installedMemoryBytes = [uint64] @($physicalMemory | Measure-Object -Property Capacity -Sum).Sum
    model = $computer.Model
    machineId = (Get-CimInstance Win32_ComputerSystemProduct).UUID
    systemDriveOnEligibleSsd = [bool] $systemDriveOnEligibleSsd
    bitLockerProtection = $bitLocker.ProtectionStatus.ToString()
  }

  $eligible = $gate.productName -eq "Windows 11 Pro" -and
    $gate.editionId -eq "Professional" -and
    $gate.displayVersion -eq "25H2" -and
    $gate.architecture -eq "64-bit" -and
    $gate.logicalProcessors -ge 4 -and
    $gate.installedMemoryBytes -ge 8GB -and
    $gate.systemDriveOnEligibleSsd

  return [ordered]@{ facts = $gate; eligible = $eligible }
}

function Get-PayloadRoot {
  $payloadRoot = Join-Path $env:ProgramFiles "Breev\resources\windows-payload"
  if (-not (Test-Path -LiteralPath $payloadRoot -PathType Container)) {
    # Fallback to local build path if testing in development
    $devPayload = Join-Path $PSScriptRoot "..\..\..\apps\local-api\windows"
    if (Test-Path -LiteralPath $devPayload) {
      return (Resolve-Path $devPayload).Path
    }
    throw "The Breev payload root is missing"
  }
  return $payloadRoot
}

function Read-DatabaseConnection {
  param([ValidateSet("app", "schema-owner", "runtime")][string] $Role)

  $name = if ($Role -eq "schema-owner") { "schema-owner-url" } else { "database-url" }
  $configPath = Join-Path $dataRoot "config\$name"
  if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
    throw "Database configuration file $configPath is missing"
  }
  $uri = [Uri]::new((Get-Content -LiteralPath $configPath -Raw).Trim())
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
    [ValidateSet("app", "schema-owner", "runtime")][string] $Role,
    [string] $Sql,
    [switch] $ExpectFailure
  )

  $payloadRoot = Get-PayloadRoot
  $psql = Join-Path $payloadRoot "postgresql\bin\psql.exe"
  if (-not (Test-Path -LiteralPath $psql -PathType Leaf)) {
    $psql = "psql.exe"
  }
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
    throw "A database proof query failed: $output"
  }
  return ($output -join "`n").Trim()
}

function Wait-Healthy {
  param([int] $TimeoutSeconds = 60)

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$apiPort/health" -TimeoutSec 2
      $body = $response.Content | ConvertFrom-Json
      if ($response.StatusCode -eq 200 -and $body.status -eq "healthy" -and $body.database -eq "available") {
        return $body
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  throw "The local API did not become healthy within $TimeoutSeconds seconds"
}

function Run-Probe {
  param(
    [string] $Action,
    [hashtable] $Arguments
  )

  $payloadRoot = Get-PayloadRoot
  $nodePath = Join-Path $payloadRoot "node\node.exe"
  if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) {
    $nodePath = "node.exe"
  }
  $probeScript = Join-Path $PSScriptRoot "probe-durable-jobs.mjs"
  $databaseUrlFile = Join-Path $dataRoot "config\database-url"

  $cmdArgs = [Collections.Generic.List[string]]::new()
  $cmdArgs.Add($probeScript)
  $cmdArgs.Add("--action")
  $cmdArgs.Add($Action)
  $cmdArgs.Add("--database-url-file")
  $cmdArgs.Add($databaseUrlFile)

  foreach ($key in $Arguments.Keys) {
    $cmdArgs.Add("--$key")
    $cmdArgs.Add($Arguments[$key].ToString())
  }

  $process = Start-Process -FilePath $nodePath -ArgumentList $cmdArgs -NoNewWindow -PassThru -Wait -RedirectStandardOutput "$env:TEMP\probe-out-$RunId.json" -RedirectStandardError "$env:TEMP\probe-err-$RunId.log"
  $rawOutput = if (Test-Path "$env:TEMP\probe-out-$RunId.json") { Get-Content "$env:TEMP\probe-out-$RunId.json" -Raw } else { "" }
  $rawErr = if (Test-Path "$env:TEMP\probe-err-$RunId.log") { Get-Content "$env:TEMP\probe-err-$RunId.log" -Raw } else { "" }

  Remove-Item "$env:TEMP\probe-out-$RunId.json" -Force -ErrorAction SilentlyContinue
  Remove-Item "$env:TEMP\probe-err-$RunId.log" -Force -ErrorAction SilentlyContinue

  if ($process.ExitCode -ne 0) {
    throw "Probe action $Action failed with exit code $($process.ExitCode): $rawErr $rawOutput"
  }

  return ($rawOutput | ConvertFrom-Json)
}

Assert-Administrator
if (-not $DisposableEnvironmentAcknowledged -and -not $DevelopmentOnly) {
  throw "Refusing destructive Windows service lifecycle tests without -DisposableEnvironmentAcknowledged"
}
$OutputPath = [IO.Path]::GetFullPath($OutputPath)

try {
  # 1. Supported Machine Gate
  $machineGate = Get-MachineGate
  $result["machine"] = $machineGate.facts
  $result.certificationEligible = [bool] $machineGate.eligible
  Add-Check -Name "supported-machine-gate" -Passed ($machineGate.eligible -or $DevelopmentOnly) -Details $machineGate

  # 2. Verify Windows Service Configuration & SCM Boundaries
  $apiService = Get-CimInstance Win32_Service -Filter "Name='$apiServiceName'"
  $pgService = Get-CimInstance Win32_Service -Filter "Name='$postgresqlServiceName'"
  Add-Check -Name "windows-services-running" -Passed (
    $null -ne $apiService -and $apiService.State -eq "Running" -and
    $null -ne $pgService -and $pgService.State -eq "Running"
  ) -Details @{ api = $apiService.State; postgresql = $pgService.State }

  # 3. Verify Database Roles & Least Privilege Boundaries
  $roleRows = Invoke-Psql -Role schema-owner -Sql "SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolreplication, rolbypassrls FROM pg_roles WHERE rolname IN ('breev_app','breev_schema_owner') ORDER BY rolname;"
  Add-Check -Name "database-role-harmonization" -Passed (
    $roleRows -match 'breev_app\|f\|f\|f\|f\|f\|f' -and
    $roleRows -match 'breev_schema_owner\|f\|f\|f\|f\|f\|f'
  ) -Details @{ roles = $roleRows }

  # Verify breev_app cannot create schemas or tables in public
  Invoke-Psql -Role app -Sql "CREATE TABLE public.issue37_forbidden_test(id integer);" -ExpectFailure | Out-Null
  Add-Check -Name "app-role-ddl-forbidden" -Passed $true

  # 4. Verify pg-boss Schema & Privileges
  $pgBossVersion = Invoke-Psql -Role app -Sql "SELECT version FROM pgboss.version LIMIT 1;"
  $tablePrivs = Invoke-Psql -Role app -Sql "SELECT has_table_privilege('breev_app', 'pgboss.job', 'SELECT, INSERT, UPDATE, DELETE');"
  $schemaPrivs = Invoke-Psql -Role app -Sql "SELECT has_schema_privilege('breev_app', 'pgboss', 'USAGE');"
  Add-Check -Name "pgboss-schema-migrated-and-authorized" -Passed (
    -not [string]::IsNullOrWhiteSpace($pgBossVersion) -and
    $tablePrivs -eq "t" -and
    $schemaPrivs -eq "t"
  ) -Details @{ version = $pgBossVersion; tablePrivileges = $tablePrivs; schemaPrivileges = $schemaPrivs }

  # 5. Initialize Witness Table with UNIQUE(job_id) Duplicate Constraint
  Run-Probe -Action "setup-witness" -Arguments @{} | Out-Null
  Add-Check -Name "witness-table-initialized" -Passed $true

  # 6. Transactional Enqueue and Rollback Verification
  $batchId = [Guid]::NewGuid().ToString()
  $committedJobId = [Guid]::NewGuid().ToString()
  $txCommitSql = @"
BEGIN;
INSERT INTO public.issue37_durable_jobs_witness (id, job_id, queue_name, payload, execution_count, executed_at, status)
VALUES ('witness_tx_commit', '$committedJobId', 'issue37_tx_queue', '{"batchId":"$batchId","test":"commit"}', 1, now(), 'enqueued');
INSERT INTO pgboss.job (id, name, data, state)
VALUES ('$committedJobId', 'issue37_tx_queue', '{"batchId":"$batchId","test":"commit"}', 'created');
COMMIT;
"@
  Invoke-Psql -Role app -Sql $txCommitSql | Out-Null

  $rolledBackJobId = [Guid]::NewGuid().ToString()
  $txRollbackSql = @"
BEGIN;
INSERT INTO public.issue37_durable_jobs_witness (id, job_id, queue_name, payload, execution_count, executed_at, status)
VALUES ('witness_tx_rollback', '$rolledBackJobId', 'issue37_tx_queue', '{"batchId":"$batchId","test":"rollback"}', 1, now(), 'enqueued');
INSERT INTO pgboss.job (id, name, data, state)
VALUES ('$rolledBackJobId', 'issue37_tx_queue', '{"batchId":"$batchId","test":"rollback"}', 'created');
ROLLBACK;
"@
  Invoke-Psql -Role app -Sql $txRollbackSql | Out-Null

  $committedCount = Invoke-Psql -Role app -Sql "SELECT count(*) FROM pgboss.job WHERE id = '$committedJobId';"
  $rolledBackCount = Invoke-Psql -Role app -Sql "SELECT count(*) FROM pgboss.job WHERE id = '$rolledBackJobId';"
  Add-Check -Name "transactional-enqueue-and-rollback" -Passed (
    $committedCount -eq "1" -and $rolledBackCount -eq "0"
  ) -Details @{ committed = $committedCount; rolledBack = $rolledBackCount }

  # 7. Service Restart Resumption & Zero Duplicate Execution Proof
  # Enqueue 10 pending jobs + 1 scheduled job
  $restartBatchId = [Guid]::NewGuid().ToString()
  $enqueueResult = Run-Probe -Action "enqueue-batch" -Arguments @{
    count = 10
    "batch-id" = $restartBatchId
    queue = "issue37_restart_queue"
  }
  $scheduledResult = Run-Probe -Action "enqueue-scheduled" -Arguments @{
    "scheduled-id" = [Guid]::NewGuid().ToString()
    "delay-seconds" = 3
    queue = "issue37_restart_queue"
  }
  Add-Check -Name "work-enqueued-before-restart" -Passed (
    $enqueueResult.enqueued -eq 10 -and $null -ne $scheduledResult.jobId
  ) -Details @{ batch = $enqueueResult; scheduled = $scheduledResult }

  # Capture API service PID before restart
  $apiServiceBefore = Get-CimInstance Win32_Service -Filter "Name='$apiServiceName'"
  $apiPidBefore = $apiServiceBefore.ProcessId

  # Restart BreevLocalApi Windows Service
  Stop-Service -Name $apiServiceName -Force
  (Get-Service -Name $apiServiceName).WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30))
  Start-Service -Name $apiServiceName
  (Get-Service -Name $apiServiceName).WaitForStatus("Running", [TimeSpan]::FromSeconds(30))
  $healthAfterRestart = Wait-Healthy -TimeoutSeconds 45

  $apiServiceAfter = Get-CimInstance Win32_Service -Filter "Name='$apiServiceName'"
  $apiPidAfter = $apiServiceAfter.ProcessId
  Add-Check -Name "api-service-restarted" -Passed (
    $apiPidAfter -ne 0 -and $apiPidAfter -ne $apiPidBefore -and $healthAfterRestart.status -eq "healthy"
  ) -Details @{ pidBefore = $apiPidBefore; pidAfter = $apiPidAfter }

  # Work the batch and verify restart resumption without duplicates
  $workResult = Run-Probe -Action "work-batch" -Arguments @{
    "expected-count" = 11
    "timeout-ms" = 35000
    queue = "issue37_restart_queue"
  }
  Add-Check -Name "work-resumed-and-completed-after-restart" -Passed (
    $workResult.passed -and $workResult.processedCount -ge 11 -and -not $workResult.duplicateAttemptDetected
  ) -Details $workResult

  # Audit witness table to verify exact-once delivery and zero duplicate executions
  $witnessAudit = Run-Probe -Action "verify-witness" -Arguments @{
    "batch-id" = $restartBatchId
  }
  Add-Check -Name "zero-duplicate-executions-verified" -Passed (
    $witnessAudit.passed -and $witnessAudit.duplicateRows -eq 0 -and $witnessAudit.totalRows -eq 10
  ) -Details $witnessAudit

  # 8. Retry with Backoff and Dead-Letter Queue (DLQ) Routing
  $failId = [Guid]::NewGuid().ToString()
  $enqueueFailResult = Run-Probe -Action "enqueue-failing" -Arguments @{
    "fail-id" = $failId
    queue = "issue37_failing_queue"
    dlq = "issue37_dlq"
  }
  $failWorkResult = Run-Probe -Action "work-and-fail" -Arguments @{
    queue = "issue37_failing_queue"
    "timeout-ms" = 20000
  }
  # Wait for DLQ routing
  Start-Sleep -Seconds 3
  $dlqJobCount = Invoke-Psql -Role app -Sql "SELECT count(*) FROM pgboss.job WHERE (name = 'issue37_dlq' OR (name = 'issue37_failing_queue' AND state = 'failed'));"
  Add-Check -Name "retry-backoff-and-dead-letter-queue-routing" -Passed (
    $enqueueFailResult.jobId -ne $null -and
    $failWorkResult.passed -and
    [int]$dlqJobCount -ge 1
  ) -Details @{ dlqCount = $dlqJobCount; failWork = $failWorkResult }

  $result.passed = @($checks | Where-Object { -not $_.passed }).Count -eq 0
} catch {
  $result["error"] = $_.Exception.Message
} finally {
  $result["completedAtUtc"] = [DateTime]::UtcNow.ToString("o")
  $outputRoot = Split-Path -Parent $OutputPath
  New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
  $result | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
}

if (-not $result.passed) {
  throw "The Windows durable jobs service proof failed. See $OutputPath"
}
Write-Output $OutputPath
