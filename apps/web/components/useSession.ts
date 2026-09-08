"use client";

import { useEffect, useState } from "react";
import { api, session } from "@/lib/api";

export interface SessionUser { id: string; email?: string; name?: string; avatar?: string; provider?: string }

/** Reactive session hook: resolves the current user from the bearer token. */
export function useSession() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (!session.get()) { setUser(null); return; }
      try {
        const { user, provider } = await api.me();
        if (alive) setUser({ ...user, provider });
      } catch {
        session.clear();
        if (alive) setUser(null);
      }
    };
    load();
    window.addEventListener("apkf:session", load);
    return () => { alive = false; window.removeEventListener("apkf:session", load); };
  }, []);

  return { user, loading: user === undefined, signOut: () => session.clear() };
}
