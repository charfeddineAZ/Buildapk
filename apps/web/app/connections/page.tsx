"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type Connection } from "@/lib/api";
import { useSession } from "@/components/useSession";
import { SecretInput } from "@/components/SecretInput";

const STATUS: Record<Connection["status"], { dot: string; label: string }> = {
  connected: { dot: "bg-emerald-400", label: "Connected" },
  "not-connected": { dot: "bg-slate-500", label: "Not connected" },
  unavailable: { dot: "bg-slate-600", label: "Unavailable" },
  expired: { dot: "bg-rose-400", label: "Token expired" },
};

export default function Connections() {
  const { user } = useSession();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load(probe = false) {
    try { setConnections((await api.connections(probe)).connections); setErr(null); } catch (e: any) { setErr(e.message); }
  }
  useEffect(() => { load(); }, [user]);

  async function disconnect(provider: string) {
    if (!confirm(`Disconnect ${provider}? Builds that rely on it will fall back to other routes.`)) return;
    setBusy(provider);
    try { await api.disconnect(provider); await load(); } finally { setBusy(null); }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Connected Services</h1>
        <button className="btn-ghost !py-1 text-xs" onClick={() => load(true)} disabled={!user}>Test connections</button>
      </div>
      {!user && <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">Sign in to manage your connections. <Link className="underline" href="/">Sign in</Link></p>}
      {err && <p className="mb-4 text-sm text-rose-300">{err}</p>}
      <div className="grid gap-3">
        {connections.map((c) => {
          const st = STATUS[c.status];
          return (
            <div key={c.provider} className="card">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-semibold">
                    {c.label}
                    <span className={`h-2 w-2 rounded-full ${st.dot}`} />
                    <span className="text-xs font-normal text-slate-400">{st.label}{c.account ? ` · ${c.account}` : ""}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">{c.detail}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {c.scopes.map((s) => <span key={s} className="rounded bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">{s}</span>)}
                    <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] uppercase text-slate-500">{c.method}</span>
                  </div>
                  {c.lastCheckedAt && <div className="mt-1 text-[10px] text-slate-500">checked {new Date(c.lastCheckedAt).toLocaleTimeString()}</div>}
                </div>
                <div className="shrink-0">
                  {c.status === "connected" && c.method !== "platform" && c.provider !== "google" && (
                    <button className="btn-ghost !py-1 text-xs" disabled={busy === c.provider} onClick={() => disconnect(c.provider)}>Disconnect</button>
                  )}
                  {c.status === "expired" && c.provider === "github" && (
                    <a href={api.githubStartUrl("read", "/connections")} className="btn-primary !py-1 text-xs">Reconnect</a>
                  )}
                  {c.status !== "connected" && c.action?.href && (
                    c.provider === "github"
                      ? <a href={api.githubStartUrl("read", "/connections")} className="btn-primary !py-1 text-xs">{c.action.label}</a>
                      : <Link href={c.action.href} className="btn-primary !py-1 text-xs">{c.action.label}</Link>
                  )}
                  {c.status !== "connected" && c.action?.secret && !c.action.href && (
                    <button className="btn-primary !py-1 text-xs" disabled={!user} onClick={() => setAdding(adding === c.action!.secret ? null : c.action!.secret!)}>{c.action.label}</button>
                  )}
                </div>
              </div>
              {c.action?.secret && (adding === c.action.secret || (c.status === "connected" && c.method === "platform" && adding === c.action.secret)) && (
                <div className="mt-3 border-t border-white/10 pt-3">
                  <SecretInput scope="user" name={c.action.secret} onSaved={() => { setAdding(null); load(); }} onCancel={() => setAdding(null)} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-slate-500">
        We request only the scopes needed to build. Code write access is requested only when you explicitly enable Auto Fix / Create Fix PR
        (<a className="underline" href={api.githubStartUrl("write", "/connections")}>upgrade GitHub scopes</a>). Tokens are sealed with AES-256-GCM and never shown again.
      </p>
    </div>
  );
}
