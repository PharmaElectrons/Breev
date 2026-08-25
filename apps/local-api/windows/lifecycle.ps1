#Requires -Version 5.1

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("Install", "Repair", "Uninstall")]
  [string] $Action,

  [Parameter(Mandatory = $true)]
  [string] $InstallRoot,

  [Parameter(Mandatory = $true)]
  [string] $PayloadRoot,

  [string] $DataRoot = (Join-Path $env:ProgramData "Breev"),

  [ValidateSet("None", "AfterDataPrepared", "AfterPostgreSqlService", "AfterApiService", "BeforeReadiness")]
  [string] $InjectFailure = "None"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$apiServiceName = "BreevLocalApi"
$postgresqlServiceName = "BreevPostgreSQL"
$apiPort = 31310
$postgresqlPort = 31311
$createdServices = [Collections.Generic.List[string]]::new()

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "The Breev Windows lifecycle requires an elevated administrator token"
  }
}

function Assert-FileExists {
  param([string] $Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "The Windows payload is missing a required file"
  }
}

function Invoke-CheckedCommand {
  param(
    [string] $FilePath,
    [string[]] $Arguments,
    [string] $FailureMessage
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw $FailureMessage
  }
}

function Test-ServiceExists {
  param([string] $Name)
  return $null -ne (Get-Service -Name $Name -ErrorAction SilentlyContinue)
}

function Wait-ServiceAbsent {
  param([string] $Name)
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (-not (Test-ServiceExists -Name $Name)) {
      return
    }
    Start-Sleep -Milliseconds 250
  }
  throw "Windows did not remove service $Name"
}

function Stop-And-DeleteService {
  param([string] $Name)
  $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
  if ($null -eq $service) {
    return
  }

  if ($service.Status -ne [ServiceProcess.ServiceControllerStatus]::Stopped) {
    Stop-Service -Name $Name -Force
    (Get-Service -Name $Name).WaitForStatus([ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromSeconds(75))
  }
  Invoke-CheckedCommand -FilePath "sc.exe" -Arguments @("delete", $Name) -FailureMessage "Could not remove service $Name"
  Wait-ServiceAbsent -Name $Name
}

function Set-DirectoryAcl {
  param(
    [string] $Path,
    [string[]] $AdditionalGrants
  )

  New-Item -ItemType Directory -Force -Path $Path | Out-Null
  Invoke-CheckedCommand -FilePath "icacls.exe" -Arguments @($Path, "/inheritance:r") -FailureMessage "Could not disable ACL inheritance"
  $grants = @(
    "*S-1-5-18:(OI)(CI)F",
    "*S-1-5-32-544:(OI)(CI)F"
  ) + $AdditionalGrants
  Invoke-CheckedCommand -FilePath "icacls.exe" -Arguments (@($Path, "/grant:r") + $grants) -FailureMessage "Could not apply a protected directory ACL"
}

function Set-FileAcl {
  param(
    [string] $Path,
    [string[]] $AdditionalGrants
  )

  Invoke-CheckedCommand -FilePath "icacls.exe" -Arguments @($Path, "/inheritance:r") -FailureMessage "Could not disable file ACL inheritance"
  $grants = @(
    "*S-1-5-18:F",
    "*S-1-5-32-544:F"
  ) + $AdditionalGrants
  Invoke-CheckedCommand -FilePath "icacls.exe" -Arguments (@($Path, "/grant:r") + $grants) -FailureMessage "Could not apply a protected file ACL"
}

function New-RandomSecret {
  $bytes = [byte[]]::new(32)
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
  } finally {
    $generator.Dispose()
  }
  return [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function Test-Payload {
  $manifestPath = Join-Path $PayloadRoot "payload-manifest.json"
  Assert-FileExists $manifestPath
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $lock = Get-Content -LiteralPath (Join-Path $PayloadRoot "payload-lock.json") -Raw | ConvertFrom-Json
  if ($manifest.schemaVersion -ne 1 -or $manifest.architecture -ne "x64") {
    throw "The Windows payload manifest is incompatible"
  }

  $nodePath = Join-Path $PayloadRoot "node\node.exe"
  $postgresPath = Join-Path $PayloadRoot "postgresql\bin\postgres.exe"
  $shawlPath = Join-Path $PayloadRoot "service-wrapper\shawl.exe"
  Assert-FileExists $nodePath
  Assert-FileExists $postgresPath
  Assert-FileExists $shawlPath
  Assert-FileExists (Join-Path $PayloadRoot "local-api\dist\main.js")
  Assert-FileExists (Join-Path $PayloadRoot "bootstrap.sql")

  $componentRoots = @{
    node = (Join-Path $PayloadRoot "node")
    postgresql = (Join-Path $PayloadRoot "postgresql")
    shawl = (Join-Path $PayloadRoot "service-wrapper")
  }
  foreach ($component in $manifest.components) {
    $lockedComponents = @($lock.components | Where-Object { $_.name -eq $component.name })
    if ($lockedComponents.Count -ne 1 -or
        $lockedComponents[0].version -ne $component.version -or
        $lockedComponents[0].archive -ne $component.archive -or
        $lockedComponents[0].sha256 -ne $component.sha256) {
      throw "A Windows runtime component does not match its pinned archive record"
    }
    foreach ($sourceHash in $lockedComponents[0].executableHashes.PSObject.Properties) {
      $manifestSourceHash = $component.sourceExecutableHashes.PSObject.Properties[$sourceHash.Name]
      if ($null -eq $manifestSourceHash -or $manifestSourceHash.Value -ne $sourceHash.Value) {
        throw "A Windows runtime component has lost its pinned executable provenance"
      }
    }
    foreach ($executableHash in $component.executableHashes.PSObject.Properties) {
      $executablePath = Join-Path $componentRoots[$component.name] $executableHash.Name
      Assert-FileExists $executablePath
      $actualHash = (Get-FileHash -LiteralPath $executablePath -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($actualHash -ne $executableHash.Value) {
        throw "A Windows runtime executable does not match the pinned payload"
      }
    }
  }

  $nodeVersion = (& $nodePath --version).Trim()
  $postgresVersion = (& $postgresPath --version).Trim()
  $shawlVersion = (& $shawlPath --version).Trim()
  if ($nodeVersion -ne "v24.19.0" -or
      $postgresVersion -notmatch "PostgreSQL\) 18\.6$" -or
      $shawlVersion -notmatch "1\.9\.0$") {
    throw "A prepared Windows runtime has an unexpected version"
  }
}

function Complete-StagedInitialization {
  param(
    [string] $StagingRoot,
    [string] $FinalConfigRoot,
    [string] $FinalPostgresqlRoot
  )

  $stagedConfigRoot = Join-Path $StagingRoot "config"
  $stagedPostgresqlRoot = Join-Path $StagingRoot "postgresql"
  $readyMarker = Join-Path $StagingRoot "ready-to-commit"
  if ((Test-Path -LiteralPath $StagingRoot) -and -not (Test-Path -LiteralPath $readyMarker -PathType Leaf)) {
    Remove-Item -LiteralPath $StagingRoot -Recurse -Force
    return
  }
  if ((-not (Test-Path -LiteralPath $FinalConfigRoot)) -and (Test-Path -LiteralPath $stagedConfigRoot)) {
    Move-Item -LiteralPath $stagedConfigRoot -Destination $FinalConfigRoot
  }
  if ((-not (Test-Path -LiteralPath $FinalPostgresqlRoot)) -and (Test-Path -LiteralPath $stagedPostgresqlRoot)) {
    Move-Item -LiteralPath $stagedPostgresqlRoot -Destination $FinalPostgresqlRoot
  }
  if ((Test-Path -LiteralPath $FinalConfigRoot) -and (Test-Path -LiteralPath $FinalPostgresqlRoot)) {
    Remove-Item -LiteralPath $StagingRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Initialize-Database {
  $configRoot = Join-Path $DataRoot "config"
  $postgresqlDataRoot = Join-Path $DataRoot "postgresql"
  $runtimeUrlPath = Join-Path $configRoot "database-url"
  $schemaOwnerUrlPath = Join-Path $configRoot "schema-owner-url"
  $stagingRoot = Join-Path $DataRoot ".installing"

  Complete-StagedInitialization -StagingRoot $stagingRoot -FinalConfigRoot $configRoot -FinalPostgresqlRoot $postgresqlDataRoot
  $hasConfig = (Test-Path -LiteralPath $runtimeUrlPath -PathType Leaf) -and (Test-Path -LiteralPath $schemaOwnerUrlPath -PathType Leaf)
  $hasDatabase = Test-Path -LiteralPath (Join-Path $postgresqlDataRoot "PG_VERSION") -PathType Leaf
  if ($hasConfig -and $hasDatabase) {
    $majorVersion = (Get-Content -LiteralPath (Join-Path $postgresqlDataRoot "PG_VERSION") -Raw).Trim()
    if ($majorVersion -ne "18") {
      throw "The existing PostgreSQL data directory requires a reviewed upgrade path"
    }
    return
  }
  if ($hasConfig -or $hasDatabase) {
    throw "Breev found incomplete preserved database state and will not replace it"
  }

  if (Test-Path -LiteralPath $stagingRoot) {
    Remove-Item -LiteralPath $stagingRoot -Recurse -Force
  }
  $installerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $installerGrant = if ($installerSid -eq "S-1-5-18") { @() } else { @("*${installerSid}:(OI)(CI)F") }
  Set-DirectoryAcl -Path $stagingRoot -AdditionalGrants $installerGrant

  $stagedConfigRoot = Join-Path $stagingRoot "config"
  $stagedPostgresqlRoot = Join-Path $stagingRoot "postgresql"
  New-Item -ItemType Directory -Force -Path $stagedConfigRoot | Out-Null
  $bootstrapPassword = New-RandomSecret
  $runtimePassword = New-RandomSecret
  $schemaOwnerPassword = New-RandomSecret
  $passwordPath = Join-Path $stagingRoot "initdb-password"
  Set-Content -LiteralPath $passwordPath -Value $bootstrapPassword -NoNewline -Encoding ASCII

  $initdbPath = Join-Path $PayloadRoot "postgresql\bin\initdb.exe"
  try {
    Invoke-CheckedCommand -FilePath $initdbPath -Arguments @(
      "--pgdata=$stagedPostgresqlRoot",
      "--username=breev_bootstrap",
      "--pwfile=$passwordPath",
      "--encoding=UTF8",
      "--locale=C",
      "--auth=scram-sha-256",
      "--data-checksums"
    ) -FailureMessage "PostgreSQL initialization failed"
  } finally {
    Remove-Item -LiteralPath $passwordPath -Force -ErrorAction SilentlyContinue
  }

  Add-Content -LiteralPath (Join-Path $stagedPostgresqlRoot "postgresql.conf") -Encoding ASCII -Value @(
    "",
    "# Breev issue #34 runtime proof",
    "listen_addresses = '127.0.0.1, ::1'",
    "port = $postgresqlPort",
    "password_encryption = 'scram-sha-256'",
    "log_min_error_statement = fatal",
    "ssl = off"
  )
  Set-Content -LiteralPath (Join-Path $stagedPostgresqlRoot "pg_hba.conf") -Encoding ASCII -Value @(
    "# TYPE  DATABASE  USER  ADDRESS       METHOD",
    "host    all       all   127.0.0.1/32  scram-sha-256",
    "host    all       all   ::1/128       scram-sha-256"
  )

  $bootstrapSqlTemplate = Get-Content -LiteralPath (Join-Path $PayloadRoot "bootstrap.sql") -Raw
  $bootstrapSql = $bootstrapSqlTemplate.Replace("__RUNTIME_PASSWORD__", $runtimePassword).Replace("__SCHEMA_OWNER_PASSWORD__", $schemaOwnerPassword)
  $bootstrapSqlPath = Join-Path $stagingRoot "bootstrap.generated.sql"
  [IO.File]::WriteAllText($bootstrapSqlPath, $bootstrapSql, [Text.UTF8Encoding]::new($false))
  $pgpassPath = Join-Path $stagingRoot "pgpass"
  Set-Content -LiteralPath $pgpassPath -Value @(
    "127.0.0.1:${postgresqlPort}:postgres:breev_bootstrap:$bootstrapPassword",
    "127.0.0.1:${postgresqlPort}:breev:breev_bootstrap:$bootstrapPassword"
  ) -Encoding ASCII

  $pgCtlPath = Join-Path $PayloadRoot "postgresql\bin\pg_ctl.exe"
  $psqlPath = Join-Path $PayloadRoot "postgresql\bin\psql.exe"
  $bootstrapLogPath = Join-Path $stagingRoot "postgresql-bootstrap.log"
  $previousPgpassFile = $env:PGPASSFILE
  $env:PGPASSFILE = $pgpassPath
  $started = $false
  try {
    Invoke-CheckedCommand -FilePath $pgCtlPath -Arguments @("start", "--pgdata=$stagedPostgresqlRoot", "--log=$bootstrapLogPath", "--wait", "--timeout=60") -FailureMessage "The staged PostgreSQL server did not start"
    $started = $true
    Invoke-CheckedCommand -FilePath $psqlPath -Arguments @("--no-password", "--host=127.0.0.1", "--port=$postgresqlPort", "--username=breev_bootstrap", "--dbname=postgres", "--file=$bootstrapSqlPath") -FailureMessage "Could not create the separated database roles"
  } finally {
    $stopFailure = $null
    try {
      if ($started) {
        Invoke-CheckedCommand -FilePath $pgCtlPath -Arguments @("stop", "--pgdata=$stagedPostgresqlRoot", "--mode=fast", "--wait", "--timeout=60") -FailureMessage "The staged PostgreSQL server did not stop cleanly"
      }
    } catch {
      $stopFailure = $_
    } finally {
      $env:PGPASSFILE = $previousPgpassFile
      foreach ($secretPath in @($pgpassPath, $bootstrapSqlPath)) {
        if (Test-Path -LiteralPath $secretPath) {
          Remove-Item -LiteralPath $secretPath -Force
        }
      }
    }
    if ($null -ne $stopFailure) { throw $stopFailure }
  }

  Set-Content -LiteralPath (Join-Path $stagedConfigRoot "database-url") -Value "postgresql://breev_runtime:$runtimePassword@127.0.0.1:$postgresqlPort/breev" -NoNewline -Encoding ASCII
  Set-Content -LiteralPath (Join-Path $stagedConfigRoot "schema-owner-url") -Value "postgresql://breev_schema_owner:$schemaOwnerPassword@127.0.0.1:$postgresqlPort/breev" -NoNewline -Encoding ASCII
  [ordered]@{
    schemaVersion = 1
    installationId = [Guid]::NewGuid().ToString()
    postgresqlMajorVersion = 18
  } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stagedConfigRoot "installation.json") -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $stagingRoot "ready-to-commit") -Value "ready" -NoNewline -Encoding ASCII

  Complete-StagedInitialization -StagingRoot $stagingRoot -FinalConfigRoot $configRoot -FinalPostgresqlRoot $postgresqlDataRoot
}

function Configure-Service {
  param(
    [string] $Name,
    [string] $Description
  )

  Invoke-CheckedCommand -FilePath "sc.exe" -Arguments @("config", $Name, "start=", "auto", "obj=", "NT SERVICE\$Name") -FailureMessage "Could not assign the dedicated identity for $Name"
  Invoke-CheckedCommand -FilePath "sc.exe" -Arguments @("description", $Name, $Description) -FailureMessage "Could not describe service $Name"
  Invoke-CheckedCommand -FilePath "sc.exe" -Arguments @("sidtype", $Name, "restricted") -FailureMessage "Could not restrict service $Name"
  Invoke-CheckedCommand -FilePath "sc.exe" -Arguments @("failure", $Name, "reset=", "86400", "actions=", "restart/5000/restart/15000/restart/30000") -FailureMessage "Could not configure recovery for $Name"
  Invoke-CheckedCommand -FilePath "sc.exe" -Arguments @("failureflag", $Name, "1") -FailureMessage "Could not enable non-crash recovery for $Name"
}

function Register-PostgresqlService {
  $shawlPath = Join-Path $PayloadRoot "service-wrapper\shawl.exe"
  $postgresqlRoot = Join-Path $PayloadRoot "postgresql"
  $postgresPath = Join-Path $postgresqlRoot "bin\postgres.exe"
  $postgresqlDataRoot = Join-Path $DataRoot "postgresql"
  $logRoot = Join-Path $DataRoot "logs\postgresql"
  Invoke-CheckedCommand -FilePath $shawlPath -Arguments @(
    "add", "--name", $postgresqlServiceName,
    "--restart", "--restart-delay", "5000", "--stop-timeout", "60000", "--kill-process-tree",
    "--log-dir", $logRoot, "--log-as", "wrapper", "--log-cmd-as", "postgresql",
    "--cwd", $postgresqlRoot,
    "--", $postgresPath, "-D", $postgresqlDataRoot
  ) -FailureMessage "Could not register the PostgreSQL Windows service"
  [void] $createdServices.Add($postgresqlServiceName)
  Configure-Service -Name $postgresqlServiceName -Description "Breev private PostgreSQL 18.6 service"
}

function Register-ApiService {
  $shawlPath = Join-Path $PayloadRoot "service-wrapper\shawl.exe"
  $nodePath = Join-Path $PayloadRoot "node\node.exe"
  $apiRoot = Join-Path $PayloadRoot "local-api"
  $apiEntry = Join-Path $apiRoot "dist\main.js"
  $runtimeUrlPath = Join-Path $DataRoot "config\database-url"
  $logRoot = Join-Path $DataRoot "logs\local-api"
  Invoke-CheckedCommand -FilePath $shawlPath -Arguments @(
    "add", "--name", $apiServiceName,
    "--restart", "--restart-delay", "2000", "--stop-timeout", "30000", "--kill-process-tree",
    "--log-dir", $logRoot, "--log-as", "wrapper", "--log-cmd-as", "local-api",
    "--cwd", $apiRoot,
    "--env", "API_HOST=127.0.0.1", "--env", "API_PORT=$apiPort", "--env", "DATABASE_URL_FILE=$runtimeUrlPath",
    "--", $nodePath, $apiEntry
  ) -FailureMessage "Could not register the local API Windows service"
  [void] $createdServices.Add($apiServiceName)
  Configure-Service -Name $apiServiceName -Description "Breev local API service"
}

function Set-ServiceAcls {
  $configRoot = Join-Path $DataRoot "config"
  $postgresqlDataRoot = Join-Path $DataRoot "postgresql"
  $apiLogRoot = Join-Path $DataRoot "logs\local-api"
  $postgresqlLogRoot = Join-Path $DataRoot "logs\postgresql"
  $stateRoot = Join-Path $DataRoot "state"
  Set-DirectoryAcl -Path $DataRoot -AdditionalGrants @()
  Set-DirectoryAcl -Path $configRoot -AdditionalGrants @()
  Set-FileAcl -Path (Join-Path $configRoot "database-url") -AdditionalGrants @("NT SERVICE\${apiServiceName}:R")
  Set-FileAcl -Path (Join-Path $configRoot "schema-owner-url") -AdditionalGrants @()
  Set-FileAcl -Path (Join-Path $configRoot "installation.json") -AdditionalGrants @("NT SERVICE\${apiServiceName}:R")
  Set-DirectoryAcl -Path $postgresqlDataRoot -AdditionalGrants @("NT SERVICE\${postgresqlServiceName}:(OI)(CI)F")
  Set-DirectoryAcl -Path $apiLogRoot -AdditionalGrants @("NT SERVICE\${apiServiceName}:(OI)(CI)M")
  Set-DirectoryAcl -Path $postgresqlLogRoot -AdditionalGrants @("NT SERVICE\${postgresqlServiceName}:(OI)(CI)M")
  Set-DirectoryAcl -Path $stateRoot -AdditionalGrants @()

  Set-DirectoryAcl -Path (Join-Path $PayloadRoot "service-wrapper") -AdditionalGrants @(
    "NT SERVICE\${apiServiceName}:(OI)(CI)RX",
    "NT SERVICE\${postgresqlServiceName}:(OI)(CI)RX"
  )
  Set-DirectoryAcl -Path (Join-Path $PayloadRoot "node") -AdditionalGrants @("NT SERVICE\${apiServiceName}:(OI)(CI)RX")
  Set-DirectoryAcl -Path (Join-Path $PayloadRoot "local-api") -AdditionalGrants @("NT SERVICE\${apiServiceName}:(OI)(CI)RX")
  Set-DirectoryAcl -Path (Join-Path $PayloadRoot "postgresql") -AdditionalGrants @("NT SERVICE\${postgresqlServiceName}:(OI)(CI)RX")
}

function Wait-PostgresqlReady {
  $pgIsReadyPath = Join-Path $PayloadRoot "postgresql\bin\pg_isready.exe"
  $deadline = [DateTime]::UtcNow.AddSeconds(60)
  while ([DateTime]::UtcNow -lt $deadline) {
    & $pgIsReadyPath --host=127.0.0.1 --port=$postgresqlPort --dbname=breev --timeout=1 *> $null
    if ($LASTEXITCODE -eq 0) {
      return
    }
    Start-Sleep -Milliseconds 500
  }
  throw "The PostgreSQL Windows service did not become ready"
}

function Wait-ApiReady {
  $deadline = [DateTime]::UtcNow.AddSeconds(60)
  while ([DateTime]::UtcNow -lt $deadline) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$apiPort/health" -TimeoutSec 2
      $body = $response.Content | ConvertFrom-Json
      if ($response.StatusCode -eq 200 -and $body.status -eq "healthy" -and $body.database -eq "available") {
        return
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  throw "The local API Windows service did not become healthy"
}

function Write-LifecycleState {
  param(
    [string] $Status,
    [string] $FailurePoint = "",
    [string] $ErrorMessage = ""
  )

  $stateRoot = Join-Path $DataRoot "state"
  Set-DirectoryAcl -Path $stateRoot -AdditionalGrants @()
  [ordered]@{
    schemaVersion = 1
    action = $Action
    status = $Status
    failurePoint = $FailurePoint
    error = $ErrorMessage
    completedAtUtc = [DateTime]::UtcNow.ToString("o")
  } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stateRoot "lifecycle.json") -Encoding UTF8
}

function Invoke-FailurePoint {
  param([string] $Name)
  if ($InjectFailure -eq $Name) {
    throw "Injected lifecycle failure at $Name"
  }
}

Assert-Administrator
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$PayloadRoot = [IO.Path]::GetFullPath($PayloadRoot)
$DataRoot = [IO.Path]::GetFullPath($DataRoot)

if ($Action -eq "Uninstall") {
  Stop-And-DeleteService -Name $apiServiceName
  Stop-And-DeleteService -Name $postgresqlServiceName
  Write-LifecycleState -Status "data-preserved"
  exit 0
}

try {
  Test-Payload
  Set-DirectoryAcl -Path $DataRoot -AdditionalGrants @()
  Initialize-Database
  Invoke-FailurePoint -Name "AfterDataPrepared"

  Stop-And-DeleteService -Name $apiServiceName
  Stop-And-DeleteService -Name $postgresqlServiceName
  Register-PostgresqlService
  Invoke-FailurePoint -Name "AfterPostgreSqlService"
  Register-ApiService
  Invoke-FailurePoint -Name "AfterApiService"
  Set-ServiceAcls

  Start-Service -Name $postgresqlServiceName
  Wait-PostgresqlReady
  Start-Service -Name $apiServiceName
  Invoke-FailurePoint -Name "BeforeReadiness"
  Wait-ApiReady
  Write-LifecycleState -Status "healthy"
} catch {
  $lifecycleFailure = $_
  $cleanupErrors = [Collections.Generic.List[string]]::new()
  foreach ($serviceName in $createdServices) {
    try {
      Stop-And-DeleteService -Name $serviceName
    } catch {
      [void] $cleanupErrors.Add($_.Exception.Message)
    }
  }
  $failureMessage = $lifecycleFailure.Exception.Message
  if ($cleanupErrors.Count -gt 0) {
    $failureMessage += "; cleanup failed: $($cleanupErrors -join '; ')"
  }
  try {
    Write-LifecycleState -Status "failed-data-preserved" -FailurePoint $InjectFailure -ErrorMessage $failureMessage
  } catch {
    # Preserve the original lifecycle failure if even the state record cannot be written.
  }
  if ($cleanupErrors.Count -gt 0) {
    throw $failureMessage
  }
  throw $lifecycleFailure
}
