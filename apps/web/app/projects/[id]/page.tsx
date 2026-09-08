"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type SigningStatus } from "@/lib/api";
import { HealthReport } from "@/components/HealthReport";
import { DiffPreview } from "@/components/DiffPreview";

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [signing, setSigning] = useState<SigningStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [target, setTarget] = useState<"apk" | "aab">("apk");
  const [createFixPr, setCreateFixPr] = useState(false);
  const [tab, setTab] = useState<"report" | "fixes" | "builds">("report");

  async function load() {
    const [d, b, s] = await Promise.all([api.getProject(id), api.builds(id).catch(() => ({ builds: [] })), api.signing(id).catch(() => null)]);
    setData(d); setHistory(b.builds); setSigning(s?.signing ?? null);
  }
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [id]);

  async function build() {
    setBusy(true); setErr(null);
    try {
      const { result } = await api.build(id, { target, autoRepair: true, createFixPr });
      setResult(result);
      setTab("builds");
      load();
    } catch (e: any) { setErr(e.message ?? String(e)); } finally { setBusy(false); }
  }

  if (err && !data) return <p className="text-rose-300">{err}</p>;
  if (!data) return <p className="text-slate-400">Loading…</p>;

  const blockers = data.analysis?.issues.filter((i: any) => i.severity === "required").length ?? 0;
  const fixable = data.analysis?.suggestions.filter((s: any) => s.patch).length ?? 0;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{data.project?.repoName}</h1>
          <div className="text-xs text-slate-400">
            {data.project?.repositoryId}{data.project?.ref ? ` @ ${data.project.ref}` : ""} · {data.analysis?.primaryFramework}
            {signing?.configured && <> · signing <span className={signing.keystoreReady ? "text-emerald-300" : "text-amber-200"}>{signing.keystoreReady ? "sealed key" : "auto (first build)"}</span></>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={target} onChange={(e) => setTarget(e.target.value as any)} className="rounded-lg border border-white/10 bg-cloud-800 px-2 py-2 text-xs">
            <option value="apk">APK</option>
            <option value="aab">AAB (Play)</option>
          </select>
          <label className="flex items-center gap-1 text-xs text-slate-300">
            <input type="checkbox" className="accent-indigo-500" checked={createFixPr} onChange={(e) => setCreateFixPr(e.target.checked)} /> Create Fix PR
          </label>
          <button className="btn-primary" disabled={busy} onClick={build} title={blockers ? `${blockers} blocker(s) — the build will attempt auto-repair` : ""}>
            {busy ? "Building…" : `Build ${target.toUpperCase()}`}
          </button>
        </div>
      </div>
      {err && <p className="mb-3 text-sm text-rose-300">{err}</p>}

      <div className="mb-4 flex gap-1 border-b border-white/10 text-sm">
        {([["report", "Health report"], ["fixes", `Fix preview${fixable ? ` (${fixable})` : ""}`], ["builds", `Builds${history.length ? ` (${history.length})` : ""}`]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 ${tab === k ? "border-brand-500 text-white" : "border-transparent text-slate-400 hover:text-slate-200"}`}>{label}</button>
        ))}
      </div>

      {tab === "report" && data.analysis && (
        <>
          {blockers > 0 && (
            <div className="mb-4 flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              <span>{blockers} required issue{blockers > 1 ? "s" : ""} block a clean build. Review the proposed fixes before building.</span>
              <button className="btn-primary !py-1 text-xs" onClick={() => setTab("fixes")}>Preview fixes →</button>
            </div>
          )}
          <HealthReport analysis={data.analysis} />
        </>
      )}

      {tab === "fixes" && (
        <div className="card">
          <h3 className="mb-1 font-semibold">Proposed changes</h3>
          <p className="mb-3 text-xs text-slate-400">Every change the platform wants to make, as a diff. Nothing touches your repository until you approve.</p>
          <DiffPreview projectId={id} onApplied={(analysis) => { setData((d: any) => ({ ...d, analysis })); }} />
        </div>
      )}

      {tab === "builds" && (
        <div className="space-y-4">
          {result && <BuildCard projectId={id} build={result} highlight />}
          {history.length === 0 && !result && <p className="text-sm text-slate-400">No builds yet.</p>}
          {[...history].reverse().filter((b) => b.id !== result?.buildId).map((b) => <BuildCard key={b.id} projectId={id} build={b.result} createdAt={b.createdAt} />)}
        </div>
      )}

      <div className="mt-6 text-xs text-slate-500">
        Manage <Link className="underline" href="/settings/secrets">project secrets</Link> · <Link className="underline" href="/settings/signing">signing</Link>
      </div>
    </div>
  );
}

function BuildCard({ projectId, build, createdAt, highlight }: { projectId: string; build: any; createdAt?: string; highlight?: boolean }) {
  const [showPreview, setShowPreview] = useState(false);
  const repairPatches = build.attempts?.flatMap((a: any) => a.repairPatches ?? []) ?? [];
  return (
    <div className={`card ${highlight ? "border-brand-500/40" : ""}`}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold">
          {build.buildId} — <span className={build.status === "success" ? "text-emerald-400" : "text-rose-400"}>{build.status}</span>
        </h3>
        <span className="text-xs text-slate-500">{build.target?.toUpperCase()} · {build.provider}{createdAt ? ` · ${new Date(createdAt).toLocaleString()}` : ""}</span>
      </div>
      {build.attempts?.map((a: any) => (
        <div key={a.index} className="mb-1 text-xs text-slate-300">
          #{a.index} {a.provider} → <span className={a.status === "success" ? "text-emerald-400" : "text-rose-400"}>{a.status}</span>
          {a.repairApplied && <span className="ml-2 text-amber-300">repair:{a.repairApplied.slice(0, 10)} ({a.repairSource})</span>}
        </div>
      ))}
      {build.validation && (
        <div className="mt-2 text-xs text-slate-400">
          APK {build.validation.packageName} · minSdk {build.validation.minSdk} · {build.validation.abis?.join(", ")} · signed:{String(build.validation.signing?.signed)}
        </div>
      )}
      {build.fixPrUrl && <a href={build.fixPrUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-brand-50 underline">Fix PR opened → {build.fixPrUrl}</a>}
      {build.failureReason && <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-black/40 p-2 text-[11px] text-rose-200">{build.failureReason}</pre>}
      <div className="mt-3 flex flex-wrap gap-2">
        {build.artifacts?.map((art: any) => (
          <a key={art.name} href={art.url} className="btn-ghost text-xs" title={`sha256 ${art.sha256?.slice(0, 16)}… · expires ${new Date(art.expiresAt).toLocaleTimeString()}`}>
            ⬇ {art.type.toUpperCase()} <span className="text-slate-500">{art.sizeBytes ? `${(art.sizeBytes / 1024).toFixed(1)} KB` : ""}</span>
          </a>
        ))}
        {repairPatches.length > 0 && (
          <button className="btn-ghost text-xs" onClick={() => setShowPreview((s) => !s)}>{showPreview ? "Hide" : "Show"} repair diff ({repairPatches.length})</button>
        )}
      </div>
      {showPreview && <div className="mt-3"><DiffPreview projectId={projectId} patches={repairPatches} /></div>}
    </div>
  );
}
