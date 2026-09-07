"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function UsagePage() {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787"}/usage`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data) return <p className="text-slate-400">Loading…</p>;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Free-Tier Usage</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        {data.quotas.map((q: any) => (
          <div key={q.provider} className="card">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{q.provider}</span>
              <span className={`text-xs ${q.available ? "text-emerald-400" : "text-rose-400"}`}>{q.available ? "available" : "exhausted"}</span>
            </div>
            <div className="mt-1 text-sm text-slate-300">
              {q.remaining} {q.unit} remaining · plan {q.plan}
            </div>
          </div>
        ))}
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">Consumed</h2>
      {data.usage.length === 0 ? (
        <p className="text-sm text-slate-400">No builds consumed yet.</p>
      ) : (
        <div className="card">
          {data.usage.map((u: any, i: number) => (
            <div key={i} className="flex justify-between border-b border-white/5 py-1 text-sm last:border-0">
              <span>{u.provider}</span>
              <span className="text-slate-300">{u.consumed} {u.unit}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
