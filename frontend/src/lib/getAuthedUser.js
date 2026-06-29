/**
 * Hent den aktuelt autentificerede bruger, eller `null` hvis sessionen er
 * udløbet/ugyldig.
 *
 * #1807 forward-guard: `supabase.auth.getUser()` returnerer `user = null` ved
 * udløbet session. Sider der deref'er `user.id` uden en `if (!user)`-guard
 * crasher (Sentry CYCLINGZONE-16, #1792). Denne helper er det ÉNE sted hvor
 * den adfærd kan evolveres — fx aktiv `signOut()` + redirect i edge-casen hvor
 * `SIGNED_OUT` ikke fyrer og brugeren ellers sidder på en tom side.
 *
 * Kaldssted-mønster (håndhævet af scripts/lint-getuser-guard.mjs):
 *   const user = await getAuthedUser();
 *   if (!user) { return; }   // eller redirect
 *   ... user.id ...
 *
 * @param {{ auth: { getUser: () => Promise<{ data: { user: any } }> } }} [client]
 *   Supabase-client; injicérbar for test. Default-clienten lazy-importeres (i
 *   stedet for et top-niveau `import { supabase }`) så modulet kan unit-testes
 *   under Node's ESM-loader uden at trække den env-afhængige client + .ts ind
 *   (CLAUDE.md #803). I browseren resolver Vite det dynamiske import normalt.
 * @returns {Promise<import("@supabase/supabase-js").User | null>}
 */
export async function getAuthedUser(client) {
  const c = client ?? (await import("./supabase")).supabase;
  const { data: { user } } = await c.auth.getUser();
  return user ?? null;
}
