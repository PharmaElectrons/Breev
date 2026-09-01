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
});
