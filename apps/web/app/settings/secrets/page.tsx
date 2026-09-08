"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type SecretView } from "@/lib/api";
import { useSession } from "@/components/useSession";
import { SecretInput } from "@/components/SecretInput";

export default function SecretsPage() {
  const { user } = useSession();
  const [scope, setScope] = useState<"user" | "project">("user");
  const [projects, setProjects] = useState<any[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [secrets, setSecrets] = useState<SecretView[]>([]);
  const [known, setKnown] = useState<Record<string, { label: string; provider: string; hint: string }>>({});
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => { api.listProjects().then((r) => { setProjects(r.projects); if (!projectId && r.projects[0]) setProjectId(r.projects[0].id); }).catch(() => {}); }, []);

  async function load() {
    if (!user) return;
    if (scope === "project" && !projectId) return;
    try {
      const r = await api.listSecrets(scope, projectId);
      setSecrets(r.secrets); setKnown(r.known); setErr(null);
    } catch (e: any) { setErr(e.message); }
  }
  useEffect(() => { load(); }, [user, scope, projectId]);

  async function remove(name: string) {
    if (!confirm(`Delete ${name}?`)) return;
    await api.deleteSecret(scope, name, projectId);
    load();
  }

  const missingKnown = Object.entries(known).filter(([k]) => !secrets.some((s) => s.name === k));

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Secrets</h1>
        <div className="flex items-center gap-2 text-sm">
          <button className={`rounded-lg px-3 py-1 ${scope === "user" ? "bg-brand-600 text-white" : "bg-white/5 text-slate-300"}`} onClick={() => setScope("user")}>Account</button>
          <button className={`rounded-lg px-3 py-1 ${scope === "project" ? "bg-brand-600 text-white" : "bg-white/5 text-slate-300"}`} onClick={() => setScope("project")}>Project</button>
          {scope === "project" && (
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="rounded-lg border border-white/10 bg-cloud-800 px-2 py-1 text-xs">
              {projects.map((p) => <option key={p.id} value={p.id}>{p.repoName}</option>)}
            </select>
          )}
        </div>
      </div>

      {!user && <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">Sign in to manage secrets. <Link className="underline" href="/">Sign in</Link></p>}
      {err && <p className="mb-4 text-sm text-rose-300">{err}</p>}

      <div className="card mb-4">
        <h2 className="mb-3 font-semibold">{scope === "user" ? "Account secrets" : `Project secrets — ${projects.find((p) => p.id === projectId)?.repoName ?? ""}`}</h2>
        {secrets.length === 0 && <p className="text-sm text-slate-400">No secrets yet. {scope === "project" ? "Project secrets override account secrets and are injected as build env vars." : "Account secrets apply to all your projects."}</p>}
        <div className="divide-y divide-white/5">
          {secrets.map((s) => (
            <div key={s.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <div className="font-mono text-xs">{s.name} {known[s.name] && <span className="ml-2 rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">{known[s.name].label}</span>}</div>
                <div className="text-[11px] text-slate-500">{s.preview} · updated {new Date(s.updatedAt).toLocaleString()}{s.lastUsedAt ? ` · last used ${new Date(s.lastUsedAt).toLocaleString()}` : ""}</div>
              </div>
              <div className="flex gap-2">
                <button className="btn-ghost !py-1 text-xs" onClick={() => setAdding(s.name)}>Replace</button>
                <button className="btn-ghost !py-1 text-xs text-rose-300" onClick={() => remove(s.name)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
        {adding !== null && (
          <div className="mt-3 border-t border-white/10 pt-3">
            <SecretInput scope={scope} projectId={projectId} name={adding || undefined} onSaved={() => { setAdding(null); load(); }} onCancel={() => setAdding(null)} />
          </div>
        )}
        {adding === null && user && <button className="btn-primary mt-3 !py-1 text-xs" onClick={() => setAdding("")}>+ Add custom secret</button>}
      </div>

      {scope === "user" && missingKnown.length > 0 && (
        <div className="card">
          <h2 className="mb-2 font-semibold">Suggested</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {missingKnown.map(([name, k]) => (
              <button key={name} onClick={() => setAdding(name)} className="rounded-xl border border-white/10 bg-cloud-900/40 p-3 text-left text-sm hover:border-brand-500">
                <div className="font-medium">{k.label}</div>
                <div className="font-mono text-[11px] text-slate-400">{name}</div>
                <div className="mt-1 text-xs text-slate-500">{k.hint}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
