"use client";

import { useState } from "react";
import { api } from "@/lib/api";

const HINTS: Record<string, string> = {
  EXPO_TOKEN: "expo.dev → Account settings → Access tokens",
  GITHUB_TOKEN: "Fine-grained PAT with contents:read + actions:write (or use Connect GitHub)",
  CF_API_TOKEN: "dash.cloudflare.com → My Profile → API Tokens",
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: "Play Console → Setup → API access → service account JSON",
  OPENAI_API_KEY: "platform.openai.com → API keys",
};

export function SecretInput({ scope, projectId, name: initialName, onSaved, onCancel }: { scope: "user" | "project"; projectId?: string; name?: string; onSaved: () => void; onCancel?: () => void }) {
  const [name, setName] = useState(initialName ?? "");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const multiline = name.endsWith("_JSON");

  async function save() {
    setBusy(true); setErr(null);
    try {
      await api.setSecret(scope, name.trim().toUpperCase(), value, projectId);
      setValue("");
      onSaved();
    } catch (e: any) { setErr(e.message ?? String(e)); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={name}
          onChange={(e) => setName(e.target.value.toUpperCase())}
          placeholder="NAME (e.g. EXPO_TOKEN)"
          disabled={Boolean(initialName)}
          className="w-full rounded-xl border border-white/10 bg-cloud-800 px-3 py-2 font-mono text-xs outline-none focus:border-brand-500 disabled:opacity-60 sm:w-64"
        />
        {multiline ? (
          <textarea value={value} onChange={(e) => setValue(e.target.value)} rows={4} placeholder="Paste JSON…" className="flex-1 rounded-xl border border-white/10 bg-cloud-800 px-3 py-2 font-mono text-xs outline-none focus:border-brand-500" />
        ) : (
          <input type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Secret value" className="flex-1 rounded-xl border border-white/10 bg-cloud-800 px-3 py-2 font-mono text-xs outline-none focus:border-brand-500" />
        )}
        <div className="flex gap-2">
          <button className="btn-primary !py-1 text-xs" disabled={busy || !name || !value} onClick={save}>{busy ? "Saving…" : "Save"}</button>
          {onCancel && <button className="btn-ghost !py-1 text-xs" onClick={onCancel}>Cancel</button>}
        </div>
      </div>
      {HINTS[name] && <div className="text-xs text-slate-500">Where to get it: {HINTS[name]}</div>}
      {err && <div className="text-xs text-rose-300">{err}</div>}
      <div className="text-[11px] text-slate-500">Encrypted with AES-256-GCM before it is stored. You will only ever see a masked preview again.</div>
    </div>
  );
}
