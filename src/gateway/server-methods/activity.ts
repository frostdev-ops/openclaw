import { globalActivityRing } from "../../infra/activity-ring.js";
import type { GatewayRequestHandlers } from "./types.js";

export const activityHandlers: GatewayRequestHandlers = {
  "activity.recent": async ({ respond, params }) => {
    const limit = typeof params?.limit === "number" ? Math.min(params.limit, 500) : 100;
    const since = typeof params?.since === "number" ? params.since : undefined;
    const types = Array.isArray(params?.types) ? (params.types as string[]) : undefined;
    const entries = globalActivityRing.recent(limit, since, types);
    respond(true, { entries, count: entries.length }, undefined);
  },

  "activity.stats": async ({ respond, params }) => {
    const windowMinutes = typeof params?.windowMinutes === "number" ? params.windowMinutes : 60;
    const windowMs = windowMinutes * 60 * 1000;
    const counts = globalActivityRing.stats(windowMs);
    respond(true, { windowMinutes, counts }, undefined);
  },
};
