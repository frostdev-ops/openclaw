import type { GatewayRequestHandlers } from "./types.js";

export const diagnosticsExtendedHandlers: GatewayRequestHandlers = {
  "diagnostics.environment": async ({ respond }) => {
    respond(
      true,
      {
        runtime: {
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
          pid: process.pid,
          execPath: process.execPath,
          uptimeSeconds: Math.round(process.uptime()),
        },
        env: {
          cwd: process.cwd(),
          PATH: (process.env.PATH ?? "")
            .split(process.platform === "win32" ? ";" : ":")
            .filter(Boolean),
        },
      },
      undefined,
    );
  },

  "diagnostics.sessions": async ({ respond, context }) => {
    const mem = process.memoryUsage();
    respond(
      true,
      {
        uptimeMs: Math.round(process.uptime() * 1000),
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        chatAbortControllers: context.chatAbortControllers.size,
        dedupeSize: context.dedupe.size,
      },
      undefined,
    );
  },

  "diagnostics.webhooks": async ({ respond }) => {
    respond(
      true,
      {
        note: "Webhook diagnostics not yet instrumented",
        totals: { received: 0, processed: 0, errors: 0 },
      },
      undefined,
    );
  },
};
