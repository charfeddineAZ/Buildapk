"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";

export default function Landing() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function login() {
    setLoading(true);
    try {
      // In production this is a real Google OAuth round-trip; here we mint a
      // demo session so the whole flow is clickable end-to-end.
      await api.authGoogle({ googleId: "demo", email: "demo@apkfactory.dev", name: "Demo User" });
      router.push("/dashboard");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="flex min-h-[70vh] flex-col items-center justify-center text-center">
      <div className="mb-4 rounded-full border border-white/10 bg-white/5 px-4 py-1 text-xs uppercase tracking-widest text-slate-300">
        Cloud · AI · Universal APK Factory
      </div>
      <h1 className="bg-gradient-to-r from-brand-500 via-white to-emerald-400 bg-clip-text text-5xl font-extrabold text-transparent sm:text-6xl">
        Build Android apps entirely in the cloud
      </h1>
      <p className="mt-4 max-w-xl text-slate-300">
        No Android SDK, no Java, no Gradle, no Node on your phone. Connect GitHub &amp; Expo,
        analyze any project, let the AI fix issues, and download your APK / AAB.
      </p>
      <button onClick={login} disabled={loading} className="btn-primary mt-8 px-6 py-3 text-base">
        {loading ? "Connecting…" : "Continue with Google"}
      </button>
      <div className="mt-10 grid w-full max-w-3xl grid-cols-2 gap-3 text-sm text-slate-400 sm:grid-cols-4">
        {["Google Login", "Connect GitHub", "Deep Analyzer", "AI Build Agent"].map((s) => (
          <div key={s} className="card !p-3">{s}</div>
        ))}
      </div>
    </section>
  );
}
