#!/usr/bin/env bash
set -euo pipefail

connection=qemu:///system
domain_name=breev-issue-34-win11
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)

usage() {
  echo "usage: $0 --snapshot-id ID --run-id UUID --source-commit SHA [--name DOMAIN]" >&2
  exit 2
}

snapshot_id=
run_id=
source_commit=
while (($# > 0)); do
  case "$1" in
    --snapshot-id) snapshot_id=${2:-}; shift 2 ;;
    --run-id) run_id=${2:-}; shift 2 ;;
    --source-commit) source_commit=${2:-}; shift 2 ;;
    --name) domain_name=${2:-}; shift 2 ;;
    *) usage ;;
  esac
done
[[ "$snapshot_id" =~ ^[a-zA-Z0-9._-]+$ && "$run_id" =~ ^[0-9a-fA-F-]{36}$ && "$source_commit" =~ ^[0-9a-f]{40}$ ]] || usage
[[ "$domain_name" =~ ^breev-issue-34-[a-zA-Z0-9._-]+$ ]] || {
  echo "Refusing to snapshot a domain outside the disposable issue-34 namespace" >&2
  exit 1
}
[[ "$(virsh --connect "$connection" domstate "$domain_name")" == "shut off" ]] || {
  echo "Power off the disposable domain before capturing its indivisible baseline" >&2
  exit 1
}

xml=$(virsh --connect "$connection" dumpxml "$domain_name" --inactive)
domain_uuid=$(virsh --connect "$connection" domuuid "$domain_name")
machine_type=$(sed -n "s/.*<type arch='x86_64' machine='\([^']*\)'.*/\1/p" <<<"$xml")
disk_path=$(virsh --connect "$connection" domblklist "$domain_name" --details --inactive | awk '$2 == "disk" {print $4; exit}')
windows_iso_path=$(virsh --connect "$connection" domblklist "$domain_name" --details --inactive | awk '$2 == "cdrom" && $4 ~ /windows11-25h2-/ {print $4; exit}')
nvram_path=$(sed -n 's|.*<nvram[^>]*>\(.*\)</nvram>.*|\1|p' <<<"$xml")
tpm_path="/var/lib/libvirt/swtpm/$domain_uuid"
for source_path in "$disk_path" "$nvram_path" "$tpm_path"; do
  [[ "$source_path" == /var/lib/libvirt/* && -e "$source_path" ]] || {
    echo "Missing or unsafe disposable-domain state path: $source_path" >&2
    exit 1
  }
done
[[ -f "$windows_iso_path" ]] || { echo "The pinned Windows installation media is absent from the domain" >&2; exit 1; }
windows_iso_hash=$(pkexec sha256sum "$windows_iso_path" | awk '{print $1}')
[[ "$windows_iso_hash" == "768984706b909479417b2368438909440f2967ff05c6a9195ed2667254e465e3" ]] || {
  echo "The domain is not tied to the pinned official Windows 11 25H2 media" >&2
  exit 1
}
windows_iso_bytes=$(pkexec stat -c %s "$windows_iso_path")
configured_disk_bytes=$(pkexec qemu-img info --output=json "$disk_path" | jq -er '."virtual-size"')

baseline_root="/var/lib/libvirt/images/.breev-issue34-baselines/$domain_name/$snapshot_id"
if pkexec test -e "$baseline_root"; then
  echo "The immutable baseline already exists: $baseline_root" >&2
  exit 1
fi
temporary_xml=$(mktemp)
trap 'gio trash "$temporary_xml" >/dev/null 2>&1 || true' EXIT
printf '%s\n' "$xml" > "$temporary_xml"
pkexec mkdir -p "$baseline_root"
pkexec cp -a --reflink=auto --sparse=always -- "$disk_path" "$baseline_root/disk.qcow2"
pkexec cp -a --reflink=auto -- "$nvram_path" "$baseline_root/nvram.fd"
pkexec cp -a -- "$tpm_path" "$baseline_root/tpm"
pkexec install -m 0600 -- "$temporary_xml" "$baseline_root/domain.xml"
pkexec qemu-img check "$baseline_root/disk.qcow2" >/dev/null

disk_hash=$(pkexec sha256sum "$baseline_root/disk.qcow2" | awk '{print $1}')
nvram_hash=$(pkexec sha256sum "$baseline_root/nvram.fd" | awk '{print $1}')
tpm_hash=$(pkexec tar -C "$baseline_root/tpm" -cf - . | sha256sum | awk '{print $1}')
xml_hash=$(sha256sum "$temporary_xml" | awk '{print $1}')
manifest_path="$repo_root/artifacts/windows/host-cache/${domain_name}-${snapshot_id}-baseline.json"
mkdir -p -- "$(dirname -- "$manifest_path")"
jq -n \
  --arg snapshotId "$snapshot_id" --arg domain "$domain_name" --arg domainUuid "$domain_uuid" \
  --arg runId "$run_id" --arg sourceCommit "$source_commit" \
  --arg machineType "$machine_type" --arg virtualization "kvm" \
  --arg windowsIsoSha256 "$windows_iso_hash" --argjson windowsIsoBytes "$windows_iso_bytes" --argjson configuredDiskBytes "$configured_disk_bytes" \
  --arg baselineRoot "$baseline_root" --arg diskSha256 "$disk_hash" --arg nvramSha256 "$nvram_hash" \
  --arg tpmSha256 "$tpm_hash" --arg domainXmlSha256 "$xml_hash" --arg capturedAtUtc "$(date --utc +%FT%T.%NZ)" \
  '{schemaVersion:1,runId:$runId,sourceCommit:$sourceCommit,snapshotId:$snapshotId,domain:$domain,domainUuid:$domainUuid,machineType:$machineType,virtualization:$virtualization,windowsIsoSha256:$windowsIsoSha256,windowsIsoBytes:$windowsIsoBytes,configuredDiskBytes:$configuredDiskBytes,baselineRoot:$baselineRoot,diskSha256:$diskSha256,nvramSha256:$nvramSha256,tpmSha256:$tpmSha256,domainXmlSha256:$domainXmlSha256,capturedAtUtc:$capturedAtUtc,indivisibleState:["disk","uefi-nvram","swtpm","domain-xml"],passed:true}' \
  > "$manifest_path"
echo "$manifest_path"
