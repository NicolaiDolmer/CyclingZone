// #3399/#3400 · Narrative rubrik-bygger til notifikationer/digest/Discord-DM.
//
// PROBLEM (#3399): emitRaceResultNotifications/emitStageResultNotifications
// (notificationService.js) skriver flade utility-strenge ("Race result is
// in"), og buildRaceDigestEmail (emailTemplates.js) er en nøgen <li>-liste —
// mens race_stage_moments (backend/lib/raceNarrative.js, S6) allerede
// persisterer PRÆCIS de momenter frontend/src/lib/raceReport.js bruger til at
// bygge etape-rapportens rubrik. Dette modul er den backend-side ækvivalent
// af raceReport.js's rubrik-udvælgelse (selectHeadlineMoment er en bevidst
// 1:1-port — se kommentaren ved funktionen), plus de dataopslag der binder
// den til en konkret notifikations-modtager (personligt resultat).
//
// Fog-gate (#1791, samme regel som raceNarrative.js/raceReport.js): output
// herfra er UDELUKKENDE afledt af allerede-persisterede rækker
// (race_stage_moments.moment_key/params, race_results.rank/rider_name) —
// ingen opdigtet detalje, ingen skjult mekanik-konstant.
//
// EN-first, ingen i18n-katalog her (samme bevidste afgrænsning som
// emailTemplates.js's header-kommentar: "English only for v1" — backend har
// intet DA-katalog for dynamisk, rytter-navngivet narrativ tekst). Kun
// headline-familiens v1-skabelon bruges (kopieret ordret fra
// frontend/public/locales/en/races.json's detail.report.headline.*.v1) — den
// fulde variant-rotation (raceReport.js's variantIndex/HEADLINE_VARIANT_COUNTS)
// er en frontend-PRÆSENTATIONS-nuance, ikke duplikeret her for at undgå
// backend/frontend copy-drift på tværs af to uafhængige kopier af samme
// variant-tabel.
//
// Ærlig degradering (matcher raceReport.js's `if (!winMoment) return null`):
// alle data-opslags-funktioner her returnerer null/tomt ved manglende data
// ELLER fejl (aldrig kast) — kalderen (notificationService.js m.fl.) falder
// tilbage til den eksisterende flade copy, præcis som i dag, for gamle/PCM-løb
// eller løb hvor v3 var slukket for etapen.

import { captureException } from "./sentry.js";
import { fetchAllRows } from "./supabasePagination.js";

// ─── Rene tekst-hjælpere ───────────────────────────────────────────────────

/**
 * Engelsk ordenstal ("1st", "2nd", "3rd", "4th", "11th", "12th", "13th", ...).
 * @param {number} n
 * @returns {string}
 */
export function ordinal(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  const abs = Math.abs(Math.trunc(num));
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${num}th`;
  switch (abs % 10) {
    case 1: return `${num}st`;
    case 2: return `${num}nd`;
    case 3: return `${num}rd`;
    default: return `${num}th`;
  }
}

// "2nd" / "2nd and 5th" / "2nd, 5th and 11th" — Oxford-komma bevidst udeladt
// (matcher emailTemplates.js's stil, ingen kompleks tegnsætning i player-facing copy).
function joinOrdinalList(ranks) {
  const sorted = [...(ranks || [])].filter((r) => Number.isFinite(r)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const words = sorted.map(ordinal);
  if (words.length === 1) return words[0];
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * Personligt-resultat-sætning uden indledende stort bogstav/punktum, fx
 * "you placed 2nd and 5th" — sporbar direkte til race_results.rank.
 * @param {number[]} ranks
 * @returns {string|null} null hvis ingen gyldige ranks (kalderen degraderer da).
 */
export function buildPersonalResultText(ranks) {
  const joined = joinOrdinalList(ranks);
  return joined ? `you placed ${joined}` : null;
}

/** Stort forbogstav — bruges til at løfte en frase til sætningsstart. */
export function capitalize(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Sekunder → "M:SS" — duplikeret bevidst fra frontend/src/pages/RaceDetailPage.jsx's
// formatMarginSeconds (ren præsentation, samme etablerede frontend/backend-
// duplikationsmønster som raceReport.js's fnv1aHash-kommentar beskriver).
function formatMarginSeconds(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

// ─── Rubrik-moment-udvælgelse (1:1-port af frontend/src/lib/raceReport.js) ──

// De momenter selectHeadlineMoment kan modtage som "vinder-momentet" for
// etapen — identisk med raceReport.js's WIN_MOMENT_KEYS.
export const WIN_MOMENT_KEYS = Object.freeze(["sprint_win", "close_win", "solo_win", "itt_win", "ttt_win"]);

function byKey(moments, key) {
  return moments.find((m) => m.moment_key === key) || null;
}

/**
 * Vælg rubrik-momentet for én etapes momenter — 1:1-port af
 * frontend/src/lib/raceReport.js's selectHeadlineMoment (se dens kommentar for
 * begrundelsen: den STØRRE historie slår den rene etapesejr, final_gc vinder
 * altid). Forskellen fra frontend-versionen er ren signatur-bekvemmelighed:
 * finder selv winMoment i stedet for at modtage det som separat parameter
 * (notifikations-kaldstederne har ikke allerede udledt det et andet sted).
 *
 * @param {Array<{moment_key, params, significance, rider_ids}>} stageMoments
 * @returns {object|null} null hvis intet vinder-moment findes (ærlig degradering).
 */
export function selectHeadlineMoment(stageMoments) {
  const list = stageMoments || [];
  const winMoment = list.find((m) => WIN_MOMENT_KEYS.includes(m.moment_key));
  if (!winMoment) return null;

  const finalGc = byKey(list, "final_gc");
  if (finalGc) return finalGc;

  const gcTakeover = byKey(list, "gc_takeover");
  const breakawaySurvived = byKey(list, "breakaway_survived");
  if (breakawaySurvived && breakawaySurvived.rider_ids?.[0] === winMoment.rider_ids?.[0]) {
    return gcTakeover && (gcTakeover.significance ?? 0) > (breakawaySurvived.significance ?? 0)
      ? gcTakeover
      : breakawaySurvived;
  }
  if (gcTakeover && (gcTakeover.significance ?? 0) > (winMoment.significance ?? 0)) return gcTakeover;
  return winMoment;
}

// EN v1-skabeloner — kopieret ORDRET fra frontend/public/locales/en/races.json's
// detail.report.headline.*.v1 (#2356), så notifikations-/digest-/DM-copy matcher
// in-app-panelets primære formulering. Kun de 6 moment_keys selectHeadlineMoment
// rent faktisk kan returnere har en skabelon her.
function headlineTemplate(momentKey) {
  switch (momentKey) {
    case "sprint_win": return "{rider} takes the sprint";
    // #4373: tidskørsler har egne rubrikker — ordret fra races.json's
    // detail.report.headline.itt_win.v1 / ttt_win.v1.
    case "itt_win": return "{rider} sets the fastest time";
    case "ttt_win": return "{rider} leads home the fastest team";
    case "close_win": return "{rider} wins by {marginText}";
    case "solo_win": return "{rider} rides away from the field";
    case "breakaway_survived": return "The breakaway makes it: {rider} wins";
    case "gc_takeover": return "{rider} takes the race lead";
    case "final_gc": return "{rider} wins {race}";
    default: return null;
  }
}

function interpolate(template, params) {
  return template.replace(/\{(\w+)\}/g, (_, key) => (params[key] ?? ""));
}

/**
 * Byg rubrik-teksten for ét udvalgt moment. riderName er en opslagsfunktion
 * (id → navn), matcher RaceDetailPage.jsx's headlineParamsFor-mønster.
 *
 * @param {{moment_key:string, params:object}} moment
 * @param {{riderName:(id:string)=>string, raceName?:string}} ctx
 * @returns {string|null} null hvis moment_key ikke har en skabelon (bør ikke ske
 *   for output fra selectHeadlineMoment, men degraderer ærligt hvis det gør).
 */
export function buildHeadlineText(moment, { riderName, raceName } = {}) {
  if (!moment) return null;
  const template = headlineTemplate(moment.moment_key);
  if (!template) return null;
  const p = moment.params || {};
  const name = typeof riderName === "function" ? riderName : () => "the rider";

  switch (moment.moment_key) {
    case "close_win":
    case "solo_win":
      return interpolate(template, { rider: name(p.riderId), marginText: formatMarginSeconds(p.gapSeconds) });
    case "final_gc": {
      const [first] = p.riderIds || [];
      return interpolate(template, { rider: name(first), race: raceName || "your race" });
    }
    default:
      return interpolate(template, { rider: name(p.riderId) });
  }
}

// ─── Dataopslag (Supabase) ──────────────────────────────────────────────────
//
// pagination-safe: hver slice herunder er bundet til ÉT race_id (+ evt. ét
// stage_number) og ÉN result_type — samme størrelsesorden som
// notificationService.js's defaultFetchStageParticipants (verificeret max 192
// rækker pr. felt, #3331-audit 2026-08-05). 'gc' har præcis én række pr.
// deltagende rytter for HELE løbet (raceRunner.js: også endagsløb pusher
// result_type='gc', kun stage_number=1) — samme orden af størrelse.

async function fetchRaceResultsSlice({ supabase, raceId, resultType, stageNumber = null }) {
  let query = supabase
    .from("race_results")
    // pagination-safe: bundet til ét race_id + resultType(+stageNumber) — se modul-header.
    .select("rider_id, rider_name, rank, team:team_id!inner(user_id, is_ai, is_frozen)")
    .eq("race_id", raceId)
    .eq("result_type", resultType);
  if (stageNumber != null) query = query.eq("stage_number", stageNumber);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * Reducér en race_results-slice til (a) et rytternavne-opslag (ALLE rækker,
 * uanset holdtype — rubrikkens rytter kan sagtens sidde på et AI-hold), (b)
 * ranks pr. menneske-manager (kun is_ai=false/is_frozen=false, samme
 * diskriminator som resten af notificationService.js), og (c) hvilke
 * rider_ids der er DENNE managers egne i denne race_results-slice (#3493 —
 * bruges til at afgøre om rubrik-momentet overhovedet involverer managerens
 * eget hold, se isHeadlineAboutOwnRiders nedenfor).
 *
 * @param {Array} rows
 * @returns {{riderNameById: Map<string,string>, ranksByUser: Map<string,number[]>, riderIdsByUser: Map<string,Set<string>>}}
 */
export function summarizeRaceResultRows(rows) {
  const riderNameById = new Map();
  const ranksByUser = new Map();
  const riderIdsByUser = new Map();
  for (const row of rows || []) {
    if (row.rider_id && row.rider_name) riderNameById.set(row.rider_id, row.rider_name);
    const userId = row.team?.user_id;
    if (!userId || row.team?.is_ai || row.team?.is_frozen || row.rank == null) continue;
    if (!ranksByUser.has(userId)) ranksByUser.set(userId, []);
    ranksByUser.get(userId).push(row.rank);
    if (row.rider_id) {
      if (!riderIdsByUser.has(userId)) riderIdsByUser.set(userId, new Set());
      riderIdsByUser.get(userId).add(row.rider_id);
    }
  }
  return { riderNameById, ranksByUser, riderIdsByUser };
}

/**
 * #3493 · Spillerreaktion på #3399: etape-/løbsnotifikationens rubrik
 * (selectHeadlineMoment) er bevidst den STØRSTE historie i løbet — ofte en
 * rival-rytter, ikke modtagerens egen. "I like to now about my own rider,
 * and not for other teams riders in my own inbox" (Discord, #3493). Denne
 * relevans-guard afgør om rubrik-momentet rent faktisk involverer MODTAGERENS
 * egne ryttere i denne race/etape — bruges af notificationService.js til at
 * afgøre om rubrikken skal vises, eller om beskeden skal degradere ærligt til
 * den flade personlige sætning ("Etape 4 er kørt. Du placerede X."). Selve
 * løbsrapporten (frontend/src/lib/raceReport.js) er UÆNDRET — den brede
 * rubrik for HELE løbet hører fortsat hjemme dér.
 *
 * @param {{riderIdsByUser?: Map<string,Set<string>>, headlineRiderIds?: string[]}} narrative
 * @param {string} userId
 * @returns {boolean}
 */
export function isHeadlineAboutOwnRiders(narrative, userId) {
  const ownRiderIds = narrative?.riderIdsByUser?.get(userId);
  const headlineRiderIds = narrative?.headlineRiderIds;
  if (!ownRiderIds?.size || !headlineRiderIds?.length) return false;
  return headlineRiderIds.some((id) => ownRiderIds.has(id));
}

function logNarrativeFailure(err, { raceId, stageNumber, stage }) {
  console.error(
    `  ⚠️  narrativ-opslag fejlede (race ${raceId}${stageNumber != null ? `, etape ${stageNumber}` : ""}) — falder tilbage til standard-copy:`,
    err?.message || err,
  );
  captureException(err, { tags: { flow: "notifications", stage }, raceId, stageNumber });
}

/**
 * #3399 · Byg den narrative rubrik + pr.-manager ranks for et løbs SLUT-resultat
 * (final_gc/gc_takeover/vindermoment for løbets sidste kørte etape — dækker
 * begge endagsløb og etapeløb, jf. raceRunner.js's result_type='gc'-shape).
 *
 * Ærlig degradering: returnerer null (aldrig kast) hvis race_stage_moments er
 * tom for løbet (v3 var slukket, gammelt/PCM-løb), hvis intet vinder-moment
 * findes, eller ved enhver query-fejl — kalderen falder da tilbage til
 * eksisterende flade copy.
 *
 * @param {{supabase:object, race:{id:string, name?:string}}} args
 * @returns {Promise<{headlineText:string, ranksByUser:Map<string,number[]>}|null>}
 */
export async function buildRaceResultNarrative({ supabase, race }) {
  if (!supabase?.from || !race?.id) return null;
  try {
    // #4566: race_id-only (ikke stage-scoped) — samme klassebug som
    // RaceDetailPage.jsx's momentsPromise (et 13-etapes løb har allerede ramt
    // 1.345 rækker mod PostgREST's tavse 1.000-loft). fetchAllRows pagineret,
    // stabil .order() så "sidste etape" (Math.max nedenfor) altid ser den
    // fulde rækkefølge på tværs af sider.
    const momentRows = await fetchAllRows(() =>
      supabase
        .from("race_stage_moments")
        .select("stage_number, moment_key, params, significance, rider_ids")
        .eq("race_id", race.id)
        .order("stage_number", { ascending: true })
        .order("id", { ascending: true })
    );
    if (!momentRows?.length) return null;

    const finalStage = Math.max(...momentRows.map((m) => m.stage_number ?? 1));
    const stageMoments = momentRows.filter((m) => (m.stage_number ?? 1) === finalStage);
    const headline = selectHeadlineMoment(stageMoments);
    if (!headline) return null;

    const rows = await fetchRaceResultsSlice({ supabase, raceId: race.id, resultType: "gc" });
    const { riderNameById, ranksByUser, riderIdsByUser } = summarizeRaceResultRows(rows);
    const riderName = (id) => (id ? riderNameById.get(id) || "the rider" : "the rider");
    const headlineText = buildHeadlineText(headline, { riderName, raceName: race.name ?? "your race" });
    if (!headlineText) return null;

    // #3493: hvilke rider_ids rubrik-momentet handler om — bruges af
    // isHeadlineAboutOwnRiders til at afgøre om DENNE rubrik er relevant for
    // en given modtager.
    return { headlineText, ranksByUser, riderIdsByUser, headlineRiderIds: headline.rider_ids || [] };
  } catch (err) {
    // best-effort: logNarrativeFailure() below calls captureException internally
    // (single choke-point shared with buildStageResultNarrative's catch).
    logNarrativeFailure(err, { raceId: race?.id, stage: "race-result-narrative" });
    return null;
  }
}

/**
 * #3399 · Byg den narrative rubrik + pr.-manager ranks for ÉN mellem-etape
 * (ikke-final) af et etapeløb. Samme ærlige degradering som
 * buildRaceResultNarrative.
 *
 * @param {{supabase:object, race:{id:string, name?:string}, stageNumber:number}} args
 * @returns {Promise<{headlineText:string, ranksByUser:Map<string,number[]>}|null>}
 */
export async function buildStageResultNarrative({ supabase, race, stageNumber }) {
  if (!supabase?.from || !race?.id || !stageNumber) return null;
  try {
    // pagination-safe: race_id+stage_number-scoped — bounded af den enkelte
    // etapes feltstørrelse, verificeret max 117 rækker/etape prod-audit 1/9
    // (#4566), langt under PostgREST's 1.000-rækkers-loft.
    const { data: momentRows, error } = await supabase
      .from("race_stage_moments")
      .select("stage_number, moment_key, params, significance, rider_ids")
      .eq("race_id", race.id)
      .eq("stage_number", stageNumber);
    if (error) throw error;
    if (!momentRows?.length) return null;

    const headline = selectHeadlineMoment(momentRows);
    if (!headline) return null;

    const rows = await fetchRaceResultsSlice({ supabase, raceId: race.id, resultType: "stage", stageNumber });
    const { riderNameById, ranksByUser, riderIdsByUser } = summarizeRaceResultRows(rows);
    const riderName = (id) => (id ? riderNameById.get(id) || "the rider" : "the rider");
    const headlineText = buildHeadlineText(headline, { riderName, raceName: race.name ?? "your race" });
    if (!headlineText) return null;

    // #3493: se buildRaceResultNarrative's tilsvarende kommentar.
    return { headlineText, ranksByUser, riderIdsByUser, headlineRiderIds: headline.rider_ids || [] };
  } catch (err) {
    // best-effort: logNarrativeFailure() calls captureException internally (see
    // buildRaceResultNarrative's catch above).
    logNarrativeFailure(err, { raceId: race?.id, stageNumber, stage: "stage-result-narrative" });
    return null;
  }
}
