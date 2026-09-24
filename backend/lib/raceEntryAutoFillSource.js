// backend/lib/raceEntryAutoFillSource.js
// #5246: hvem skrev en auto-fyldt race_entries-raekke? Kilden gemmes i
// race_entries.auto_filled_source (database/2026-09-23-5246-late-fill-log.sql),
// saa assistentens late-fill kan maales for sig selv uden at blive blandet sammen
// med spillerens egen "Auto-udfyld" eller AI-holdenes generator-raekker.
//
// Kilden saettes EKSPLICIT af hver skriver. DB-triggeren giver ingen default:
// en auto-raekke uden kilde (alt fra foer #5246, eller en ny skriver der glemmer
// feltet) staar som NULL og taelles som "unknown" i maalingen, aldrig som
// late_fill. Vaerdierne skal matche CHECK-constrainten
// race_entries_auto_filled_source_check i migrationen.
export const AUTO_FILL_SOURCES = Object.freeze({
  // Assistenten fyldte et menneskeholds tomme trup kort foer start (sweep, mode=late_fill).
  LATE_FILL: "late_fill",
  // Assistenten fyldte et menneskehold der selv har slaaet den til (sweep, mode=opt_in).
  OPT_IN: "opt_in",
  // raceRunner.fillMissingTeamEntries ved loebsstart (fuld trup fra nul eller op til gulvet).
  START_RESCUE: "start_rescue",
  // Managerens egen knap: POST /races/:raceId/selection/auto og Race Hubs
  // POST /races/distribution/regenerate.
  MANAGER_AUTO: "manager_auto",
  // Generatoren fylder et AI-hold (sweep i alle tilstande, saesonskifte, admin-genvej).
  AI_GENERATOR: "ai_generator",
});

export const AUTO_FILL_SOURCE_COLUMN = "auto_filled_source";

// Deploy-raekkefoelge (#5246): Railway deployer backend FOER auto-migrate.yml har
// koert migrationen (ca. 3 min senere). I det vindue findes kolonnen ikke, og en
// skrivning der sender feltet afvises. PostgREST svarer PGRST204 ("Could not find
// the 'auto_filled_source' column ... in the schema cache"); raa Postgres svarer
// 42703 (undefined_column). Begge skal naevne netop denne kolonne, saa vi aldrig
// sluger en anden fejl.
export function isMissingAutoFillSourceColumn(err) {
  if (!err) return false;
  const code = String(err.code ?? "");
  if (code !== "PGRST204" && code !== "42703") return false;
  const text = `${err.message ?? ""} ${err.details ?? ""} ${err.hint ?? ""}`;
  return text.includes(AUTO_FILL_SOURCE_COLUMN);
}

export function stripAutoFillSource(rows) {
  return rows.map((row) => {
    if (!Object.prototype.hasOwnProperty.call(row, AUTO_FILL_SOURCE_COLUMN)) return row;
    const { [AUTO_FILL_SOURCE_COLUMN]: _omit, ...rest } = row;
    return rest;
  });
}

/**
 * Skriv race_entries-raekker med auto_filled_source, og proev EEN gang igen uden
 * feltet hvis kolonnen ikke findes endnu (vinduet mellem backend-deploy og
 * migrationen). Alle andre fejl returneres uaendret til kalderen, som selv
 * klassificerer dem (#3420-invarianten, #4959-draening osv.).
 *
 * @param {{ supabase: object, rows: Array<object>, upsertOptions?: object }} args
 *   upsertOptions sat → .upsert(rows, upsertOptions), ellers .insert(rows).
 * @returns {Promise<{ error: object|null, sourceDropped: boolean }>}
 */
export async function writeRaceEntriesWithSource({ supabase, rows, upsertOptions }) {
  const write = (payload) => (upsertOptions
    ? supabase.from("race_entries").upsert(payload, upsertOptions)
    : supabase.from("race_entries").insert(payload));
  const first = await write(rows);
  const firstErr = first?.error ?? null;
  if (!isMissingAutoFillSourceColumn(firstErr)) return { error: firstErr, sourceDropped: false };
  console.warn(
    "⚠️  race_entries.auto_filled_source findes ikke endnu (migrationen #5246 er ikke koert) — skriver uden kilden",
  );
  const retry = await write(stripAutoFillSource(rows));
  return { error: retry?.error ?? null, sourceDropped: true };
}
