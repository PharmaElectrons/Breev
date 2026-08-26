#!/usr/bin/env bash
set -euo pipefail

connection=qemu:///system
windows_domain=breev-issue-34-win11
peer_domain=breev-issue-34-peer
peer_address=192.168.134.2
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)
cache_root="$repo_root/artifacts/windows/host-cache"
peer_key="$cache_root/issue-34-peer-ed25519"
known_hosts="$cache_root/issue-34-peer-known-hosts"
guest_result='C:\ProgramData\Breev\state\issue-34-peer.json'

usage() {
  echo "usage: $0 --windows-address IP --run-id UUID --source-commit SHA --snapshot-id ID [--output PATH]" >&2
  exit 2
}

windows_address=
run_id=
source_commit=
snapshot_id=
output_path=
while (($# > 0)); do
  case "$1" in
    --windows-address) windows_address=${2:-}; shift 2 ;;
    --run-id) run_id=${2:-}; shift 2 ;;
    --source-commit) source_commit=${2:-}; shift 2 ;;
    --snapshot-id) snapshot_id=${2:-}; shift 2 ;;
    --output) output_path=${2:-}; shift 2 ;;
    *) usage ;;
  esac
done
[[ "$windows_address" =~ ^192\.168\.134\.[0-9]+$ && "$run_id" =~ ^[0-9a-fA-F-]{36}$ && "$source_commit" =~ ^[0-9a-f]{40}$ && -n "$snapshot_id" ]] || usage
if [[ -z "$output_path" ]]; then
  output_path="$repo_root/artifacts/windows/evidence/$run_id/peer-lan-refusal.json"
fi
[[ -f "$peer_key" ]] || { echo "The task-specific peer SSH key is missing" >&2; exit 1; }

if [[ "$(virsh --connect "$connection" domstate "$peer_domain")" != "running" ]]; then
  virsh --connect "$connection" start "$peer_domain" >/dev/null
fi
ssh_options=(-i "$peer_key" -o BatchMode=yes -o ConnectTimeout=3 -o StrictHostKeyChecking=accept-new -o "UserKnownHostsFile=$known_hosts")
deadline=$((SECONDS + 60))
until ssh "${ssh_options[@]}" "root@$peer_address" true >/dev/null 2>&1; do
  ((SECONDS < deadline)) || { echo "The disposable LAN peer did not become ready" >&2; exit 1; }
  sleep 1
done

scp "${ssh_options[@]}" "$repo_root/tooling/windows/proof/probe-lan-refusal.mjs" "root@$peer_address:/tmp/probe-lan-refusal.mjs" >/dev/null
ssh "${ssh_options[@]}" "root@$peer_address" node /tmp/probe-lan-refusal.mjs \
  --host "$windows_address" --port 31311 --source-address "$peer_address" \
  --run-id "$run_id" --source-commit "$source_commit" --snapshot-id "$snapshot_id" \
  --output /tmp/peer-lan-refusal.json >/dev/null
mkdir -p -- "$(dirname -- "$output_path")"
scp "${ssh_options[@]}" "root@$peer_address:/tmp/peer-lan-refusal.json" "$output_path" >/dev/null
jq -e --arg runId "$run_id" --arg source "$peer_address" '.passed and .runId == $runId and .sourceAddress == $source and .sourceAddressAssigned and (.sourceInterfaces | length) > 0' "$output_path" >/dev/null

open_request=$(jq -cn --arg path "$guest_result" '{execute:"guest-file-open",arguments:{path:$path,mode:"w"}}')
handle=$(virsh --connect "$connection" qemu-agent-command "$windows_domain" "$open_request" | jq -er .return)
close_guest_file() {
  virsh --connect "$connection" qemu-agent-command "$windows_domain" "$(jq -cn --argjson handle "$handle" '{execute:"guest-file-close",arguments:{handle:$handle}}')" >/dev/null 2>&1 || true
}
trap close_guest_file EXIT
content=$(base64 -w0 -- "$output_path")
write_request=$(jq -cn --argjson handle "$handle" --arg content "$content" '{execute:"guest-file-write",arguments:{handle:$handle,"buf-b64":$content}}')
virsh --connect "$connection" qemu-agent-command "$windows_domain" "$write_request" | jq -e '.return.count > 0' >/dev/null
close_guest_file
trap - EXIT
echo "$guest_result"
