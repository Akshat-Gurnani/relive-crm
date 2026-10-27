import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { sb, getServer, localSignOut } from "./supabase";

export type Profile = { id: string; full_name: string; role: "admin" | "manager" | "agent" | "marketing" | "viewer"; team_id: string | null; phone: string | null };
type Ctx = { ready: boolean; offline: string | null; profile: Profile | null; refresh: () => Promise<void>; signOut: () => Promise<void>; forget: () => Promise<void> };
const SessionCtx = createContext<Ctx>({ ready: false, offline: null, profile: null, refresh: async () => {}, signOut: async () => {}, forget: async () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [offline, setOffline] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setReady(false);
    try {
      const c = await sb();
      const { data: { session } } = await c.auth.getSession();
      if (!session) { setProfile(null); setOffline(null); return; }
      const { data, error } = await c.from("profiles").select("id,full_name,role,team_id,phone").eq("id", session.user.id).maybeSingle();
      if (error && !data) throw error;
      setProfile((data as Profile) ?? null); setOffline(null);
    } catch {
      // Signed in before, but the server cannot be reached now: say so instead of spinning or logging out.
      const s = await getServer().catch(() => null);
      setOffline(s?.url || "the CRM server");
    }
    finally { setReady(true); }
  }, []);
  const forget = useCallback(async () => { await localSignOut(); setProfile(null); setOffline(null); }, []);
  const signOut = useCallback(async () => { try { await (await sb()).auth.signOut(); } catch {} setProfile(null); }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return <SessionCtx.Provider value={{ ready, offline, profile, refresh, signOut, forget }}>{children}</SessionCtx.Provider>;
}
export const useSession = () => useContext(SessionCtx);
export const canWork = (p: Profile | null) => !!p && ["admin", "manager", "agent"].includes(p.role);
export const canManage = (p: Profile | null) => !!p && ["admin", "manager"].includes(p.role);
