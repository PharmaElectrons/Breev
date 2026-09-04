# Test harness: import only the pure verifier, never execute the lifecycle.
param([Parameter(Mandatory = $true)][string] $PayloadRoot)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module Microsoft.PowerShell.Utility -ErrorAction Stop
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'lifecycle.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count -ne 0) { throw 'Lifecycle PowerShell parsing failed' }
$definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Test-PayloadFiles' }, $true)
if ($null -eq $definition) { throw 'Payload verifier definition is missing' }
Invoke-Expression $definition.Extent.Text
$manifest = Get-Content -LiteralPath (Join-Path $PayloadRoot 'payload-manifest.json') -Raw | ConvertFrom-Json
Test-PayloadFiles -Root $PayloadRoot -Files $manifest.files
