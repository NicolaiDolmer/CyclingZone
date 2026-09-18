// #4557 · Klub-DNA-kaldene (GET /board/dna-suggestions, POST /board/dna-choose),
// samlet ét sted så Boardroom og den gamle BoardPage bruger samme kontrakt.
// INGEN ny rute: begge endpoints findes allerede (backend/routes/api.js).
//
// #4348: bruger den KANONISKE authHeaders() (lib/supabase.ts) — enforced af
// authHeadersCanonical.4348.test.js (ingen ny lokal kopi tilladt).
import { authHeaders } from "../../lib/supabase";
import { apiFetch } from "../../lib/apiFetch.ts"; // #5242: Retry-After-respekt + centraliseret 401-vej

const API = import.meta.env.VITE_API_URL;

/**
 * Bestyrelsens 3 DNA-forslag + om holdet stadig må skifte.
 * Returnerer `null` ved manglende session/fejl — kalderen viser bare ingenting
 * (DNA-kortet er en tilbudt handling, ikke sidens data).
 */
export async function fetchDnaSuggestions() {
  const headers = await authHeaders({ json: false });
  if (!headers) return null;
  try {
    const res = await apiFetch(`${API}/api/board/dna-suggestions`, { headers });
    if (!res.ok) return null; // dækker også limited/unauthorized/networkError
    return res.data ?? null;
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
    res = await apiFetch(`${API}/api/board/dna-choose`, {
      method: "POST",
      headers,
      body: JSON.stringify({ dna_key: dnaKey }),
    });
  } catch {
    return { ok: false, data: null };
  }
  return { ok: res.ok, data: res.data ?? null }; // #5242, se bonusOfferApi.js

}
