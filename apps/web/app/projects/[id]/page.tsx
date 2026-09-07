"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { HealthReport } from "@/components/HealthReport";

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787"}/projects/${id}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, [id]);

  async function build() {
    setBusy(true);
    try {
      const { result } = await api.build(id, { target: "apk", autoRepair: true });
      setResult(result);
    } finally { setBusy(false); }
  }

  if (!data) return <p className="text-slate-400">Loading…</p>;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{data.project?.repoName}</h1>
        <button className="btn-primary" disabled={busy} onClick={build}>
          {busy ? "Building…" : "Build APK"}
        </button>
      </div>

      {data.analysis && <HealthReport analysis={data.analysis} />}

      {result && (
        <div className="card mt-6">
          <h3 className="mb-2 font-semibold">Build {result.buildId} — {result.status}</h3>
          {result.attempts?.map((a: any) => (
            <div key={a.index} className="mb-1 text-xs text-slate-300">
              #{a.index} {a.provider} → <span className={a.status === "success" ? "text-emerald-400" : "text-rose-400"}>{a.status}</span>
              {a.repairApplied && <span className="ml-2 text-amber-300">repair:{a.repairApplied.slice(0, 10)}</span>}
            </div>
          ))}
          {result.validation && (
            <div className="mt-3 text-xs text-slate-400">
              APK {result.validation.packageName} · minSdk {result.validation.minSdk} · {result.validation.abis.join(", ")} · signed:{String(result.validation.signing.signed)}
            </div>
          )}
          {result.artifacts?.length ? (
            <div className="mt-3 flex gap-2">
              {result.artifacts.map((art: any) => (
                <a key={art.name} href={art.url} className="btn-ghost text-xs">{art.type.toUpperCase()}</a>
              ))}
            </div>
          ) : (
            <a href={`/builds/${result.buildId}/logs`} className="btn-ghost mt-3 text-xs">View logs</a>
          )}
        </div>
      )}
    </div>
  );
}
