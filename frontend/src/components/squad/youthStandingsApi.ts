// #5631: den bundne ungdomsstillings-klient (auth-headere + apiFetch).
//
// Selve klienten er ren og testet i lib/youthRankingsClient.ts; her får den
// kun sine afhængigheder, samme lagdeling som lib/rankingsApi.ts. apiFetch
// giver 429-backoff og ÉN 401-håndtering (#5242).
import { authHeaders } from "../../lib/supabase";
import { apiFetch } from "../../lib/apiFetch.ts";
import { reportLoadFailure } from "../../lib/actionTelemetry.js";
import { createYouthRankingsClient } from "../../lib/youthRankingsClient.ts";

export const { getYouthStandings } = createYouthRankingsClient({
  baseUrl: import.meta.env.VITE_API_URL || "",
  headers: () => authHeaders({ json: false }),
  request: (url, init) => apiFetch(url, init, { source: "youth-standings" }),
  // path+status only, aldrig query-værdier (samme regel som rankingsApi.ts).
  reportError: (error, context) => reportLoadFailure("youth_rankings_client", {
    kind: "http", status: context.status, cause: error, context: { path: context.path },
  }),
});
