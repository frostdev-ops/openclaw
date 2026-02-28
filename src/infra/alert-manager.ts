import { randomUUID } from "crypto";

export interface Alert {
  id: string;
  ts: number;
  severity: "info" | "warn" | "error";
  category: string;
  title: string;
  details: string;
  acknowledged: boolean;
  resolvedAt?: number;
}

export interface AlertThresholds {
  memoryPercent: number;
  queueDepth: number;
  errorRatePerMinute: number;
}

const DEFAULT_THRESHOLDS: AlertThresholds = {
  memoryPercent: 90,
  queueDepth: 100,
  errorRatePerMinute: 10,
};

export class AlertManager {
  private alerts: Alert[] = [];
  private thresholds: AlertThresholds = { ...DEFAULT_THRESHOLDS };

  list(filter?: { severity?: string; acknowledged?: boolean; limit?: number }): Alert[] {
    let result = this.alerts;
    if (filter?.severity) {
      result = result.filter((a) => a.severity === filter.severity);
    }
    if (filter?.acknowledged != null) {
      result = result.filter((a) => a.acknowledged === filter.acknowledged);
    }
    if (filter?.limit) {
      result = result.slice(-filter.limit);
    }
    return result;
  }

  acknowledge(ids: string[]): void {
    for (const alert of this.alerts) {
      if (ids.includes(alert.id)) {
        alert.acknowledged = true;
      }
    }
  }

  getConfig(): AlertThresholds {
    return { ...this.thresholds };
  }

  setConfig(t: Partial<AlertThresholds>): void {
    this.thresholds = { ...this.thresholds, ...t };
  }

  add(entry: Omit<Alert, "id" | "ts" | "acknowledged">): Alert {
    const alert: Alert = { ...entry, id: randomUUID(), ts: Date.now(), acknowledged: false };
    this.alerts.push(alert);
    if (this.alerts.length > 200) {
      this.alerts.shift();
    }
    return alert;
  }
}

export const globalAlertManager = new AlertManager();
