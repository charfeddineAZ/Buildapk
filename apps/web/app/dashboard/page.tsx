"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type AnalysisFile } from "@/lib/api";

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
  const [projects, setProjects] = useState<any[]>([]);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setProjects((await api.listProjects()).projects); } catch { /* ignore */ }
  }
  useEffect(() => { load(); }, []);

  async function analyze(repoUrl: string, files: AnalysisFile, repoName: string, org: string) {
    setBusy(true);
    try {
      const { projectId } = await api.analyze({ repositoryId: repoUrl, repoName, org, files });
      router.push(`/projects/${projectId}`);
    } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Projects</h1>
        <button className="btn-primary" disabled={busy} onClick={() => analyze("sample/CPAAutomator", SAMPLE, "CPAAutomator", "charfeddine")}>
          {busy ? "Analyzing…" : "+ Add Repository"}
        </button>
      </div>

      <div className="mb-6 flex gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste repository URL (https://github.com/owner/repo)"
          className="flex-1 rounded-xl border border-white/10 bg-cloud-800 px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
        <button
          className="btn-ghost"
          disabled={busy || !url.includes("github.com")}
          onClick={() => {
            const parts = url.replace("https://github.com/", "").split("/");
            analyze(url, SAMPLE, parts[1] ?? "repo", parts[0] ?? "owner");
          }}
        >
          Analyze URL
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {projects.length === 0 && <p className="text-sm text-slate-400">No projects yet. Add a repository to run a deep analysis.</p>}
        {projects.map((p) => (
          <button key={p.id} onClick={() => router.push(`/projects/${p.id}`)} className="card text-left hover:border-brand-500">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{p.repoName}</span>
              <span className={`text-xs ${p.score >= 80 ? "text-emerald-400" : p.score >= 60 ? "text-amber-400" : "text-rose-400"}`}>
                {p.score ?? "—"}/100
              </span>
            </div>
            <div className="mt-1 text-xs text-slate-400">{p.framework} · {p.issues} issues</div>
          </button>
        ))}
      </div>
    </div>
  );
}
