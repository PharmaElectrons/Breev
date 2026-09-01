import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const installer = readFileSync(
  new URL("./installer.nsh", import.meta.url),
  "utf8",
);
const candidateBuilder = readFileSync(
  new URL(
    "../../../tooling/windows/Build-WindowsCandidates.ps1",
    import.meta.url,
  ),
  "utf8",
);
const terminalProof = readFileSync(
  new URL(
    "../../../tooling/windows/proof/Invoke-TerminalInstallerProof.ps1",
    import.meta.url,
  ),
  "utf8",
);
const issue34Aggregator = readFileSync(
  new URL(
    "../../../tooling/windows/proof/Confirm-Issue34Evidence.ps1",
    import.meta.url,
  ),
  "utf8",
);
const require = createRequire(import.meta.url);
const electronBuilderPackage = require.resolve("electron-builder/package.json");
const nsisTemplateRoot = path.join(
  path.dirname(electronBuilderPackage),
  "..",
  "app-builder-lib",
  "templates",
  "nsis",
);
const assistedTemplate = readFileSync(
  path.join(nsisTemplateRoot, "assistedInstaller.nsh"),
  "utf8",
);
const installerTemplate = readFileSync(
  path.join(nsisTemplateRoot, "installer.nsi"),
  "utf8",
);
const installSectionTemplate = readFileSync(
  path.join(nsisTemplateRoot, "installSection.nsh"),
  "utf8",
);
const installUtilTemplate = readFileSync(
  path.join(nsisTemplateRoot, "include", "installUtil.nsh"),
  "utf8",
);
const uninstallerTemplate = readFileSync(
  path.join(nsisTemplateRoot, "uninstaller.nsh"),
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

describe("unified Windows installer role selection", () => {
  it("validates CLI role selection during customInit", () => {
    expect(installer).toContain("!macro customInit");
    expect(installer).toContain('${GetOptions} $R7 "/ROLE=" $R6');
    expect(installer).toContain('$BreevRole != "main"');
    expect(installer).toContain('$BreevRole != "terminal"');
    expect(installer).toContain("SetErrorLevel 87");
    expectOrdered(installer, [
      "!macro BreevFailRole MESSAGE",
      "${IfNot} ${Silent}",
      "MessageBox",
      "Quit",
    ]);
  });

  it("uses installed state to preserve role and reject conversion", () => {
    expect(installer).toContain('FileOpen $R4 "$R5\\config\\device-role" r');
    expect(installer).toContain(
      "The installed Breev device role cannot be read. Repair is required.",
    );
    expect(installer).toContain("$BreevRole != $BreevInstalledRole");
    expect(installer).toContain('$BreevMainState == "1"');
    expect(installer).toContain('$BreevTerminalState == "1"');
    expect(installer).toContain(
      "The requested /ROLE conflicts with this computer",
    );
  });

  it("shows the required native radio choices and defaults to Main", () => {
    expect(installer).toContain(
      "Page custom BreevRolePageCreate BreevRolePageLeave",
    );
    expect(installer).toContain(
      "Main Pharmacy Server && Station (Primary Computer)",
    );
    expect(installer).toContain(
      "Additional POS Terminal (Cashier / Sales Counter)",
    );
    expectOrdered(installer, [
      'StrCpy $BreevRole "main"',
      "${NSD_CreateRadioButton}",
      "${NSD_Check} $BreevMainRoleRadio",
    ]);
  });

  it("skips UI for updates, explicit CLI roles, and silent installs", () => {
    expect(installer).toContain("${If} ${isUpdated}");
    expect(installer).toContain("${If} ${Silent}");
    expect(installer).toContain('StrCpy $BreevSkipRolePage "1"');
    expect(installer).toMatch(/\$\{If\} \$BreevSkipRolePage == "1"\s+Abort/);
  });

  it("passes the resolved role to install and repair lifecycle calls", () => {
    expect(installer).toContain('-Role "$BreevRole"');
    expectOrdered(installer, [
      "!macro customInstall",
      '${GetOptions} $R7 "/repair" $R6',
      '!insertmacro RunBreevLifecycle "Install"',
      '!insertmacro RunBreevLifecycle "Repair"',
    ]);
  });

  it("preserves data only for updates and cleans genuine uninstalls", () => {
    const start = installer.indexOf("!macro customUnInstall");
    const uninstallMacro = installer.slice(start);

    expectOrdered(uninstallMacro, [
      "${If} ${isUpdated}",
      '-Action "Uninstall"',
      "${Else}",
      '-Action "DestructiveUninstall"',
      "-DataDestructionAuthorized",
      '-DestructionConfirmation "destroy-pharmacy-data"',
      "-SkipStateWrite",
    ]);
    expect(uninstallMacro).toContain("No application files were removed");
    expect(installUtilTemplate).toContain('StrCpy $0 "$0 --updated"');
    expectOrdered(uninstallerTemplate, [
      "!insertmacro customUnInstall",
      "# delete the installed files",
    ]);
  });

  it("matches the pinned builder hook order before old-version removal", () => {
    expectOrdered(assistedTemplate, [
      "customPageAfterChangeDir",
      "MUI_PAGE_INSTFILES",
    ]);
    expectOrdered(installerTemplate, [
      "customInit",
      '!include "installSection.nsh"',
    ]);
    expectOrdered(installSectionTemplate, [
      "uninstallOldVersion SHELL_CONTEXT",
      "customInstall",
    ]);
  });

  it("uses the single BreevSetup.exe artifact everywhere", () => {
    expect(candidateBuilder).toContain(
      '$builderInstaller = Join-Path $builderOutput "BreevSetup.exe"',
    );
    expect(candidateBuilder).not.toContain("Breev-$version-windows-x64.exe");
  });

  it("keeps the Terminal lifecycle proof correlated with the existing Main proof", () => {
    expect(terminalProof).toContain(
      'source = "tooling/windows/proof/Invoke-TerminalInstallerProof.ps1"',
    );
    expect(terminalProof).toContain(
      '$mainEvidence.source -eq "tooling/windows/proof/Invoke-InstalledRuntimeProof.ps1"',
    );
    expect(terminalProof).toContain(
      'Invoke-Installer -Path $InstallerPath -Arguments @("/S", "/allusers", "/ROLE=terminal")',
    );
    expect(terminalProof).toContain(
      'Invoke-Installer -Path $UpdateInstallerPath -Arguments @("/S", "/allusers")',
    );
    expect(issue34Aggregator).toContain("[string] $TerminalResultPath");
    expect(issue34Aggregator).toContain(
      "$terminal.mainEvidence.sha256 -eq (Get-FileHash -LiteralPath",
    );
    expect(issue34Aggregator).toContain('Add-Criterion $criteria "AC-9"');
  });

  it("proves Terminal repair, failure, update, clean uninstall, and footprint invariants", () => {
    for (const check of [
      "repair-preserves-role-and-terminal-state",
      "failed-repair-preserves-terminal-state",
      "update-preserves-role-and-terminal-state",
      "uninstall-removes-role-and-terminal-state",
      "reinstall-selects-terminal-role-again",
    ]) {
      expect(terminalProof).toContain(check);
    }
    expect(terminalProof).toContain("$breevPorts = @(31310, 31311, 31312)");
    expect(terminalProof).toContain(
      "@($Facts.mainStatePathsPresent).Count -eq 0",
    );
    expect(terminalProof).toContain("@($Facts.firewallRules).Count -eq 0");
    expect(terminalProof).toContain("@($Facts.listeners).Count -eq 0");
    expect(terminalProof).toContain(
      "Refusing destructive lifecycle tests without -DisposableEnvironmentAcknowledged",
    );
  });
});
