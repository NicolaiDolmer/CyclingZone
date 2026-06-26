// backend/lib/dbChunk.js
// Delte DB-chunk/paginerings-helpers. selectInChunks + fetchAllPaged var tidligere
// duplikeret ord-for-ord i raceRunner.js og raceEntryGenerator.js (identisk signatur).
// Konsolideret her så bl.a. den delte eligibility-loader (raceEntriesLoader.js) kan
// genbruge samme chunk/paged-fundament i stedet for at indføre en tredje kopi.

// PostgREST .in() encoder id-listen i URL'en — ved relaunch-skala (600-800 UUID'er)
// rammer det 414/proxy-grænser. Batch derfor alle id-opslag i bidder. (#1307-review)
export const IN_CHUNK_SIZE = 200;
export async function selectInChunks({ supabase, table, columns, inColumn, ids, extra = null }) {
  const out = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
    let q = supabase.from(table).select(columns).in(inColumn, ids.slice(i, i + IN_CHUNK_SIZE));
    if (extra) q = extra(q);
    const { data, error } = await q;
    if (error) return { data: null, error };
    out.push(...(data || []));
  }
  return { data: out, error: null };
}

// Range-pagineret fetch (PostgREST default-cap = 1000 rækker → tavs trunkering; #1839).
// `query` er en thunk der returnerer en frisk builder, så .range() kan kædes pr. side.
export const PAGE_SIZE = 1000;
export async function fetchAllPaged(query) {
  const out = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await query().range(from, from + PAGE_SIZE - 1);
    if (error) return { data: null, error };
    out.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return { data: out, error: null };
}
