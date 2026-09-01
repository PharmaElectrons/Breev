import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const lifecycle = readFileSync(
  new URL("./lifecycle.ps1", import.meta.url),
  "utf8",
);

function expectOrdered(source: string, values: readonly string[]): void {
  let previousIndex = -1;
  for (const value of values) {
    const index = source.indexOf(value, previousIndex + 1);
    expect(index, `${value} should be present`).toBeGreaterThan(previousIndex);
    previousIndex = index;
  }
}

describe("Windows role-aware lifecycle", () => {
  it("keeps Role optional for the existing installer and validates exact values", () => {
    expect(lifecycle).toContain('[string] $Role = ""');
    expect(lifecycle).toContain('$RequestedRole -cne "main"');
    expect(lifecycle).toContain('$RequestedRole -cne "terminal"');
    expect(lifecycle).toContain('Role must be exactly "main" or "terminal"');
  });

  it("resolves preserved role state only after non-preserving actions return", () => {
    expectOrdered(lifecycle, [
      'if ($Action -eq "DestructiveUninstall")',
      'if ($Action -eq "Uninstall")',
      "$resolvedRole = Resolve-LifecycleRole",
    ]);
  });

  it("uses an isolated terminal path with no Main authority operations", () => {
    const start = lifecycle.indexOf("# BEGIN terminal role lifecycle");
    const end = lifecycle.indexOf("# END terminal role lifecycle");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const terminalLifecycle = lifecycle.slice(start, end);

    expectOrdered(terminalLifecycle, [
      "Assert-TerminalMachineState",
      "Test-Payload",
      "Initialize-TerminalConfiguration",
      'Invoke-FailurePoint -Name "BeforeReadiness"',
      "Write-InstalledDeviceRole",
      'Write-LifecycleState -Status "healthy"',
    ]);
    for (const forbiddenOperation of [
      "Resolve-LanApiHost",
      "Initialize-Database",
      "Register-PostgresqlService",
      "Register-ApiService",
      "Set-LanFirewallRule",
      "Invoke-DatabaseMigrations",
      "Initialize-MainDeviceBinding",
      "Start-Service",
    ]) {
      expect(terminalLifecycle).not.toContain(forbiddenOperation);
    }
  });

  it("retains the existing ordered Main lifecycle and commits role last", () => {
    const mainLifecycle = lifecycle.slice(
      lifecycle.indexOf("# END terminal role lifecycle"),
    );
    expectOrdered(mainLifecycle, [
      "Resolve-LanApiHost",
      "Test-Payload",
      "Initialize-Database",
      "Register-PostgresqlService",
      "Register-ApiService",
      "Set-LanFirewallRule",
      "Set-ServiceAcls",
      "Wait-PostgresqlReady",
      "Invoke-DatabaseMigrations",
      "Initialize-MainDeviceBinding",
      "Wait-ApiReady",
      "Write-InstalledDeviceRole",
      'Write-LifecycleState -Status "healthy"',
    ]);
  });

  it("persists an exact role through a protected sibling file", () => {
    const start = lifecycle.indexOf("function Write-InstalledDeviceRole");
    const end = lifecycle.indexOf("function New-RandomSecret", start);
    const writer = lifecycle.slice(start, end);

    expect(writer).toContain('$temporaryPath = "$rolePath.tmp"');
    expectOrdered(writer, [
      "Set-Content -LiteralPath $temporaryPath -Encoding ASCII -NoNewline",
      "Set-FileAcl -Path $temporaryPath",
      "Move-Item -LiteralPath $temporaryPath -Destination $rolePath",
    ]);
    expect(writer).not.toContain(
      "Move-Item -LiteralPath $temporaryPath -Destination $rolePath -Force",
    );
    expect(writer).toContain(
      'identity = "S-1-5-32-545"; rights = [Security.AccessControl.FileSystemRights]::Read',
    );
  });

  it("preserves installed role and data during ordinary uninstall", () => {
    const start = lifecycle.indexOf('if ($Action -eq "Uninstall")');
    const end = lifecycle.indexOf(
      "$resolvedRole = Resolve-LifecycleRole",
      start,
    );
    const uninstallLifecycle = lifecycle.slice(start, end);

    expect(uninstallLifecycle).not.toContain("device-role");
    expect(uninstallLifecycle).not.toContain(
      "Remove-Item -LiteralPath $DataRoot -Recurse -Force",
    );
    expect(uninstallLifecycle).toContain(
      'Write-LifecycleState -Status "data-preserved"',
    );
  });

  it("rejects conflicting Main and Terminal state before terminal mutation", () => {
    expect(lifecycle).toContain("$hasMainState -and $hasTerminalState");
    expect(lifecycle).toContain(
      "The requested role conflicts with preserved Breev state",
    );
    expectOrdered(lifecycle, [
      "$resolvedRole = Resolve-LifecycleRole",
      "Assert-TerminalMachineState",
      "Initialize-TerminalConfiguration",
    ]);
  });
});
