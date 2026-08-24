#!/usr/bin/env bash
set -euo pipefail

connection=qemu:///system
domain_name=breev-issue-34-win11
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)

usage() {
  echo "usage: $0 --snapshot-id ID --acknowledge-disposable-restore [--name DOMAIN] [--output PATH]" >&2
  exit 2
}

snapshot_id=
acknowledged=false
output_path=
while (($# > 0)); do
  case "$1" in
    --snapshot-id) snapshot_id=${2:-}; shift 2 ;;
    --name) domain_name=${2:-}; shift 2 ;;
    --output) output_path=${2:-}; shift 2 ;;
    --acknowledge-disposable-restore) acknowledged=true; shift ;;
    *) usage ;;
  esac
done
[[ "$snapshot_id" =~ ^[a-zA-Z0-9._-]+$ && "$acknowledged" == true ]] || usage
[[ "$domain_name" =~ ^breev-issue-34-[a-zA-Z0-9._-]+$ ]] || {
  echo "Refusing to restore a domain outside the disposable issue-34 namespace" >&2
  exit 1
}
[[ "$(virsh --connect "$connection" domstate "$domain_name")" == "shut off" ]] || {
  echo "Power off the disposable domain before restoring its baseline" >&2
  exit 1
}

manifest_path="$repo_root/artifacts/windows/host-cache/${domain_name}-${snapshot_id}-baseline.json"
[[ -f "$manifest_path" ]] || { echo "Missing baseline manifest: $manifest_path" >&2; exit 1; }
baseline_root=$(jq -r .baselineRoot "$manifest_path")
expected_uuid=$(jq -r .domainUuid "$manifest_path")
run_id=$(jq -r .runId "$manifest_path")
source_commit=$(jq -r .sourceCommit "$manifest_path")
if [[ -z "$output_path" ]]; then
  output_path="$repo_root/artifacts/windows/evidence/$run_id/host-restore.json"
fi
[[ "$baseline_root" == "/var/lib/libvirt/images/.breev-issue34-baselines/$domain_name/$snapshot_id" ]] || {
  echo "The baseline manifest resolves outside the exact disposable target" >&2
  exit 1
}
[[ "$(virsh --connect "$connection" domuuid "$domain_name")" == "$expected_uuid" ]] || {
  echo "The domain identity does not match the baseline" >&2
  exit 1
}

temporary_xml=$(mktemp)
restored_xml=$(mktemp)
trap 'gio trash "$temporary_xml" "$restored_xml" >/dev/null 2>&1 || true' EXIT
pkexec cat "$baseline_root/domain.xml" > "$temporary_xml"
[[ "$(sha256sum "$temporary_xml" | awk '{print $1}')" == "$(jq -r .domainXmlSha256 "$manifest_path")" ]] || {
  echo "The retained domain definition does not match the baseline manifest" >&2
  exit 1
}
[[ "$(sed -n "s|.*<uuid>\(.*\)</uuid>.*|\1|p" "$temporary_xml")" == "$expected_uuid" ]] || {
  echo "The retained domain definition has the wrong UUID" >&2
  exit 1
}
disk_path=$(sed -n "/<disk type='file' device='disk'>/,/<\/disk>/ s|.*<source file='\([^']*\)'.*|\1|p" "$temporary_xml" | head -1)
nvram_path=$(sed -n 's|.*<nvram[^>]*>\(.*\)</nvram>.*|\1|p' "$temporary_xml")
tpm_path="/var/lib/libvirt/swtpm/$expected_uuid"
for target_path in "$disk_path" "$nvram_path" "$tpm_path"; do
  [[ "$target_path" == /var/lib/libvirt/* && -e "$target_path" ]] || {
    echo "Missing or unsafe disposable-domain state path: $target_path" >&2
    exit 1
  }
done

pkexec cp -a --reflink=auto --sparse=always -- "$baseline_root/disk.qcow2" "$disk_path"
pkexec cp -a --reflink=auto -- "$baseline_root/nvram.fd" "$nvram_path"
pkexec find "$tpm_path" -mindepth 1 -delete
pkexec cp -aT -- "$baseline_root/tpm" "$tpm_path"
virsh --connect "$connection" define "$temporary_xml" >/dev/null
pkexec qemu-img check "$disk_path" >/dev/null

disk_hash=$(pkexec sha256sum "$disk_path" | awk '{print $1}')
nvram_hash=$(pkexec sha256sum "$nvram_path" | awk '{print $1}')
tpm_hash=$(pkexec tar -C "$tpm_path" -cf - . | sha256sum | awk '{print $1}')
[[ "$disk_hash" == "$(jq -r .diskSha256 "$manifest_path")" ]]
[[ "$nvram_hash" == "$(jq -r .nvramSha256 "$manifest_path")" ]]
[[ "$tpm_hash" == "$(jq -r .tpmSha256 "$manifest_path")" ]]
virsh --connect "$connection" dumpxml "$domain_name" --inactive > "$restored_xml"
xml_hash=$(sha256sum "$restored_xml" | awk '{print $1}')
[[ "$xml_hash" == "$(jq -r .domainXmlSha256 "$manifest_path")" ]]
mkdir -p -- "$(dirname -- "$output_path")"
jq -n \
  --arg runId "$run_id" --arg sourceCommit "$source_commit" --arg snapshotId "$snapshot_id" \
  --arg domain "$domain_name" --arg domainUuid "$expected_uuid" --arg restoredAtUtc "$(date --utc +%FT%T.%NZ)" \
  --arg diskSha256 "$disk_hash" --arg nvramSha256 "$nvram_hash" --arg tpmSha256 "$tpm_hash" --arg domainXmlSha256 "$xml_hash" \
  '{schemaVersion:1,runId:$runId,sourceCommit:$sourceCommit,snapshotId:$snapshotId,domain:$domain,domainUuid:$domainUuid,diskSha256:$diskSha256,nvramSha256:$nvramSha256,tpmSha256:$tpmSha256,domainXmlSha256:$domainXmlSha256,restoredAtUtc:$restoredAtUtc,indivisibleState:["disk","uefi-nvram","swtpm","domain-xml"],passed:true}' \
  > "$output_path"
echo "$output_path"
