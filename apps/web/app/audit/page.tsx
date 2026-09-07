"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function AuditPage() {
  const [entries, setEntries] = useState<any[]>([]);
  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787"}/audit`)
      .then((r) => r.json())
      .then((d) => setEntries(d.entries))
      .catch(() => {});
  }, []);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Audit Log</h1>
      {entries.length === 0 ? (
        <p className="text-sm text-slate-400">No actions recorded yet.</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/10">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/5 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Project</th>
                <th className="px-3 py-2">Result</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-white/5">
                  <td className="px-3 py-2 text-slate-400">{new Date(e.at).toLocaleString()}</td>
                  <td className="px-3 py-2">{e.action}</td>
                  <td className="px-3 py-2 text-slate-400">{e.projectId ?? "—"}</td>
                  <td className={`px-3 py-2 ${e.result === "success" ? "text-emerald-400" : "text-rose-400"}`}>{e.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
