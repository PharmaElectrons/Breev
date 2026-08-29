# shellcheck shell=bash
# Guest control for the milestone-1 lifecycle harness.
#
# Source this file. It wraps the QEMU Guest Agent transport that the issue-34
# libvirt scripts already use (guest-exec, guest-exec-status, guest-file-*) and
# adds exit-code propagation, chunked upload and download, and a domain guard
# that keeps every destructive command inside the disposable Windows guest.
#
# Environment:
#   M1_CONNECTION              libvirt URI, default qemu:///system
#   M1_DOMAIN                  guest domain, default breev-issue-34-win11
#   M1_GUEST_EXEC_TIMEOUT      seconds a single guest command may run, default 900

if [[ -n "${M1_GUEST_AGENT_SOURCED:-}" ]]; then
  return 0
fi
M1_GUEST_AGENT_SOURCED=1

: "${M1_CONNECTION:=qemu:///system}"
: "${M1_DOMAIN:=breev-issue-34-win11}"
: "${M1_GUEST_EXEC_TIMEOUT:=900}"

M1_POWERSHELL='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
M1_GUEST_TAR='C:\Windows\System32\tar.exe'
m1_open_handle=

guest_fail() {
  echo "$1" >&2
  return 1
}

guest_require_tools() {
  local tool
  for tool in base64 iconv jq sha256sum tar virsh; do
    command -v "$tool" >/dev/null || guest_fail "Missing host command: $tool" || return 1
  done
}

# The harness stops and starts services, rewrites installations, and can remove
# data. Refuse every domain except the disposable Windows proof guest.
guest_require_domain() {
  [[ "$M1_DOMAIN" == "breev-issue-34-win11" ]] ||
    guest_fail "Refusing to drive '$M1_DOMAIN': the milestone-1 harness runs only on breev-issue-34-win11" ||
    return 1
}

guest_require_running() {
  guest_require_tools || return 1
  guest_require_domain || return 1
  [[ "$(virsh --connect "$M1_CONNECTION" domstate "$M1_DOMAIN" 2>/dev/null)" == "running" ]] ||
    guest_fail "The domain $M1_DOMAIN is not running" || return 1
  guest_agent_command '{"execute":"guest-ping"}' >/dev/null ||
    guest_fail "The QEMU Guest Agent in $M1_DOMAIN did not answer" || return 1
}

guest_domain_uuid() {
  virsh --connect "$M1_CONNECTION" domuuid "$M1_DOMAIN"
}

guest_agent_command() {
  virsh --connect "$M1_CONNECTION" qemu-agent-command "$M1_DOMAIN" "$1"
}

# Wait until the agent answers again, which is how a guest restart is observed.
guest_wait_ready() {
  local timeout=${1:-300}
  local deadline=$((SECONDS + timeout))
  while ((SECONDS < deadline)); do
    if [[ "$(virsh --connect "$M1_CONNECTION" domstate "$M1_DOMAIN" 2>/dev/null)" == "running" ]] &&
      guest_agent_command '{"execute":"guest-ping"}' >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  guest_fail "The QEMU Guest Agent did not come back within ${timeout}s"
}

# Run a program in the guest. Standard output is written to standard output,
# standard error to standard error, and the guest exit code is returned.
guest_exec() {
  local program=$1
  shift
  local args_json request response pid status exit_code out_data err_data deadline
  args_json=$(printf '%s\n' "$@" | jq -Rn '[inputs]')
  request=$(jq -cn --arg path "$program" --argjson args "$args_json" \
    '{execute:"guest-exec",arguments:{path:$path,arg:$args,"capture-output":true}}')
  response=$(guest_agent_command "$request") || return 1
  pid=$(jq -er .return.pid <<<"$response") || return 1
  deadline=$((SECONDS + M1_GUEST_EXEC_TIMEOUT))
  while ((SECONDS < deadline)); do
    status=$(guest_agent_command "$(jq -cn --argjson pid "$pid" \
      '{execute:"guest-exec-status",arguments:{pid:$pid}}')") || return 1
    if [[ "$(jq -r '.return.exited // false' <<<"$status")" == "true" ]]; then
      exit_code=$(jq -r '.return.exitcode // 0' <<<"$status")
      out_data=$(jq -r '.return["out-data"] // empty' <<<"$status")
      err_data=$(jq -r '.return["err-data"] // empty' <<<"$status")
      [[ -z "$out_data" ]] || base64 -d <<<"$out_data"
      [[ -z "$err_data" ]] || base64 -d <<<"$err_data" >&2
      return "$exit_code"
    fi
    sleep 1
  done
  guest_fail "A guest command did not finish within ${M1_GUEST_EXEC_TIMEOUT}s: $program"
}

# A guest-exec argument reaches powershell.exe as a single flattened token, so a
# multi-line -Command loses its line breaks and fails to parse. Encode the script
# the way Windows expects instead: UTF-16LE, base64, -EncodedCommand.
guest_powershell_command() {
  local encoded
  encoded=$(printf '%s' "$1" | iconv -f UTF-8 -t UTF-16LE | base64 -w0)
  guest_exec "$M1_POWERSHELL" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass \
    -EncodedCommand "$encoded"
}

guest_powershell_file() {
  local script=$1
  shift
  guest_exec "$M1_POWERSHELL" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$script" "$@"
}

guest_close_handle() {
  if [[ -n "$m1_open_handle" ]]; then
    guest_agent_command "$(jq -cn --argjson handle "$m1_open_handle" \
      '{execute:"guest-file-close",arguments:{handle:$handle}}')" >/dev/null 2>&1 || true
    m1_open_handle=
  fi
}

guest_upload_file() {
  local host_path=$1 guest_path=$2 response chunk
  [[ -f "$host_path" ]] || guest_fail "Missing upload source: $host_path" || return 1
  response=$(guest_agent_command "$(jq -cn --arg path "$guest_path" \
    '{execute:"guest-file-open",arguments:{path:$path,mode:"wb"}}')") || return 1
  m1_open_handle=$(jq -er .return <<<"$response") || return 1
  while IFS= read -r chunk; do
    [[ -n "$chunk" ]] || continue
    guest_agent_command "$(jq -cn --argjson handle "$m1_open_handle" --arg content "$chunk" \
      '{execute:"guest-file-write",arguments:{handle:$handle,"buf-b64":$content}}')" |
      jq -e '.return.count > 0' >/dev/null || { guest_close_handle; return 1; }
  done < <(base64 -w 65536 -- "$host_path")
  guest_close_handle
}

guest_download_file() {
  local guest_path=$1 host_path=$2 response content eof temporary
  response=$(guest_agent_command "$(jq -cn --arg path "$guest_path" \
    '{execute:"guest-file-open",arguments:{path:$path,mode:"rb"}}')") || return 1
  m1_open_handle=$(jq -er .return <<<"$response") || return 1
  temporary=$(mktemp)
  : >"$temporary"
  eof=false
  while [[ "$eof" != "true" ]]; do
    response=$(guest_agent_command "$(jq -cn --argjson handle "$m1_open_handle" \
      '{execute:"guest-file-read",arguments:{handle:$handle,count:49152}}')") ||
      { guest_close_handle; rm -f -- "$temporary"; return 1; }
    content=$(jq -r '.return["buf-b64"] // empty' <<<"$response")
    [[ -z "$content" ]] || base64 -d <<<"$content" >>"$temporary"
    eof=$(jq -r '.return.eof' <<<"$response")
  done
  guest_close_handle
  mkdir -p -- "$(dirname -- "$host_path")"
  mv -- "$temporary" "$host_path"
}

guest_path_exists() {
  local guest_path=$1 answer
  answer=$(guest_powershell_command \
    "if (Test-Path -LiteralPath '${guest_path//\'/\'\'}') { 'yes' } else { 'no' }") || return 1
  [[ "${answer//[$'\r\n ']/}" == "yes" ]]
}
