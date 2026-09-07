/**
 * Free-Tier Manager (section 35). Tracks remaining quota for every build
 * provider and the AI router, and answers "which provider should I use?".
 *
 * The numbers below reflect the documented free tiers at the time of writing;
 * each adapter refreshes them from the live API so the platform never hard-codes
 * stale limits. When a provider's free tier is exhausted the Router simply moves
 * to the next available builder (section 42).
 */

import type { BuildProvider, ProviderQuota } from "@apk-factory/types";
import { Logger } from "@apk-factory/logger";

type QuotaKey = BuildProvider | "ai";

export class QuotaManager {
  private quotas = new Map<QuotaKey, ProviderQuota>();
  /** Fired whenever quota is consumed — used to feed UsageService. */
  onConsume?: (provider: QuotaKey, amount: number, unit: ProviderQuota["unit"]) => void;

  constructor(
    seed: Partial<Record<QuotaKey, Omit<ProviderQuota, "available">>> = {},
    private readonly log: Logger = new Logger("quota"),
  ) {
    const defaults: Record<QuotaKey, Omit<ProviderQuota, "available">> = {
      eas: { provider: "eas", plan: "free", remaining: 15, unit: "builds", resetsAt: nextMonth() },
      "github-actions": { provider: "github-actions", plan: "free", remaining: 2000, unit: "minutes", resetsAt: nextMonth() },
      "cloudflare-builds": { provider: "cloudflare-builds", plan: "free", remaining: 3000, unit: "minutes", resetsAt: nextMonth() },
      docker: { provider: "docker", plan: "local", remaining: Infinity, unit: "builds", resetsAt: nextMonth() },
      ai: { provider: "ai", plan: "free", remaining: 1000, unit: "builds", resetsAt: nextMonth() },
    };
    for (const [k, v] of Object.entries({ ...defaults, ...seed })) {
      this.quotas.set(k as QuotaKey, { ...v, available: v.remaining > 0 });
    }
  }

  get(provider: QuotaKey): ProviderQuota {
    const q = this.quotas.get(provider);
    if (!q) throw new Error(`unknown provider quota: ${provider}`);
    return q;
  }

  all(): ProviderQuota[] {
    return [...this.quotas.values()];
  }

  isAvailable(provider: QuotaKey): boolean {
    const q = this.quotas.get(provider);
    return Boolean(q && q.available && q.remaining > 0);
  }

  /** Consume quota; clamps and flips availability when exhausted. */
  consume(provider: QuotaKey, amount = 1): void {
    const q = this.quotas.get(provider);
    if (!q) return;
    if (!Number.isFinite(q.remaining)) return; // unlimited (e.g. local docker)
    q.remaining = Math.max(0, q.remaining - amount);
    q.available = q.remaining > 0;
    this.log.info("quota consumed", { provider, remaining: q.remaining });
    this.onConsume?.(provider, amount, q.unit);
  }

  /** Refresh from a live adapter. */
  sync(provider: QuotaKey, remaining: number, resetsAt: string): void {
    const q = this.quotas.get(provider);
    if (!q) return;
    q.remaining = remaining;
    q.resetsAt = resetsAt;
    q.available = remaining > 0;
  }

  /**
   * Choose the cheapest/free available route among candidates, honouring a
   * preference order (usually set by the Build Router per framework).
   */
  pickFreeRoute(candidates: QuotaKey[]): QuotaKey | null {
    for (const c of candidates) {
      if (this.isAvailable(c)) return c;
    }
    return null;
  }
}

function nextMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1, 1);
  return d.toISOString();
}

export * from "./usage.js";
