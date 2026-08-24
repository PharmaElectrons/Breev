import { expect, test } from "@playwright/test";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { _electron as electron, type ElectronApplication } from "playwright";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";

test("the packaged window reports the real local runtime failures", async () => {
  const postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let api: ChildProcessWithoutNullStreams | undefined;
  let electronApp: ElectronApplication | undefined;

  try {
    api = spawnLocalApi(port, postgres.getConnectionUri());
    await waitForHealth(baseUrl);

    const executablePath = packagedExecutablePath();
    await access(executablePath);
    electronApp = await electron.launch({
      env: {
        ...process.env,
        BREEV_LOCAL_API_URL: baseUrl,
      },
      executablePath,
    });

    const window = await electronApp.firstWindow();
    await expect(window.getByTestId("handshake-state")).toHaveText(
      "Breev runtime ready",
    );
    await window.screenshot({
      path: path.resolve(
        import.meta.dirname,
        "../../../test-results/desktop/handshake-ready.png",
      ),
    });

    const rendererBoundary = await window.evaluate(() => {
      const runtimeWindow = window as unknown as {
        breevRuntime: Record<string, unknown>;
        process?: unknown;
      };
      return {
        preloadKeys: Object.keys(runtimeWindow.breevRuntime),
        nodeGlobal: typeof runtimeWindow.process,
      };
    });
    expect(rendererBoundary).toEqual({
      preloadKeys: ["getLocalApiUrl"],
      nodeGlobal: "undefined",
    });

    await postgres.stop();
    await window.getByRole("button", { name: "Retry" }).click();
    await expect(window.getByTestId("handshake-state")).toHaveText(
      "Database unavailable",
    );

    await stopProcess(api);
    api = undefined;
    await window.getByRole("button", { name: "Retry" }).click();
    await expect(window.getByTestId("handshake-state")).toHaveText(
      "Local API unreachable",
    );
  } finally {
    await electronApp?.close();
    await stopProcess(api);
    await postgres.stop().catch(() => undefined);
  }
});

function spawnLocalApi(
  port: number,
  databaseUrl: string,
): ChildProcessWithoutNullStreams {
  return spawn(
    process.execPath,
    [path.resolve(import.meta.dirname, "../../local-api/dist/main.js")],
    {
      env: {
        ...process.env,
        API_HOST: "127.0.0.1",
        API_PORT: String(port),
        DATABASE_URL: databaseUrl,
      },
    },
  );
}

function packagedExecutablePath(): string {
  const artifact = path.resolve(
    import.meta.dirname,
    `../../../artifacts/Breev-${process.platform}-${process.arch}`,
  );

  if (process.platform === "win32") {
    return path.join(artifact, "Breev.exe");
  }
  if (process.platform === "darwin") {
    return path.join(artifact, "Breev.app", "Contents", "MacOS", "Breev");
  }
  return path.join(artifact, "Breev");
}

async function waitForHealth(baseUrl: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.status === 200) {
        return;
      }
    } catch {
      await delay(100);
    }
  }
  throw new Error(`Local API did not become healthy at ${baseUrl}`);
}

async function reservePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a local API port"));
        return;
      }
      server.close((error) => {
        if (error === undefined) {
          resolve(address.port);
        } else {
          reject(error);
        }
      });
    });
  });
}

async function stopProcess(
  child: ChildProcessWithoutNullStreams | undefined,
): Promise<void> {
  if (child === undefined || child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5_000).unref();
  });
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
