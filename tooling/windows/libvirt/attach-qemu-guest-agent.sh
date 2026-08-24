#!/usr/bin/env bash
set -euo pipefail

connection=qemu:///system
domain_name=breev-issue-34-win11
agent_version=110.0.2-1.el10
agent_hash=c50ea2e7c04730a1097ab6c112138645be4da26015518329daebe8d3630e0790
agent_url="https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/archive-qemu-ga/qemu-ga-win-${agent_version}/qemu-ga-x86_64.msi"
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)
cache_root="$repo_root/artifacts/windows/host-cache"
agent_path="$cache_root/qemu-ga-x86_64-${agent_version}.msi"
iso_path="$cache_root/breev-issue-34-qemu-ga-${agent_version}.iso"
volume_name="breev-issue-34-qemu-ga-${agent_version}.iso"

if [[ ${1:-} == "--name" && -n ${2:-} && $# -eq 2 ]]; then
  domain_name=$2
elif (($# != 0)); then
  echo "usage: $0 [--name DOMAIN]" >&2
  exit 2
fi

for command_name in curl sha256sum virsh xorriso; do
  command -v "$command_name" >/dev/null || {
    echo "Missing host command: $command_name" >&2
    exit 1
  }
done
virsh --connect "$connection" dominfo "$domain_name" >/dev/null
mkdir -p -- "$cache_root"
if [[ ! -f "$agent_path" ]] || [[ "$(sha256sum -- "$agent_path" | awk '{print $1}')" != "$agent_hash" ]]; then
  curl --fail --location --show-error --output "$agent_path" "$agent_url"
fi
[[ "$(sha256sum -- "$agent_path" | awk '{print $1}')" == "$agent_hash" ]] || {
  echo "The pinned QEMU guest agent MSI hash does not match" >&2
  exit 1
}

xorriso -as mkisofs -quiet -V BREEV_QEMU_GA -o "$iso_path" "$agent_path"
if ! virsh --connect "$connection" vol-info --pool default "$volume_name" >/dev/null 2>&1; then
  virsh --connect "$connection" vol-create-as default "$volume_name" --capacity "$(stat -c %s -- "$iso_path")" --format raw
  virsh --connect "$connection" vol-upload --pool default "$volume_name" "$iso_path"
fi
managed_iso_path=$(virsh --connect "$connection" vol-path --pool default "$volume_name")
cdrom_target=$(virsh --connect "$connection" domblklist "$domain_name" --details | awk '$2 == "cdrom" { print $3; exit }')
if [[ -n "$cdrom_target" ]]; then
  virsh --connect "$connection" change-media "$domain_name" "$cdrom_target" "$managed_iso_path" --update --config
  if [[ "$(virsh --connect "$connection" domstate "$domain_name")" == "running" ]]; then
    virsh --connect "$connection" change-media "$domain_name" "$cdrom_target" "$managed_iso_path" --update --live
  fi
else
  attach_flags=(--config)
  if [[ "$(virsh --connect "$connection" domstate "$domain_name")" == "running" ]]; then
    attach_flags+=(--live)
  fi
  virsh --connect "$connection" attach-disk "$domain_name" "$managed_iso_path" sdc \
    --type cdrom --mode readonly "${attach_flags[@]}"
fi
echo "Attached the pinned QEMU guest agent MSI media to $domain_name."
