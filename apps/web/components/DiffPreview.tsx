"use client";

import { useEffect, useMemo, useState } from "react";
import { api, type PatchPreview, type RepairPreview } from "@/lib/api";

const RISK: Record<string, string> = { none: "text-emerald-300", low: "text-emerald-300", medium: "text-amber-300", high: "text-rose-300" };
const LEVEL = ["Environment", "Dependencies", "Configuration", "Source code"];

function DiffBlock({ diff }: { diff: string }) {
  const lines = diff.split("\n").slice(2); // drop ---/+++ headers (shown in the card title)
  return (
    <pre className="max-h-80 overflow-auto rounded-xl bg-black/50 p-3 font-mono text-[11px] leading-relaxed">
      {lines.map((l, i) => {
        const cls = l.startsWith("+") ? "bg-emerald-500/15 text-emerald-200" : l.startsWith("-") ? "bg-rose-500/15 text-rose-200" : l.startsWith("@@") ? "text-sky-300" : "text-slate-400";
        return <div key={i} className={`${cls} whitespace-pre px-1`}>{l || " "}</div>;
      })}
    </pre>
  );
}

/**
 * §22 — "Never edit main blindly": show every patch as a unified diff, let the
 * user tick what they approve, then apply (locally to the analyzed snapshot,
 * or as an isolated fix branch + PR when Create Fix PR is enabled at build time).
 */
export function DiffPreview({ projectId, patches, onApplied }: { projectId: string; patches?: any[]; onApplied?: (analysis: any) => void }) {
  const [preview, setPreview] = useState<RepairPreview | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    setErr(null);
    api.previewRepairs(projectId, patches).then((p) => {
      if (!alive) return;
      setPreview(p);
      // Pre-select everything that does not need approval; user opts in to the rest.
      setSelected(new Set(p.previews.map((x, i) => (!x.requiresApproval && x.kind === "file" && x.diff ? i : -1)).filter((i) => i >= 0)));
      setExpanded(new Set(p.previews.map((_, i) => i).slice(0, 2)));
    }).catch((e) => alive && setErr(e.message ?? String(e)));
    return () => { alive = false; };
  }, [projectId, JSON.stringify(patches ?? null)]);

  const toggle = (i: number) => setSelected((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });
  const applicable = useMemo(() => preview?.previews.map((p, i) => ({ p, i })).filter(({ p }) => p.kind === "file" && p.diff) ?? [], [preview]);

  async function apply() {
    if (!preview) return;
    setBusy(true); setErr(null);
    try {
      const approved = [...selected].map((i) => preview.previews[i].patch);
      const r = await api.applyRepairs(projectId, approved);
      setDone(r.applied);
      onApplied?.(r.analysis);
    } catch (e: any) { setErr(e.message ?? String(e)); } finally { setBusy(false); }
  }

  if (err) return <p className="text-sm text-rose-300">{err}</p>;
  if (!preview) return <p className="text-sm text-slate-400">Computing diff…</p>;
  if (preview.previews.length === 0) return <p className="text-sm text-slate-400">No fixes to preview — the project is clean. 🎉</p>;

  const { summary } = preview;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <div>
          <span className="text-slate-200">{summary.files} file{summary.files === 1 ? "" : "s"}</span> · <span className="text-emerald-300">+{summary.additions}</span> <span className="text-rose-300">−{summary.deletions}</span>
          {" · "}{summary.autoApplicable} safe · {summary.requiresApproval} need approval{summary.advisory ? ` · ${summary.advisory} advisory` : ""}
          <span className="ml-2 rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase">{preview.source}</span>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost !py-1 text-xs" onClick={() => setSelected(new Set(applicable.map((a) => a.i)))}>Select all</button>
          <button className="btn-ghost !py-1 text-xs" onClick={() => setSelected(new Set())}>None</button>
          <button className="btn-primary !py-1 text-xs" disabled={busy || selected.size === 0 || done !== null} onClick={apply}>
            {done !== null ? `Applied ${done} ✓` : busy ? "Applying…" : `Apply ${selected.size} selected`}
          </button>
        </div>
      </div>

      {preview.previews.map((p: PatchPreview, i) => {
        const isFile = p.kind === "file" && Boolean(p.diff);
        return (
          <div key={i} className={`rounded-xl border ${selected.has(i) ? "border-brand-500/50" : "border-white/10"} bg-cloud-900/40`}>
            <div className="flex items-start gap-3 p-3">
              {isFile ? (
                <input type="checkbox" className="mt-1 h-4 w-4 accent-indigo-500" checked={selected.has(i)} onChange={() => toggle(i)} disabled={done !== null} />
              ) : (
                <span className="mt-1 h-4 w-4 text-center text-xs text-slate-500">i</span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <code className="font-semibold text-slate-100">{p.file}</code>
                  {p.isNew && <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-200">new file</span>}
                  <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-300">L{p.level} · {LEVEL[p.level]}</span>
                  <span className={`text-[10px] uppercase ${RISK[p.risk]}`}>{p.risk} risk</span>
                  {p.requiresApproval && <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-200">needs approval</span>}
                  {isFile && <span className="text-[10px] text-slate-500">+{p.additions} −{p.deletions}</span>}
                </div>
                <div className="mt-0.5 text-xs text-slate-400">{p.description}</div>
                {!isFile && p.kind === "advisory" && (
                  <div className="mt-2 whitespace-pre-wrap rounded-lg bg-black/30 p-2 text-xs text-slate-300">{p.after}</div>
                )}
              </div>
              {isFile && (
                <button className="btn-ghost !px-2 !py-1 text-[11px]" onClick={() => setExpanded((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })}>
                  {expanded.has(i) ? "Hide diff" : "Show diff"}
                </button>
              )}
            </div>
            {isFile && expanded.has(i) && <div className="px-3 pb-3"><DiffBlock diff={p.diff} /></div>}
          </div>
        );
      })}
      <p className="text-[11px] text-slate-500">
        Applying updates the analyzed snapshot only — your repository is untouched. Enable <em>Create Fix PR</em> when building to push the same changes to an isolated <code>apk-factory/fix-*</code> branch for review.
      </p>
    </div>
  );
}
