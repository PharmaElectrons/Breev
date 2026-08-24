#!/usr/bin/env bash
set -euo pipefail

connection=qemu:///system
domain_name=breev-issue-34-win11
model=e1000e
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)
state_path="$repo_root/artifacts/windows/host-cache/${domain_name}-nat-mac"

usage() {
  echo "usage: $0 disconnect|restore [--name DOMAIN] [--run-id UUID --snapshot-id ID --source-commit SHA --output PATH]" >&2
  exit 2
}

(($# > 0)) || usage
action=$1
shift
run_id=
snapshot_id=
source_commit=
output_path=
while (($# > 0)); do
  case "$1" in
    --name)
      (($# >= 2)) || usage
      domain_name=$2
      shift 2
      ;;
    --run-id) run_id=${2:-}; shift 2 ;;
    --snapshot-id) snapshot_id=${2:-}; shift 2 ;;
    --source-commit) source_commit=${2:-}; shift 2 ;;
    --output) output_path=${2:-}; shift 2 ;;
    *) usage ;;
  esac
done
[[ "$action" == "disconnect" || "$action" == "restore" ]] || usage
[[ "$domain_name" =~ ^breev-issue-34-[a-zA-Z0-9._-]+$ ]] || {
  echo "Refusing to mutate networking outside the disposable issue-34 namespace" >&2
  exit 1
}
[[ "$run_id" =~ ^[0-9a-fA-F-]{36}$ && -n "$snapshot_id" && "$source_commit" =~ ^[0-9a-f]{40}$ ]] || usage
state_path="$repo_root/artifacts/windows/host-cache/${domain_name}-nat-mac"

if [[ "$(virsh --connect "$connection" domstate "$domain_name")" != "running" ]]; then
  echo "The Windows proof domain must be running" >&2
  exit 1
fi
baseline_manifest="$repo_root/artifacts/windows/host-cache/${domain_name}-${snapshot_id}-baseline.json"
[[ -f "$baseline_manifest" &&
   "$(jq -r .runId "$baseline_manifest")" == "$run_id" &&
   "$(jq -r .sourceCommit "$baseline_manifest")" == "$source_commit" &&
   "$(jq -r .domainUuid "$baseline_manifest")" == "$(virsh --connect "$connection" domuuid "$domain_name")" ]] || {
  echo "The network target does not match the correlated disposable baseline" >&2
  exit 1
}

default_mac=$(virsh --connect "$connection" domiflist "$domain_name" | awk '$3 == "default" {print $5}')
case "$action" in
  disconnect)
    if [[ -z "$output_path" ]]; then
      output_path="$repo_root/artifacts/windows/evidence/$run_id/offline-network.json"
    fi
    [[ -n "$default_mac" ]] || {
      echo "The default NAT interface is already absent" >&2
      exit 1
    }
    mkdir -p -- "$(dirname -- "$state_path")"
    printf '%s\n' "$default_mac" > "$state_path"
    virsh --connect "$connection" detach-interface \
      --domain "$domain_name" --type network --mac "$default_mac" --live --config
    mapfile -t live_sources < <(virsh --connect "$connection" domiflist "$domain_name" | awk 'NR > 2 && NF >= 5 {print $3}')
    mapfile -t inactive_sources < <(virsh --connect "$connection" domiflist "$domain_name" --inactive | awk 'NR > 2 && NF >= 5 {print $3}')
    [[ "${#live_sources[@]}" -eq 1 && "${live_sources[0]}" == "breev-issue-34-isolated" &&
       "${#inactive_sources[@]}" -eq 1 && "${inactive_sources[0]}" == "breev-issue-34-isolated" ]] || {
      echo "The offline guest must retain only the isolated issue-34 interface" >&2
      exit 1
    }
    mkdir -p -- "$(dirname -- "$output_path")"
    jq -n \
      --arg runId "$run_id" --arg sourceCommit "$source_commit" --arg snapshotId "$snapshot_id" \
      --arg domain "$domain_name" --arg domainUuid "$(virsh --connect "$connection" domuuid "$domain_name")" \
      --arg disconnectedMac "$default_mac" --arg retainedNetwork "${live_sources[0]}" \
      --arg recordedAtUtc "$(date --utc +%FT%T.%NZ)" \
      '{schemaVersion:1,runId:$runId,sourceCommit:$sourceCommit,snapshotId:$snapshotId,domain:$domain,domainUuid:$domainUuid,disconnectedNatMac:$disconnectedMac,liveNetworks:[$retainedNetwork],inactiveNetworks:[$retainedNetwork],recordedAtUtc:$recordedAtUtc,passed:true}' \
      > "$output_path"
    ;;
  restore)
    if [[ -z "$output_path" ]]; then
      output_path="$repo_root/artifacts/windows/evidence/$run_id/network-restore.json"
    fi
    [[ -z "$default_mac" ]] || {
      echo "The default NAT interface is already attached" >&2
      exit 1
    }
    default_mac=$(virsh --connect "$connection" dumpxml "$domain_name" --inactive | awk '
      /<interface type=.network./ { in_interface=1; mac=""; source="" }
      in_interface && /<mac address=/ { line=$0; sub(/^.*address=./, "", line); sub(/..*$/, "", line); mac=line }
      in_interface && /source network=.default./ { source="default" }
      in_interface && /<\/interface>/ { if (source == "default") print mac; in_interface=0 }
    ')
    if [[ -z "$default_mac" ]]; then
      # A live+config detach removes the inactive definition, so use the fixed
      # proof-domain address retained by the host state file.
      [[ -f "$state_path" ]] || {
        echo "The NAT MAC state is missing: $state_path" >&2
        exit 1
      }
      default_mac=$(<"$state_path")
    fi
    virsh --connect "$connection" attach-interface \
      --domain "$domain_name" --type network --source default --model "$model" \
      --mac "$default_mac" --live --config
    mapfile -t live_sources < <(virsh --connect "$connection" domiflist "$domain_name" | awk 'NR > 2 && NF >= 5 {print $3}' | sort)
    mapfile -t inactive_sources < <(virsh --connect "$connection" domiflist "$domain_name" --inactive | awk 'NR > 2 && NF >= 5 {print $3}' | sort)
    expected_sources=(breev-issue-34-isolated default)
    [[ "${live_sources[*]}" == "${expected_sources[*]}" && "${inactive_sources[*]}" == "${expected_sources[*]}" ]] || {
      echo "The restored guest must have exactly its NAT and isolated interfaces" >&2
      exit 1
    }
    mkdir -p -- "$(dirname -- "$output_path")"
    jq -n \
      --arg runId "$run_id" --arg sourceCommit "$source_commit" --arg snapshotId "$snapshot_id" \
      --arg domain "$domain_name" --arg domainUuid "$(virsh --connect "$connection" domuuid "$domain_name")" \
      --arg recordedAtUtc "$(date --utc +%FT%T.%NZ)" \
      '{schemaVersion:1,runId:$runId,sourceCommit:$sourceCommit,snapshotId:$snapshotId,domain:$domain,domainUuid:$domainUuid,liveNetworks:["breev-issue-34-isolated","default"],inactiveNetworks:["breev-issue-34-isolated","default"],recordedAtUtc:$recordedAtUtc,passed:true}' \
      > "$output_path"
    ;;
esac

virsh --connect "$connection" domiflist "$domain_name"
echo "$output_path"
