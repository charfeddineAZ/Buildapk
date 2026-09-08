"use client";

import { useEffect, useState } from "react";
import { api, type SigningStatus } from "@/lib/api";
import { useSession } from "@/components/useSession";

export default function SigningPage() {
  const { user } = useSession();
  const [projects, setProjects] = useState<any[]>([]);
  const [rows, setRows] = useState<Record<string, SigningStatus>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const { projects } = await api.listProjects();
    setProjects(projects);
    const entries = await Promise.all(projects.map(async (p) => [p.id, (await api.signing(p.id)).signing] as const));
    setRows(Object.fromEntries(entries));
  }
  useEffect(() => { load().catch(() => {}); }, [user]);

  async function ensure(id: string) { setBusy(id); try { await api.ensureSigning(id); await load(); } finally { setBusy(null); } }
  async function rotate(id: string, name: string) {
    if (!confirm(`Rotate the signing key for ${name}?\n\nExisting installs will NOT be able to update in place to builds signed with the new key. Type OK to continue.`)) return;
    setBusy(id);
    try { await api.rotateSigning(id); await load(); } finally { setBusy(null); }
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Release signing</h1>
      <p className="mb-6 text-sm text-slate-400">
        Zero-config: every project gets its own upload key. Passwords are generated here and sealed in the vault; the keystore itself is created by <code className="rounded bg-black/40 px-1">keytool</code> inside the first build and sealed too — so every later build signs with the same key. Nothing to upload, nothing to remember.
      </p>
      {projects.length === 0 && <p className="text-sm text-slate-400">No projects yet — add a repository first.</p>}
      <div className="grid gap-3">
        {projects.map((p) => {
          const s = rows[p.id];
          return (
            <div key={p.id} className="card">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 font-semibold">
                    {p.repoName}
                    {s?.configured ? (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] ${s.keystoreReady ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-200"}`}>{s.keystoreReady ? "keystore sealed" : "keystore on first build"}</span>
                    ) : (
                      <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">not configured</span>
                    )}
                  </div>
                  {s?.configured && (
                    <div className="mt-1 text-xs text-slate-400">
                      alias <code className="text-slate-200">{s.keyAlias}</code> · {s.dname}
                      {s.certSha256 && <> · cert <code className="text-slate-200">{s.certSha256.slice(0, 23)}…</code></>}
                      {s.keystoreStoredAt && <> · sealed {new Date(s.keystoreStoredAt).toLocaleDateString()}</>}
                      {s.rotatedAt && <> · rotated {new Date(s.rotatedAt).toLocaleDateString()}</>}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  {!s?.configured && <button className="btn-primary !py-1 text-xs" disabled={busy === p.id} onClick={() => ensure(p.id)}>Enable</button>}
                  {s?.configured && <button className="btn-ghost !py-1 text-xs" onClick={() => setOpen(open === p.id ? null : p.id)}>{open === p.id ? "Hide" : "Gradle snippet"}</button>}
                  {s?.keystoreReady && user && <a className="btn-ghost !py-1 text-xs" href={api.exportKeystoreUrl(p.id)} onClick={(e) => { e.preventDefault(); downloadKeystore(p.id, p.repoName); }}>Export keystore</a>}
                  {s?.configured && <button className="btn-ghost !py-1 text-xs text-rose-300" disabled={busy === p.id} onClick={() => rotate(p.id, p.repoName)}>Rotate</button>}
                </div>
              </div>
              {open === p.id && s?.gradleBlock && (
                <pre className="mt-3 overflow-x-auto rounded-xl bg-black/40 p-3 text-[11px] text-emerald-200">{s.gradleBlock}</pre>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-slate-500">Rotating a key breaks in-place updates for users who installed a build signed with the old key. Export and keep a copy of the keystore before rotating if you plan to publish on Google Play.</p>
    </div>
  );
}

async function downloadKeystore(projectId: string, name: string) {
  const token = window.localStorage.getItem("apkf.session");
  const res = await fetch(api.exportKeystoreUrl(projectId), { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) { alert(`Export failed: ${res.status}`); return; }
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name}-release.keystore`;
  a.click();
  URL.revokeObjectURL(a.href);
}
