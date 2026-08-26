import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { addBreevLifecycleActions } from "./forge.config.mjs";
import rendererConfig from "./vite.renderer.config.mjs";

test("keeps renderer dependencies resolvable with pnpm", () => {
  assert.equal(rendererConfig.resolve.preserveSymlinks, false);
});

test("adds one complete machine lifecycle sequence to the pinned WiX template", async () => {
  const creator = {
    wixTemplate: await readFile(
      new URL(
        "./node_modules/electron-wix-msi/static/wix.xml",
        import.meta.url,
      ),
      "utf8",
    ),
  };

  addBreevLifecycleActions(creator);

  assert.equal(count(creator.wixTemplate, "<InstallExecuteSequence>"), 1);
  assert.match(
    creator.wixTemplate,
    /<MajorUpgrade [^>]*Schedule="afterInstallInitialize"\/>/,
  );
  assert.equal(
    count(
      creator.wixTemplate,
      '<Property Id="MSIRESTARTMANAGERCONTROL" Value="Disable" />',
    ),
    1,
  );
  for (const action of [
    "BreevStopForRepair",
    "BreevRollbackStop",
    "BreevRollbackRepair",
    "BreevRollbackUninstall",
    "BreevInstallLifecycle",
    "BreevRepairLifecycle",
    "BreevUninstallLifecycle",
    "BreevInjectedFailure",
  ]) {
    assert.equal(count(creator.wixTemplate, `<CustomAction Id="${action}"`), 1);
    assert.equal(count(creator.wixTemplate, `<Custom Action="${action}"`), 1);
  }
  assert.equal(
    count(
      creator.wixTemplate,
      "[APPLICATIONROOTDIRECTORY]app-0.0.0\\resources\\payload\\lifecycle.ps1",
    ),
    7,
  );
  assert.equal(
    count(
      creator.wixTemplate,
      "-PayloadRoot &quot;[APPLICATIONROOTDIRECTORY]app-0.0.0\\resources\\payload&quot;",
    ),
    7,
  );
  assert.doesNotMatch(
    creator.wixTemplate,
    /\[APPLICATIONROOTDIRECTORY\]resources\\payload/,
  );
  assert.match(
    creator.wixTemplate,
    /BreevRollbackRepair[\s\S]*Before="BreevStopForRepair"><!\[CDATA\[Installed AND REINSTALL\]\]>/,
  );
  assert.match(
    creator.wixTemplate,
    /BreevStopForRepair[\s\S]*Before="InstallFiles"><!\[CDATA\[Installed AND REINSTALL\]\]>/,
  );
  assert.match(
    creator.wixTemplate,
    /BreevRollbackStop[\s\S]*After="InstallFiles"><!\[CDATA\[NOT Installed OR \(Installed AND REINSTALL\)\]\]>/,
  );
  assert.match(
    creator.wixTemplate,
    /CustomAction Id="BreevRollbackStop"[^>]*-SkipStateWrite"/,
  );
  assert.match(
    creator.wixTemplate,
    /BreevInstallLifecycle[\s\S]*After="BreevRollbackStop"><!\[CDATA\[NOT Installed\]\]>/,
  );
  assert.match(
    creator.wixTemplate,
    /BreevRepairLifecycle[\s\S]*After="BreevInstallLifecycle"><!\[CDATA\[Installed AND REINSTALL\]\]>/,
  );
  assert.match(
    creator.wixTemplate,
    /BreevInjectedFailure[\s\S]*issue-34-injected-failure[\s\S]*After="BreevRepairLifecycle"><!\[CDATA\[BREEVFORGEINJECTFAILURE = "1" AND NOT REMOVE~="ALL"\]\]>/,
  );
  assert.match(
    creator.wixTemplate,
    /BreevRollbackUninstall[\s\S]*Before="BreevUninstallLifecycle"><!\[CDATA\[REMOVE~="ALL"\]\]>/,
  );
  assert.match(
    creator.wixTemplate,
    /BreevUninstallLifecycle[\s\S]*Before="RemoveFiles"><!\[CDATA\[REMOVE~="ALL"\]\]>/,
  );
});

test("fails closed if the pinned MakerWix template shape changes", () => {
  assert.throws(
    () => addBreevLifecycleActions({ wixTemplate: "<Product />" }),
    /template shape changed/,
  );
});

function count(value, pattern) {
  return value.split(pattern).length - 1;
}
