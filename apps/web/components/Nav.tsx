"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "./useSession";

const LINKS = [
  { href: "/dashboard", label: "Projects" },
  { href: "/connections", label: "Connections" },
  { href: "/settings/secrets", label: "Secrets" },
  { href: "/settings/signing", label: "Signing" },
  { href: "/usage", label: "Usage" },
  { href: "/audit", label: "Audit" },
  { href: "/status", label: "Status" },
];

export function Nav() {
  const { user, signOut } = useSession();
  const router = useRouter();
  const path = usePathname();
  return (
    <nav className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-6 py-4">
      <Link href="/" className="flex items-center gap-2 font-bold">
        <span className="text-xl">🚀</span>
        <span className="bg-gradient-to-r from-brand-500 to-emerald-400 bg-clip-text text-transparent">AI APK Factory</span>
      </Link>
      <div className="flex flex-wrap items-center gap-4 text-sm text-slate-300">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={`hover:text-white ${path?.startsWith(l.href) ? "text-white" : ""}`}>{l.label}</Link>
        ))}
        <Link href="/setup" className={`rounded-lg border border-brand-500/40 px-2 py-1 text-xs text-brand-50 hover:bg-brand-500/10 ${path === "/setup" ? "bg-brand-500/20" : ""}`}>Setup</Link>
        {user ? (
          <button className="btn-ghost !py-1 text-xs" onClick={() => { signOut(); router.push("/"); }} title={user.email}>
            {user.avatar && <img src={user.avatar} alt="" className="h-5 w-5 rounded-full" />}
            {user.name ?? user.email ?? "Account"} · Sign out
          </button>
        ) : (
          <Link href="/" className="btn-ghost !py-1 text-xs">Sign in</Link>
        )}
      </div>
    </nav>
  );
}
