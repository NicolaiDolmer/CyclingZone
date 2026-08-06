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

function fmtAmount(n, formatNumber) {
  return `${formatNumber(Math.abs(Number(n) || 0))} CZ$`;
}

/**
 * Bygger op til 3 label/value-rækker til det delbare kort ud fra
 * `row.facts` (get_season_documentary_facts' rå output) — SAMME struktur
 * grammatikken læste, så kortet aldrig kan sige noget andet end teksten.
 *
 * @param {object} facts
 * @param {(n:number)=>string} formatNumber  lib/intl.js's formatNumber (locale-korrekt)
 * @param {(key:string, params?:object)=>string} t  i18next t() bundet til seasonEnd
 * @returns {Array<{label:string, value:string}>}
 */
export function buildDocumentaryCardStats(facts, formatNumber, t) {
  const rows = [];
  const signing = facts?.signings?.[0];
  if (signing?.riderName) {
    rows.push({ label: t("documentary.card.signing"), value: `${signing.riderName} · ${fmtAmount(signing.amount, formatNumber)}` });
  }
  const biggest = facts?.biggestResult;
  if (biggest?.rider_name && biggest?.race_name) {
    rows.push({ label: t("documentary.card.result"), value: `${biggest.rider_name} · ${biggest.race_name}` });
  }
  const rival = facts?.rival;
  if (rival?.team_name) {
    rows.push({ label: t("documentary.card.rival"), value: `${rival.team_name} · ${formatNumber(rival.gap)} ${t("documentary.card.points")}` });
  }
  const standing = facts?.myStanding;
  if (standing?.total_points != null) {
    rows.push({ label: t("documentary.card.finalPoints"), value: formatNumber(standing.total_points) });
  }
  return rows.slice(0, 4);
}
