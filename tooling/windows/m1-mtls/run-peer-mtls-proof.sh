#!/usr/bin/env bash
# Drives the disposable Windows Main and Alpine peer through the three #134
# pairing/mTLS cases. The installed API is temporarily restarted under its
# original BreevLocalApi service identity with a synthetic licence public-key
# registry; its production parser, entitlement, pairing, CA, and mTLS code run
# unchanged. The original service command is restored on every exit path.
set -euo pipefail

mtls_script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
mtls_repo_root=$(cd -- "$mtls_script_dir/../../.." && pwd)
# Read-only dependency owned by the lifecycle leaf.
# shellcheck source=tooling/windows/m1/guest-agent.sh
source "$mtls_repo_root/tooling/windows/m1/guest-agent.sh"

mtls_connection=qemu:///system
mtls_peer_domain=breev-issue-34-peer
mtls_peer_address=192.168.134.2
mtls_windows_address=
mtls_lan_port=
mtls_run_id=
mtls_source_commit=
mtls_cache_root="$mtls_repo_root/artifacts/windows/host-cache"
mtls_peer_key="$mtls_cache_root/issue-34-peer-ed25519"
mtls_known_hosts="$mtls_cache_root/issue-34-peer-known-hosts"
mtls_output_root="$mtls_script_dir/out"
mtls_host_temp=
mtls_guest_root=
mtls_peer_root=
mtls_guest_driver=
mtls_guest_api_helper=
mtls_service_may_need_restore=false
mtls_guest_staged=false
mtls_peer_staged=false

mtls_usage() {
  cat >&2 <<'USAGE'
usage: run-peer-mtls-proof.sh --windows-address IP --lan-port PORT --run-id UUID --source-commit SHA

The issue-34 topology uses Windows 192.168.134.154, Alpine 192.168.134.2,
and the installed LAN API default 31312. Port 31311 is private PostgreSQL.
USAGE
}

while (($# > 0)); do
  case "$1" in
    --windows-address) mtls_windows_address=${2:-}; shift 2 ;;
    --lan-port) mtls_lan_port=${2:-}; shift 2 ;;
    --run-id) mtls_run_id=${2:-}; shift 2 ;;
    --source-commit) mtls_source_commit=${2:-}; shift 2 ;;
    -h | --help) mtls_usage; exit 0 ;;
    *) mtls_usage; exit 2 ;;
  esac
done

[[ "$mtls_windows_address" =~ ^192\.168\.134\.([1-9]|[1-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|25[0-4])$ ]] ||
  { echo "--windows-address must be a concrete address on the isolated issue-34 LAN" >&2; exit 2; }
[[ "$mtls_lan_port" =~ ^[0-9]+$ ]] && ((mtls_lan_port > 0 && mtls_lan_port <= 65535)) ||
  { echo "--lan-port must be a valid TCP port" >&2; exit 2; }
((mtls_lan_port != 31310 && mtls_lan_port != 31311)) ||
  { echo "--lan-port must not expose loopback API 31310 or PostgreSQL 31311" >&2; exit 2; }
[[ "$mtls_run_id" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] ||
  { echo "--run-id must be a UUID" >&2; exit 2; }
[[ "$mtls_source_commit" =~ ^[0-9a-f]{40}$ ]] ||
  { echo "--source-commit must be a 40-character lowercase SHA" >&2; exit 2; }
[[ -f "$mtls_peer_key" ]] || { echo "The issue-34 peer SSH key is missing" >&2; exit 1; }
for mtls_tool in jq node scp ssh virsh; do
  command -v "$mtls_tool" >/dev/null || { echo "Missing host command: $mtls_tool" >&2; exit 1; }
done

mtls_host_temp=$(mktemp -d -t breev-m1-mtls.XXXXXXXX)
mtls_guest_root="C:\\ProgramData\\Breev\\state\\m1-mtls-$mtls_run_id"
mtls_peer_root="/tmp/breev-m1-mtls-$mtls_run_id"
mtls_guest_driver="$mtls_guest_root\\main-pairing-operator.mjs"
mtls_guest_api_helper="$mtls_guest_root\\guest-proof-api.ps1"
mtls_ssh_options=(
  -i "$mtls_peer_key"
  -o BatchMode=yes
  -o ConnectTimeout=5
  -o StrictHostKeyChecking=accept-new
  -o "UserKnownHostsFile=$mtls_known_hosts"
)

mtls_cleanup() {
  local cleanup_status=$?
  set +e
  if [[ "$mtls_service_may_need_restore" == true ]]; then
    guest_powershell_file "$mtls_guest_api_helper" -Action Stop -ProofRoot "$mtls_guest_root" >/dev/null 2>&1
  fi
  if [[ "$mtls_guest_staged" == true ]]; then
    guest_powershell_command "Remove-Item -LiteralPath '${mtls_guest_root//\'/\'\'}' -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item -LiteralPath 'C:\ProgramData\Breev\logs\local-api\m1-mtls-proof' -Recurse -Force -ErrorAction SilentlyContinue" >/dev/null 2>&1
  fi
  if [[ "$mtls_peer_staged" == true ]]; then
    ssh "${mtls_ssh_options[@]}" "root@$mtls_peer_address" rm -rf -- "$mtls_peer_root" >/dev/null 2>&1
  fi
  if [[ -n "$mtls_host_temp" && -d "$mtls_host_temp" ]]; then
    rm -rf -- "$mtls_host_temp"
  fi
  return "$cleanup_status"
}
trap mtls_cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

guest_require_running
if [[ "$(virsh --connect "$mtls_connection" domstate "$mtls_peer_domain" 2>/dev/null)" != "running" ]]; then
  virsh --connect "$mtls_connection" start "$mtls_peer_domain" >/dev/null
fi

mtls_deadline=$((SECONDS + 60))
until ssh "${mtls_ssh_options[@]}" "root@$mtls_peer_address" true >/dev/null 2>&1; do
  ((SECONDS < mtls_deadline)) || { echo "The disposable Alpine peer did not become ready" >&2; exit 1; }
  sleep 1
done
ssh "${mtls_ssh_options[@]}" "root@$mtls_peer_address" \
  "ip -4 -o addr show | grep -F ' $mtls_peer_address/' >/dev/null && node -e 'if (Number(process.versions.node.split(\".\")[0]) < 22) process.exit(1)'"

guest_powershell_command "New-Item -ItemType Directory -Force -Path '${mtls_guest_root//\'/\'\'}', '${mtls_guest_root//\'/\'\'}\\out' | Out-Null"
mtls_guest_staged=true
for mtls_file in \
  guest-proof-api.ps1 \
  licence-key-override.mjs \
  main-pairing-operator.mjs \
  seed-pairing-prereqs.mjs; do
  guest_upload_file "$mtls_script_dir/$mtls_file" "$mtls_guest_root\\$mtls_file"
done

ssh "${mtls_ssh_options[@]}" "root@$mtls_peer_address" mkdir -p -- "$mtls_peer_root/out"
mtls_peer_staged=true
scp "${mtls_ssh_options[@]}" \
  "$mtls_script_dir/der.mjs" \
  "$mtls_script_dir/peer-terminal-client.mjs" \
  "$mtls_script_dir/terminal-identity.mjs" \
  "$mtls_script_dir/peer-mtls-driver.mjs" \
  "root@$mtls_peer_address:$mtls_peer_root/" >/dev/null

mtls_guest_node='C:\Program Files\Breev\resources\windows-payload\node\node.exe'
mtls_guest_api_root='C:\Program Files\Breev\resources\windows-payload\local-api'
mtls_main_device_file='C:\ProgramData\Breev\config\main-device.json'
mtls_schema_owner_url='C:\ProgramData\Breev\config\schema-owner-url'
# The public half persists under the fixed synthetic fixture identity so a
# second run can verify the already-installed synthetic licence. Its private
# half is removed immediately after the idempotent seed transaction.
mtls_guest_issuer='C:\ProgramData\Breev\state\m1-mtls-synthetic-issuer'
mtls_guest_out="$mtls_guest_root\\out"
mtls_guest_invitation="$mtls_guest_root\\invitation.json"

guest_exec "$mtls_guest_node" "$mtls_guest_root\\seed-pairing-prereqs.mjs" \
  --prepare-issuer --issuer-directory "$mtls_guest_issuer" >/dev/null
guest_exec "$mtls_guest_node" "$mtls_guest_root\\seed-pairing-prereqs.mjs" \
  --database-url-file "$mtls_schema_owner_url" \
  --issuer-directory "$mtls_guest_issuer" \
  --main-device-file "$mtls_main_device_file" \
  --output-dir "$mtls_guest_out" \
  --pg-package-root "$mtls_guest_api_root" >/dev/null
# Signing material exists only long enough to mint the synthetic disposable
# licence. The API process receives the public registry, never this private key.
guest_powershell_command "Remove-Item -LiteralPath '${mtls_guest_issuer//\'/\'\'}\\licence-signing-key.pem' -Force -ErrorAction SilentlyContinue"
mtls_service_may_need_restore=true
guest_powershell_file "$mtls_guest_api_helper" -Action Start -ProofRoot "$mtls_guest_root" \
  -IssuerDirectory "$mtls_guest_issuer" \
  -WindowsAddress "$mtls_windows_address" -LanPort "$mtls_lan_port" >/dev/null

guest_exec "$mtls_guest_node" "$mtls_guest_driver" \
  --action cancel-current \
  --main-device-file "$mtls_main_device_file" \
  --seed-result "$mtls_guest_out\\seed-result.json" \
  --port 31310 >/dev/null
mtls_start_json=$(guest_exec "$mtls_guest_node" "$mtls_guest_driver" \
  --action start \
  --invitation-output "$mtls_guest_invitation" \
  --main-device-file "$mtls_main_device_file" \
  --seed-result "$mtls_guest_out\\seed-result.json" \
  --port 31310)
mtls_session_id=$(jq -er '.sessionId' <<<"$mtls_start_json")
guest_download_file "$mtls_guest_invitation" "$mtls_host_temp/invitation.json"
scp "${mtls_ssh_options[@]}" "$mtls_host_temp/invitation.json" \
  "root@$mtls_peer_address:$mtls_peer_root/invitation.json" >/dev/null

mtls_remote_common=(
  --host "$mtls_windows_address"
  --port "$mtls_lan_port"
  --invitation-file "$mtls_peer_root/invitation.json"
  --output-dir "$mtls_peer_root/out"
  --run-id "$mtls_run_id"
  --source-commit "$mtls_source_commit"
)
ssh "${mtls_ssh_options[@]}" "root@$mtls_peer_address" node \
  "$mtls_peer_root/peer-mtls-driver.mjs" --case accepted \
  "${mtls_remote_common[@]}" --poll-interval-ms 250 --poll-deadline-ms 60000 \
  >"$mtls_host_temp/accepted.stdout" 2>"$mtls_host_temp/accepted.stderr" &
mtls_accepted_pid=$!

mtls_deadline=$((SECONDS + 60))
while ((SECONDS < mtls_deadline)); do
  kill -0 "$mtls_accepted_pid" 2>/dev/null || {
    wait "$mtls_accepted_pid" || true
    echo "The accepted peer exited before confirmation: $(<"$mtls_host_temp/accepted.stderr")" >&2
    exit 1
  }
  mtls_state_json=$(guest_exec "$mtls_guest_node" "$mtls_guest_driver" \
    --action state \
    --main-device-file "$mtls_main_device_file" \
    --seed-result "$mtls_guest_out\\seed-result.json" \
    --port 31310)
  [[ "$(jq -r '.state' <<<"$mtls_state_json")" == "awaiting-confirmation" ]] && break
  sleep 1
done
[[ "$(jq -r '.state // empty' <<<"${mtls_state_json:-{}}")" == "awaiting-confirmation" ]] ||
  { echo "The peer did not reach pairing confirmation" >&2; exit 1; }

guest_exec "$mtls_guest_node" "$mtls_guest_driver" \
  --action confirm \
  --session-id "$mtls_session_id" \
  --main-device-file "$mtls_main_device_file" \
  --seed-result "$mtls_guest_out\\seed-result.json" \
  --port 31310 >/dev/null
if ! wait "$mtls_accepted_pid"; then
  echo "The accepted peer case failed: $(<"$mtls_host_temp/accepted.stderr")" >&2
  exit 1
fi

for mtls_case in foreign missing; do
  ssh "${mtls_ssh_options[@]}" "root@$mtls_peer_address" node \
    "$mtls_peer_root/peer-mtls-driver.mjs" --case "$mtls_case" \
    "${mtls_remote_common[@]}" >/dev/null
done

for mtls_case in accepted foreign missing; do
  scp "${mtls_ssh_options[@]}" \
    "root@$mtls_peer_address:$mtls_peer_root/out/$mtls_case.json" \
    "$mtls_host_temp/$mtls_case.json" >/dev/null
done
node "$mtls_script_dir/aggregate-mtls-results.mjs" \
  --input-dir "$mtls_host_temp" \
  --output "$mtls_host_temp/aggregate.json" \
  --run-id "$mtls_run_id" \
  --source-commit "$mtls_source_commit" >/dev/null

mkdir -p -- "$mtls_output_root"
for mtls_result in accepted foreign missing aggregate; do
  install -m 600 "$mtls_host_temp/$mtls_result.json" "$mtls_output_root/$mtls_result.json"
done
echo "$mtls_output_root/aggregate.json"
