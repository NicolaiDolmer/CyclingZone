// race_results-dublet-invarianten (#2974/#2898), aggregeret i Postgres (#4204).
//
// ── Hvorfor denne fil findes ────────────────────────────────────────────────
// verify-invariants.js talte tidligere dubletter i hukommelsen: den hentede HELE
// race_results over PostgREST i sider a 1000 (1.128.609 rækker målt 24/8 =
// ~1.130 HTTP-kald) og byggede to Map's. Det alene stod for hovedparten af
// scriptets 20 min 12 s køretid i det daglige workflow (#4159). Postgres kan
// svare på præcis samme spørgsmål med to GROUP BY ... HAVING count(*) > 1.
//
// Modulet holder BEGGE veje til samme svar:
//   - computeRaceResultDuplicates(rows): referencen, dvs. den ORIGINALE
//     in-memory-optælling med uændret adfærd. Bruges stadig som fallback når
//     RPC'en ikke er applied endnu (migrationen køres post-merge), så vagten
//     ikke bliver rød i vinduet mellem merge og apply.
//   - normalizeRaceResultDuplicatesRpc(json): samme svar, læst fra RPC'en
//     public.verify_race_result_duplicates (database/2026-08-29-4204-*.sql).
//
// De to veje er bevist ækvivalente i backend/lib/testdb/
// raceResultDuplicateRpc.integration.test.js: de samme rækker går gennem den
// ægte, committede SQL (PGlite) og gennem referencen herunder, og de to
// resultater sammenlignes med deepStrictEqual, inkl. rækkefølge og nøgle-orden,
// så --json-outputtet er byte-identisk.
//
// ── Nøglerne (uændret semantik, flyttet hertil) ─────────────────────────────
// Dublet-nøgle: (race_id, stage_number, result_type, rider_id). En rytter kan
// ikke optræde to gange i samme klassement på samme etape. Det er præcis den
// form en dublet fra et fejlet delete-then-insert tager.
//
// rider_id IS NULL er UDELADT, og det er ikke kosmetik. Målt mod prod 26/7 er
// 43.288 af 487.377 rækker rytterløse: hold-klassementerne (`team`, `team_day`)
// har per design ingen rytter, og historiske PCM-importer efterlod rækker hvor
// rytteren ikke kunne matches. Grupperer man dem med, samler SQL/Map alle
// NULL-rytter-rækker i ét løb i ÉN nøgle og rapporterer 2.336 "dubletter" på
// 410 løb, rent støj. Med filteret: 0 dubletter i prod.
//
// Rang-nøgle: (race_id, stage_number, result_type, rank). Fanger den variant
// hvor dubletten IKKE er rytter-identisk (fx en genafvikling med et ændret felt
// oven på et fejlet delete). NULL-rang er udeladt: ikke-scorende rækker bærer
// rank=null i massevis og er ikke dubletter.
//
// ── Rækkefølge ─────────────────────────────────────────────────────────────
// Kun de første `limit` brud rapporteres. Referencen rapporterer dem i den
// rækkefølge nøglerne først blev set, og rækkerne blev hentet med order=id.asc,
// altså stigende efter gruppens laveste id. SQL-siden bruger derfor
// `order by min(id::text)`, så de to veje udpeger de SAMME brud når der er flere
// end `limit`. (`::text` fordi min()/max() for uuid først kom i PostgreSQL 18;
// uuid'ens tekst-form sorterer identisk med uuid-formen.)

/** Navnet på RPC'en i Postgres (database/2026-08-29-4204-race-result-duplicate-rpc.sql). */
export const RACE_RESULT_DUPLICATE_RPC = "verify_race_result_duplicates";

/** Hvor mange brud der rapporteres pr. check (uændret fra det tidligere .slice(0, 50)). */
export const RACE_RESULT_VIOLATION_LIMIT = 50;

/**
 * @typedef {object} RaceResultDuplicateSummary
 * @property {number} totalRows           Antal rækker i race_results i alt (inkl. rytterløse).
 * @property {number} riderKeyCount       Distinkte (løb, etape, klassement, rytter)-nøgler.
 * @property {number} duplicateKeyCount   Hvor mange af dem der optræder 2+ gange.
 * @property {number} duplicateRaceCount  Distinkte løb blandt dubletterne.
 * @property {Array<{raceId: string, stageNumber: number|null, resultType: string, riderId: string, rows: number}>} duplicateKeys
 * @property {number} duplicateRankCount  Distinkte (løb, etape, klassement, rang) tildelt 2+ gange.
 * @property {Array<{raceId: string, stageNumber: number|null, resultType: string, rank: number, rows: number}>} duplicateRanks
 */

// Map-nøglen bygges med JSON.stringify over de fire felter: injektiv (to
// forskellige feltkombinationer kan ikke give samme streng, i modsætning til en
// rå `|`-join) og NULL får sin egen værdi, så NULL grupperes med NULL præcis som
// SQL's GROUP BY gør det.
//
// Bucket'en beholder de RÅ værdier i stedet for at splitte nøglestrengen op igen
// (som den oprindelige kode gjorde). Den gamle vej gav NaN for en NULL
// stage_number; begge serialiseres til `null` af JSON.stringify, så
// --json-outputtet er uændret, men de rå værdier er dét SQL også leverer, og det
// er dét der gør de to veje direkte sammenlignelige.
function keyOf(parts) {
  return JSON.stringify(parts);
}

/**
 * Den originale in-memory-optælling. Fallback når RPC'en ikke findes endnu, og
 * reference-implementationen som ækvivalens-testen måler SQL'en imod.
 *
 * @param {Array<{race_id: string, stage_number: number|null, result_type: string, rider_id: string|null, rank: number|null}>} rows
 *   race_results-rækker i stigende id-orden (som fetchAll leverer dem).
 * @param {{limit?: number}} [options]
 * @returns {RaceResultDuplicateSummary}
 */
export function computeRaceResultDuplicates(rows, { limit = RACE_RESULT_VIOLATION_LIMIT } = {}) {
  const cap = Math.max(0, Number.isFinite(limit) ? limit : RACE_RESULT_VIOLATION_LIMIT);

  const riderKeys = new Map();
  for (const r of rows) {
    if (r.rider_id == null) continue;
    const key = keyOf([r.race_id, r.stage_number, r.result_type, r.rider_id]);
    const bucket = riderKeys.get(key);
    if (bucket) {
      bucket.rows += 1;
    } else {
      riderKeys.set(key, {
        raceId: r.race_id,
        stageNumber: r.stage_number,
        resultType: r.result_type,
        riderId: r.rider_id,
        rows: 1,
      });
    }
  }

  const duplicateKeys = [];
  for (const bucket of riderKeys.values()) {
    if (bucket.rows > 1) duplicateKeys.push(bucket);
  }

  const rankKeys = new Map();
  for (const r of rows) {
    if (r.rank == null) continue;
    const key = keyOf([r.race_id, r.stage_number, r.result_type, r.rank]);
    const bucket = rankKeys.get(key);
    if (bucket) {
      bucket.rows += 1;
    } else {
      rankKeys.set(key, {
        raceId: r.race_id,
        stageNumber: r.stage_number,
        resultType: r.result_type,
        rank: r.rank,
        rows: 1,
      });
    }
  }

  const duplicateRanks = [];
  for (const bucket of rankKeys.values()) {
    if (bucket.rows > 1) duplicateRanks.push(bucket);
  }

  // Distinkte løb blandt dubletterne, talt over ALLE brud og ikke kun de
  // rapporterede `cap` stk. (uændret: detaljeteksten nævnte altid det fulde tal).
  const duplicateRaces = new Set(duplicateKeys.map((d) => d.raceId));

  return {
    totalRows: rows.length,
    riderKeyCount: riderKeys.size,
    duplicateKeyCount: duplicateKeys.length,
    duplicateRaceCount: duplicateRaces.size,
    duplicateKeys: duplicateKeys.slice(0, cap),
    duplicateRankCount: duplicateRanks.length,
    duplicateRanks: duplicateRanks.slice(0, cap),
  };
}

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Oversæt RPC'ens jsonb-svar til samme form som computeRaceResultDuplicates.
 * Nøjagtig samme nøgle-rækkefølge i violation-objekterne, så --json-outputtet er
 * byte-identisk med den gamle vej.
 *
 * @param {unknown} payload svaret fra POST /rest/v1/rpc/verify_race_result_duplicates
 * @returns {RaceResultDuplicateSummary}
 */
export function normalizeRaceResultDuplicatesRpc(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(
      `${RACE_RESULT_DUPLICATE_RPC}: uventet svar (forventede et jsonb-objekt, fik ${
        Array.isArray(payload) ? "array" : typeof payload
      })`,
    );
  }

  const keys = Array.isArray(payload.duplicate_keys) ? payload.duplicate_keys : [];
  const ranks = Array.isArray(payload.duplicate_ranks) ? payload.duplicate_ranks : [];

  return {
    totalRows: toCount(payload.total_rows),
    riderKeyCount: toCount(payload.rider_key_count),
    duplicateKeyCount: toCount(payload.duplicate_key_count),
    duplicateRaceCount: toCount(payload.duplicate_race_count),
    duplicateKeys: keys.map((d) => ({
      raceId: d.race_id,
      stageNumber: d.stage_number,
      resultType: d.result_type,
      riderId: d.rider_id,
      rows: d.rows,
    })),
    duplicateRankCount: toCount(payload.duplicate_rank_count),
    duplicateRanks: ranks.map((d) => ({
      raceId: d.race_id,
      stageNumber: d.stage_number,
      resultType: d.result_type,
      rank: d.rank,
      rows: d.rows,
    })),
  };
}
