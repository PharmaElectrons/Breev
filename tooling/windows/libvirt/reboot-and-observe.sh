#!/usr/bin/env bash
set -euo pipefail

connection=qemu:///system
domain_name=breev-issue-34-win11
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)

usage() {
  echo "usage: $0 --run-id UUID --snapshot-id ID --source-commit SHA [--name DOMAIN] [--output PATH]" >&2
  exit 2
}

run_id=
snapshot_id=
source_commit=
output_path=
while (($# > 0)); do
  case "$1" in
    --run-id) run_id=${2:-}; shift 2 ;;
    --snapshot-id) snapshot_id=${2:-}; shift 2 ;;
    --source-commit) source_commit=${2:-}; shift 2 ;;
    --name) domain_name=${2:-}; shift 2 ;;
    --output) output_path=${2:-}; shift 2 ;;
    *) usage ;;
  esac
done
[[ "$run_id" =~ ^[0-9a-fA-F-]{36}$ && -n "$snapshot_id" && "$source_commit" =~ ^[0-9a-f]{40}$ ]] || usage
[[ "$domain_name" =~ ^breev-issue-34-[a-zA-Z0-9._-]+$ ]] || {
  echo "Refusing to reboot a domain outside the disposable issue-34 namespace" >&2
  exit 1
}
if [[ -z "$output_path" ]]; then
  output_path="$repo_root/artifacts/windows/evidence/$run_id/host-reboot.json"
fi

for command_name in jq virsh; do
  command -v "$command_name" >/dev/null || { echo "Missing host command: $command_name" >&2; exit 1; }
done
[[ "$(virsh --connect "$connection" domstate "$domain_name")" == "running" ]] || {
  echo "The Windows proof domain is not running" >&2
  exit 1
}
baseline_manifest="$repo_root/artifacts/windows/host-cache/${domain_name}-${snapshot_id}-baseline.json"
[[ -f "$baseline_manifest" &&
   "$(jq -r .runId "$baseline_manifest")" == "$run_id" &&
   "$(jq -r .sourceCommit "$baseline_manifest")" == "$source_commit" &&
   "$(jq -r .domainUuid "$baseline_manifest")" == "$(virsh --connect "$connection" domuuid "$domain_name")" ]] || {
  echo "The reboot target does not match the correlated disposable baseline" >&2
  exit 1
}
viewer_process_count=$(ps -C virt-viewer -C remote-viewer -o args= 2>/dev/null | awk -v domain="$domain_name" 'index($0, domain) { count++ } END { print count + 0 }')
spice_display=$(virsh --connect "$connection" domdisplay "$domain_name")
spice_port=${spice_display##*:}
spice_client_count=$(ss -Hnt state established "( sport = :$spice_port )" | awk 'END { print NR + 0 }')
[[ "$viewer_process_count" -eq 0 && "$spice_client_count" -eq 0 ]] || {
  echo "Close every viewer before the no-login reboot proof" >&2
  exit 1
}
virsh --connect "$connection" qemu-agent-command "$domain_name" '{"execute":"guest-ping"}' >/dev/null
domain_uuid=$(virsh --connect "$connection" domuuid "$domain_name")
machine_type=$(virsh --connect "$connection" dumpxml "$domain_name" | sed -n "s/.*<type arch='x86_64' machine='\([^']*\)'.*/\1/p")
requested_at=$(date --utc +%FT%T.%NZ)
virsh --connect "$connection" reboot "$domain_name" --mode agent >/dev/null

agent_went_away=false
deadline=$((SECONDS + 180))
while ((SECONDS < deadline)); do
  if virsh --connect "$connection" qemu-agent-command "$domain_name" '{"execute":"guest-ping"}' >/dev/null 2>&1; then
    if [[ "$agent_went_away" == true ]]; then
      break
    fi
  else
    agent_went_away=true
  fi
  sleep 1
done
[[ "$agent_went_away" == true ]] || { echo "The host never observed the guest agent leave during reboot" >&2; exit 1; }
virsh --connect "$connection" qemu-agent-command "$domain_name" '{"execute":"guest-ping"}' >/dev/null
observed_at=$(date --utc +%FT%T.%NZ)
mkdir -p -- "$(dirname -- "$output_path")"
jq -n \
  --arg runId "$run_id" \
  --arg sourceCommit "$source_commit" \
  --arg snapshotId "$snapshot_id" \
  --arg domain "$domain_name" \
  --arg domainUuid "$domain_uuid" \
  --arg machineType "$machine_type" \
  --arg requestedAtUtc "$requested_at" \
  --arg observedAtUtc "$observed_at" \
  --argjson viewerProcessCount "$viewer_process_count" --argjson spiceClientCount "$spice_client_count" \
  '{schemaVersion:1,runId:$runId,sourceCommit:$sourceCommit,snapshotId:$snapshotId,domain:$domain,domainUuid:$domainUuid,machineType:$machineType,rebootRequestedAtUtc:$requestedAtUtc,guestAgentReturnedAtUtc:$observedAtUtc,viewerProcessCountAtRequest:$viewerProcessCount,spiceClientCountAtRequest:$spiceClientCount,passed:($viewerProcessCount == 0 and $spiceClientCount == 0)}' \
  > "$output_path"
echo "$output_path"
