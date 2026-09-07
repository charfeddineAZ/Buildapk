"use client";

import { ScoreBar } from "./ScoreBar";

const SEV: Record<string, { label: string; dot: string }> = {
  required: { label: "Required", dot: "bg-rose-400" },
  recommended: { label: "Recommended", dot: "bg-amber-400" },
  optional: { label: "Optional", dot: "bg-sky-400" },
  good: { label: "Good", dot: "bg-emerald-400" },
};

export function HealthReport({ analysis }: { analysis: any }) {
  const s = analysis.score;
  const issues = analysis.issues || [];
  const suggestions = analysis.suggestions || [];

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="card">
        <h3 className="mb-3 font-semibold">Project Score — {s.overall}/100</h3>
        <ScoreBar label="Build readiness" value={s.buildReadiness} />
        <ScoreBar label="Dependencies" value={s.dependencies} />
        <ScoreBar label="Android" value={s.android} />
        <ScoreBar label="Security" value={s.security} />
        <ScoreBar label="Assets" value={s.assets} />
        <ScoreBar label="Signing" value={s.signing} />
        <ScoreBar label="Compatibility" value={s.compatibility} />
      </div>

      <div className="card">
        <h3 className="mb-3 font-semibold">Issues</h3>
        <div className="space-y-2">
          {issues.map((i: any) => (
            <div key={i.id} className="flex items-start gap-2 text-sm">
              <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${SEV[i.severity]?.dot}`} />
              <div>
                <div className="font-medium">{i.title}</div>
                <div className="text-xs text-slate-400">{i.description}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {suggestions.length > 0 && (
        <div className="card md:col-span-2">
          <h3 className="mb-3 font-semibold">Suggestions</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {suggestions.map((g: any) => (
              <div key={g.id} className="rounded-xl border border-white/10 bg-cloud-900/40 p-3 text-sm">
                <div className="font-medium">{g.title}</div>
                {g.recommendedValue && (
                  <code className="mt-1 block rounded bg-black/40 px-2 py-1 text-emerald-300">{g.recommendedValue}</code>
                )}
                <div className="mt-1 text-xs text-slate-400">{g.reason}</div>
                {g.patch?.autoFixable !== false && (
                  <button className="btn-primary mt-2 !py-1 text-xs">Apply Fix</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
