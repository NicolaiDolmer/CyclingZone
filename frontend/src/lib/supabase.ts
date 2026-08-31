import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("⚠️  Supabase env vars missing — check .env file");
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
});

// Auth helpers
export const signIn = (email: string, password: string) =>
  supabase.auth.signInWithPassword({ email, password });

export const signUp = (email: string, password: string) =>
  supabase.auth.signUp({ email, password });

export const signOut = () => supabase.auth.signOut();

export const getSession = () => supabase.auth.getSession();

// #4348: kanonisk authHeaders(). Var skrevet forfra 26 gange i frontend/src (4
// af kopierne uden værn — rod-årsagen bag #4347: en død session interpolerede
// `session?.access_token` som `undefined` direkte ind i Bearer-strengen, og
// serverens `if (!token)`-værn fangede ikke teksten "undefined").
//
// null = "ingen brugbar session, lad være med at sende kaldet" — kontrakten 22
// af de 26 kopier allerede havde, og som kald-stederne i forvejen er skrevet
// til at håndtere. `json: false` findes for de to GET-kun-kopier
// (useAcademyPnl.js, useForumHighlights.js) — en GET med Content-Type udløser
// en unødvendig CORS-preflight på tværs af cyclingzone.org → *.up.railway.app.
export async function authHeaders(
  { json = true }: { json?: boolean } = {},
): Promise<Record<string, string> | null> {
  const { data } = await getSession();
  const token = data?.session?.access_token;
  if (!token) return null;
  return json
    ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    : { Authorization: `Bearer ${token}` };
}
