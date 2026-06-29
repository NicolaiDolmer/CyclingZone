// Delte fetch-helpers for de to body-løse senior-kontrakt-handlinger
// (#1719 fyr / #1720 forlæng) + deres preview-quotes. Serveren beregner
// gebyr/løn ud fra rytter-state, så POST'erne er body-løse.
//
// Én kilde forbruges af BÅDE rytter-profilen (RiderManageActions, #2007) og
// holdsidens RiderActionModal — ingen copy-paste af token-hentning/fetch-mønster.
// Returnerer altid { ok, data } så kald-stedet selv oversætter via resolveApiError
// med sit eget i18n-namespace. Netværksfejl kastes (fetch rejecter) → wrap i try.
import { supabase } from "./supabase.js";

const API = import.meta.env.VITE_API_URL;

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` };
}

// GET en preview-quote. path ∈ "release-quote" | "extend-quote". → { ok, data }.
export async function fetchRiderQuote(riderId, path) {
  const res = await fetch(`${API}/api/riders/${riderId}/${path}`, { headers: await authHeaders() });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

// POST en body-løs kontrakt-handling. path ∈ "release" | "extend-contract". → { ok, data }.
export async function postRiderContractAction(riderId, path) {
  const res = await fetch(`${API}/api/riders/${riderId}/${path}`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({}),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}
