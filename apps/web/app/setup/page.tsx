"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type Checklist, type PlatformStatus } from "@/lib/api";
import { useSession } from "@/components/useSession";

const HEALTH: Record<string, string> = { ok: "bg-emerald-400", warn: "bg-amber-400", missing: "bg-rose-400" };

/**
 * Zero-Manual-Config setup wizard: one screen that tells the operator what the
 * deployment still needs (with the exact command) and walks the user through
 * sign-in → GitHub → first repo → first build.
 */
export default function SetupWizard() {
  const { user } = useSession();
  const [status, setStatus] = useState<PlatformStatus | null>(null);
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      const [s, c] = await Promise.all([api.setupStatus(), api.checklist()]);
      setStatus(s); setChecklist(c); setErr(null);
    } catch (e: any) { setErr(e.message ?? String(e)); }
  }
  useEffect(() => { load(); }, [user]);

  const nextStep = checklist?.steps.find((s) => !s.done && !s.optional);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold">Setup</h1>
        <p className="text-sm text-slate-400">Nothing to edit by hand: the platform reports what it needs and where to click.</p>
        {err && <p className="mt-2 text-sm text-rose-300">API unreachable: {err}</p>}
      </header>

      {/* ── User onboarding ─────────────────────────────────────────── */}
      <section className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Your checklist</h2>
          {checklist && <span className="text-xs text-slate-400">{checklist.progress}% · {checklist.complete ? "all set 🎉" : "in progress"}</span>}
        </div>
        {checklist && (
          <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-gradient-to-r from-brand-500 to-emerald-400 transition-all" style={{ width: `${checklist.progress}%` }} />
          </div>
        )}
        <ol className="space-y-2">
          {checklist?.steps.map((s, i) => (
            <li key={s.id} className={`flex items-start gap-3 rounded-xl border p-3 ${s.done ? "border-emerald-500/20 bg-emerald-500/5" : nextStep?.id === s.id ? "border-brand-500/40 bg-brand-500/10" : "border-white/10"}`}>
              <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${s.done ? "bg-emerald-400 text-black" : "bg-white/10 text-slate-300"}`}>{s.done ? "✓" : i + 1}</span>
              <div className="flex-1">
                <div className="flex items-center gap-2 font-medium">
                  {s.title}
                  {s.optional && <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">optional</span>}
                </div>
                <div className="text-xs text-slate-400">{s.hint}</div>
              </div>
              {!s.done && s.action && (
                s.id === "github" && status?.capabilities.find((c) => c.id === "github-oauth")?.health === "ok"
                  ? <a href={api.githubStartUrl("read", "/setup")} className="btn-primary !py-1 text-xs">Connect GitHub</a>
                  : <Link href={s.action.href} className={`${nextStep?.id === s.id ? "btn-primary" : "btn-ghost"} !py-1 text-xs`}>{s.action.label}</Link>
              )}
            </li>
          ))}
        </ol>
      </section>

      {/* ── Platform capabilities ───────────────────────────────────── */}
      <section className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Platform status</h2>
          {status && (
            <span className={`rounded-full px-2 py-0.5 text-xs ${status.ready ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-200"}`}>
              {status.mode} · v{status.version} · {status.ready ? "ready" : "needs attention"}
            </span>
          )}
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {status?.capabilities.map((c) => (
            <div key={c.id} className="rounded-xl border border-white/10 bg-cloud-900/40 p-3 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <span className={`h-2 w-2 rounded-full ${HEALTH[c.health]}`} />
                {c.label}
              </div>
              <div className="mt-1 text-xs text-slate-400">{c.detail}</div>
              {c.fix && (
                <pre className="mt-2 overflow-x-auto rounded-lg bg-black/40 p-2 text-[11px] text-amber-200">{c.fix}</pre>
              )}
              <div className="mt-1 flex flex-wrap gap-1">
                {c.requires.map((r) => <span key={r} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">{r}</span>)}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Operators: run <code className="rounded bg-black/40 px-1">npm run setup</code> for an interactive walkthrough that runs these commands for you.
        </p>
      </section>
    </div>
  );
}
