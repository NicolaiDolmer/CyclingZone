/**
 * race_results deltager-identitet — entrant_key (#3022).
 *
 * Én kilde til sandhed for "hvad er en deltagers stabile identitet i race_results",
 * spejlende den genererede SQL-kolonne 1:1:
 *   database/proposals/2026-08-05-race-results-entrant-key-unique-constraint.sql
 *   + database/2026-08-06-race-results-entrant-uid.sql (#3416: entrant_uid-fallback —
 *     delete-triggerne snapshotter FK-uuid'en før ON DELETE SET NULL, så nøglen er
 *     STABIL hen over sletning og navne-dubletter aldrig kan vælte en delete)
 *
 * Bevis for at de to sider er enige: backend/lib/testdb/raceResultsEntrantUnique.integration.test.js
 * kører DEN ÆGTE SQL-fil mod en PGlite-instans og sammenligner med denne fils output.
 *
 * Formål:
 *   1. computeEntrantKey  — samme fallback-logik som DB'ens entrant_key-kolonne
 *      (rider_id/team_id når sat, ellers et navne-snapshot). Bruges kun til
 *      forward-guarden nedenfor — selve uniqueness håndhæves af DB-constrainten.
 *   2. assertValidEntrantRows — afvis en batch FØR den når databasen hvis:
 *        a) en række mangler enhver deltager-identitet (hverken FK eller navn) —
 *           "en resultatrække uden gyldig rytter/hold" (#3022 acceptkriterium)
 *        b) to rækker i SAMME batch ville kollidere på
 *           (race_id, stage_number, result_type, entrant_key) — fanger et
 *           opstrøms engine-/import-bug FØR et koldt unique_violation-svar fra
 *           Postgres, med et forklarende budskab.
 */

const TEAM_SCOPED_RESULT_TYPES = new Set(["team", "team_day"]);

function isTeamScoped(resultType) {
  return TEAM_SCOPED_RESULT_TYPES.has(resultType);
}

function norm(value) {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * Spejler entrant_key-kolonnens CASE-udtryk. ALDRIG null/undefined — en manglende
 * identitet giver en generisk (men gruppérbar) fallback-streng, som
 * hasValidEntrantIdentity/assertValidEntrantRows nedenfor fanger separat.
 */
export function computeEntrantKey(row) {
  const resultType = row?.result_type;
  if (isTeamScoped(resultType)) {
    if (row?.team_id) return String(row.team_id);
    if (row?.entrant_uid) return String(row.entrant_uid);
    return `team-name:${norm(row?.team_name)}`;
  }
  if (row?.rider_id) return String(row.rider_id);
  if (row?.entrant_uid) return String(row.entrant_uid);
  return `rider-name:${norm(row?.rider_name)}::${norm(row?.team_name)}`;
}

/**
 * true hvis rækken har en identitet der kan bære entrant_key uden at falde
 * tilbage til en tom/ukendt streng — enten en FK ELLER et ikke-tomt navne-snapshot.
 */
export function hasValidEntrantIdentity(row) {
  const resultType = row?.result_type;
  if (isTeamScoped(resultType)) {
    return Boolean(row?.team_id) || norm(row?.team_name) !== "";
  }
  return Boolean(row?.rider_id) || norm(row?.rider_name) !== "";
}

function groupKey(row) {
  return `${row?.race_id ?? ""}|${row?.stage_number ?? 1}|${row?.result_type}|${computeEntrantKey(row)}`;
}

/**
 * Kaster en beskrivende fejl hvis batchen indeholder:
 *   - en række uden gyldig deltager-identitet, eller
 *   - to rækker der ville kollidere med race_results_entrant_unique.
 * No-op (returnerer stille) for en gyldig batch.
 */
export function assertValidEntrantRows(rows) {
  const seen = new Map();
  for (const row of rows || []) {
    if (!hasValidEntrantIdentity(row)) {
      throw new Error(
        `race_results row uden gyldig deltager-identitet (result_type=${row?.result_type}, ` +
          `race_id=${row?.race_id}, stage_number=${row?.stage_number}) — hverken rider_id/team_id ` +
          `eller et navne-snapshot (rider_name/team_name) er sat. #3022 kræver ÉN af delene FØR skrivning.`,
      );
    }
    const key = groupKey(row);
    if (seen.has(key)) {
      throw new Error(
        `race_results batch indeholder to rækker for samme deltager (race_id=${row?.race_id}, ` +
          `stage_number=${row?.stage_number}, result_type=${row?.result_type}) — ville kollidere med ` +
          `race_results_entrant_unique-constrainten (#3022). Undersøg hvor batchen bygges — dette er ` +
          `formentlig samme fejlklasse som #2898/#2974 (delete-then-insert-desync), ikke gyldig spildata.`,
      );
    }
    seen.set(key, true);
  }
}
