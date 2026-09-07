/**
 * Usage tracking (section 35). Mirrors QuotaManager consumption into per-period
 * rows so the Free-Tier dashboard can show what was spent where. In-memory here;
 * production persists to the `usage` table.
 */

import type { BuildProvider } from "@apk-factory/types";

export interface UsageRow {
  provider: BuildProvider | "ai" | "eas";
  unit: "builds" | "minutes";
  consumed: number;
}

export class UsageService {
  private rows: { provider: UsageRow["provider"]; unit: UsageRow["unit"]; amount: number; at: string }[] = [];

  record(provider: UsageRow["provider"], amount: number, unit: UsageRow["unit"]): void {
    this.rows.push({ provider, unit, amount, at: new Date().toISOString() });
  }

  summary(): UsageRow[] {
    const map = new Map<string, UsageRow>();
    for (const r of this.rows) {
      const key = `${r.provider}:${r.unit}`;
      const cur = map.get(key) ?? { provider: r.provider, unit: r.unit, consumed: 0 };
      cur.consumed += r.amount;
      map.set(key, cur);
    }
    return [...map.values()];
  }
}
