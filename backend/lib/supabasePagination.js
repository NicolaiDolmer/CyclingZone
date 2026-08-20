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

// #4010: keyset-paginering — brug denne i stedet for fetchAllRows når filteret
// rammer mange rækker.
//
// Offset-paginering betaler for alt den springer over: Postgres skal stadig
// producere og kassere de første `from` rækker på hver side, så en fuld
// gennemløbning bliver kvadratisk. Målt på balanceDriftWatch's 14-dages-vindue
// over race_results (1,05 mio. rækker) kostede ÉN side af 1000 rækker 376.260
// buffere og 427 ms — 65 sider blev til 594 s DB-tid og 3,3 TB buffer-trafik i
// døgnet.
//
// Keyset starter hver side dér hvor den forrige slap (`WHERE key > sidste`), så
// prisen er lineær i antal rækker uanset hvor dybt man er nået.
//
// KRAV: `keyColumn` skal være UNIK og totalt ordnet (typisk primærnøglen), og
// buildQuery SKAL sortere stigende på præcis den kolonne. En ikke-unik sortering
// kan tabe eller duplikere rækker over sidegrænser — det gælder også for
// offset-varianten ovenfor, men keyset gør kravet ufravigeligt.
//
// buildQuery: (after) => query-builder. `after` er sidste sete nøgleværdi, eller
// null på første side; kaldstedet påfører selv `.gt(keyColumn, after)`.
export async function fetchAllRowsKeyset(
  buildQuery,
  { keyColumn = "id", pageSize = SUPABASE_PAGE_SIZE } = {},
) {
  const rows = [];
  let after = null;
  for (;;) {
    const data = await withSupabaseRetry(async () => {
      const { data, error } = await buildQuery(after).limit(pageSize);
      if (error) throw error;
      return data;
    });
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    const nextAfter = data[data.length - 1]?.[keyColumn];
    // Uden en nøgleværdi kan vi ikke rykke markøren, og et nyt kald ville hente
    // præcis samme side igen. Stop hellere end at loope i ring — kaldstedet har
    // så en select uden keyColumn, hvilket er en programmeringsfejl.
    if (nextAfter == null || nextAfter === after) {
      throw new Error(
        `fetchAllRowsKeyset: mangler brugbar "${keyColumn}"-værdi i sidste række — er kolonnen med i select() og .order()?`,
      );
    }
    after = nextAfter;
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
