$ErrorActionPreference = 'Stop'

$apiBaseUrl = 'http://127.0.0.1:31310'
$bindingPath = 'C:\ProgramData\Breev\config\main-device.json'

if (-not (Test-Path -LiteralPath $bindingPath -PathType Leaf)) {
    throw "Installed Breev Main-device binding was not found at $bindingPath"
}

$binding = Get-Content -LiteralPath $bindingPath -Raw | ConvertFrom-Json
if ($binding.deviceId -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') {
    throw 'The installed Breev Main-device ID is not a UUIDv7.'
}

$headers = @{
    Accept = 'application/json'
    Authorization = "Breev-Device $($binding.deviceSecret)"
    Origin = 'breev://app'
    'X-Breev-Device-Id' = $binding.deviceId
    'X-Breev-Device-Session' = $binding.sessionToken
}

try {
    $state = Invoke-RestMethod -Method Get -Uri "$apiBaseUrl/identity/state" -Headers $headers -TimeoutSec 5
} finally {
    $headers = $null
    $binding.deviceSecret = $null
    $binding.sessionToken = $null
}

if ($state.state -ne 'authenticated') {
    throw 'Breev has no active authenticated identity session. Sign in in the installed Breev app and run this script again.'
}

[ordered]@{
    pharmacyId = $state.pharmacy.id
    pharmacyName = $state.pharmacy.name
    mainDeviceId = $binding.deviceId
    identitySessionId = $state.session.id
    identitySessionExpiresAt = $state.session.expiresAt
    source = 'Installed Breev runtime only (127.0.0.1:31310)'
} | ConvertTo-Json
