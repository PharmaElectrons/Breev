#!/usr/bin/env bash
set -euo pipefail

connection=qemu:///system
domain_name=breev-issue-34-win11
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)

usage() {
  echo "usage: $0 export|import --run-id UUID --snapshot-id ID --source-commit SHA --guest-repo-root WINDOWS_PATH [--name DOMAIN]" >&2
  exit 2
}

(($# > 0)) || usage
action=$1
shift
run_id=
snapshot_id=
source_commit=
guest_repo_root=
while (($# > 0)); do
  case "$1" in
    --run-id) run_id=${2:-}; shift 2 ;;
    --snapshot-id) snapshot_id=${2:-}; shift 2 ;;
    --source-commit) source_commit=${2:-}; shift 2 ;;
    --guest-repo-root) guest_repo_root=${2:-}; shift 2 ;;
    --name) domain_name=${2:-}; shift 2 ;;
    *) usage ;;
  esac
done

[[ "$action" == "export" || "$action" == "import" ]] || usage
[[ "$run_id" =~ ^[0-9a-fA-F-]{36}$ && "$snapshot_id" =~ ^[a-zA-Z0-9._-]+$ && "$source_commit" =~ ^[0-9a-f]{40}$ ]] || usage
[[ "$domain_name" =~ ^breev-issue-34-[a-zA-Z0-9._-]+$ ]] || {
  echo "Refusing to transfer evidence outside the disposable issue-34 namespace" >&2
  exit 1
}
[[ ${#guest_repo_root} -ge 4 && "${guest_repo_root:1:2}" == ":\\" && "$guest_repo_root" != *'"'* ]] || {
  echo "The guest repository root must be an absolute Windows path without quotes" >&2
  exit 1
}

for command_name in base64 jq sha256sum stat virsh; do
  command -v "$command_name" >/dev/null || { echo "Missing host command: $command_name" >&2; exit 1; }
done
[[ "$(virsh --connect "$connection" domstate "$domain_name")" == "running" ]] || {
  echo "The Windows proof domain must be running" >&2
  exit 1
}
domain_uuid=$(virsh --connect "$connection" domuuid "$domain_name")
baseline_manifest="$repo_root/artifacts/windows/host-cache/${domain_name}-${snapshot_id}-baseline.json"
[[ -f "$baseline_manifest" &&
   "$(jq -r .runId "$baseline_manifest")" == "$run_id" &&
   "$(jq -r .sourceCommit "$baseline_manifest")" == "$source_commit" &&
   "$(jq -r .domainUuid "$baseline_manifest")" == "$domain_uuid" ]] || {
  echo "The evidence target does not match the correlated disposable baseline" >&2
  exit 1
}
virsh --connect "$connection" qemu-agent-command "$domain_name" '{"execute":"guest-ping"}' >/dev/null

guest_evidence_root="${guest_repo_root}\\artifacts\\windows\\evidence\\${run_id}"
guest_archive="C:\\Windows\\Temp\\breev-issue34-${run_id}.zip"
host_evidence_root="$repo_root/artifacts/windows/evidence/$run_id"
host_archive="$host_evidence_root/windows-before-restore.zip"
host_export_manifest="$host_evidence_root/windows-before-restore.json"
active_handle=

agent_command() {
  virsh --connect "$connection" qemu-agent-command "$domain_name" "$1"
}

close_active_handle() {
  if [[ -n "$active_handle" ]]; then
    agent_command "$(jq -cn --argjson handle "$active_handle" '{execute:"guest-file-close",arguments:{handle:$handle}}')" >/dev/null 2>&1 || true
    active_handle=
  fi
}
trap close_active_handle EXIT

guest_exec() {
  local program=$1
  shift
  local args_json request response pid status exit_code out_data err_data deadline
  args_json=$(printf '%s\n' "$@" | jq -Rn '[inputs]')
  request=$(jq -cn --arg path "$program" --argjson args "$args_json" '{execute:"guest-exec",arguments:{path:$path,arg:$args,"capture-output":true}}')
  response=$(agent_command "$request")
  pid=$(jq -er .return.pid <<<"$response")
  deadline=$((SECONDS + 900))
  while ((SECONDS < deadline)); do
    status=$(agent_command "$(jq -cn --argjson pid "$pid" '{execute:"guest-exec-status",arguments:{pid:$pid}}')")
    if [[ "$(jq -r '.return.exited // false' <<<"$status")" == "true" ]]; then
      exit_code=$(jq -er '.return.exitcode' <<<"$status")
      out_data=$(jq -r '.return["out-data"] // empty' <<<"$status")
      err_data=$(jq -r '.return["err-data"] // empty' <<<"$status")
      if ((exit_code != 0)); then
        [[ -z "$err_data" ]] || base64 -d <<<"$err_data" >&2
        return "$exit_code"
      fi
      [[ -z "$out_data" ]] || base64 -d <<<"$out_data"
      return 0
    fi
    sleep 1
  done
  echo "The QEMU Guest Agent command did not finish in time" >&2
  return 1
}

upload_file() {
  local host_path=$1 guest_path=$2 request response content
  request=$(jq -cn --arg path "$guest_path" '{execute:"guest-file-open",arguments:{path:$path,mode:"w"}}')
  response=$(agent_command "$request")
  active_handle=$(jq -er .return <<<"$response")
  while IFS= read -r content; do
    [[ -n "$content" ]] || continue
    request=$(jq -cn --argjson handle "$active_handle" --arg content "$content" '{execute:"guest-file-write",arguments:{handle:$handle,"buf-b64":$content}}')
    agent_command "$request" | jq -e '.return.count > 0' >/dev/null
  done < <(base64 -w 65536 -- "$host_path")
  close_active_handle
}

download_file() {
  local guest_path=$1 host_path=$2 request response eof content temporary_path
  temporary_path=$(mktemp)
  request=$(jq -cn --arg path "$guest_path" '{execute:"guest-file-open",arguments:{path:$path,mode:"r"}}')
  response=$(agent_command "$request")
  active_handle=$(jq -er .return <<<"$response")
  : > "$temporary_path"
  eof=false
  while [[ "$eof" != "true" ]]; do
    request=$(jq -cn --argjson handle "$active_handle" '{execute:"guest-file-read",arguments:{handle:$handle,count:49152}}')
    response=$(agent_command "$request")
    content=$(jq -r '.return["buf-b64"] // empty' <<<"$response")
    [[ -z "$content" ]] || base64 -d <<<"$content" >> "$temporary_path"
    eof=$(jq -r '.return.eof' <<<"$response")
  done
  close_active_handle
  mv -- "$temporary_path" "$host_path"
}

powershell='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
case "$action" in
  export)
    mkdir -p -- "$host_evidence_root"
    [[ ! -e "$host_archive" && ! -e "$host_export_manifest" ]] || {
      echo "Refusing to overwrite an existing exported evidence bundle" >&2
      exit 1
    }
    export_script="${guest_repo_root}\\tooling\\windows\\proof\\Export-Issue34Evidence.ps1"
    export_result=$(guest_exec "$powershell" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$export_script" \
      -RunId "$run_id" -SourceCommit "$source_commit" -SnapshotId "$snapshot_id" \
      -EvidenceRoot "$guest_evidence_root" -ArchivePath "$guest_archive")
    jq -e --arg runId "$run_id" --arg sourceCommit "$source_commit" --arg snapshotId "$snapshot_id" --arg machineId "$domain_uuid" \
      '.passed and .runId == $runId and .sourceCommit == $sourceCommit and .snapshotId == $snapshotId and ((.machineId | ascii_downcase) == ($machineId | ascii_downcase))' \
      <<<"$export_result" >/dev/null
    download_file "$guest_archive" "$host_archive"
    archive_hash=$(sha256sum "$host_archive" | awk '{print $1}')
    [[ "$archive_hash" == "$(jq -r .archiveSha256 <<<"$export_result")" ]] || {
      echo "The downloaded evidence archive does not match the guest export" >&2
      exit 1
    }
    jq -n --arg runId "$run_id" --arg sourceCommit "$source_commit" --arg snapshotId "$snapshot_id" \
      --arg domain "$domain_name" --arg domainUuid "$domain_uuid" --arg archivePath "$host_archive" \
      --arg archiveSha256 "$archive_hash" --argjson archiveBytes "$(stat -c %s "$host_archive")" \
      --arg exportedAtUtc "$(date --utc +%FT%T.%NZ)" --argjson guest "$export_result" \
      '{schemaVersion:1,runId:$runId,sourceCommit:$sourceCommit,snapshotId:$snapshotId,domain:$domain,domainUuid:$domainUuid,archivePath:$archivePath,archiveSha256:$archiveSha256,archiveBytes:$archiveBytes,guest:$guest,exportedAtUtc:$exportedAtUtc,passed:true}' \
      > "$host_export_manifest"
    guest_exec "$powershell" -NoLogo -NoProfile -NonInteractive -Command "Remove-Item -LiteralPath '$guest_archive' -Force" >/dev/null
    echo "$host_export_manifest"
    ;;
  import)
    [[ -f "$host_archive" && -f "$host_export_manifest" ]] || {
      echo "The exported pre-restore evidence bundle is missing" >&2
      exit 1
    }
    jq -e --arg runId "$run_id" --arg sourceCommit "$source_commit" --arg snapshotId "$snapshot_id" --arg domainUuid "$domain_uuid" \
      '.passed and .runId == $runId and .sourceCommit == $sourceCommit and .snapshotId == $snapshotId and .domainUuid == $domainUuid' \
      "$host_export_manifest" >/dev/null
    archive_hash=$(sha256sum "$host_archive" | awk '{print $1}')
    [[ "$archive_hash" == "$(jq -r .archiveSha256 "$host_export_manifest")" ]] || {
      echo "The retained evidence archive no longer matches its export manifest" >&2
      exit 1
    }
    upload_file "$host_archive" "$guest_archive"
    import_script="${guest_repo_root}\\tooling\\windows\\proof\\Import-Issue34Evidence.ps1"
    import_result=$(guest_exec "$powershell" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$import_script" \
      -RunId "$run_id" -SourceCommit "$source_commit" -SnapshotId "$snapshot_id" \
      -EvidenceRoot "$guest_evidence_root" -ArchivePath "$guest_archive" -ExpectedArchiveSha256 "$archive_hash")
    jq -e --arg runId "$run_id" --arg sourceCommit "$source_commit" --arg snapshotId "$snapshot_id" --arg machineId "$domain_uuid" \
      '.passed and .runId == $runId and .sourceCommit == $sourceCommit and .snapshotId == $snapshotId and ((.machineId | ascii_downcase) == ($machineId | ascii_downcase))' \
      <<<"$import_result" >/dev/null
    guest_host_root="${guest_evidence_root}\\host"
    guest_exec "$powershell" -NoLogo -NoProfile -NonInteractive -Command "New-Item -ItemType Directory -Force -Path '$guest_host_root' | Out-Null" >/dev/null
    host_files=(
      "$baseline_manifest:baseline.json"
      "$host_evidence_root/host-reboot.json:host-reboot.json"
      "$host_evidence_root/offline-network.json:offline-network.json"
      "$host_evidence_root/network-restore.json:network-restore.json"
      "$host_evidence_root/host-restore.json:host-restore.json"
      "$host_export_manifest:windows-before-restore.json"
    )
    for mapping in "${host_files[@]}"; do
      host_path=${mapping%:*}
      guest_name=${mapping##*:}
      [[ -f "$host_path" ]] || { echo "Missing correlated host evidence: $host_path" >&2; exit 1; }
      jq -e --arg runId "$run_id" --arg sourceCommit "$source_commit" --arg snapshotId "$snapshot_id" \
        '.runId == $runId and .sourceCommit == $sourceCommit and .snapshotId == $snapshotId' "$host_path" >/dev/null
      upload_file "$host_path" "${guest_host_root}\\${guest_name}"
    done
    echo "${guest_evidence_root}\\host-import.json"
    ;;
esac
