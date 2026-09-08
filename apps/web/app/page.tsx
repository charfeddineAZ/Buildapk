"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, session } from "@/lib/api";
import { useSession } from "@/components/useSession";

export default function Landing() {
  const router = useRouter();
  const { user } = useSession();
  const [loading, setLoading] = useState(false);
  const [githubOAuth, setGithubOAuth] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(new URLSearchParams(window.location.search).get("error"));
    api.connections().then((c) => setGithubOAuth(c.githubOAuth)).catch(() => setGithubOAuth(false));
  }, []);

  async function demoLogin() {
    setLoading(true);
    try {
      // Google OAuth is wired through the same session mechanism; the demo
      // profile keeps the whole flow clickable when Google isn't configured.
      const { token } = await api.authGoogle({ googleId: "demo", email: "demo@apkfactory.dev", name: "Demo User" });
      if (token) session.set(token);
      router.push("/setup");
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
        No Android SDK, no Java, no Gradle, no Node on your phone. Connect GitHub,
        analyze any project, let the AI fix issues, and download your APK / AAB.
      </p>
      {error && <p className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}

      <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
        {user ? (
          <button onClick={() => router.push("/dashboard")} className="btn-primary px-6 py-3 text-base">Open dashboard →</button>
        ) : (
          <>
            {githubOAuth ? (
              <a href={api.githubStartUrl("read", "/setup")} className="btn-primary px-6 py-3 text-base">
                <svg viewBox="0 0 16 16" className="h-5 w-5 fill-current" aria-hidden><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" /></svg>
                Continue with GitHub
              </a>
            ) : null}
            <button onClick={demoLogin} disabled={loading} className={githubOAuth ? "btn-ghost px-6 py-3 text-base" : "btn-primary px-6 py-3 text-base"}>
              {loading ? "Connecting…" : githubOAuth ? "Try the demo" : "Continue with Google (demo)"}
            </button>
          </>
        )}
      </div>
      {githubOAuth === false && !user && (
        <p className="mt-3 text-xs text-slate-500">
          GitHub sign-in isn&apos;t configured on this deployment yet — see <a className="underline" href="/status">Platform status</a>.
        </p>
      )}

      <div className="mt-10 grid w-full max-w-3xl grid-cols-2 gap-3 text-sm text-slate-400 sm:grid-cols-4">
        {["GitHub Login", "Zero-config Signing", "Deep Analyzer", "AI Build Agent"].map((s) => (
          <div key={s} className="card !p-3">{s}</div>
        ))}
      </div>
    </section>
  );
}
