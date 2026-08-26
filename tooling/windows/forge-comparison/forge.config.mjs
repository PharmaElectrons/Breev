import { MakerWix } from "@electron-forge/maker-wix";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { flipFuses, FuseV1Options, FuseVersion } from "@electron/fuses";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const certificateFile = process.env.BREEV_WINDOWS_CERTIFICATE_FILE;
const certificatePassword = process.env.BREEV_WINDOWS_CERTIFICATE_PASSWORD;
const buildVersion = process.env.BREEV_WINDOWS_BUILD_VERSION ?? "0.0.0";

export function addBreevLifecycleActions(creator) {
  const productEnd = "  </Product>";
  const majorUpgrade =
    '    <MajorUpgrade AllowSameVersionUpgrades="yes" DowngradeErrorMessage="A later version of this product is already installed. Setup will now exit."/>';
  if (
    !creator.wixTemplate.includes(productEnd) ||
    !creator.wixTemplate.includes(majorUpgrade)
  ) {
    throw new Error("The pinned MakerWix template shape changed");
  }
  creator.wixTemplate = creator.wixTemplate.replace(
    majorUpgrade,
    majorUpgrade.replace("/>", ' Schedule="afterInstallInitialize"/>'),
  );
  const powerShell =
    "&quot;[System64Folder]WindowsPowerShell\\v1.0\\powershell.exe&quot; -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass";
  // MakerWix puts packaged resources below app-<version>, not directly below
  // APPLICATIONROOTDIRECTORY. Deferred actions otherwise fail with file-not-found.
  const applicationRoot = `[APPLICATIONROOTDIRECTORY]app-${buildVersion}`;
  const script = `&quot;${applicationRoot}\\resources\\payload\\lifecycle.ps1&quot;`;
  const common = `-InstallRoot &quot;${applicationRoot}&quot; -PayloadRoot &quot;${applicationRoot}\\resources\\payload&quot;`;
  // Breev's deferred lifecycle actions stop and recover both services. Letting
  // Restart Manager inspect the live 250 MB service payload crashes msiserver
  // before those actions run on the supported Windows 11 proof environment.
  creator.wixTemplate = creator.wixTemplate.replace(
    productEnd,
    `    <Property Id="MSIRESTARTMANAGERCONTROL" Value="Disable" />
    <Property Id="BREEVFORGEINJECTFAILURE" Secure="yes" />
    <CustomAction Id="BreevStopForRepair" Directory="APPLICATIONROOTDIRECTORY" ExeCommand="${powerShell} -File ${script} -Action &quot;Uninstall&quot; ${common}" Execute="deferred" Impersonate="no" Return="check" />
    <CustomAction Id="BreevRollbackStop" Directory="APPLICATIONROOTDIRECTORY" ExeCommand="${powerShell} -File ${script} -Action &quot;Uninstall&quot; ${common} -SkipStateWrite" Execute="rollback" Impersonate="no" Return="ignore" />
    <CustomAction Id="BreevRollbackRepair" Directory="APPLICATIONROOTDIRECTORY" ExeCommand="${powerShell} -File ${script} -Action &quot;Repair&quot; ${common}" Execute="rollback" Impersonate="no" Return="ignore" />
    <CustomAction Id="BreevRollbackUninstall" Directory="APPLICATIONROOTDIRECTORY" ExeCommand="${powerShell} -File ${script} -Action &quot;Repair&quot; ${common}" Execute="rollback" Impersonate="no" Return="ignore" />
    <CustomAction Id="BreevInstallLifecycle" Directory="APPLICATIONROOTDIRECTORY" ExeCommand="${powerShell} -File ${script} -Action &quot;Install&quot; ${common}" Execute="deferred" Impersonate="no" Return="check" />
    <CustomAction Id="BreevRepairLifecycle" Directory="APPLICATIONROOTDIRECTORY" ExeCommand="${powerShell} -File ${script} -Action &quot;Repair&quot; ${common}" Execute="deferred" Impersonate="no" Return="check" />
    <CustomAction Id="BreevUninstallLifecycle" Directory="APPLICATIONROOTDIRECTORY" ExeCommand="${powerShell} -File ${script} -Action &quot;Uninstall&quot; ${common}" Execute="deferred" Impersonate="no" Return="check" />
    <CustomAction Id="BreevInjectedFailure" Directory="APPLICATIONROOTDIRECTORY" ExeCommand="${powerShell} -Command &quot;&amp; { Set-Content -LiteralPath '[CommonAppDataFolder]Breev\\state\\forge-injected-failure.txt' -Value 'issue-34-injected-failure' -NoNewline -Encoding ASCII; exit 34 }&quot;" Execute="deferred" Impersonate="no" Return="check" />
    <InstallExecuteSequence>
      <Custom Action="BreevRollbackRepair" Before="BreevStopForRepair"><![CDATA[Installed AND REINSTALL]]></Custom>
      <Custom Action="BreevStopForRepair" Before="InstallFiles"><![CDATA[Installed AND REINSTALL]]></Custom>
      <Custom Action="BreevRollbackStop" After="InstallFiles"><![CDATA[NOT Installed OR (Installed AND REINSTALL)]]></Custom>
      <Custom Action="BreevInstallLifecycle" After="BreevRollbackStop"><![CDATA[NOT Installed]]></Custom>
      <Custom Action="BreevRepairLifecycle" After="BreevInstallLifecycle"><![CDATA[Installed AND REINSTALL]]></Custom>
      <Custom Action="BreevInjectedFailure" After="BreevRepairLifecycle"><![CDATA[BREEVFORGEINJECTFAILURE = "1" AND NOT REMOVE~="ALL"]]></Custom>
      <Custom Action="BreevRollbackUninstall" Before="BreevUninstallLifecycle"><![CDATA[REMOVE~="ALL"]]></Custom>
      <Custom Action="BreevUninstallLifecycle" Before="RemoveFiles"><![CDATA[REMOVE~="ALL"]]></Custom>
    </InstallExecuteSequence>
${productEnd}`,
  );
}

const windowsFuseConfig = Object.freeze({
  version: FuseVersion.V1,
  strictlyRequireAllFuses: true,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  [FuseV1Options.WasmTrapHandlers]: true,
});

export default {
  packagerConfig: {
    afterComplete: [
      (buildPath, _electronVersion, _platform, _arch, done) => {
        refreshPayloadExecutableHashes(
          path.join(buildPath, "resources", "payload"),
        ).then(() => done(), done);
      },
    ],
    afterCopy: [
      (buildPath, _electronVersion, _platform, _arch, done) => {
        try {
          const packagePath = path.join(buildPath, "package.json");
          const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
          packageJson.version = buildVersion;
          writeFileSync(
            packagePath,
            `${JSON.stringify(packageJson, null, 2)}\n`,
          );
          done();
        } catch (error) {
          done(error);
        }
      },
    ],
    appVersion: buildVersion,
    asar: true,
    extraResource: [
      path.resolve(import.meta.dirname, "../../../artifacts/windows/payload"),
    ],
    name: "BreevForgeComparison",
    windowsSign:
      certificateFile === undefined
        ? undefined
        : {
            certificateFile,
            certificatePassword,
            hashes: ["sha256"],
          },
  },
  rebuildConfig: {},
  hooks: {
    packageAfterCopy: async (
      _configuration,
      resourcesPath,
      _electronVersion,
      platform,
    ) => {
      if (platform !== "win32") {
        throw new Error("The Forge comparison is Windows-only");
      }
      await flipFuses(
        path.resolve(resourcesPath, "../..", "electron.exe"),
        windowsFuseConfig,
      );
    },
  },
  makers: [
    new MakerWix({
      arch: "x64",
      beforeCreate: addBreevLifecycleActions,
      defaultInstallMode: "perMachine",
      exe: "BreevForgeComparison.exe",
      icon: path.resolve(
        import.meta.dirname,
        "../../../design/prototype/public/favicon.ico",
      ),
      manufacturer: "Breev",
      name: "Breev Forge Comparison",
      programFilesFolderName: "Breev Forge Comparison",
      upgradeCode: "6f630741-72aa-52ee-9501-f5b1414aa07d",
      version: buildVersion,
      windowsSign:
        certificateFile === undefined
          ? undefined
          : {
              certificateFile,
              certificatePassword,
              hashes: ["sha256"],
            },
    }),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: path.resolve(
            import.meta.dirname,
            "../../../apps/desktop/src/main/index.ts",
          ),
          config: path.resolve(import.meta.dirname, "vite.main.config.mjs"),
          target: "main",
        },
        {
          entry: path.resolve(
            import.meta.dirname,
            "../../../apps/desktop/src/preload/index.ts",
          ),
          config: path.resolve(import.meta.dirname, "vite.preload.config.mjs"),
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: path.resolve(import.meta.dirname, "vite.renderer.config.mjs"),
        },
      ],
    }),
  ],
};

async function refreshPayloadExecutableHashes(payloadRoot) {
  const manifestPath = path.join(payloadRoot, "payload-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const componentRoots = {
    node: "node",
    postgresql: "postgresql",
    shawl: "service-wrapper",
  };
  for (const component of manifest.components) {
    const componentRoot = componentRoots[component.name];
    if (
      componentRoot === undefined ||
      component.sourceExecutableHashes === undefined
    ) {
      throw new Error("The Forge payload manifest lacks pinned provenance");
    }
    for (const relativePath of Object.keys(component.executableHashes)) {
      component.executableHashes[relativePath] = createHash("sha256")
        .update(
          await readFile(path.join(payloadRoot, componentRoot, relativePath)),
        )
        .digest("hex");
    }
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
