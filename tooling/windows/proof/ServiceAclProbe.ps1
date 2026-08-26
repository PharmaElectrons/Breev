#Requires -Version 5.1

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $AllowedPath,

  [Parameter(Mandatory = $true)]
  [string] $DeniedPaths,

  [Parameter(Mandatory = $true)]
  [string] $OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$allowedRead = try {
  [void] [IO.File]::ReadAllText($AllowedPath)
  $true
} catch {
  $false
}
$deniedReads = foreach ($path in $DeniedPaths.Split(@("||"), [StringSplitOptions]::RemoveEmptyEntries)) {
  $exception = $null
  $blocked = try {
    [void] [IO.File]::ReadAllText($path)
    $false
  } catch {
    $exception = $_.Exception.GetBaseException()
    $exception -is [UnauthorizedAccessException]
  }
  [ordered]@{
    path = $path
    blocked = $blocked
    exceptionType = if ($null -eq $exception) { $null } else { $exception.GetType().FullName }
    hresult = if ($null -eq $exception) { $null } else { $exception.HResult }
  }
}
$privileges = & whoami.exe /priv /fo csv | ConvertFrom-Csv
$dangerousPresentPrivileges = @($privileges | Where-Object {
  $_.'Privilege Name' -in @("SeDebugPrivilege", "SeBackupPrivilege", "SeRestorePrivilege", "SeTakeOwnershipPrivilege")
})
$result = [ordered]@{
  schemaVersion = 1
  identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  allowedRead = $allowedRead
  deniedReads = $deniedReads
  dangerousPresentPrivileges = @($dangerousPresentPrivileges | Select-Object -ExpandProperty 'Privilege Name')
  outputWrite = $true
  passed = $allowedRead -and @($deniedReads | Where-Object { -not $_.blocked }).Count -eq 0 -and $dangerousPresentPrivileges.Count -eq 0
  completedAtUtc = [DateTime]::UtcNow.ToString("o")
}

try {
  $result | ConvertTo-Json | Set-Content -LiteralPath $OutputPath -Encoding UTF8
} catch {
  $result["outputWrite"] = $false
  $result["passed"] = $false
  throw
}

if (-not $result.passed) {
  exit 1
}
