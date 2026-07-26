// Kanonisk paginering for Supabase/PostgREST-loads.
//
// PostgREST returnerer maks 1000 rækker pr. select uden eksplicit .range().
// Et naivt .select()/.in() lyver derfor stille på store tabeller: det returnerer
// kun de første 1000 rækker uden fejl. Det har bidt flere steder (PCM rytter-
// matcher → tabte 88% af ryttere; updateStandings → underberegnede standings
// 38%). Brug denne helper til ALLE loads der kan overstige 1000 rækker.
//
// VIGTIGT: buildQuery SKAL inkludere en stabil .order() (fx .order("id")), ellers
// kan PostgREST returnere rækker i forskellig rækkefølge mellem sider → gaps eller
// dubletter på tværs af sider. Helperen tilføjer kun .range().

import { withSupabaseRetry } from "./supabaseErrorNormalize.js";

export const SUPABASE_PAGE_SIZE = 1000;

// buildQuery: () => en Supabase-query-builder (med .order()) der endnu ikke har
// fået .range() påført. Kaldes én gang pr. side. Kaster ved Supabase-fejl.
//
// #2023: hver side hentes via withSupabaseRetry, så et kort, selv-helende
// gateway-hikke (Cloudflare 5xx foran *.supabase.co) ikke vælter en hel cron.
// Den rå fejl kastes uændret ind i retry-laget, så transient-detekteringen kan
// se HTML-signalet; ved endelig opgivelse normaliseres beskeden til én linje.
export async function fetchAllRows(buildQuery, pageSize = SUPABASE_PAGE_SIZE) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const data = await withSupabaseRetry(async () => {
      const { data, error } = await buildQuery().range(from, to);
      if (error) throw error;
      return data;
    });
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

// #3030: .in(ids)-lister URL-encodes ind i PostgREST-request-linjen; gatewayen
// dropper forbindelsen når linjen passerer ~16 KB (≈430 UUID'er) → undici
// "TypeError: fetch failed" UDEN statuskode. Det væltede auto-prize-sweepen
// (399 race-ids, Sentry CYCLINGZONE-3H) og ownership-invariant-watch (459
// intake-rytter-ids, CYCLINGZONE-3G) i takt med at sæsonen voksede. 100 ids
// ≈ 3,7 KB URL — god margin. Brug denne til ALLE .in()-kald hvis id-liste
// ikke er hårdt bundet lavt.
export const SUPABASE_IN_CHUNK_SIZE = 100;

// buildQueryForChunk: (idsChunk) => query-builder (med .order(), uden .range()).
// Kaldes én gang pr. chunk; hver chunk pagineres via fetchAllRows. Rækkefølgen
// er stabil inden for en chunk, men på tværs af chunks følger den id-listens
// rækkefølge — kald sites der kræver global sortering må selv sortere bagefter.
export async function fetchAllRowsChunkedIn(
  ids,
  buildQueryForChunk,
  { chunkSize = SUPABASE_IN_CHUNK_SIZE, pageSize = SUPABASE_PAGE_SIZE } = {},
) {
  const rows = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    rows.push(...await fetchAllRows(() => buildQueryForChunk(chunk), pageSize));
  }
  return rows;
}
