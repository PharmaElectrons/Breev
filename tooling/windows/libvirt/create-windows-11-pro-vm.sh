#!/usr/bin/env bash
set -euo pipefail

connection=qemu:///system
domain_name=breev-issue-34-win11
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)
published_iso_hash=768984706b909479417b2368438909440f2967ff05c6a9195ed2667254e465e3

usage() {
  echo "usage: $0 --iso PATH [--name DOMAIN]" >&2
  exit 2
}

iso_path=
while (($# > 0)); do
  case "$1" in
    --iso)
      (($# >= 2)) || usage
      iso_path=$2
      shift 2
      ;;
    --name)
      (($# >= 2)) || usage
      domain_name=$2
      shift 2
      ;;
    *) usage ;;
  esac
done

[[ -n "$iso_path" ]] || usage
for command_name in sha256sum virsh virt-fw-vars virt-install; do
  command -v "$command_name" >/dev/null || { echo "Missing host command: $command_name" >&2; exit 1; }
done
iso_path=$(realpath -- "$iso_path")
[[ -f "$iso_path" ]] || {
  echo "Windows ISO not found: $iso_path" >&2
  exit 1
}

actual_iso_hash=$(sha256sum -- "$iso_path" | awk '{print $1}')
[[ "$actual_iso_hash" == "$published_iso_hash" ]] || {
  echo "Windows ISO hash does not match Microsoft's published value" >&2
  exit 1
}

if virsh --connect "$connection" dominfo "$domain_name" >/dev/null 2>&1; then
  echo "The libvirt domain already exists: $domain_name" >&2
  exit 1
fi

cache_root="$repo_root/artifacts/windows/host-cache"
secure_boot_vars="$cache_root/microsoft-windows11-secure-boot-vars.fd"
mkdir -p -- "$cache_root"
virt-fw-vars \
  --input /usr/share/edk2/x64/OVMF_VARS.4m.fd \
  --enroll-microsoft \
  --microsoft-db win11 \
  --microsoft-kek all \
  --secure-boot \
  --output "$secure_boot_vars"
chmod 0644 "$secure_boot_vars"

iso_volume="${domain_name}-windows11-25h2-${actual_iso_hash:0:12}.iso"
if virsh --connect "$connection" vol-info --pool default "$iso_volume" >/dev/null 2>&1; then
  echo "Refusing to reuse an existing Windows media volume without re-verifying it: $iso_volume" >&2
  exit 1
fi
virsh --connect "$connection" vol-create-as default "$iso_volume" --capacity "$(stat -c %s -- "$iso_path")" --format raw
virsh --connect "$connection" vol-upload --pool default "$iso_volume" "$iso_path"
managed_iso_path=$(virsh --connect "$connection" vol-path --pool default "$iso_volume")
created=false
cleanup() {
  if [[ "$created" != true ]]; then
    virsh --connect "$connection" vol-delete --pool default "$iso_volume" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

virt-install \
  --connect "$connection" \
  --name "$domain_name" \
  --memory 8192 \
  --vcpus 4,sockets=1,cores=4,threads=1 \
  --cpu host-passthrough \
  --machine pc-q35-11.1 \
  --osinfo win11 \
  --boot loader=/usr/share/edk2/x64/OVMF_CODE.secboot.4m.fd,loader.readonly=yes,loader.secure=yes,loader.type=pflash,nvram.template="$secure_boot_vars",nvram.templateFormat=raw \
  --features smm.state=on \
  --tpm backend.type=emulator,backend.version=2.0,model=tpm-crb \
  --disk pool=default,size=256,format=qcow2,bus=sata,cache=none,target.rotation_rate=1 \
  --cdrom "$managed_iso_path" \
  --network network=default,model=e1000e \
  --network network=breev-issue-34-isolated,model=e1000e \
  --graphics spice \
  --video vga \
  --channel unix,target.type=virtio,target.name=org.qemu.guest_agent.0 \
  --noautoconsole

created=true

virsh --connect "$connection" autostart "$domain_name" --disable
domain_uuid=$(virsh --connect "$connection" domuuid "$domain_name")
machine_type=$(virsh --connect "$connection" dumpxml "$domain_name" --inactive | sed -n "s/.*<type arch='x86_64' machine='\([^']*\)'.*/\1/p")
creation_manifest="$cache_root/${domain_name}-creation.json"
jq -n \
  --arg domain "$domain_name" --arg domainUuid "$domain_uuid" --arg machineType "$machine_type" \
  --arg windowsIsoSha256 "$actual_iso_hash" --arg windowsIsoPath "$managed_iso_path" \
  --argjson windowsIsoBytes "$(stat -c %s -- "$iso_path")" --argjson configuredDiskBytes "$((256 * 1024 * 1024 * 1024))" \
  --arg createdAtUtc "$(date --utc +%FT%T.%NZ)" \
  '{schemaVersion:1,domain:$domain,domainUuid:$domainUuid,machineType:$machineType,virtualization:"kvm",windowsEditionTarget:"Windows 11 Pro",windowsReleaseTarget:"25H2",windowsIsoSha256:$windowsIsoSha256,windowsIsoBytes:$windowsIsoBytes,managedWindowsIsoPath:$windowsIsoPath,configuredDiskBytes:$configuredDiskBytes,createdAtUtc:$createdAtUtc}' \
  > "$creation_manifest"
echo "Created $domain_name. Install Windows 11 Pro x64 without requirement bypasses, then activate and patch it before collecting certification evidence."
