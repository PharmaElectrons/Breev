import express, { type ErrorRequestHandler } from "express";
import { request as httpRequest, type Server } from "node:http";
import { describe, expect, it } from "vitest";

import {
  createMainRequestBodyParser,
  mainRequestBodyLimit,
} from "./main-device-security.service.js";

describe("main request body limits", () => {
  it("allows the larger body only for the exact quick-access POST contract", () => {
    expect(mainRequestBodyLimit("POST", "/sales/quick-access")).toBe(
      1024 * 1024,
    );
    for (const [method, path] of [
      ["GET", "/sales/quick-access"],
      ["PUT", "/sales/quick-access"],
      ["POST", "/sales/quick-access/"],
      ["POST", "/sales/other"],
    ]) {
      expect(mainRequestBodyLimit(method!, path!)).toBe(8 * 1024);
    }
  });

  it("enforces both limits on chunked requests without a Content-Length", async () => {
    const app = express();
    app.use(createMainRequestBodyParser());
    app.use((request, response) => {
      response.status(200).json({
        contentLength: request.get("content-length") ?? null,
        transferEncoding: request.get("transfer-encoding") ?? null,
      });
    });
    const errorHandler: ErrorRequestHandler = (
      error: unknown,
      _request,
      response,
      _next,
    ) => {
      void _next;
      response
        .status(readErrorType(error) === "entity.too.large" ? 413 : 400)
        .end();
    };
    app.use(errorHandler);

    const server = await listen(app);
    try {
      const allowed = await sendChunkedJson(
        server,
        "POST",
        "/sales/quick-access",
      );
      expect(allowed.statusCode).toBe(200);
      expect(allowed.body).toEqual({
        contentLength: null,
        transferEncoding: "chunked",
      });

      for (const [method, path] of [
        ["POST", "/sales/other"],
        ["PUT", "/sales/quick-access"],
        ["POST", "/sales/quick-access/"],
      ]) {
        const rejected = await sendChunkedJson(server, method!, path!);
        expect(rejected.statusCode, `${method} ${path}`).toBe(413);
      }
    } finally {
      await close(server);
    }
  });
});

async function listen(app: express.Express): Promise<Server> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  return server;
}

function sendChunkedJson(
  server: Server,
  method: string,
  path: string,
): Promise<{
  readonly body: unknown;
  readonly statusCode: number | undefined;
}> {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port");
  }

  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        headers: { "content-type": "application/json" },
        hostname: "127.0.0.1",
        method,
        path,
        port: address.port,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () => {
          resolve({
            body: body.length === 0 ? undefined : JSON.parse(body),
            statusCode: response.statusCode,
          });
        });
      },
    );
    request.once("error", reject);
    request.write('{"padding":"');
    request.write("x".repeat(30_000));
    request.end('"}');
  });
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) reject(error);
      else resolve();
    });
  });
}

function readErrorType(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "type" in error &&
    typeof error.type === "string"
    ? error.type
    : undefined;
}
