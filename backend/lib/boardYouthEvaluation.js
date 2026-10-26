// #7096 · Ungdomsresultater i bestyrelsens vurdering af ungdomsarbejdet.
//
// Ejer 23/10: U23- og juniorresultater tæller i bestyrelsens vurdering af
// UNGDOMSARBEJDET, men ALDRIG i seniormålene. Seniormålene (stage_wins,
// placering osv.) læser fortsat kun seniorløb (boardGoalContext.js'
// onlySeniorRaceRows, #5537) — intet i denne fil rører den sti, mål-
// evalueringen eller tilliden (board_relations.confidence).
//
// Design-go 24/10 (PR #7101, mulighed A), kvalitativt:
//  - Ét nik pr. ungdomsløb med podie (etape eller samlet), uanset hvor mange
//    etaper/podier holdet tog i det.
//  - Et større plus, når holdet vandt løbet: en etapesejr, en samlet sejr eller
//    slut-trøjen. Ellers tæller podiet normalt.
//  - Et loft for ungdomsandelen i stemningsvinduet, så ungdomsresultater ikke
//    alene fylder vinduet og skjuler medlemmets egne mål-bevægelser.
//  - Kun indeværende sæson, kun ungdomsfokuserede medlemmer (policy-aksen
//    youth_focus = "high"), fravær trækker aldrig ned, samme regel i alle
//    divisioner.
//
// Offentlighedspolitik (AGENTS.md regel 17): selve vægtene og loftet står IKKE i
// koden. De læses fra en privat runtime-kilde (miljøvariablen i YOUTH_TUNING_ENV,
// leveret fra Infisical) og er fail-closed: mangler eller er kilden ugyldig,
// slås ungdomsinputtet helt fra (ingen læsning, ingen events) i stedet for at
// falde tilbage på et tal i koden. Tests bruger syntetiske tal.

import { getArchetypeByKey } from "./boardArchetypes.js";
import { captureException } from "./sentry.js";
import { SQUADS, isYouthSquad } from "./squads.js";
import { fetchAllRows } from "./supabasePagination.js";

// Navnet på den private kilde (JSON). Værdien må aldrig logges eller committes.
export const YOUTH_TUNING_ENV = "BOARD_YOUTH_MOOD_TUNING";
// Kilde-markør på ungdoms-events i stemningspuljen (bruges af loftet).
export const YOUTH_RESULT_SOURCE = "youth_result";

// Resultat-typer der tæller: etaperesultater og det samlede resultat. "gc" på et
// endagsløb er selve løbsresultatet (samme skel som boardGoalContext.js/
// riderPalmares.js), så sejre, podier og samlede placeringer dækkes af de to.
export const YOUTH_RESULT_TYPES = Object.freeze(["stage", "gc"]);
// Slut-trøjerne (points/mountain/young): kun selve sejren (rank 1) tæller, og
// den giver sejrsvægten. Plads 2-3 i en trøjeklassifikation er ikke et podie.
export const YOUTH_JERSEY_TYPES = Object.freeze(["points", "mountain", "young"]);
// Podiet: definitionen, ikke et balance-tal.
export const YOUTH_PODIUM_MAX_RANK = 3;
// Ungdomstrupperne (squads.js er SSOT for trup-værdierne).
const YOUTH_RACE_SQUADS = Object.freeze(SQUADS.filter((squad) => isYouthSquad(squad)));

let invalidTuningReported = false;

/**
 * Validerer den private tuning-kilde. Returnerer `{ podiumWeight, winWeight,
 * windowCap }` eller null (fail-closed) ved manglende/ugyldig kilde. En
 * ugyldig-men-tilstede kilde rapporteres én gang pr. proces, uden værdien.
 */
export function parseYouthMoodTuning(raw) {
  if (raw == null || String(raw).trim() === "") return null;
  let parsed;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    // best-effort: ugyldig JSON fejler valid-checken herunder, som rapporterer én gang.
    parsed = null;
  }
  const podiumWeight = Number(parsed?.podiumWeight);
  const winWeight = Number(parsed?.winWeight);
  const windowCap = Number(parsed?.windowCap);
  const valid = Number.isFinite(podiumWeight) && podiumWeight > 0
    && Number.isFinite(winWeight) && winWeight >= podiumWeight
    && Number.isInteger(windowCap) && windowCap >= 1;
  if (!valid) {
    if (!invalidTuningReported) {
      invalidTuningReported = true;
      captureException(new Error(`${YOUTH_TUNING_ENV} is present but invalid; youth mood input is off`));
    }
    return null;
  }
  return { podiumWeight, winWeight, windowCap };
}

/** Læser den private kilde fra miljøet (fail-closed, se `parseYouthMoodTuning`). */
export function readYouthMoodTuning(env = process.env) {
  return parseYouthMoodTuning(env?.[YOUTH_TUNING_ENV]);
}

/** Har arketypen ungdomsfokus som grundholdning (policy-aksen youth_focus)? */
export function isYouthFocusedArchetype(archetypeKey) {
  return getArchetypeByKey(archetypeKey)?.policy_axes?.youth_focus === "high";
}

/**
 * Rene stemnings-input fra holdets ungdomsresultater.
 *
 * `rows` er race_results-rækker (`race_id`, `result_type`, `rank`,
 * `imported_at`, indlejret `races: { squad }`). Kun rækker fra et ungdomsløb
 * (races.squad u23/junior) med et podie (rank 1-3) på etapen eller samlet
 * eller en slut-trøje (rank 1) tæller. Seniorrækker og rækker uden kendt trup ignoreres altid, så en
 * seniorsejr aldrig dobbelttælles her.
 *
 * Returnerer ét event pr. (løb, ungdomsfokuseret medlem), dateret ved løbets
 * seneste tællende resultat, nyeste først. Et løb med mindst én sejr (rank 1 på
 * en etape, samlet eller en slut-trøje) får sejrsvægten, ellers podievægten. Uden gyldig
 * `tuning` (fail-closed), uden ungdomsfokuserede medlemmer eller uden tællende
 * rækker → tom liste.
 */
export function deriveYouthResultMoodEvents({ rows = [], assignedMembers = [], tuning = null } = {}) {
  if (!tuning) return [];
  const youthMemberKeys = [...new Set((assignedMembers || [])
    .map((m) => m?.archetype_key)
    .filter((key) => key && isYouthFocusedArchetype(key)))];
  if (!youthMemberKeys.length) return [];

  const byRace = new Map();
  for (const row of rows || []) {
    if (!row?.race_id) continue;
    if (!isYouthSquad(row?.races?.squad)) continue;
    const isJersey = YOUTH_JERSEY_TYPES.includes(row.result_type);
    if (!isJersey && !YOUTH_RESULT_TYPES.includes(row.result_type)) continue;
    const rank = Number(row.rank);
    if (!Number.isInteger(rank) || rank < 1 || rank > YOUTH_PODIUM_MAX_RANK) continue;
    if (isJersey && rank !== 1) continue;
    const at = row.imported_at ?? null;
    const atMs = at ? new Date(at).getTime() : NaN;
    if (!Number.isFinite(atMs)) continue;
    const previous = byRace.get(row.race_id);
    const won = rank === 1 || previous?.won === true;
    if (!previous || atMs > previous.atMs) byRace.set(row.race_id, { at, atMs, won });
    else if (won && !previous.won) previous.won = true;
  }

  const events = [];
  for (const [raceId, { at, atMs, won }] of byRace) {
    for (const ownerArchetypeKey of youthMemberKeys) {
      events.push({
        ownerArchetypeKey,
        satisfaction_delta: won ? tuning.winWeight : tuning.podiumWeight,
        created_at: at,
        source: YOUTH_RESULT_SOURCE,
        raceId,
        _atMs: atMs,
      });
    }
  }
  return events
    .sort((a, b) => b._atMs - a._atMs || String(a.raceId).localeCompare(String(b.raceId)))
    .map(({ _atMs, ...event }) => event);
}

/**
 * Læser holdets ungdomsresultater (podier på etaper og samlet, slut-trøjer) i én sæson.
 * Kun ungdomsløb (indlejret races.squad), kun den givne sæson. Kaster ved en
 * fejlet læsning; kalderen afgør om det er best-effort.
 */
export async function loadYouthRaceResultsForBoard({ supabase, teamId, seasonId } = {}) {
  if (!supabase?.from || !teamId || !seasonId) return [];
  try {
    // Pagineret (PostgREST-loftet, #3331): et hold med et fuldt ungdomsprogram
    // kan nærme sig loftet over en hel sæson. Stabil rækkefølge på id.
    return await fetchAllRows(() => supabase.from("race_results")
      .select("id, race_id, result_type, rank, imported_at, races!inner(squad, season_id)")
      .eq("team_id", teamId)
      .in("result_type", [...YOUTH_RESULT_TYPES, ...YOUTH_JERSEY_TYPES])
      .lte("rank", YOUTH_PODIUM_MAX_RANK)
      .eq("races.season_id", seasonId)
      .in("races.squad", [...YOUTH_RACE_SQUADS])
      .order("id", { ascending: true }));
  } catch (err) {
    throw new Error(`race_results (youth) lookup failed: ${err?.message ?? err}`, { cause: err });
  }
}
