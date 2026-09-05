// #4557 · Klub-DNA-kaldene (GET /board/dna-suggestions, POST /board/dna-choose),
// samlet ét sted så Boardroom og den gamle BoardPage bruger samme kontrakt.
// INGEN ny rute: begge endpoints findes allerede (backend/routes/api.js).

import { supabase } from "../../lib/supabase";

const API = import.meta.env.VITE_API_URL;

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : null;
}

/**
 * Bestyrelsens 3 DNA-forslag + om holdet stadig må skifte.
 * Returnerer `null` ved manglende session/fejl — kalderen viser bare ingenting
 * (DNA-kortet er en tilbudt handling, ikke sidens data).
 */
export async function fetchDnaSuggestions() {
  const headers = await authHeaders();
  if (!headers) return null;
  try {
    const res = await fetch(`${API}/api/board/dna-suggestions`, { headers });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Vælg (eller skift til) et DNA. `ok:false` uden at kaste, som bonusOfferApi. */
export async function postDnaChoice(dnaKey) {
  const headers = await authHeaders();
  if (!headers || !dnaKey) return { ok: false, data: null };
  let res;
  try {
    res = await fetch(`${API}/api/board/dna-choose`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ dna_key: dnaKey }),
    });
  } catch {
    return { ok: false, data: null };
  }
  const data = await res.json().catch(() => null);
  return { ok: res.ok, data };
}
