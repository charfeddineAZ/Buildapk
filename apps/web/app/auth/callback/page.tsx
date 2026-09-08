"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { session } from "@/lib/api";

/** OAuth landing: the API redirects here with `#token=…` (fragment never reaches servers). */
export default function AuthCallback() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const token = hash.get("token");
    const next = new URLSearchParams(window.location.search).get("next") || "/dashboard";
    if (!token) { setError("No session token returned by the API."); return; }
    session.set(token);
    window.history.replaceState(null, "", window.location.pathname);
    router.replace(next.startsWith("/") ? next : "/dashboard");
  }, [router]);

  return (
    <section className="flex min-h-[50vh] flex-col items-center justify-center text-center">
      {error ? (
        <>
          <p className="text-rose-300">{error}</p>
          <a href="/" className="btn-ghost mt-4">Back</a>
        </>
      ) : (
        <p className="text-slate-300">Signing you in…</p>
      )}
    </section>
  );
}
