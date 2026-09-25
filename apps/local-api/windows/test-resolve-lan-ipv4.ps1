# Test harness: import only the pure LAN address resolver, never execute lifecycle actions.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$script:fixtureAdapters = @(
  [PSCustomObject] @{ ifIndex = 6; Status = 'Up' }
)
$script:fixtureInterfaces = @(
  [PSCustomObject] @{ InterfaceIndex = 6; ConnectionState = 'Connected'; InterfaceMetric = 40 },
  [PSCustomObject] @{ InterfaceIndex = 41; ConnectionState = 'Connected'; InterfaceMetric = 15 }
)
$script:fixtureAddresses = @(
  [PSCustomObject] @{ InterfaceIndex = 6; IPAddress = '192.168.1.6' },
  [PSCustomObject] @{ InterfaceIndex = 41; IPAddress = '172.22.96.1' }
)

function Get-NetAdapter {
  [CmdletBinding()]
  param([switch] $Physical)
  return $script:fixtureAdapters
}

function Get-NetIPInterface {
  [CmdletBinding()]
  param([string] $AddressFamily)
  return $script:fixtureInterfaces
}

function Get-NetIPAddress {
  [CmdletBinding()]
  param([string] $AddressFamily)
  return $script:fixtureAddresses
}

$tokens = $null
$parseErrors = $null
$lifecyclePath = Join-Path $PSScriptRoot 'lifecycle.ps1'
$ast = [Management.Automation.Language.Parser]::ParseFile($lifecyclePath, [ref] $tokens, [ref] $parseErrors)
if ($parseErrors.Count -gt 0) { throw 'Lifecycle PowerShell parsing failed' }
$definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Resolve-LanIPv4Address' }, $true)
if ($null -eq $definition) { throw 'LAN address resolver definition is missing' }
Invoke-Expression $definition.Extent.Text

$selected = Resolve-LanIPv4Address
if ($selected -ne '192.168.1.6') {
  throw "Expected the physical Wi-Fi address 192.168.1.6, got $selected"
}

# Virtual-only Windows hosts remain supported when there is no active physical NIC.
$script:fixtureAdapters = @()
$selected = Resolve-LanIPv4Address
if ($selected -ne '172.22.96.1') {
  throw "Expected virtual-only fallback address 172.22.96.1, got $selected"
}
