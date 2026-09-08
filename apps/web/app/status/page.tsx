"use client";

import { useEffect, useState } from "react";
import { api, type PlatformStatus } from "@/lib/api";

const HEALTH: Record<string, { dot: string; label: string }> = {
  ok: { dot: "bg-emerald-400", label: "OK" },
  warn: { dot: "bg-amber-400", label: "Degraded" },
  missing: { dot: "bg-rose-400", label: "Missing" },
};

/** Read-only public status page (mirrors GET /setup/status). */
export default function StatusPage() {
  const [status, setStatus] = useState<PlatformStatus | null>(null);
  const [health, setHealth] = useState<{ ok: boolean; version: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.health().then(setHealth).catch((e) => setErr(String(e.message ?? e)));
    api.setupStatus().then(setStatus).catch(() => {});
  }, []);

  const counts = status ? { ok: status.capabilities.filter((c) => c.health === "ok").length, total: status.capabilities.length } : null;

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Platform status</h1>
      <p className="mb-6 text-sm text-slate-400">API {health ? <span className="text-emerald-300">online · v{health.version}</span> : err ? <span className="text-rose-300">offline ({err})</span> : "checking…"}{counts && <> · {counts.ok}/{counts.total} capabilities healthy</>}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {status?.capabilities.map((c) => (
          <div key={c.id} className="card">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{c.label}</span>
              <span className="flex items-center gap-1 text-xs text-slate-300"><span className={`h-2 w-2 rounded-full ${HEALTH[c.health].dot}`} />{HEALTH[c.health].label}</span>
            </div>
            <div className="mt-1 text-xs text-slate-400">{c.detail}</div>
          </div>
        ))}
      </div>
      {status && <p className="mt-6 text-xs text-slate-500">Checked {new Date(status.checkedAt).toLocaleString()} · environment {status.environment}</p>}
    </div>
  );
}
