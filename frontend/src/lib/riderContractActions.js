// Delte fetch-helpers for de to body-løse senior-kontrakt-handlinger
// (#1719 fyr / #1720 forlæng) + deres preview-quotes. Serveren beregner
// gebyr/løn ud fra rytter-state, så POST'erne er body-løse.
//
// Én kilde forbruges af BÅDE rytter-profilen (RiderManageActions, #2007) og
// holdsidens RiderActionModal — ingen copy-paste af token-hentning/fetch-mønster.
// Returnerer altid { ok, data } så kald-stedet selv oversætter via resolveApiError
// med sit eget i18n-namespace. Netværksfejl kastes (fetch rejecter) → wrap i try.
import { authHeaders } from "./supabase.js"; // #4348: kanonisk kopi

const API = import.meta.env.VITE_API_URL;

// #4347: null = "ingen session" — før blev headeren strengen "Bearer undefined",
// som serveren afviste med 401, men fejlkroppen var tom, så kald-stedet viste sin
// generiske fallback i stedet for at sige at sessionen var udløbet.
const SESSION_EXPIRED = { ok: false, data: { errorCode: "session_expired" } };

// GET en preview-quote. path ∈ "release-quote" | "extend-quote". → { ok, data }.
export async function fetchRiderQuote(riderId, path) {
  const headers = await authHeaders();
  if (!headers) return SESSION_EXPIRED;
  const res = await fetch(`${API}/api/riders/${riderId}/${path}`, { headers });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

// POST en body-løs kontrakt-handling. path ∈ "release" | "extend-contract". → { ok, data }.
export async function postRiderContractAction(riderId, path) {
  const headers = await authHeaders();
  if (!headers) return SESSION_EXPIRED;
  const res = await fetch(`${API}/api/riders/${riderId}/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}
