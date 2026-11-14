// #7664: henter tidspunktet til "Opdateret kl." (rytter- og holdranglisten).
// Holdt ude af rankingFreshness.ts, saa de rene hjaelpere kan proeves med
// `node --test` uden Supabase-klienten.
import { authHeaders } from "./supabase";
import { apiFetch } from "./apiFetch.ts";

/** Svaret fra /api/rankings/freshness, eller null (fx ikke logget ind eller fejl). */
export async function loadRankingFreshness(): Promise<unknown> {
  const headers = await authHeaders({ json: false });
  if (!headers) return null;
  const response = await apiFetch("/api/rankings/freshness", { headers }, { source: "rankings-freshness" });
  return response.ok ? response.data : null;
}
