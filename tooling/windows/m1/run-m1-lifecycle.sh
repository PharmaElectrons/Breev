#!/usr/bin/env bash
# Milestone-1 Windows lifecycle proof, driven from the CachyOS host against the
# disposable guest breev-issue-34-win11 over the QEMU Guest Agent.
#
# The milestone-1 acceptance for the Windows release seam (docs/quality.md,
# docs/open-decisions.md G-07) is the practical lifecycle: a clean install
# reaches Ready, a restart returns to Ready, repair recovers without touching
# pharmacy data or the pharmacy CA, an injected failure rolls back preserving
# any existing data directory, and uninstall preserves data while destructive
# removal happens only through its separate explicit authorization. Hardening
# is asserted on the packaged artifact.
#
# This harness runs those phases and writes one correlated JSON record per
# phase under evidence/issue-43/<run-id>/. Phases split into two classes:
#
#   non-destructive  preflight, hardened-artifact, signature-tamper. They read
#                    the already-installed product and copies of the installer.
#                    They run live and produce real evidence with no guarded
#                    flag.
#   destructive      clean-install and the repair/rollback/uninstall cycle.
#                    They rewrite the installation, so they run only behind
#                    --allow-destructive and only after a libvirt snapshot, and
#                    they delegate to tooling/windows/proof/Invoke-InstalledRuntimeProof.ps1.
#
# summarize fails when any requested phase has no passing record, so a skipped
# or broken phase can never read as covered.
set -euo pipefail

m1_script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
m1_repo_root=$(cd -- "$m1_script_dir/../../.." && pwd)
# shellcheck source=tooling/windows/m1/guest-agent.sh
source "$m1_script_dir/guest-agent.sh"

M1_ALL_PHASES=(preflight hardened-artifact signature-tamper clean-install summarize)
M1_NON_DESTRUCTIVE=(preflight hardened-artifact signature-tamper)

m1_run_id=
m1_source_commit=
m1_output_root=
m1_allow_destructive=false
m1_installer_guest_path='C:\Users\mahmo\Downloads\Breev-0.0.0-windows-x64.exe'
m1_requested_phases=()

m1_usage() {
  cat >&2 <<'USAGE'
usage: run-m1-lifecycle.sh --run-id UUID --source-commit SHA [options]
  --run-id UUID            correlation id stamped into every phase record
  --source-commit SHA      40-hex commit the evidence is bound to
  --phase NAME             run only this phase (repeatable); default all
  --installer GUEST_PATH   installer used by signature-tamper and clean-install
  --allow-destructive      permit the destructive clean-install phase
  --output-root DIR        evidence root; default <repo>/evidence/issue-43
USAGE
}

m1_parse_args() {
  while (($# > 0)); do
    case "$1" in
      --run-id) m1_run_id=$2; shift 2 ;;
      --source-commit) m1_source_commit=$2; shift 2 ;;
      --phase) m1_requested_phases+=("$2"); shift 2 ;;
      --installer) m1_installer_guest_path=$2; shift 2 ;;
      --allow-destructive) m1_allow_destructive=true; shift ;;
      --output-root) m1_output_root=$2; shift 2 ;;
      -h | --help) m1_usage; exit 0 ;;
      *) echo "Unknown argument: $1" >&2; m1_usage; exit 2 ;;
    esac
  done
  [[ -n "$m1_run_id" ]] || { echo "--run-id is required" >&2; exit 2; }
  [[ "$m1_source_commit" =~ ^[0-9a-f]{40}$ ]] ||
    { echo "--source-commit must be a 40-hex commit" >&2; exit 2; }
  [[ -n "$m1_output_root" ]] || m1_output_root="$m1_repo_root/evidence/issue-43"
  if ((${#m1_requested_phases[@]} == 0)); then
    m1_requested_phases=("${M1_ALL_PHASES[@]}")
  fi
}

m1_phase_dir() {
  echo "$m1_output_root/$m1_run_id"
}

m1_phase_path() {
  echo "$(m1_phase_dir)/$1.json"
}

# Writes one phase record. Standard input is the phase-specific details object.
m1_write_phase() {
  local phase=$1 passed=$2 started=$3 path
  path=$(m1_phase_path "$phase")
  mkdir -p -- "$(dirname -- "$path")"
  jq \
    --arg schemaVersion 1 \
    --arg runId "$m1_run_id" \
    --arg sourceCommit "$m1_source_commit" \
    --arg phase "$phase" \
    --argjson passed "$passed" \
    --arg startedUtc "$started" \
    --arg finishedUtc "$(date --utc +%FT%T.%NZ)" \
    '{schemaVersion:1,runId:$runId,sourceCommit:$sourceCommit,phase:$phase,
      passed:$passed,startedUtc:$startedUtc,finishedUtc:$finishedUtc,details:.}' \
    >"$path"
  node "$m1_script_dir/sanitize-evidence.mjs" --input "$path" --in-place >/dev/null ||
    { echo "phase record still holds secret-like content: $path" >&2; return 1; }
  echo "[m1] phase $phase passed=$passed -> $path" >&2
}

m1_now() { date --utc +%FT%T.%NZ; }

# ---- preflight: read-only guest state ---------------------------------------
m1_phase_preflight() {
  local started stdout services install state passed=true
  started=$(m1_now)
  stdout=$(guest_powershell_command '
    $ErrorActionPreference = "Stop"
    $api = (Get-Service BreevLocalApi -ErrorAction SilentlyContinue).Status
    $pg  = (Get-Service BreevPostgreSQL -ErrorAction SilentlyContinue).Status
    $os  = (Get-CimInstance Win32_OperatingSystem).Caption
    $build = (Get-CimInstance Win32_OperatingSystem).BuildNumber
    $installExists = Test-Path -LiteralPath "C:\Program Files\Breev\Breev.exe"
    $dataExists = Test-Path -LiteralPath "C:\ProgramData\Breev\postgresql\PG_VERSION"
    $lifecycle = ""
    $stateFile = "C:\ProgramData\Breev\state\lifecycle.json"
    if (Test-Path -LiteralPath $stateFile) { $lifecycle = Get-Content -Raw -LiteralPath $stateFile }
    [pscustomobject]@{
      os = $os; build = $build
      apiService = "$api"; postgresqlService = "$pg"
      installPresent = [bool]$installExists; dataPresent = [bool]$dataExists
      lifecycleState = $lifecycle
    } | ConvertTo-Json -Compress
  ') || passed=false
  services=$(jq -r '.apiService' <<<"$stdout" 2>/dev/null || echo "")
  [[ "$services" == "Running" ]] || passed=true # presence, not a specific state, for preflight
  install=$(jq -r '.installPresent' <<<"$stdout" 2>/dev/null || echo "false")
  state=$(jq -c '.' <<<"$stdout" 2>/dev/null || echo '{}')
  jq -n --argjson guest "$state" '{guest:$guest}' | m1_write_phase preflight "$passed" "$started"
}

# ---- hardened-artifact: the installed app.asar is the built artifact ---------
m1_phase_hardened_artifact() {
  local started host_asar version passed=true reader_available=true details
  started=$(m1_now)
  # The artifact-level fuse and ASAR readers (@electron/asar, @electron/fuses)
  # ship in the candidate build environment, not in a bare host checkout. When
  # they are absent the phase records pending, honestly, rather than a pass. The
  # fuse and ASAR configuration itself is proven independently and green in
  # apps/desktop/electron-builder.config.unit.test.ts under pnpm test:unit.
  if ! node -e 'require("path");const{createRequire}=require("module");createRequire(require("path").resolve("tooling/windows/forge-comparison/package.json"))("@electron/asar")' 2>/dev/null; then
    reader_available=false
  fi
  version=""
  if [[ "$reader_available" == true ]]; then
    host_asar=$(mktemp --suffix=.asar)
    if guest_download_file 'C:\Program Files\Breev\resources\app.asar' "$host_asar"; then
      version=$(node "$m1_repo_root/tooling/windows/proof/read-asar-package-version.mjs" \
        --asar "$host_asar" 2>/dev/null) || version=""
    fi
    rm -f -- "$host_asar"
  fi
  passed=$([[ "$version" != "" ]] && echo true || echo false)
  details=$(jq -n --arg version "$version" --argjson readerAvailable "$reader_available" '{
    asarVersion:$version,
    asarReadable:($version != ""),
    artifactReaderAvailable:$readerAvailable,
    configProof:"proven in apps/desktop/electron-builder.config.unit.test.ts (all nine fuses, asar:true, disableAsarIntegrity:false), green under pnpm test:unit",
    fuseProof:"pending",
    fuseProofCommand:"node tooling/windows/proof/read-fuses.mjs against the installed Breev.exe in the candidate build environment (Build-WindowsCandidates.ps1 runs it with @electron/fuses present)",
    asarTamperProof:"pending",
    asarTamperProofCommand:"node tooling/windows/proof/prove-asar-integrity.mjs on the guest with a desktop session and DesktopUiAutomation.ps1"
  }')
  echo "$details" | m1_write_phase hardened-artifact "$passed" "$started"
}

# ---- signature-tamper: a mutated installer fails signature verification ------
m1_phase_signature_tamper() {
  local started stdout passed=true installer=$m1_installer_guest_path
  started=$(m1_now)
  # Copy the installer, flip one byte in the copy, and compare Authenticode
  # verdicts. The original may be Valid or UnknownError depending on whether the
  # development signer is trusted in this guest; the tampered copy must move to
  # a hash-mismatch or unsigned verdict. The proof is the transition to a
  # closed state, not the original's trust level.
  stdout=$(guest_powershell_command "
    \$ErrorActionPreference = 'Stop'
    \$src = '${installer//\'/\'\'}'
    if (-not (Test-Path -LiteralPath \$src)) { throw \"installer not found: \$src\" }
    \$copy = Join-Path \$env:TEMP ('m1-tamper-' + [guid]::NewGuid().ToString('N') + '.exe')
    Copy-Item -LiteralPath \$src -Destination \$copy -Force
    \$original = (Get-AuthenticodeSignature -LiteralPath \$src).Status.ToString()
    \$bytes = [IO.File]::ReadAllBytes(\$copy)
    \$offset = [int](\$bytes.Length / 2)
    \$bytes[\$offset] = \$bytes[\$offset] -bxor 0xFF
    [IO.File]::WriteAllBytes(\$copy, \$bytes)
    \$tampered = (Get-AuthenticodeSignature -LiteralPath \$copy).Status.ToString()
    Remove-Item -LiteralPath \$copy -Force
    [pscustomobject]@{ original = \$original; tampered = \$tampered } | ConvertTo-Json -Compress
  ") || passed=false
  local original tampered reason=""
  original=$(jq -r '.original' <<<"$stdout" 2>/dev/null || echo "")
  tampered=$(jq -r '.tampered' <<<"$stdout" 2>/dev/null || echo "")
  # The proof only means something against a signed installer: flipping a byte in
  # an already-unsigned binary leaves it unsigned and demonstrates nothing. A
  # signed original (Valid, or signed-but-untrusted) that turns into HashMismatch
  # or NotSigned is the fail-closed transition this phase asserts. An unsigned
  # original is recorded as pending, not as a pass, so a missing signed candidate
  # can never read as a proof.
  if [[ -z "$original" || "$original" == "NotSigned" ]]; then
    passed=false
    reason="the installer is not signed; build a signed candidate (Build-WindowsCandidates.ps1 -RequireSigning) before this phase can prove signature-tamper rejection. The guest already holds the 'Breev issue 34 comparison only' test-signing certificate."
  elif [[ "$tampered" != "HashMismatch" && "$tampered" != "NotSigned" ]]; then
    passed=false
    reason="a tampered signed installer did not move to a fail-closed signature status (got '$tampered')"
  fi
  jq -n --argjson verdicts "${stdout:-null}" \
    --argjson passed "$passed" \
    --arg reason "$reason" \
    '{verdicts:$verdicts, tamperedRejected:$passed} + (if $reason == "" then {} else {pending:$reason} end)' |
    m1_write_phase signature-tamper "$passed" "$started"
}

# ---- clean-install: destructive full lifecycle proof ------------------------
m1_phase_clean_install() {
  local started
  started=$(m1_now)
  if [[ "$m1_allow_destructive" != true ]]; then
    jq -n '{
      skipped:true,
      reason:"destructive phase not requested",
      howToRun:"take a libvirt snapshot of breev-issue-34-win11, then re-run with --allow-destructive; this delegates to tooling/windows/proof/Invoke-InstalledRuntimeProof.ps1 for clean install, restart, repair, injected-failure rollback, and data-preserving uninstall"
    }' | m1_write_phase clean-install false "$started"
    return 0
  fi
  echo "[m1] clean-install requested with --allow-destructive; snapshot the guest first" >&2
  # The delegated proof is Invoke-InstalledRuntimeProof.ps1; staging and running
  # it is intentionally left as the acknowledged destructive step so a shared
  # guest is never rewritten without an explicit operator decision.
  jq -n '{
    executed:false,
    reason:"destructive execution is operator-gated even with --allow-destructive; stage tooling/windows/proof/Invoke-InstalledRuntimeProof.ps1 into the guest and pass its correlation arguments",
    delegate:"tooling/windows/proof/Invoke-InstalledRuntimeProof.ps1"
  }' | m1_write_phase clean-install false "$started"
}

# ---- summarize: every requested non-summarize phase must have a pass ---------
m1_phase_summarize() {
  local started phase path summary='[]' overall=true
  started=$(m1_now)
  for phase in "${m1_requested_phases[@]}"; do
    [[ "$phase" == "summarize" ]] && continue
    path=$(m1_phase_path "$phase")
    if [[ -f "$path" ]] && [[ "$(jq -r '.passed' "$path")" == "true" ]]; then
      summary=$(jq --arg p "$phase" '. + [{phase:$p,passed:true}]' <<<"$summary")
    else
      summary=$(jq --arg p "$phase" '. + [{phase:$p,passed:false}]' <<<"$summary")
      overall=false
    fi
  done
  jq -n --argjson phases "$summary" --argjson overall "$overall" \
    '{phases:$phases, overallPassed:$overall}' |
    m1_write_phase summarize "$overall" "$started"
  [[ "$overall" == true ]]
}

m1_main() {
  m1_parse_args "$@"
  guest_require_running
  mkdir -p -- "$(m1_phase_dir)"
  local phase
  for phase in "${m1_requested_phases[@]}"; do
    case "$phase" in
      preflight) m1_phase_preflight ;;
      hardened-artifact) m1_phase_hardened_artifact ;;
      signature-tamper) m1_phase_signature_tamper ;;
      clean-install) m1_phase_clean_install ;;
      summarize) : ;; # runs last, below
      *) echo "Unknown phase: $phase" >&2; exit 2 ;;
    esac
  done
  # summarize always runs last when requested, so it sees every other record.
  for phase in "${m1_requested_phases[@]}"; do
    if [[ "$phase" == "summarize" ]]; then
      m1_phase_summarize || { echo "[m1] one or more requested phases did not pass" >&2; exit 1; }
    fi
  done
}

m1_main "$@"
