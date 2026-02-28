import { loadConfig } from "../../config/config.js";
import type { GatewayRequestHandlers } from "./types.js";

export const networkHandlers: GatewayRequestHandlers = {
  "network.connections": async ({ respond, context }) => {
    const connectedNodes = context.nodeRegistry.listConnected();
    respond(
      true,
      {
        nodes: connectedNodes.map((n) => ({
          nodeId: n.nodeId,
          displayName: n.displayName,
          platform: n.platform,
          connectedAtMs: n.connectedAtMs,
        })),
        nodeCount: connectedNodes.length,
      },
      undefined,
    );
  },

  "network.discovery": async ({ respond }) => {
    const cfg = loadConfig();
    respond(
      true,
      {
        gateway: {
          port: cfg.gateway?.port ?? null,
          mode: cfg.gateway?.mode ?? null,
        },
      },
      undefined,
    );
  },
};
