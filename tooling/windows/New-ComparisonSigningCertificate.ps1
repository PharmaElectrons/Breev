#Requires -Version 5.1

[CmdletBinding()]
param(
  [string] $OutputRoot = (Join-Path $PSScriptRoot "../../artifacts/windows/comparison-signing")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$passwordValue = $env:BREEV_WINDOWS_CERTIFICATE_PASSWORD
if ([string]::IsNullOrWhiteSpace($passwordValue)) {
  throw "Set BREEV_WINDOWS_CERTIFICATE_PASSWORD to a temporary secret before creating the comparison certificate"
}

$OutputRoot = [IO.Path]::GetFullPath($OutputRoot)
New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
$pfxPath = Join-Path $OutputRoot "breev-issue-34-comparison.pfx"
$cerPath = Join-Path $OutputRoot "breev-issue-34-comparison.cer"
$password = ConvertTo-SecureString -String $passwordValue -AsPlainText -Force
$certificate = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject "CN=Breev issue 34 comparison only" `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -HashAlgorithm SHA256 `
  -KeyAlgorithm RSA `
  -KeyLength 3072 `
  -KeyExportPolicy Exportable `
  -NotAfter ([DateTime]::UtcNow.AddDays(14))

Export-PfxCertificate -Cert $certificate -FilePath $pfxPath -Password $password | Out-Null
Export-Certificate -Cert $certificate -FilePath $cerPath | Out-Null
Import-Certificate -FilePath $cerPath -CertStoreLocation "Cert:\CurrentUser\Root" | Out-Null

$certificateEvidence = [ordered]@{
  schemaVersion = 1
  purpose = "issue-34-comparison-only"
  productionTrusted = $false
  pfxPath = $pfxPath
  thumbprint = $certificate.Thumbprint
  notAfterUtc = $certificate.NotAfter.ToUniversalTime().ToString("o")
}
[IO.File]::WriteAllText(
  (Join-Path $OutputRoot "certificate.json"),
  ($certificateEvidence | ConvertTo-Json) + "`n",
  [Text.UTF8Encoding]::new($false)
)

$env:BREEV_WINDOWS_CERTIFICATE_FILE = $pfxPath
$env:BREEV_WINDOWS_CERTIFICATE_THUMBPRINT = $certificate.Thumbprint
Write-Output $pfxPath
