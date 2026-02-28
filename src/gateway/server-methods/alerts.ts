import { globalAlertManager } from "../../infra/alert-manager.js";
import type { GatewayRequestHandlers } from "./types.js";

export const alertHandlers: GatewayRequestHandlers = {
  "alerts.list": async ({ respond, params }) => {
    const alerts = globalAlertManager.list({
      severity: typeof params?.severity === "string" ? params.severity : undefined,
      acknowledged: typeof params?.acknowledged === "boolean" ? params.acknowledged : undefined,
      limit: typeof params?.limit === "number" ? params.limit : undefined,
    });
    respond(true, { alerts, count: alerts.length }, undefined);
  },

  "alerts.acknowledge": async ({ respond, params }) => {
    const ids: string[] = [];
    if (typeof params?.id === "string") {
      ids.push(params.id);
    }
    if (Array.isArray(params?.ids)) {
      ids.push(...(params.ids as string[]));
    }
    globalAlertManager.acknowledge(ids);
    respond(true, { acknowledged: ids.length }, undefined);
  },

  "alerts.config": async ({ respond, params }) => {
    if (params?.thresholds && typeof params.thresholds === "object") {
      globalAlertManager.setConfig(params.thresholds as Record<string, number>);
    }
    respond(true, globalAlertManager.getConfig(), undefined);
  },
};
