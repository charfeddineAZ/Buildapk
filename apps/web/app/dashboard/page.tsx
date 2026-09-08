"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type AnalysisFile, type Checklist } from "@/lib/api";
import { useSession } from "@/components/useSession";

const SAMPLE: AnalysisFile = {
  "package.json": JSON.stringify({
    name: "CPAAutomator",
    dependencies: { expo: "^53.0.0", react: "19.0.0", "react-native": "0.79.3", "react-native-dynamic": "1.2.0" },
  }),
  "app.json": JSON.stringify({ expo: { name: "CPAAutomator", icon: "./assets/icon.png", android: { minSdkVersion: 24, targetSdkVersion: 35 } } }),
  "assets/icon.png": "binary",
};

export default function Dashboard() {
  const router = useRouter();
  const { user } = useSession();
  const [projects, setProjects] = useState<any[]>([]);
  const [repos, setRepos] = useState<{ fullName: string; defaultBranch: string; private: boolean }[] | null>(null);
  const [githubConnected, setGithubConnected] = useState<boolean | null>(null);
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [url, setUrl] = useState("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try { setProjects((await api.listProjects()).projects); } catch { /* ignore */ }
    try { setChecklist(await api.checklist()); } catch { /* ignore */ }
    try {
      const c = await api.connections();
      const gh = c.connections.find((x) => x.provider === "github")?.status === "connected";
      setGithubConnected(gh);
      if (gh) api.githubRepos().then((r) => setRepos(r.repos)).catch(() => setRepos([]));
    } catch { setGithubConnected(false); }
  }
  useEffect(() => { load(); }, [user]);

  async function importRepo(repo: string) {
    setBusy(repo); setErr(null);
    try {
      const { projectId } = await api.importRepo(repo);
      router.push(`/projects/${projectId}`);
    } catch (e: any) { setErr(e.message ?? String(e)); } finally { setBusy(null); }
  }

  async function analyzeSample() {
    setBusy("sample");
    try {
      const { projectId } = await api.analyze({ repositoryId: "sample/CPAAutomator", repoName: "CPAAutomator", org: "charfeddine", files: SAMPLE });
      router.push(`/projects/${projectId}`);
    } finally { setBusy(null); }
  }

  const nextStep = checklist?.steps.find((s) => !s.done && !s.optional);
  const visibleRepos = (repos ?? []).filter((r) => r.fullName.toLowerCase().includes(filter.toLowerCase())).slice(0, 30);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Projects</h1>
        <button className="btn-ghost text-xs" disabled={busy !== null} onClick={analyzeSample}>{busy === "sample" ? "Analyzing…" : "Try the sample project"}</button>
      </div>

      {checklist && !checklist.complete && nextStep && (
        <div className="mb-6 flex items-center justify-between rounded-xl border border-brand-500/30 bg-brand-500/10 px-4 py-3 text-sm">
          <span>Next step: <strong>{nextStep.title}</strong> — {nextStep.hint}</span>
          <Link href="/setup" className="btn-ghost !py-1 text-xs">Open setup ({checklist.progress}%)</Link>
        </div>
      )}

      {/* Import */}
      <div className="card mb-6">
        <h2 className="mb-2 font-semibold">Add a repository</h2>
        {githubConnected === false && (
          <p className="mb-3 text-xs text-amber-200">
            GitHub is not connected. <a className="underline" href={api.githubStartUrl("read", "/dashboard")}>Connect GitHub</a> to browse your repositories, or add a <Link className="underline" href="/settings/secrets">GITHUB_TOKEN</Link> secret.
          </p>
        )}
        <div className="flex gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && url.includes("/")) importRepo(url); }}
            placeholder="owner/repo or https://github.com/owner/repo"
            className="flex-1 rounded-xl border border-white/10 bg-cloud-800 px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
          <button className="btn-primary" disabled={busy !== null || !url.includes("/")} onClick={() => importRepo(url)}>
            {busy === url ? "Importing…" : "Import & analyze"}
          </button>
        </div>
        {err && <p className="mt-2 text-xs text-rose-300">{err}</p>}

        {repos && repos.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs text-slate-400">Your GitHub repositories ({repos.length})</span>
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter…" className="rounded-lg border border-white/10 bg-cloud-800 px-2 py-1 text-xs outline-none" />
            </div>
            <div className="grid max-h-64 gap-1 overflow-auto sm:grid-cols-2">
              {visibleRepos.map((r) => {
                const existing = projects.find((p) => p.repositoryId === r.fullName);
                return (
                  <button key={r.fullName} disabled={busy !== null} onClick={() => existing ? router.push(`/projects/${existing.id}`) : importRepo(r.fullName)} className="flex items-center justify-between rounded-lg border border-white/5 bg-cloud-900/40 px-3 py-2 text-left text-xs hover:border-brand-500">
                    <span className="truncate">{r.fullName} <span className="text-slate-500">· {r.defaultBranch}{r.private ? " · private" : ""}</span></span>
                    <span className="ml-2 shrink-0 text-slate-400">{busy === r.fullName ? "…" : existing ? "open" : "+"}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {projects.length === 0 && <p className="text-sm text-slate-400">No projects yet. Import a repository to run a deep analysis.</p>}
        {projects.map((p) => (
          <button key={p.id} onClick={() => router.push(`/projects/${p.id}`)} className="card text-left hover:border-brand-500">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{p.repoName}</span>
              <span className={`text-xs ${p.score >= 80 ? "text-emerald-400" : p.score >= 60 ? "text-amber-400" : "text-rose-400"}`}>
                {p.score ?? "—"}/100
              </span>
            </div>
            <div className="mt-1 text-xs text-slate-400">{p.repositoryId}{p.ref ? ` @ ${p.ref}` : ""} · {p.framework} · {p.issues} issues</div>
          </button>
        ))}
      </div>
    </div>
  );
}
