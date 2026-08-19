// #3402 — Sæsondokumentaren: ren data-shaping, uden for React (samme
// adskillelse som seasonHonours.js/seasonRecapData.js — testbar med
// node --test, ingen DOM). SeasonDocumentary.jsx bruger disse funktioner til
// at gå fra den rå season_documentaries-række til hvad siden og
// eksport-kortet renderer.

/**
 * PostgREST svarer PGRST205 (og Postgres 42P01 "undefined_table") når
 * season_documentaries-tabellen ikke findes endnu — migrationen
 * (database/2026-08-06-3402-season-documentary.sql) applies EFTER merge,
 * ejer-politik (jf. isMissingFunctionError i seasonHonours.js, samme
 * begrundelse for RPC'en). I vinduet indtil da skal siden udelade sektionen,
 * ikke vise en fejl for noget der endnu ikke er slået til.
 */
export function isMissingTableError(error) {
  if (!error) return false;
  const code = String(error.code || "");
  if (code === "PGRST205" || code === "42P01") return true;
  const message = String(error.message || "").toLowerCase();
  return message.includes("could not find the table")
    || message.includes("does not exist");
}

/**
 * Vælger hvilken tekst der skal vises: LLM-poleret hvis den findes for det
 * ønskede sprog, ellers den deterministiske kladde (ALTID til stede — #3402's
 * fallback-krav). En række med source='llm' men uden det ønskede sprogs
 * LLM-tekst (fx polish fejlede kun for ét sprog) falder også tilbage pr. sprog.
 *
 * @param {object|null} row  en season_documentaries-række
 * @param {"en"|"da"} lang
 * @returns {{ paragraphs: string[], source: "llm"|"deterministic" }|null}
 */
export function pickDocumentaryText(row, lang) {
  if (!row) return null;
  const llmKey = lang === "da" ? "llm_da" : "llm_en";
  const detKey = lang === "da" ? "deterministic_da" : "deterministic_en";
  const llmText = row[llmKey];
  if (typeof llmText === "string" && llmText.trim()) {
    // LLM-teksten er ÉN sammenhængende streng (flere afsnit adskilt af blanke
    // linjer, jf. seasonDocumentaryLLM.js's systemprompt) — split til afsnit
    // så renderingen matcher den deterministiske sti (string[]).
    const paragraphs = llmText.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    if (paragraphs.length) return { paragraphs, source: "llm" };
  }
  const det = Array.isArray(row[detKey]) ? row[detKey].filter((p) => typeof p === "string" && p.trim()) : [];
  return { paragraphs: det, source: "deterministic" };
}

/**
 * Bygger de delbare kort-rækker ud fra `row.facts` (get_season_documentary_facts'
 * rå output) — SAMME struktur grammatikken læste, så kortet aldrig kan sige
 * noget andet end teksten.
 *
 * #season-recap-polish (18/8, ejer-godkendt mockup) — PRÆCIS 4 rækker i FAST
 * rækkefølge (ikke længere "op til 4, i den rækkefølge facts tilfældigvis har
 * data"): Turning point (bedste løbsdag) → Biggest result → Closest rival →
 * Final points. "Signing" droppet fra kortet — dét tal stod allerede i
 * dokumentar-teksten (afsnit 2), og kortet har kun plads til 4 rækker.
 * Final points læses fra facts.myStanding, med teamRecap.standingsRow.
 * total_points som fallback — kortets download-knap sidder nu på
 * SeasonRecapHero (som ALTID har standingsRow), ikke længere på selve
 * dokumentar-sektionen (som kan mangle helt, fx lige efter en cutover), så
 * kortet skal kunne bygges selv når dokumentar-facts endnu ikke er klar.
 *
 * @param {object|null} facts  get_season_documentary_facts' output, eller null hvis
 *   dokumentaren (endnu) ikke er tilgængelig — kortet degraderer da til kun
 *   "Final points" (fra standingsRow) i stedet for at fejle.
 * @param {{total_points?:number}|null} [standingsRow]  season_standings-rækken for
 *   MIT hold denne sæson (SeasonEndPage's teamRecap.standingsRow) — fallback-kilde
 *   til "Final points" når facts.myStanding mangler.
 * @param {(n:number)=>string} formatNumber  lib/intl.js's formatNumber (locale-korrekt)
 * @param {(key:string, params?:object)=>string} t  i18next t() bundet til seasonEnd
 * @param {{turningPointDateLabel?:string|null}} [extras]  allerede-formateret dato for
 *   "Turning point"-rækken (afledt af race_stage_schedule.scheduled_at, IKKE den rå
 *   pool_race.date_text — se raceCompletionDate.js #3197). Falder tilbage til
 *   løbsnavnet når datoen (endnu) ikke er hentet/tilgængelig.
 * @returns {Array<{label:string, value:string}>}
 */
export function buildDocumentaryCardStats(facts, standingsRow, formatNumber, t, extras = {}) {
  const rows = [];

  const bestRaceDay = facts?.bestRaceDay;
  if (bestRaceDay?.race_name && bestRaceDay?.total_points != null) {
    const points = `${formatNumber(bestRaceDay.total_points)} ${t("documentary.card.pts")}`;
    const dateOrRace = extras.turningPointDateLabel || bestRaceDay.race_name;
    rows.push({ label: t("documentary.card.turningPoint"), value: `${points} · ${dateOrRace}` });
  }

  const biggest = facts?.biggestResult;
  if (biggest?.rider_name && biggest?.race_name) {
    rows.push({ label: t("documentary.card.result"), value: `${biggest.rider_name} · ${biggest.race_name}` });
  }

  const standingPoints = facts?.myStanding?.total_points ?? standingsRow?.total_points ?? null;
  const rival = facts?.rival;
  if (rival?.team_name && rival?.gap != null) {
    const iAmAhead = standingPoints != null && standingPoints > rival.total_points;
    const sign = iAmAhead ? "+" : "-";
    rows.push({ label: t("documentary.card.rival"), value: `${rival.team_name} · ${sign}${formatNumber(rival.gap)}` });
  }

  if (standingPoints != null) {
    rows.push({ label: t("documentary.card.finalPoints"), value: formatNumber(standingPoints) });
  }

  return rows.slice(0, 4);
}
