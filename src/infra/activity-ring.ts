import { randomUUID } from "crypto";

export interface ActivityEntry {
  id: string;
  ts: number;
  type: string;
  sessionKey?: string;
  summary: string;
  data?: unknown;
}

export class ActivityRing {
  private entries: ActivityEntry[] = [];
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  push(entry: Omit<ActivityEntry, "id">): void {
    const full = { ...entry, id: randomUUID() };
    if (this.entries.length >= this.capacity) {
      this.entries.shift();
    }
    this.entries.push(full);
  }

  recent(limit = 100, since?: number, types?: string[]): ActivityEntry[] {
    let result = this.entries;
    if (since != null) {
      result = result.filter((e) => e.ts > since);
    }
    if (types && types.length > 0) {
      result = result.filter((e) => types.includes(e.type));
    }
    return result.slice(-limit);
  }

  stats(windowMs: number): Record<string, number> {
    const since = Date.now() - windowMs;
    const recent = this.entries.filter((e) => e.ts > since);
    const counts: Record<string, number> = {};
    for (const e of recent) {
      counts[e.type] = (counts[e.type] ?? 0) + 1;
    }
    return counts;
  }
}

export const globalActivityRing = new ActivityRing(500);
