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
  [string] $InjectFailure = "None",

  [switch] $SkipStateWrite
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$apiServiceName = "BreevLocalApi"
$postgresqlServiceName = "BreevPostgreSQL"
$apiPort = 31310
$postgresqlPort = 31311
$createdServices = [Collections.Generic.List[string]]::new()
$sensitiveValues = [Collections.Generic.List[string]]::new()

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

  # Output is captured through files, never through PowerShell stream
  # redirection: under Windows PowerShell 5.1 a `2>&1` pipe capture both turns
  # native stderr into terminating errors while $ErrorActionPreference is
  # Stop, and hangs forever on launchers like `pg_ctl start` whose daemon
  # children inherit the pipe's write end so EOF never arrives. WaitForExit()
  # waits only on the direct child, and inherited file handles block nothing.
  $captureId = [Guid]::NewGuid().ToString("N")
  $stdoutPath = Join-Path $env:TEMP "breev-cmd-$captureId.out"
  $stderrPath = Join-Path $env:TEMP "breev-cmd-$captureId.err"
  try {
    $quotedArguments = @($Arguments | ForEach-Object {
      if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
    })
    $startParameters = @{
      FilePath = $FilePath
      NoNewWindow = $true
      PassThru = $true
      RedirectStandardOutput = $stdoutPath
      RedirectStandardError = $stderrPath
    }
    if ($quotedArguments.Count -gt 0) {
      $startParameters.ArgumentList = ($quotedArguments -join " ")
    }
    $process = Start-Process @startParameters
    # The handle must be cached while the process is guaranteed alive: without
    # it, WaitForExit succeeds on a synchronize-only handle but ExitCode reads
    # $null for an already-exited process, which would fail successful
    # commands.
    $null = $process.Handle
    $process.WaitForExit()
    if ($null -eq $process.ExitCode -or $process.ExitCode -ne 0) {
      $detail = ((Get-Content -LiteralPath $stdoutPath -Raw -ErrorAction SilentlyContinue) + "`n" +
                 (Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue)).Trim()
      foreach ($sensitiveValue in $script:sensitiveValues) {
        $detail = $detail.Replace($sensitiveValue, "<REDACTED>")
      }
      if ($detail.Length -gt 4000) {
        $detail = $detail.Substring($detail.Length - 4000)
      }
      if ($detail.Length -gt 0) {
        throw "$($FailureMessage): $detail"
      }
      throw $FailureMessage
    }
  } finally {
    Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
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

function Stop-BreevProcesses {
  param(
    [string[]] $PathPrefixes,
    [int] $TimeoutSeconds = 15
  )

  # A previous run can orphan postgres.exe on the staging directory or leave
  # service processes alive after the SCM reports them stopped. Both hold file
  # locks that wedge every later install, so they are reaped by location, not
  # by name alone, to avoid touching unrelated PostgreSQL or Node installs.
  $normalizedPrefixes = @($PathPrefixes | Where-Object { $_ } | ForEach-Object {
    [IO.Path]::GetFullPath($_).TrimEnd("\") + "\"
  } | Where-Object {
    # A volume root or single-level prefix would match unrelated processes
    # across the whole machine; only application-specific paths are eligible.
    ($_ -split "\\" | Where-Object { $_ }).Count -ge 3
  })
  if ($normalizedPrefixes.Count -eq 0) {
    return
  }

  $findProcesses = {
    Get-CimInstance -ClassName Win32_Process -Filter "Name = 'postgres.exe' OR Name = 'node.exe' OR Name = 'shawl.exe' OR Name = 'pg_ctl.exe'" -ErrorAction SilentlyContinue |
      Where-Object {
        $candidate = $_
        $haystacks = @($candidate.ExecutablePath, $candidate.CommandLine) | Where-Object { $_ }
        $matched = $false
        foreach ($prefix in $normalizedPrefixes) {
          foreach ($haystack in $haystacks) {
            if ($haystack.IndexOf($prefix, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
              $matched = $true
            }
          }
        }
        $matched
      }
  }

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (@(& $findProcesses).Count -eq 0) {
      return
    }
    Start-Sleep -Milliseconds 500
  }
  foreach ($process in @(& $findProcesses)) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Milliseconds 500
  $survivors = @(& $findProcesses)
  if ($survivors.Count -gt 0) {
    $survivorList = ($survivors | ForEach-Object { "$($_.Name):$($_.ProcessId)" }) -join ", "
    throw "Processes still hold Breev files after forced termination: $survivorList"
  }
}

function Set-ProtectedAcl {
  param(
    [string] $Path,
    [object[]] $AdditionalGrants,
    [Security.AccessControl.InheritanceFlags] $InheritanceFlags
  )

  $grants = @(
    [ordered]@{ identity = "S-1-5-18"; rights = [Security.AccessControl.FileSystemRights]::FullControl },
    [ordered]@{ identity = "S-1-5-32-544"; rights = [Security.AccessControl.FileSystemRights]::FullControl }
    # PowerShell 5.1 binds an empty array argument to $null. Do not turn that
    # absence into a third ACL entry when the installer runs as LocalSystem.
    @($AdditionalGrants) | Where-Object { $null -ne $_ }
  )
  # Build the allowlist from an empty descriptor. Windows Installer rollback can
  # expose an existing descriptor in noncanonical order, which .NET refuses to
  # protect or edit even though Windows can still read it.
  $item = Get-Item -LiteralPath $Path
  $acl = if ($item.PSIsContainer) {
    [Security.AccessControl.DirectorySecurity]::new()
  } else {
    [Security.AccessControl.FileSecurity]::new()
  }
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($grant in $grants) {
    $identity = if ($grant.identity -match '^S-\d(?:-\d+)+$') {
      [Security.Principal.SecurityIdentifier]::new($grant.identity)
    } else {
      [Security.Principal.NTAccount]::new($grant.identity)
    }
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
      $identity,
      $grant.rights,
      $InheritanceFlags,
      [Security.AccessControl.PropagationFlags]::None,
      [Security.AccessControl.AccessControlType]::Allow
    ))
  }
  Set-Acl -LiteralPath $Path -AclObject $acl
}

function Set-DirectoryAcl {
  param(
    [string] $Path,
    [object[]] $AdditionalGrants,
    [switch] $ResetDescendants
  )

  New-Item -ItemType Directory -Force -Path $Path | Out-Null
  $inheritanceFlags = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
  Set-ProtectedAcl -Path $Path -AdditionalGrants $AdditionalGrants -InheritanceFlags $inheritanceFlags

  if ($ResetDescendants -and @(Get-ChildItem -LiteralPath $Path -Force).Count -gt 0) {
    # The parent is already protected, so descendants can inherit only this exact allowlist.
    Invoke-CheckedCommand `
      -FilePath "icacls.exe" `
      -Arguments @((Join-Path $Path "*"), "/reset", "/T", "/C", "/Q") `
      -FailureMessage "Could not reset descendant ACLs to the protected boundary"
  }
}

function Set-FileAcl {
  param(
    [string] $Path,
    [object[]] $AdditionalGrants
  )

  Set-ProtectedAcl `
    -Path $Path `
    -AdditionalGrants $AdditionalGrants `
    -InheritanceFlags ([Security.AccessControl.InheritanceFlags]::None)
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

function New-MainDeviceId {
  # UUIDv7: 48-bit millisecond timestamp, version and variant nibbles, random
  # tail. Both the API and the desktop validate this exact shape.
  $bytes = [byte[]]::new(16)
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
  } finally {
    $generator.Dispose()
  }
  $milliseconds = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  for ($i = 5; $i -ge 0; $i--) {
    $bytes[$i] = [byte]($milliseconds -band 0xFF)
    $milliseconds = $milliseconds -shr 8
  }
  $bytes[6] = [byte](($bytes[6] -band 0x0F) -bor 0x70)
  $bytes[8] = [byte](($bytes[8] -band 0x3F) -bor 0x80)
  $hex = -join ($bytes | ForEach-Object { $_.ToString("x2") })
  return "{0}-{1}-{2}-{3}-{4}" -f $hex.Substring(0, 8), $hex.Substring(8, 4), $hex.Substring(12, 4), $hex.Substring(16, 4), $hex.Substring(20)
}

function Write-MainDeviceFile {
  param([string] $Path)

  # The Main device binding authenticates the desktop app to the local API.
  # It is generated once per installation: the database binds the device ID
  # to its first credential, so an existing file must never be overwritten.
  if (Test-Path -LiteralPath $Path -PathType Leaf) {
    return
  }
  $deviceSecret = New-RandomSecret
  $sessionToken = New-RandomSecret
  foreach ($secretValue in @($deviceSecret, $sessionToken)) {
    [void] $script:sensitiveValues.Add($secretValue)
  }
  # ASCII keeps the file free of a byte-order mark, which JSON.parse rejects.
  [ordered]@{
    deviceId = New-MainDeviceId
    deviceSecret = $deviceSecret
    sessionToken = $sessionToken
  } | ConvertTo-Json | Set-Content -LiteralPath $Path -Encoding ASCII
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
  Assert-FileExists (Join-Path $PayloadRoot "local-api\dist\migrate.js")
  Assert-FileExists (Join-Path $PayloadRoot "local-api\drizzle\meta\_journal.json")
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

  # An interrupted earlier run can leave a staged postgres.exe holding locks
  # inside .installing, which would fail every Remove-Item below forever.
  Stop-BreevProcesses -PathPrefixes @($stagingRoot) -TimeoutSeconds 0
  Complete-StagedInitialization -StagingRoot $stagingRoot -FinalConfigRoot $configRoot -FinalPostgresqlRoot $postgresqlDataRoot
  $hasConfig = (Test-Path -LiteralPath $runtimeUrlPath -PathType Leaf) -and (Test-Path -LiteralPath $schemaOwnerUrlPath -PathType Leaf)
  $hasDatabase = Test-Path -LiteralPath (Join-Path $postgresqlDataRoot "PG_VERSION") -PathType Leaf
  if ($hasConfig -and $hasDatabase) {
    $majorVersion = (Get-Content -LiteralPath (Join-Path $postgresqlDataRoot "PG_VERSION") -Raw).Trim()
    if ($majorVersion -ne "18") {
      throw "The existing PostgreSQL data directory requires a reviewed upgrade path"
    }
    # Installations that predate the Main device binding get one backfilled.
    # A fresh ID triple is safe against an existing database: provisioning
    # inserts a new device row and never rebinds an existing one.
    Write-MainDeviceFile -Path (Join-Path $configRoot "main-device.json")
    return
  }
  if ($hasConfig -or $hasDatabase) {
    throw "Breev found incomplete preserved database state and will not replace it"
  }

  if (Test-Path -LiteralPath $stagingRoot) {
    Remove-Item -LiteralPath $stagingRoot -Recurse -Force
  }
  $installerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $installerGrant = if ($installerSid -eq "S-1-5-18") {
    @()
  } else {
    @([ordered]@{ identity = $installerSid; rights = [Security.AccessControl.FileSystemRights]::FullControl })
  }
  Set-DirectoryAcl -Path $stagingRoot -AdditionalGrants $installerGrant

  $stagedConfigRoot = Join-Path $stagingRoot "config"
  $stagedPostgresqlRoot = Join-Path $stagingRoot "postgresql"
  New-Item -ItemType Directory -Force -Path $stagedConfigRoot | Out-Null
  $bootstrapPassword = New-RandomSecret
  $appPassword = New-RandomSecret
  $schemaOwnerPassword = New-RandomSecret
  foreach ($secretValue in @($bootstrapPassword, $appPassword, $schemaOwnerPassword)) {
    [void] $script:sensitiveValues.Add($secretValue)
  }
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
  $bootstrapSql = $bootstrapSqlTemplate.Replace("__APP_PASSWORD__", $appPassword).Replace("__RUNTIME_PASSWORD__", $appPassword).Replace("__SCHEMA_OWNER_PASSWORD__", $schemaOwnerPassword)
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
  $bootstrapSucceeded = $false
  try {
    Invoke-CheckedCommand -FilePath $pgCtlPath -Arguments @("start", "--pgdata=$stagedPostgresqlRoot", "--log=$bootstrapLogPath", "--wait", "--timeout=60") -FailureMessage "The staged PostgreSQL server did not start"
    $started = $true
    Invoke-CheckedCommand -FilePath $psqlPath -Arguments @("--no-password", "--host=127.0.0.1", "--port=$postgresqlPort", "--username=breev_bootstrap", "--dbname=postgres", "--file=$bootstrapSqlPath") -FailureMessage "Could not create the separated database roles"
    $bootstrapSucceeded = $true
  } finally {
    $stopFailure = $null
    try {
      # pg_ctl start can fail its own wait while the postmaster is already up,
      # so the on-disk pid file decides whether a stop is owed. An orphaned
      # staged postgres.exe otherwise locks .installing against every later
      # install attempt.
      if ($started -or (Test-Path -LiteralPath (Join-Path $stagedPostgresqlRoot "postmaster.pid") -PathType Leaf)) {
        Invoke-CheckedCommand -FilePath $pgCtlPath -Arguments @("stop", "--pgdata=$stagedPostgresqlRoot", "--mode=fast", "--wait", "--timeout=60") -FailureMessage "The staged PostgreSQL server did not stop cleanly"
      }
    } catch {
      $stopFailure = $_
    } finally {
      $env:PGPASSFILE = $previousPgpassFile
      foreach ($secretPath in @($pgpassPath, $bootstrapSqlPath)) {
        try {
          if (Test-Path -LiteralPath $secretPath) {
            Remove-Item -LiteralPath $secretPath -Force
          }
        } catch {
          if ($null -eq $stopFailure) { $stopFailure = $_ }
        }
      }
    }
    # A throw here would replace an in-flight bootstrap failure, so stop or
    # secret-cleanup failures only surface when the bootstrap itself succeeded.
    if ($null -ne $stopFailure -and $bootstrapSucceeded) { throw $stopFailure }
  }

  Set-Content -LiteralPath (Join-Path $stagedConfigRoot "database-url") -Value "postgresql://breev_app:$appPassword@127.0.0.1:$postgresqlPort/breev" -NoNewline -Encoding ASCII
  Set-Content -LiteralPath (Join-Path $stagedConfigRoot "schema-owner-url") -Value "postgresql://breev_schema_owner:$schemaOwnerPassword@127.0.0.1:$postgresqlPort/breev" -NoNewline -Encoding ASCII
  Write-MainDeviceFile -Path (Join-Path $stagedConfigRoot "main-device.json")
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
  # Recorded before the registration call: shawl can create the service and
  # still fail afterwards, and the rollback path only cleans recorded names.
  [void] $createdServices.Add($postgresqlServiceName)
  Invoke-CheckedCommand -FilePath $shawlPath -Arguments @(
    "add", "--name", $postgresqlServiceName,
    "--restart", "--restart-delay", "5000", "--stop-timeout", "60000", "--kill-process-tree",
    "--log-dir", $logRoot, "--log-as", "wrapper", "--log-cmd-as", "postgresql",
    "--cwd", $postgresqlRoot,
    "--", $postgresPath, "-D", $postgresqlDataRoot
  ) -FailureMessage "Could not register the PostgreSQL Windows service"
  Configure-Service -Name $postgresqlServiceName -Description "Breev private PostgreSQL 18.6 service"
}

function Register-ApiService {
  $shawlPath = Join-Path $PayloadRoot "service-wrapper\shawl.exe"
  $nodePath = Join-Path $PayloadRoot "node\node.exe"
  $apiRoot = Join-Path $PayloadRoot "local-api"
  $apiEntry = Join-Path $apiRoot "dist\main.js"
  $runtimeUrlPath = Join-Path $DataRoot "config\database-url"
  $logRoot = Join-Path $DataRoot "logs\local-api"
  $backupRoot = Join-Path $DataRoot "backups"
  [void] $createdServices.Add($apiServiceName)
  Invoke-CheckedCommand -FilePath $shawlPath -Arguments @(
    "add", "--name", $apiServiceName,
    "--restart", "--restart-delay", "2000", "--stop-timeout", "30000", "--kill-process-tree",
    "--log-dir", $logRoot, "--log-as", "wrapper", "--log-cmd-as", "local-api",
    "--cwd", $apiRoot,
    "--env", "API_HOST=127.0.0.1", "--env", "API_PORT=$apiPort", "--env", "DATABASE_URL_FILE=$runtimeUrlPath",
    "--env", "BREEV_BACKUP_DIRECTORY=$backupRoot",
    "--env", "BREEV_MAIN_DEVICE_FILE=$(Join-Path $DataRoot 'config\main-device.json')",
    "--", $nodePath, $apiEntry
  ) -FailureMessage "Could not register the local API Windows service"
  Configure-Service -Name $apiServiceName -Description "Breev local API service"
  # The SCM must bring PostgreSQL up before the API on every boot, or the API
  # starts against a database that is not accepting connections yet.
  Invoke-CheckedCommand -FilePath "sc.exe" -Arguments @("config", $apiServiceName, "depend=", $postgresqlServiceName) -FailureMessage "Could not order the local API service after PostgreSQL"
}

function Set-ServiceAcls {
  $configRoot = Join-Path $DataRoot "config"
  $postgresqlDataRoot = Join-Path $DataRoot "postgresql"
  $apiLogRoot = Join-Path $DataRoot "logs\local-api"
  $postgresqlLogRoot = Join-Path $DataRoot "logs\postgresql"
  $stateRoot = Join-Path $DataRoot "state"
  Set-DirectoryAcl -Path $DataRoot -AdditionalGrants @() -ResetDescendants
  Set-DirectoryAcl -Path $configRoot -AdditionalGrants @() -ResetDescendants
  Set-FileAcl -Path (Join-Path $configRoot "database-url") -AdditionalGrants @(
    [ordered]@{ identity = "NT SERVICE\${apiServiceName}"; rights = [Security.AccessControl.FileSystemRights]::Read }
  )
  Set-FileAcl -Path (Join-Path $configRoot "schema-owner-url") -AdditionalGrants @()
  # The desktop app runs as the interactive user and authenticates with this
  # binding, so local users may read it. The machine is the Main device per
  # ADR 0002; database credentials stay administrator-only above.
  Set-FileAcl -Path (Join-Path $configRoot "main-device.json") -AdditionalGrants @(
    [ordered]@{ identity = "NT SERVICE\${apiServiceName}"; rights = [Security.AccessControl.FileSystemRights]::Read },
    [ordered]@{ identity = "S-1-5-32-545"; rights = [Security.AccessControl.FileSystemRights]::Read }
  )
  Set-FileAcl -Path (Join-Path $configRoot "installation.json") -AdditionalGrants @(
    [ordered]@{ identity = "NT SERVICE\${apiServiceName}"; rights = [Security.AccessControl.FileSystemRights]::Read }
  )
  Set-DirectoryAcl -Path $postgresqlDataRoot -AdditionalGrants @(
    [ordered]@{ identity = "NT SERVICE\${postgresqlServiceName}"; rights = [Security.AccessControl.FileSystemRights]::FullControl }
  ) -ResetDescendants
  Set-DirectoryAcl -Path $apiLogRoot -AdditionalGrants @(
    [ordered]@{ identity = "NT SERVICE\${apiServiceName}"; rights = [Security.AccessControl.FileSystemRights]::Modify }
  ) -ResetDescendants
  Set-DirectoryAcl -Path $postgresqlLogRoot -AdditionalGrants @(
    [ordered]@{ identity = "NT SERVICE\${postgresqlServiceName}"; rights = [Security.AccessControl.FileSystemRights]::Modify }
  ) -ResetDescendants
  Set-DirectoryAcl -Path $stateRoot -AdditionalGrants @() -ResetDescendants
  Set-DirectoryAcl -Path (Join-Path $DataRoot "backups") -AdditionalGrants @(
    [ordered]@{ identity = "NT SERVICE\${apiServiceName}"; rights = [Security.AccessControl.FileSystemRights]::Modify }
  ) -ResetDescendants
  # The recovery key store: the API service creates and re-protects
  # breev-recovery-kek.dat here, which needs WRITE_DAC and WRITE_OWNER, so
  # the grant is FullControl. No descendant reset: the key file's own
  # hardening must survive a repair.
  Set-DirectoryAcl -Path (Join-Path $DataRoot "Recovery") -AdditionalGrants @(
    [ordered]@{ identity = "NT SERVICE\${apiServiceName}"; rights = [Security.AccessControl.FileSystemRights]::FullControl }
  )

  Set-DirectoryAcl -Path (Join-Path $PayloadRoot "service-wrapper") -AdditionalGrants @(
    [ordered]@{ identity = "NT SERVICE\${apiServiceName}"; rights = [Security.AccessControl.FileSystemRights]::ReadAndExecute },
    [ordered]@{ identity = "NT SERVICE\${postgresqlServiceName}"; rights = [Security.AccessControl.FileSystemRights]::ReadAndExecute }
  ) -ResetDescendants
  Set-DirectoryAcl -Path (Join-Path $PayloadRoot "node") -AdditionalGrants @(
    [ordered]@{ identity = "NT SERVICE\${apiServiceName}"; rights = [Security.AccessControl.FileSystemRights]::ReadAndExecute }
  ) -ResetDescendants
  Set-DirectoryAcl -Path (Join-Path $PayloadRoot "local-api") -AdditionalGrants @(
    [ordered]@{ identity = "NT SERVICE\${apiServiceName}"; rights = [Security.AccessControl.FileSystemRights]::ReadAndExecute }
  ) -ResetDescendants
  Set-DirectoryAcl -Path (Join-Path $PayloadRoot "postgresql") -AdditionalGrants @(
    [ordered]@{ identity = "NT SERVICE\${postgresqlServiceName}"; rights = [Security.AccessControl.FileSystemRights]::ReadAndExecute }
  ) -ResetDescendants
}

function Wait-PostgresqlReady {
  # Explicit stream redirection plus the script-wide Stop preference would turn
  # a single pg_isready stderr line into a terminating error inside this poll.
  $ErrorActionPreference = "Continue"
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

function Invoke-DatabaseMigrations {
  $nodePath = Join-Path $PayloadRoot "node\node.exe"
  $apiRoot = Join-Path $PayloadRoot "local-api"
  $migrateEntry = Join-Path $apiRoot "dist\migrate.js"
  $runtimeUrlPath = Join-Path $DataRoot "config\database-url"
  $schemaOwnerUrlPath = Join-Path $DataRoot "config\schema-owner-url"

  if (-not (Test-Path -LiteralPath $migrateEntry -PathType Leaf)) {
    throw "The Windows payload is missing local-api\dist\migrate.js"
  }

  $previousDatabaseUrlFile = $env:DATABASE_URL_FILE
  $previousMigrationUrlFile = $env:DATABASE_MIGRATION_URL_FILE
  try {
    $env:DATABASE_URL_FILE = $runtimeUrlPath
    $env:DATABASE_MIGRATION_URL_FILE = $schemaOwnerUrlPath
    Invoke-CheckedCommand -FilePath $nodePath -Arguments @($migrateEntry) -FailureMessage "Privileged database migrations failed"
  } finally {
    $env:DATABASE_URL_FILE = $previousDatabaseUrlFile
    $env:DATABASE_MIGRATION_URL_FILE = $previousMigrationUrlFile
  }
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
      # A refused connection or non-200 response falls through to the sleep.
    }
    Start-Sleep -Milliseconds 500
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
  Set-DirectoryAcl -Path $stateRoot -AdditionalGrants @() -ResetDescendants
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
  # Every statement here is best-effort and the action always exits 0: the
  # NSIS uninstaller treats any nonzero exit as "the app cannot be closed"
  # and traps the user in a retry loop that blocks reinstalling forever.
  $uninstallErrors = [Collections.Generic.List[string]]::new()
  foreach ($serviceName in @($apiServiceName, $postgresqlServiceName)) {
    try {
      Stop-And-DeleteService -Name $serviceName
    } catch {
      [void] $uninstallErrors.Add($_.Exception.Message)
    }
  }
  try {
    Stop-BreevProcesses -PathPrefixes @($PayloadRoot, $InstallRoot, $DataRoot) -TimeoutSeconds 15
  } catch {
    [void] $uninstallErrors.Add($_.Exception.Message)
  }
  if (-not $SkipStateWrite) {
    try {
      if ($uninstallErrors.Count -gt 0) {
        Write-LifecycleState -Status "data-preserved" -ErrorMessage ($uninstallErrors -join "; ")
      } else {
        Write-LifecycleState -Status "data-preserved"
      }
    } catch {
      # State recording must never block an uninstall.
    }
  }
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
  Invoke-DatabaseMigrations
  Start-Service -Name $apiServiceName
  Invoke-FailurePoint -Name "BeforeReadiness"
  Wait-ApiReady
  Write-LifecycleState -Status "healthy"
} catch {
  $lifecycleFailure = $_
  $cleanupErrors = [Collections.Generic.List[string]]::new()
  $servicesToClean = @($createdServices)
  [array]::Reverse($servicesToClean)
  foreach ($serviceName in $servicesToClean) {
    try {
      Stop-And-DeleteService -Name $serviceName
    } catch {
      [void] $cleanupErrors.Add($_.Exception.Message)
    }
  }
  try {
    Stop-BreevProcesses -PathPrefixes @($PayloadRoot, (Join-Path $DataRoot ".installing")) -TimeoutSeconds 10
  } catch {
    [void] $cleanupErrors.Add($_.Exception.Message)
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
