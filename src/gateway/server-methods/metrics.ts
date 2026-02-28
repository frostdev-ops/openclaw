import { cpus, freemem, loadavg, totalmem } from "os";
import type { GatewayRequestHandlers } from "./types.js";

export const metricsHandlers: GatewayRequestHandlers = {
  "metrics.system": async ({ respond, params }) => {
    const includeDisks = params?.includeDisks === true;
    const cpuList = cpus();
    const totalMem = totalmem();
    const freeMem = freemem();
    const usedMem = totalMem - freeMem;
    const memPercent = Math.round((usedMem / totalMem) * 100);
    const load = loadavg();
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();

    const result: Record<string, unknown> = {
      cpu: {
        model: cpuList[0]?.model ?? "unknown",
        cores: cpuList.length,
        loadAvg: load,
        usagePercent: Math.min(100, Math.round((load[0] / cpuList.length) * 100)),
      },
      memory: {
        total: totalMem,
        free: freeMem,
        used: usedMem,
        percent: memPercent,
      },
      process: {
        pid: process.pid,
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        external: mem.external,
        cpuUserMs: Math.round(cpu.user / 1000),
        cpuSystemMs: Math.round(cpu.system / 1000),
      },
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    };

    if (includeDisks) {
      // Basic disk info via statfs is not available cross-platform in Node
      result.disk = null;
    }

    respond(true, result, undefined);
  },

  "metrics.process": async ({ respond, context }) => {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    respond(
      true,
      {
        uptimeMs: Math.round(process.uptime() * 1000),
        memoryUsage: {
          rss: mem.rss,
          heapUsed: mem.heapUsed,
          heapTotal: mem.heapTotal,
          external: mem.external,
        },
        cpuUsage: {
          userMs: Math.round(cpu.user / 1000),
          systemMs: Math.round(cpu.system / 1000),
        },
        chatRunsActive: context.chatAbortControllers.size,
        dedupeEntries: context.dedupe.size,
        nodeVersion: process.version,
      },
      undefined,
    );
  },
};
