#!/usr/bin/env bash
set -euo pipefail

script_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
connection=qemu:///system
isolated_network=breev-issue-34-isolated

for command_name in curl jq qemu-img qemu-system-x86_64 swtpm virsh virt-fw-vars virt-install xorriso; do
  command -v "$command_name" >/dev/null || {
    echo "Missing host command: $command_name" >&2
    exit 1
  }
done

test -r /dev/kvm && test -w /dev/kvm || {
  echo "/dev/kvm is not accessible to the current user" >&2
  exit 1
}

if ! virsh --connect "$connection" net-info default >/dev/null 2>&1; then
  virsh --connect "$connection" net-define /usr/share/libvirt/networks/default.xml
fi
virsh --connect "$connection" net-autostart default
if ! virsh --connect "$connection" net-info default | grep -q 'Active:.*yes'; then
  virsh --connect "$connection" net-start default
fi

if ! virsh --connect "$connection" net-info "$isolated_network" >/dev/null 2>&1; then
  virsh --connect "$connection" net-define "$script_root/issue-34-isolated.xml"
fi
virsh --connect "$connection" net-autostart "$isolated_network"
if ! virsh --connect "$connection" net-info "$isolated_network" | grep -q 'Active:.*yes'; then
  virsh --connect "$connection" net-start "$isolated_network"
fi

if ! virsh --connect "$connection" pool-info default >/dev/null 2>&1; then
  virsh --connect "$connection" pool-define-as default dir --target /var/lib/libvirt/images
  virsh --connect "$connection" pool-build default
fi
virsh --connect "$connection" pool-autostart default
if ! virsh --connect "$connection" pool-info default | grep -q 'State:.*running'; then
  virsh --connect "$connection" pool-start default
fi

if systemctl is-active --quiet ufw.service; then
  outbound_interface=$(ip route show default | awk 'NR == 1 { for (i = 1; i <= NF; i++) if ($i == "dev") { print $(i + 1); exit } }')
  [[ -n "$outbound_interface" ]] || {
    echo "Could not identify the host's default-route interface for the disposable VM" >&2
    exit 1
  }
  ensure_ufw_rule() {
    local marker=$1
    shift
    if ! pkexec ufw status | grep -Fq "$marker"; then
      pkexec ufw "$@" comment "$marker"
    fi
  }
  ensure_ufw_rule "Breev issue 34 VM DHCP broadcast" allow in on virbr0 proto udp to any port 67
  ensure_ufw_rule "Breev issue 34 VM DNS" allow in on virbr0 to 192.168.122.1 port 53
  ensure_ufw_rule "Breev issue 34 VM internet" route allow in on virbr0 out on "$outbound_interface" from 192.168.122.0/24
  ensure_ufw_rule "Breev issue 34 LAN DHCP broadcast" allow in on virbr34 proto udp to any port 67
  ensure_ufw_rule "Breev issue 34 LAN DNS" allow in on virbr34 to 192.168.134.1 port 53
  ensure_ufw_rule "Breev issue 34 isolated LAN" route allow in on virbr34 out on virbr34 from 192.168.134.0/24 to 192.168.134.0/24
fi

virt-host-validate qemu
virsh --connect "$connection" net-list --all
virsh --connect "$connection" pool-list --all
