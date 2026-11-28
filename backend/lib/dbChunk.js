// backend/lib/dbChunk.js
// Delte DB-chunk/paginerings-helpers. selectInChunks + fetchAllPaged var tidligere
// duplikeret ord-for-ord i raceRunner.js og raceEntryGenerator.js (identisk signatur).
// Konsolideret her så bl.a. den delte eligibility-loader (raceEntriesLoader.js) kan
// genbruge samme chunk/paged-fundament i stedet for at indføre en tredje kopi.

import { withSupabaseRetry } from "./supabaseErrorNormalize.js";

// CYCLINGZONE-9A (11/10): helperne her gik uden om retry-laget (#2023), så ét
// forbigående gateway-hikke ("Project not specified" lige efter et deploy) væltede
// hele entry-generator-sweepen. Hver chunk/side retry'es nu som fetchAllRows, men
// {data, error}-kontrakten er uændret: den endelige fejl returneres, kastes ikke.
export async function runWithRetry(run, retryOpts) {
  try {
    const data = await withSupabaseRetry(async () => {
      const { data: rows, error } = await run();
      if (error) throw error;
      return rows;
    }, retryOpts);
    return { data, error: null };
  } catch (error) {
    // catch-ok: fejlen sluges ikke, den returneres i {data, error}-kontrakten (kalderen kaster/capturer).
    return { data: null, error };
  }
}

// PostgREST .in() encoder id-listen i URL'en — ved relaunch-skala (600-800 UUID'er)
// rammer det 414/proxy-grænser. Batch derfor alle id-opslag i bidder. (#1307-review)
export const IN_CHUNK_SIZE = 200;
// #8797: en bid kan stadig give flere end 1.000 rækker når inColumn ikke er unik
// (fx team_rider_role_rules pr. hold). PostgREST afkorter så stille. Rammer en bid
// præcis loftet, hentes netop den bid igen side for side med stabil orden. Under
// loftet er kaldet og rækkefølgen uændret fra før, så eksisterende resultater er
// bit-identiske; kun de manglende rækker kommer nu med.
// Ordenen SKAL være unik: fallbacken udløses kun når inColumn ikke er unik (en bid
// er højst IN_CHUNK_SIZE id'er), så inColumn alene giver bånd, og range-sider over
// bånd kan springe rækker over eller dublere dem. Default er derfor [inColumn, "id"];
// en tabel uden id-kolonne skal give sin egen unikke orderBy (ellers fejler kaldet
// højlydt i stedet for at miste rækker).
export async function selectInChunks({ supabase, table, columns, inColumn, ids, extra = null, orderBy = null, retryOpts }) {
  const out = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + IN_CHUNK_SIZE);
    // Frisk builder pr. forsøg: en PostgREST-builder kan kun awaites én gang.
    const build = () => {
      let q = supabase.from(table).select(columns).in(inColumn, chunk);
      if (extra) q = extra(q);
      return q;
    };
    let { data, error } = await runWithRetry(build, retryOpts);
    if (error) return { data: null, error };
    if ((data || []).length >= PAGE_SIZE) {
      ({ data, error } = await fetchAllPaged(() => {
        let q = build();
        for (const col of orderBy || [inColumn, "id"]) q = q.order(col);
        return q;
      }, { retryOpts }));
      if (error) return { data: null, error };
    }
    out.push(...(data || []));
  }
  return { data: out, error: null };
}

// Range-pagineret fetch (PostgREST default-cap = 1000 rækker → tavs trunkering; #1839).
// `query` er en thunk der returnerer en frisk builder, så .range() kan kædes pr. side.
export const PAGE_SIZE = 1000;
/**
 * @param {() => any} query
 * @param {{ retryOpts?: any }} [opts]
 * @returns {Promise<{ data: any[] | null, error: any }>}
 */
export async function fetchAllPaged(query, { retryOpts } = {}) {
  const out = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await runWithRetry(() => query().range(from, from + PAGE_SIZE - 1), retryOpts);
    if (error) return { data: null, error };
    out.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return { data: out, error: null };
}
