#!/usr/bin/env bash
set -euo pipefail

connection=qemu:///system
domain_name=breev-issue-34-peer
alpine_version=3.24.1
alpine_hash=e73a6241bd5f3c5c2d4d38c02cc52c378c0415a7c888bd292066bf36e0f41a39
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)
cache_root="$repo_root/artifacts/windows/host-cache"
iso_name="alpine-virt-${alpine_version}-x86_64.iso"
iso_path="$cache_root/$iso_name"
iso_url="https://dl-cdn.alpinelinux.org/alpine/v3.24/releases/x86_64/$iso_name"
key_path="$cache_root/issue-34-peer-ed25519"

for command_name in curl ssh-keygen uuidgen virsh virt-install; do
  command -v "$command_name" >/dev/null || {
    echo "Missing host command: $command_name" >&2
    exit 1
  }
done
if virsh --connect "$connection" dominfo "$domain_name" >/dev/null 2>&1; then
  echo "The disposable peer domain already exists: $domain_name" >&2
  exit 1
fi
virsh --connect "$connection" net-info default >/dev/null
virsh --connect "$connection" net-info breev-issue-34-isolated >/dev/null

mkdir -p -- "$cache_root"
if [[ ! -f "$iso_path" ]] || [[ "$(sha256sum -- "$iso_path" | awk '{print $1}')" != "$alpine_hash" ]]; then
  curl --fail --location --show-error --output "$iso_path" "$iso_url"
fi
[[ "$(sha256sum -- "$iso_path" | awk '{print $1}')" == "$alpine_hash" ]] || {
  echo "The Alpine peer ISO does not match the pinned official hash" >&2
  exit 1
}
if [[ ! -f "$key_path" || ! -f "$key_path.pub" ]]; then
  ssh-keygen -q -t ed25519 -N "" -C "breev-issue-34-disposable-peer" -f "$key_path"
fi

cloud_root=$(mktemp -d)
cleanup() {
  gio trash "$cloud_root" >/dev/null 2>&1 || true
}
trap cleanup EXIT
public_key=$(<"$key_path.pub")
# Alpine's disk setup copied the ISO machine-id into every peer. Give each
# installed peer a stable unique id so evidence identifies the real VM.
peer_machine_id=$(uuidgen | tr -d '-')
user_data="$cloud_root/user-data"
metadata="$cloud_root/meta-data"
printf '%s\n' \
  "#alpine-config" \
  "hostname: $domain_name" \
  "ssh_authorized_keys:" \
  "  - $public_key" \
  "apk:" \
  "  repositories:" \
  "    - base_url: https://dl-cdn.alpinelinux.org/alpine" \
  "      repos:" \
  "        - main" \
  "        - community" \
  "packages:" \
  "  - nodejs" \
  "  - openssh" \
  "runcmd:" \
  "  - printf '%s\\n' '$domain_name' > /etc/hostname" \
  "  - hostname '$domain_name'" \
  "  - printf 'auto lo\\niface lo inet loopback\\n\\nauto eth0\\niface eth0 inet static\\n  address 192.168.122.2\\n  netmask 255.255.255.0\\n  gateway 192.168.122.1\\n\\nauto eth1\\niface eth1 inet static\\n  address 192.168.134.2\\n  netmask 255.255.255.0\\n' > /etc/network/interfaces" \
  "  - rc-update add networking boot" \
  "  - rc-update add sshd default" \
  "  - ERASE_DISKS=/dev/vda setup-disk -m sys -q /dev/vda" \
  "  - mount /dev/vda3 /mnt" \
  "  - mount /dev/vda1 /mnt/boot" \
  "  - mkdir -p /mnt/root/.ssh" \
  "  - printf '%s\n' '$peer_machine_id' > /mnt/etc/machine-id" \
  "  - printf '%s\\n' '$public_key' > /mnt/root/.ssh/authorized_keys" \
  "  - chmod 700 /mnt/root/.ssh" \
  "  - chmod 600 /mnt/root/.ssh/authorized_keys" \
  "  - sed -i 's/ quiet/ console=ttyS0/' /mnt/boot/extlinux.conf" \
  "  - umount /mnt/boot" \
  "  - umount /mnt" \
  "  - poweroff" > "$user_data"
printf '%s\n' \
  "instance-id: $domain_name" \
  "local-hostname: $domain_name" > "$metadata"

virt-install \
  --connect "$connection" \
  --name "$domain_name" \
  --memory 1024 \
  --vcpus 1 \
  --osinfo alpinelinux3.24 \
  --disk pool=default,size=4,format=qcow2,bus=virtio \
  --location "$iso_path,kernel=boot/vmlinuz-virt,initrd=boot/initramfs-virt" \
  --extra-args "console=ttyS0" \
  --network network=default,model=virtio \
  --network network=breev-issue-34-isolated,model=virtio \
  --cloud-init "user-data=$user_data,meta-data=$metadata" \
  --graphics none \
  --console pty,target.type=serial \
  --noautoconsole

virsh --connect "$connection" autostart "$domain_name" --disable
echo "Created $domain_name. Wait for its unattended install to power off, then boot it and use $key_path for the isolated peer proof."
