import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

type AuthResult = { error: string | null; session: Session | null };

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signInWithPassword: (email: string, password: string) => Promise<AuthResult>;
  signUpWithPassword: (email: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  async function signInWithPassword(email: string, password: string): Promise<AuthResult> {
    if (!supabase) return { error: "Supabase is not configured", session: null };
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (data.session) setSession(data.session);
    return { error: error?.message ?? null, session: data.session };
  }

  async function signUpWithPassword(email: string, password: string): Promise<AuthResult> {
    if (!supabase) return { error: "Supabase is not configured", session: null };
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (data.session) setSession(data.session);
    return { error: error?.message ?? null, session: data.session };
  }

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        signInWithPassword,
        signUpWithPassword,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}