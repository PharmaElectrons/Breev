# Running the issue #34 Windows proof from CachyOS

**Research date:** 2026-08-24

**Scope:** A practical, supportable host environment for destructive installer and Windows-service tests. This note does not record issue #34 results.

**Status:** Research complete; the recommended environment was subsequently provisioned for the issue #34 run. No Windows acceptance result is implied by this note.

## Recommendation

Use a persistent, licensed Windows 11 Pro x64 25H2 guest under QEMU/KVM, managed by the system libvirt instance. Define the guest and its networks declaratively; use `virt-install` for initial provisioning, `virsh` for lifecycle automation, and virt-manager/virt-viewer only where a human needs to inspect the installer or desktop. Run each destructive scenario against a disposable snapshot or copy-on-write overlay derived from an activated, fully patched golden guest.

This is the smallest credible local setup because QEMU system emulation supplies a complete virtual machine and KVM lets the x64 guest execute directly on the x64 host CPU. It runs the real Windows kernel, Service Control Manager, NSIS/MSI behavior, registry, ACLs, reboots, and Electron process tree rather than translating their APIs ([QEMU overview](https://www.qemu.org/docs/master/about/)). libvirt adds a stable domain, network, TPM, firmware, and snapshot control plane. virt-manager is a libvirt GUI and its companion tools include `virt-install`, `virt-clone`, and `virt-xml` ([virt-manager project](https://github.com/virt-manager/virt-manager#virtual-machine-manager)).

Treat this VM as the certification candidate for issue #34's installer/service seam only after it records the required edition, release, activation, Secure Boot, TPM, CPU, memory, and storage facts. The repository separately requires physical-profile tests. A software vTPM does not prove physical TPM-backed CA-key behavior, UPS behavior, peripherals, or bare-metal performance.

Microsoft's Windows-client VM requirements explicitly support Windows 11 in a VM, but the cited page names Azure and Hyper-V examples rather than promising Microsoft hypervisor support for KVM. If the release owner interprets "Microsoft-supported" as requiring Microsoft support for the hypervisor as well as for Windows 11 Pro 25H2, repeat the final evidence on supported physical hardware or an appropriately licensed Hyper-V host. That interpretation is an external release-gate choice, not something this research can silently settle.

## Why Windows 11 Pro 25H2 is the required image

The official multi-edition x64 ISO is expressly offered for creating a virtual machine. Its product key selects the edition. Microsoft says installation requires a Windows licence, and its current download is Windows 11 25H2 ([official Windows 11 download](https://www.microsoft.com/en-us/software-download/windows11)). Windows 11 Pro 25H2 remains serviced through 2027-10-12, so it has more than the repository's required twelve months of security support on the research date ([Windows 11 release information](https://learn.microsoft.com/en-us/windows/release-health/windows11-release-information)).

Use a licence that permits assignment to this virtual device and activate the Pro guest. Do not assume that an OEM licence attached to another machine can be reused: Microsoft's current Windows 11 virtualization guidance says an OEM licence typically does not include virtualization rights and directs customers to check their agreement ([Windows 11 licensing for virtual desktops](https://www.microsoft.com/licensing/docs/documents/download/Windows%2011%20licensing%20for%20Virtual%20Desktops.pdf)). Microsoft activation requires a valid product key or digital licence for a device that has never had activated Windows, and activation is associated with the hardware configuration ([Windows activation](https://support.microsoft.com/en-us/windows/activation/activate-windows)). Keep the VM UUID, machine type, virtual TPM state, firmware NVRAM, and MAC address stable across rollback so destructive test resets do not masquerade as new hardware.

The free Evaluation Center image is not a substitute: Microsoft currently offers Windows 11 **Enterprise** 25H2 for a 90-day evaluation, while the repository excludes Enterprise as its certification candidate ([Evaluation Center](https://www.microsoft.com/en-us/evalcenter/evaluate-windows-11-enterprise)). It can be useful while developing the automation, but it cannot satisfy issue #34's Windows 11 Pro evidence.

## Required VM definition

Use at least the repository's provisional minimum Main profile: four vCPUs, 8 GiB RAM, and a 256 GiB or larger qcow2 disk on SSD-backed host storage. Microsoft itself requires a 64-bit compatible CPU, two or more virtual processors, 4 GiB RAM, at least 64 GiB storage, UEFI/Secure Boot capability, and TPM 2.0 for a Windows 11 VM ([Windows 11 requirements](https://learn.microsoft.com/en-us/windows/whats-new/windows-11-requirements)). The larger disk leaves room for two packaging stacks, pinned PostgreSQL and Node distributions, Windows updates, and evidence artifacts.

Use these domain properties:

- x86_64 `q35` machine with KVM acceleration and a stable machine type;
- UEFI firmware with Secure Boot **enabled** and enrolled Microsoft keys;
- a libvirt-managed `swtpm` TPM 2.0 device with persistent state;
- a stable UUID and MAC address;
- qcow2 storage and the QEMU guest agent;
- SPICE or VNC for the real standard-user desktop test; and
- no shared writable pharmacy data or host development database.

libvirt 8.6 and newer can select EFI Secure Boot firmware using `secure-boot` and `enrolled-keys` features. Enrolled keys matter: firmware that merely supports Secure Boot does not enforce it until usable keys are present ([libvirt Secure Boot](https://libvirt.org/kbase/secureboot.html)). For the virtual TPM, libvirt starts an independent `swtpm` for each requesting QEMU guest and can explicitly request version 2.0 and persistent TPM state ([libvirt domain XML](https://libvirt.org/formatdomain.html#tpm-device)). Inside Windows, capture `Confirm-SecureBootUEFI` returning `True`; Microsoft documents that this checks the local UEFI Secure Boot status ([Secure Boot cmdlet](https://learn.microsoft.com/en-us/powershell/module/secureboot/confirm-securebootuefi)). Also capture edition/version/build, x64 architecture, activation state, `Get-Tpm`, RAM, and CPU count in machine-readable output before accepting any issue evidence.

Do not bypass Windows 11 checks. A bypassed or modified installation is outside the repository's supported environment and makes the result unusable.

## Snapshots and isolation

Create the golden point only after Windows 11 Pro is activated, patched, and configured with the test administrator, test standard user, automation key, and required build cache. Shut the guest down cleanly before making the golden point. For every destructive test, create a fresh child overlay and discard it afterward; never commit test changes into the golden image. QEMU documents that a backing-file child records only differences and does not modify the backing file unless an explicit commit operation is used ([`qemu-img create`](https://www.qemu.org/docs/master/tools/qemu-img.html#create)). QEMU identifies qcow2 as its preferred external-overlay format ([live block operations](https://www.qemu.org/docs/master/interop/live-block-operations.html)).

The snapshot unit is more than the Windows disk. Treat the qcow2 chain, per-domain UEFI NVRAM, libvirt XML identity, and `swtpm` state as one indivisible baseline. QEMU supports TPM snapshot/save/restore only when QEMU and swtpm parameters and compatible state are preserved ([QEMU TPM device](https://www.qemu.org/docs/master/specs/tpm.html#migration-with-the-tpm-emulator)). Validate one complete restore before collecting evidence. A disk-only rewind that leaves newer TPM or NVRAM state can break activation or BitLocker and is not a clean rollback.

Use only disposable VM state and synthetic pharmacy data. Keep all host shares read-only during installer execution. Export results outward after the scenario, and never attach a live pharmacy database, backup, credentials, or ProgramData directory.

## Network layout and the LAN refusal proof

Use two libvirt networks:

1. A temporary NAT network for Windows Update, activation, dependency population, and artefact intake.
2. A dedicated isolated test LAN with the Windows guest and an independent peer machine. A libvirt network without a `forward` element is isolated from other networks while still allowing machines on its bridge to communicate ([libvirt network XML](https://libvirt.org/formatnetwork.html#connectivity)).

Detach or disable the NAT NIC before the offline-cycle test. Keep the isolated LAN so the automation can call the local API and the peer can exercise the PostgreSQL negative case. The guest then has no route to the internet even while the CachyOS host remains online.

For the required PostgreSQL test, use a second disposable Linux VM on the isolated LAN or a separate physical machine attached over wired Ethernet. Record all of the following in one result:

- Windows reports PostgreSQL listening on `127.0.0.1`/`::1` only;
- a loopback `psql` connection succeeds;
- the peer attempts a real TCP connection to the Windows guest's LAN address and PostgreSQL port; and
- that attempt receives an active refusal rather than succeeding.

Windows Defender Firewall can mask whether loopback binding caused the failure because Windows can block unmatched inbound traffic before it reaches TCP ([firewall profile actions](https://learn.microsoft.com/en-us/powershell/module/netsecurity/set-netfirewallprofile)). In the disposable snapshot, add a temporary allow rule scoped only to the peer and PostgreSQL test port. Windows rules can match both remote address and local port ([`New-NetFirewallRule`](https://learn.microsoft.com/en-us/powershell/module/netsecurity/new-netfirewallrule)). Capture the refusal, then discard the snapshot. The product's final firewall rules remain #43 scope.

The present CachyOS host reaches its LAN through Wi-Fi, while its Ethernet interface is available but disconnected. Do not plan a conventional layer-2 guest bridge over that Wi-Fi connection. libvirt documents that wireless interfaces cannot be attached to a Linux host bridge ([libvirt networking](https://wiki.libvirt.org/Networking.html#bridged-networking-aka-shared-physical-device)). The isolated two-VM LAN is sufficient for an independent-machine TCP seam. If the evidence owner requires a physically separate peer, connect the existing Ethernet interface to a test LAN and bridge that wired interface, or run the peer on another wired machine. Record which topology was actually used.

## Automating the real acceptance seams

Provision the guest once from Microsoft's ISO. `virt-install` supports unattended Windows installs and a Windows product-key input through libosinfo; its project is part of virt-manager ([virt-install documentation](https://github.com/virt-manager/virt-manager/blob/main/man/virt-install.rst)). Keep licence keys and passwords outside the repository and evidence logs.

After provisioning, install the pinned QEMU Guest Agent solely for noninteractive host observation and sanitized result transfer. Copy source or a Git bundle into the guest rather than exposing the host worktree as a writable share. Build and run both Windows packaging candidates inside Windows so the comparison does not depend on Wine cross-build behavior.

Separate the no-login proof from remote administration:

1. Register an `NT AUTHORITY\SYSTEM` startup task that captures the previous and new boot identities, interactive/remote-interactive sessions and logon events, exact service state, service process creation times, and the loopback health response.
2. Reboot through QEMU Guest Agent from the host without opening the graphical console. Record the guest-agent departure and return as the host-observed reboot boundary.
3. Only after the startup result exists, sign in interactively as the standard non-administrator user and execute the full local desktop cycle.

The independent LAN peer cannot poll the API because the API intentionally listens on loopback in this stage. It is used only for the required PostgreSQL refusal attempt.

The destructive automation should drive and record these independent scenarios from a fresh overlay: clean install; service crash/recovery; API restart while Electron stays open; complete Electron-tree kill; full Windows reboot with no interactive login; repair; uninstall; failed install at each required failure seam; and offline full local cycle. Each result should include the immutable source commit, installer hashes, Windows facts, VM definition hash, timestamps, exit codes, service state/configuration, process identities, port/listener output, data/configuration hashes before and after, and API/desktop assertions. Retain screenshots or video only where the GUI behavior cannot be established from structured results.

## Tool comparison

| Option                                             | What it proves                                                                                                                                            | Fit for issue #34                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| QEMU/KVM + system libvirt + `virt-install`/`virsh` | Real x64 Windows kernel, SCM, installer, ACL, reboot, network, process-tree, and offline behavior; declarative VM/network lifecycle; disposable snapshots | **Recommended.** It provides the required native seams and the most reproducible local automation. Use virt-manager only as a console.                                                                                                                                                                                                                                                                                                                                                                              |
| Quickemu/Quickget                                  | A convenient QEMU/KVM Windows guest with VirtIO and software TPM                                                                                          | Useful for ad hoc development, but not the evidence environment unchanged. Its current Windows recipe documents `secureboot="off"`, interactive installation, and a fixed `Quickemu`/`quickemu` administrator account ([Quickemu Windows guide](https://github.com/quickemu-project/quickemu/wiki/04-Create-Windows-virtual-machines)). Customizing those away removes its main simplicity advantage over direct libvirt.                                                                                           |
| Physical Windows 11 Pro 25H2                       | Strongest physical-profile and Microsoft hardware evidence                                                                                                | Keep for final physical-profile confirmation. It is a poor primary destructive loop unless a dedicated machine can be reimaged safely. It cannot replace snapshot isolation by itself.                                                                                                                                                                                                                                                                                                                              |
| GitHub-hosted Windows runner                       | Windows build and fast non-reboot checks                                                                                                                  | Supplement only. Current x64 `windows-2025` is Windows **Server** 2025, not Windows 11 Pro ([runner image inventory](https://github.com/actions/runner-images#available-images)). GitHub gives each standard job a new VM and runs Windows jobs as administrators with UAC disabled, so it cannot prove the persistent reboot or standard-user seams ([hosted runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)).                                                       |
| Azure Windows client VM                            | Remote Windows-client lab where local hardware is unavailable                                                                                             | Not the simplest substitute. Microsoft's first-party client images are Windows 10/11 **Enterprise** for active Visual Studio subscribers, not the required Pro edition ([Azure Windows client images](https://learn.microsoft.com/en-us/azure/virtual-machines/windows/client-images)). It also needs cost, subscription, network-peer, and licence work.                                                                                                                                                           |
| Nested virtualization                              | Additional VMs inside a cloud or hosted VM                                                                                                                | Unnecessary here and adds another failure layer. GitHub states nested virtualization on hosted runners is experimental and unsupported ([GitHub-hosted runners](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners)). Use the CachyOS host's direct KVM access.                                                                                                                                                                                                                              |
| Windows containers                                 | Isolated Windows application processes                                                                                                                    | Unacceptable for these claims. Microsoft says containers are not complete virtual servers, process-isolated containers share host kernel/filesystem/registry, and GUI installation can eliminate an application as a container candidate ([Microsoft container guidance](https://learn.microsoft.com/en-us/virtualization/windowscontainers/quick-start/lift-shift-to-containers)). They cannot prove the desktop installer, machine SCM lifecycle, login-independent boot, or whole-machine repair/uninstall seam. |
| Wine                                               | Windows API compatibility on Linux                                                                                                                        | Unacceptable. Wine says it translates Windows API calls to POSIX rather than running a Windows VM ([Wine overview](https://www.winehq.org/about/)). It has no real Windows kernel, SCM, registry security boundary, reboot, or Windows installer environment and can be used only for an early smoke check.                                                                                                                                                                                                         |
| Windows Sandbox                                    | Disposable Windows application test                                                                                                                       | Unacceptable as the primary lifecycle environment. Microsoft says closing it deletes all software, files, and state ([Windows Sandbox](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/)); it cannot prove uninstall/data preservation across independent destructive runs or machine startup before login.                                                                                                                                           |

## What the CachyOS host can do now

Initial read-only inspection on 2026-08-24 found the host suitable for KVM. Subsequent issue preparation installed `qemu-full 11.1.0-1`, `libvirt 12.6.0-1.1`, `virt-manager 5.1.0-4`, `swtpm 0.10.1-2.1`, `edk2-ovmf 202605-1`, `virt-firmware 26.8-1`, `dnsmasq 2.93-1.1`, and `virt-viewer 11.0-4.1`.

The prepared environment now has:

- CachyOS x86_64 on an Intel Core i7-12700H with accessible KVM, 15 GiB RAM, and SSD-backed storage;
- the system libvirt service, isolated issue-34 network, and independent Alpine LAN peer;
- the official 8,471,603,200-byte Windows 11 25H2 English x64 ISO pinned to SHA-256 `768984706b909479417b2368438909440f2967ff05c6a9195ed2667254e465e3`; and
- a running `pc-q35-11.1` KVM guest with four cores, 8 GiB RAM, a 256 GiB SSD-profile disk, Secure Boot firmware, swtpm, NAT, and the isolated LAN.

The host CPU generation appears in Microsoft's supported Windows 11 Intel list ([supported Intel processors](https://learn.microsoft.com/en-us/windows-hardware/design/minimum/supported/windows-11-supported-intel-processors)). The host has enough CPU, storage, and KVM support for the repository's provisional minimum profile; 8 GiB guest RAM is realistic but leaves limited headroom during large builds, so close memory-heavy host workloads.

Checked-in automation creates and verifies the networks and domains, captures and restores disk/UEFI/swtpm state together, transfers sanitized evidence through QEMU Guest Agent, calls the LAN seam from the peer, disconnects internet access, and records machine-readable results. Those actions do not require a cloud service.

## External inputs and remaining gates

The following remain external or unexecuted gates:

- human acceptance of Microsoft's licence terms and completion of Windows Setup/OOBE;
- a valid Windows 11 Pro entitlement and activation for this virtual device;
- current Windows servicing, TPM readiness, BitLocker encryption, and documented recovery-key custody;
- execution of the real Breev installer/service matrix inside the guest;
- a successful Windows CI run for the final source commit and a non-destructive passing physical Windows profile result;
- a production-trusted code-signing identity/key backend, which remains G-07;
- a physical LAN peer if "another LAN machine" is interpreted to exclude a second independently networked VM;
- physical TPM, BitLocker recovery-ownership, peripheral, UPS, and bare-metal performance evidence; and
- stakeholder acceptance that a licensed KVM guest satisfies issue #34's "real Windows" service/installer proof, or else access to the physical/Hyper-V repeat environment.

Until Setup, activation, servicing, and the real VM run produce structured results, issue #34 has no Windows execution evidence. Linux builds, Wine, containers, source inspection, and mocked services cannot close that gap.
