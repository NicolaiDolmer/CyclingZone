// #7879 (del af #7824) · Talentmærker ved rytternavne: Toptalent og Næste generation.
//
// Reglerne (ejer 7/11, spillerteksten gjort kort 8/11):
//   · Toptalent / Top Talent: de højest ratede ryttere (best_role_rating) inden for
//     hver ryttertype (primary_type), kun ryttere under 23 efter sæsonår. Mindst
//     én pr. type.
//   · Næste generation / Next Gen: mest reel fremgang i evnebjælkerne blandt
//     juniorer over et nyligt vindue, hvor den nyeste del vejer tungere.
//   · Ét mærke pr. rytter. Har en rytter Toptalent, kan han ikke få Næste
//     generation, og pladsen går videre til den næste i rækken.
//   · Alle ryttere tæller: managerhold, AI-hold og frie ryttere vurderes ens.
//   · Opdateres dagligt.
//
// Andele, vinduer og vægte er private (hard rule 17): de ligger i private_config
// under nøglen talent_marks_params (privateConfig.ts, validering i
// talentMarksParams.js). Mangler rækken eller er den ugyldig, beregnes der ingen
// mærker (slukket adfærd). Spillerteksten nævner ingen tal.
//
// Måles ALDRIG på potentiale eller skjult talent. Kilderne er rating og de synlige
// evner, som alle indloggede managere allerede kan læse (rider_derived_abilities'
// kolonne-grants). Kun visning: motor, værdi, bestyrelse og økonomi læser ikke
// mærket.
//
// Filen har to dele: den rene beregning (computeTalentMarks) og den daglige
// kørsel (runTalentMarksDailyTick), som henter data, kalder beregningen og
// skriver rider_talent_marks (database/2026-11-07-7879-talent-marks.sql).

import { ageForSeason, LAUNCH_REFERENCE_YEAR } from "./riderSeasonAge.js";
import { readFlagStage, evaluateFlagStage } from "./featureStage.js";
import { copenhagenDateString } from "./copenhagenTime.js";
import { fetchAllRows } from "./supabasePagination.js";
import { captureException } from "./sentry.js";
import { readPrivateConfigEntry } from "./privateConfig.ts";
import { validateTalentMarksParams } from "./talentMarksParams.js";

export const TALENT_MARKS_FLAG_KEY = "talent_marks_7879";
export const TALENT_MARKS_PARAMS_KEY = "talent_marks_params";

export const TALENT_MARK = Object.freeze({ TOP_TALENT: "top_talent", NEXT_GEN: "next_gen" });

// Aldersbåndene er definitioner, ikke balance: "under 23" og "junior" er det
// spillerne selv læser i teksten.
export const TOP_TALENT_MAX_AGE = 22; // "under 23"
export const JUNIOR_MIN_AGE = 16;
export const JUNIOR_MAX_AGE = 18;

// PostgREST giver højst 1000 rækker pr. svar; funktionen svarer med én række pr.
// rytter, så en blok på 500 ryttere holder sig altid under loftet.
const GAINS_RIDER_CHUNK = 500;

/**
 * Hvor mange mærker en gruppe på `n` ryttere får. Afrundet til nærmeste hele,
 * så tallet følger årgangene, og aldrig under `min` når gruppen ikke er tom.
 */
export function quotaFor(n, share, min = 0) {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, Math.max(min, Math.round(n * share)));
}

/** "YYYY-MM-DD" flyttet `days` dage. UTC-middag, så sommertid aldrig flytter datoen. */
export function shiftDate(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Første dato i de to vinduer, begge inklusive dagens dato. */
export function progressWindows(today, { windowDays, recentDays }) {
  return {
    windowStart: shiftDate(today, -(windowDays - 1)),
    recentStart: shiftDate(today, -(recentDays - 1)),
  };
}

/**
 * Fremgangen i vinduet med det nyeste delvindue vægtet ekstra (det indgår i begge
 * summer, så vægten kommer oveni).
 */
export function progressScore(gain, { recentWeight }) {
  const window = Number(gain?.gain_window) || 0;
  const recent = Number(gain?.gain_recent) || 0;
  return window + recentWeight * recent;
}

function byId(a, b) {
  return String(a.id).localeCompare(String(b.id));
}

/**
 * Den rene beregning. Ingen I/O.
 *
 * @param {object} input
 * @param {Array<{ id: string, birthdate: string|null, primary_type: string|null,
 *   best_role_rating: number|null, is_retired?: boolean|null }>} input.riders
 * @param {Array<{ rider_id: string, gain_window: number, gain_recent: number }>} input.juniorGains
 * @param {number} input.seasonNumber
 * @param {{ topTalentShare: number, nextGenShare: number, recentWeight: number }} input.params
 *   De private params (validateTalentMarksParams). Uden gyldige params gives ingen mærker.
 * @returns {Array<{ rider_id: string, mark: string, rider_type: string|null }>}
 *   Højst én række pr. rytter.
 */
export function computeTalentMarks({ riders = [], juniorGains = [], seasonNumber, params }) {
  if (!validateTalentMarksParams(params)) return [];
  const active = [];
  for (const rider of riders) {
    if (!rider?.id || rider.is_retired === true) continue;
    const age = ageForSeason(rider.birthdate, seasonNumber);
    if (age === null) continue;
    active.push({ ...rider, age });
  }

  // ── Toptalent: inden for hver ryttertype, under 23 ─────────────────────────
  const byType = new Map();
  for (const rider of active) {
    if (rider.age > TOP_TALENT_MAX_AGE) continue;
    if (!rider.primary_type || !Number.isFinite(rider.best_role_rating)) continue;
    if (!byType.has(rider.primary_type)) byType.set(rider.primary_type, []);
    byType.get(rider.primary_type).push(rider);
  }
  const marks = [];
  const marked = new Set();
  for (const type of [...byType.keys()].sort()) {
    const group = byType.get(type);
    // Lige rating: den yngste står først (samme niveau i en yngre alder), så id,
    // så rækkefølgen aldrig afhænger af databasens svar.
    group.sort((a, b) => b.best_role_rating - a.best_role_rating || a.age - b.age || byId(a, b));
    const quota = quotaFor(group.length, params.topTalentShare, 1);
    for (const rider of group.slice(0, quota)) {
      marks.push({ rider_id: rider.id, mark: TALENT_MARK.TOP_TALENT, rider_type: type });
      marked.add(rider.id);
    }
  }

  // ── Næste generation: juniorer med mest fremgang ───────────────────────────
  const juniors = active.filter((r) => r.age >= JUNIOR_MIN_AGE && r.age <= JUNIOR_MAX_AGE);
  const gainByRider = new Map(juniorGains.map((g) => [g.rider_id, g]));
  // Pladserne regnes af alle juniorer, også dem med Toptalent: deres plads går
  // videre til den næste i rækken i stedet for at forsvinde.
  const quota = quotaFor(juniors.length, params.nextGenShare, 1);
  const ranked = juniors
    .map((r) => {
      const gain = gainByRider.get(r.id);
      return { ...r, score: progressScore(gain, params), recent: Number(gain?.gain_recent) || 0 };
    })
    // Kun reel fremgang: en junior uden fremgang i vinduet får aldrig mærket.
    .filter((r) => r.score > 0)
    // Lige fremgang: mest i den seneste uge, så den yngste, så id.
    .sort((a, b) => b.score - a.score || b.recent - a.recent || a.age - b.age || byId(a, b));
  let given = 0;
  for (const rider of ranked) {
    if (given >= quota) break;
    if (marked.has(rider.id)) continue;
    marks.push({ rider_id: rider.id, mark: TALENT_MARK.NEXT_GEN, rider_type: null });
    marked.add(rider.id);
    given += 1;
  }
  return marks;
}

// ── Den daglige kørsel ────────────────────────────────────────────────────────

async function loadActiveSeasonNumber(supabase) {
  const { data, error } = await supabase
    .from("seasons").select("number").eq("status", "active")
    .order("number", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`seasons: ${error.message}`);
  return Number.isFinite(data?.number) ? data.number : null;
}

// Den ældste række, ikke den nyeste: dagen er først færdig, når gårsdagens rækker
// også er fjernet. Fejler oprydningen efter dagens skrivning, prøver næste time igen.
async function loadOldestComputedOn(supabase) {
  // schema-columns-ok: rider_talent_marks kommer fra 2026-11-07-7879-talent-marks.sql
  const { data, error } = await supabase
    .from("rider_talent_marks").select("computed_on")
    .order("computed_on", { ascending: true }).limit(1);
  if (error) throw new Error(`rider_talent_marks: ${error.message}`);
  return data?.[0]?.computed_on ?? null;
}

async function loadJuniorGains(supabase, riderIds, { windowStart, recentStart }) {
  const out = [];
  for (let i = 0; i < riderIds.length; i += GAINS_RIDER_CHUNK) {
    const { data, error } = await supabase.rpc("talent_marks_junior_gains", {
      p_rider_ids: riderIds.slice(i, i + GAINS_RIDER_CHUNK),
      p_window_start: windowStart,
      p_recent_start: recentStart,
    });
    if (error) throw new Error(`talent_marks_junior_gains: ${error.message}`);
    out.push(...(data || []));
  }
  return out;
}

/**
 * Beregn og skriv dagens mærker. Kører højst én gang pr. dansk kalenderdag og kun
 * når kontakten ikke er off.
 *
 * @returns {Promise<{ ran: boolean, skipped?: string, topTalent?: number, nextGen?: number }>}
 */
export async function runTalentMarksDaily({ supabase, now = new Date(), log = console }) {
  const stage = await readFlagStage(supabase, TALENT_MARKS_FLAG_KEY);
  if (!evaluateFlagStage(stage, { engineWrite: true })) return { ran: false, skipped: "flag_off" };

  const today = copenhagenDateString(now);
  if ((await loadOldestComputedOn(supabase)) === today) return { ran: false, skipped: "already_today" };

  // Uden gyldige private params er adfærden slukket: ingen beregning, ingen skrivning.
  // Advarslen nævner aldrig værdierne.
  const entry = await readPrivateConfigEntry(supabase, TALENT_MARKS_PARAMS_KEY, { strict: false, log });
  if (entry.status !== "ok" || !entry.value) {
    log?.warn?.(`[talent-marks] ${TALENT_MARKS_FLAG_KEY} is on, but ${TALENT_MARKS_PARAMS_KEY} is missing, invalid or unreadable - no marks computed`);
    return { ran: false, skipped: "no_params" };
  }
  const params = entry.value;

  const seasonNumber = await loadActiveSeasonNumber(supabase);
  if (seasonNumber === null) return { ran: false, skipped: "no_active_season" };

  // Kun ryttere der kan være under 23 i sæsonen hentes. Grænsen er grov (hele
  // fødselsåret); den præcise alder afgøres af ageForSeason i beregningen.
  const seasonYear = LAUNCH_REFERENCE_YEAR + seasonNumber - 1;
  const oldestBirthdate = `${seasonYear - TOP_TALENT_MAX_AGE}-01-01`;
  const riders = await fetchAllRows(() => supabase
    .from("riders")
    .select("id, birthdate, primary_type, best_role_rating, is_retired")
    .gte("birthdate", oldestBirthdate)
    .order("id"));

  const juniorIds = riders
    .filter((r) => {
      const age = ageForSeason(r.birthdate, seasonNumber);
      return r.is_retired !== true && age !== null && age >= JUNIOR_MIN_AGE && age <= JUNIOR_MAX_AGE;
    })
    .map((r) => r.id);
  const juniorGains = await loadJuniorGains(supabase, juniorIds, progressWindows(today, params));

  const marks = computeTalentMarks({ riders, juniorGains, seasonNumber, params });
  const rows = marks.map((m) => ({ ...m, season_number: seasonNumber, computed_on: today }));

  // Først dagens mærker (én række pr. rytter, så en rytter der beholder sit mærke
  // bare får datoen fornyet), så fjernes de mærker, der ikke er givet i dag.
  if (rows.length > 0) {
    // schema-columns-ok: rider_talent_marks kommer fra 2026-11-07-7879-talent-marks.sql
    const { error } = await supabase.from("rider_talent_marks").upsert(rows, { onConflict: "rider_id" });
    if (error) throw new Error(`rider_talent_marks upsert: ${error.message}`);
  }
  const { error: delError } = await supabase.from("rider_talent_marks").delete().lt("computed_on", today);
  if (delError) throw new Error(`rider_talent_marks cleanup: ${delError.message}`);

  return {
    ran: true,
    topTalent: marks.filter((m) => m.mark === TALENT_MARK.TOP_TALENT).length,
    nextGen: marks.filter((m) => m.mark === TALENT_MARK.NEXT_GEN).length,
  };
}

/** Cron-indgangen: kørsel + log. En fejl når Sentry; næste time prøver igen. */
export async function runTalentMarksDailyTick({ supabase, now = new Date() }) {
  try {
    const result = await runTalentMarksDaily({ supabase, now });
    if (result.ran) console.log(`Talent marks: ${result.topTalent} top talent, ${result.nextGen} next gen`);
    return result;
  } catch (err) {
    console.error("  talent marks failed:", err.message);
    captureException(err, { tags: { cron: "talent-marks-daily" } });
    return { ran: false, skipped: "error" };
  }
}
