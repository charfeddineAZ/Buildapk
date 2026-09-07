"use client";

import Link from "next/link";

export function Nav() {
  return (
    <nav className="flex items-center justify-between border-b border-white/10 px-6 py-4">
      <Link href="/" className="flex items-center gap-2 font-bold">
        <span className="text-xl">🚀</span>
        <span className="bg-gradient-to-r from-brand-500 to-emerald-400 bg-clip-text text-transparent">
          AI APK Factory
        </span>
      </Link>
      <div className="flex items-center gap-4 text-sm text-slate-300">
        <Link href="/dashboard" className="hover:text-white">Dashboard</Link>
        <Link href="/usage" className="hover:text-white">Usage</Link>
        <Link href="/audit" className="hover:text-white">Audit</Link>
        <Link href="/connections" className="hover:text-white">Connections</Link>
        <button className="btn-ghost">Sign out</button>
      </div>
    </nav>
  );
}
