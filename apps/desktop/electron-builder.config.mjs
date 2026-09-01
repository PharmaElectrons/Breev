import { flipFuses, FuseVersion, FuseV1Options } from "@electron/fuses";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const certificateFile = process.env.BREEV_WINDOWS_CERTIFICATE_FILE;
const certificatePassword = process.env.BREEV_WINDOWS_CERTIFICATE_PASSWORD;
const buildVersion = process.env.BREEV_WINDOWS_BUILD_VERSION ?? "0.0.0";

export const windowsFuseConfig = Object.freeze({
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

async function hardenElectronBeforeSigning(context) {
  const executablePath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.exe`,
  );
  await flipFuses(executablePath, windowsFuseConfig);
}

async function recordSignedPayloadHashes(context) {
  await refreshPayloadExecutableHashes(
    path.join(context.appOutDir, "resources", "windows-payload"),
  );
}

export async function refreshPayloadExecutableHashes(payloadRoot) {
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
      throw new Error("The Windows payload manifest lacks pinned provenance");
    }
    for (const relativePath of Object.keys(component.executableHashes)) {
      const bytes = await readFile(
        path.join(payloadRoot, componentRoot, relativePath),
      );
      component.executableHashes[relativePath] = createHash("sha256")
        .update(bytes)
        .digest("hex");
    }
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

export default {
  appId: "com.breev.desktop",
  productName: "Breev",
  asar: true,
  compression: "maximum",
  disableAsarIntegrity: false,
  directories: {
    buildResources: "windows",
    output: "../../artifacts/windows/electron-builder",
  },
  afterPack: hardenElectronBeforeSigning,
  afterSign: recordSignedPayloadHashes,
  extraMetadata: {
    version: buildVersion,
  },
  extraResources: [
    {
      from: "../../artifacts/windows/payload",
      to: "windows-payload",
    },
  ],
  files: ["out/**/*", "package.json"],
  forceCodeSigning: process.env.BREEV_WINDOWS_REQUIRE_SIGNING === "1",
  npmRebuild: false,
  toolsets: {
    nsis: "1.2.1",
    wine: "1.0.1",
    winCodeSign: "1.1.0",
  },
  win: {
    signExts: [
      ".exe",
      ".dll",
      ".node",
      ".sys",
      ".efi",
      ".scr",
      ".msi",
      ".cat",
      ".cab",
      ".xap",
      ".vbs",
      ".wsf",
      ".ps1",
    ],
    target: [
      {
        target: "nsis",
        arch: ["x64"],
      },
    ],
    requestedExecutionLevel: "asInvoker",
    signAndEditExecutable: true,
    signtoolOptions:
      certificateFile === undefined
        ? undefined
        : {
            certificateFile,
            certificatePassword,
            signingHashAlgorithms: ["sha256"],
          },
    verifyUpdateCodeSignature: true,
  },
  nsis: {
    allowElevation: true,
    allowToChangeInstallationDirectory: false,
    artifactName: "BreevSetup.${ext}",
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    differentialPackage: true,
    include: "windows/installer.nsh",
    oneClick: false,
    perMachine: true,
    runAfterFinish: false,
  },
};
