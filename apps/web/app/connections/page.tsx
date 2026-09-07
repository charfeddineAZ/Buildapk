"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const META: Record<string, { label: string; desc: string; scopes: string[] }> = {
  github: { label: "GitHub", desc: "Repositories, Actions, Workflows, Releases", scopes: ["contents:read", "actions:write", "webhooks:write"] },
  expo: { label: "Expo", desc: "Projects, EAS builds, credentials", scopes: ["builds", "credentials"] },
  cloudflare: { label: "Cloudflare", desc: "Workers, R2, Builds", scopes: ["workers", "r2"] },
};

export default function Connections() {
  const [connections, setConnections] = useState<{ provider: string; status: string }[]>([]);
  useEffect(() => { api.connections().then((c) => setConnections(c.connections)).catch(() => {}); }, []);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Connected Services</h1>
      <div className="grid gap-3">
        {Object.entries(META).map(([provider, m]) => {
          const connected = connections.find((c) => c.provider === provider)?.status === "connected";
          return (
            <div key={provider} className="card flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 font-semibold">
                  {m.label}
                  <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-slate-500"}`} />
                </div>
                <div className="text-xs text-slate-400">{m.desc}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {m.scopes.map((s) => <span key={s} className="rounded bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">{s}</span>)}
                </div>
              </div>
              <button className={connected ? "btn-ghost" : "btn-primary"}>{connected ? "Connected" : "Connect"}</button>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-slate-500">
        We request only the scopes needed to build. Code write access is granted only when you explicitly enable Auto Fix / Create Fix PR.
      </p>
    </div>
  );
}
