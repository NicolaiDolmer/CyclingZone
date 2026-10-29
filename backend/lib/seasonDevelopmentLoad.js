// Sæsonens belastning pr. rytter (#6499, Udvikling 2.0 del 1, D4).
//
// Tilbagegangen ved sæsonskiftet bremses af hvor meget rytteren har kørt og
// trænet hårdt i den AFSLUTTEDE sæson (riderProgression.agingBrake). Dette modul
// tæller de to tal; selve bremse-formlen bor i riderProgression.js.
//
//   løbsdage   = distinkte (race_id, stage_number) i race_results med
//                result_type = 'stage', for løb i sæsonen (races.season_id),
//                PLUS én løbsdag pr. endagsløb (races.race_type = 'single') fra
//                rytterens 'gc'-række. Endagsløb gemmer rytterens resultat som
//                'gc' (+ 'team'), aldrig 'stage' (ejer på #6499, 11/10).
//                En etape/et endagsløb tæller én gang pr. rytter.
//   hårde dage = rækker i rider_training_scores for sæsonen med
//                day_type = 'training', was_race_day = false og en session hvis
//                intensitet er 'hard' (trainingDayTypes.SESSION_INTENSITY),
//                deduplikeret pr. (rytter, game_day ?? tick_date).
//
// Kun SELECT. Bruges af riderProgressionEngine (sæsonskiftet, flag on) og af den
// read-only prøvekørsel backend/scripts/dev/agingV2DryRun6110.mjs.

import { fetchAllRows, fetchAllRowsKeyset } from "./supabasePagination.js";
// #5319: V3-tabellen er en overmaengde af dagens (samme vaerdier + de fem nye
// haarde sessioner), saa en gemt v3-session taeller med uanset flagets stadie.
// Med flaget off findes ingen saadanne raekker, saa resultatet er uaendret.
import { SESSION_INTENSITY_V3 as SESSION_INTENSITY } from "./trainingDayTypes.js";

// Sessionerne der tæller som en hård træningsdag. Udledt af SESSION_INTENSITY,
// så en ny hård session automatisk tæller med.
export const HARD_TRAINING_SESSIONS = Object.freeze(
  Object.entries(SESSION_INTENSITY).filter(([, intensity]) => intensity === "hard").map(([session]) => session),
);

// race_results er stor (~1 mio. rækker). Løbene hentes i små bidder, og hver bid
// pagineres med keyset, så ingen side betaler for de sider den springer over
// (supabasePagination.js #4010) og ingen .in()-liste nærmer sig URL-loftet (#3030).
export const RACE_ID_CHUNK = 20;

function isHardTrainingRow(row) {
  return row?.day_type === "training"
    && row.was_race_day === false
    && SESSION_INTENSITY[row.session] === "hard";
}

/**
 * Ren tælling fra rå rækker. Returnerer Map(rider_id → { raceDays, hardDays }).
 * stageRows:    [{ rider_id, race_id, stage_number }] (allerede filtreret til sæsonens etaper)
 * oneDayRows:   [{ rider_id, race_id }] (rytterens 'gc'-række i sæsonens endagsløb);
 *               ét endagsløb = én løbsdag, uanset stage_number og dubletter
 * trainingRows: [{ rider_id, day_type, was_race_day, session, game_day, tick_date }]
 * Rækker uden rider_id ignoreres; træningsrækker filtreres igen her, så en løsere
 * forespørgsel aldrig kan tælle en let dag eller en løbsdag med.
 */
export function computeSeasonLoad({ stageRows = [], oneDayRows = [], trainingRows = [] } = {}) {
  const raceKeys = new Map();
  const addRaceDay = (riderId, key) => {
    let set = raceKeys.get(riderId);
    if (!set) { set = new Set(); raceKeys.set(riderId, set); }
    set.add(key);
  };
  for (const r of stageRows) {
    if (r?.rider_id == null || r.race_id == null) continue;
    addRaceDay(r.rider_id, `${r.race_id}:${r.stage_number ?? 1}`);
  }
  for (const r of oneDayRows) {
    if (r?.rider_id == null || r.race_id == null) continue;
    addRaceDay(r.rider_id, `${r.race_id}:1`);
  }

  const hardKeys = new Map();
  for (const t of trainingRows) {
    if (t?.rider_id == null || !isHardTrainingRow(t)) continue;
    const dayKey = t.game_day != null ? `g:${t.game_day}` : `d:${t.tick_date}`;
    let set = hardKeys.get(t.rider_id);
    if (!set) { set = new Set(); hardKeys.set(t.rider_id, set); }
    set.add(dayKey);
  }

  const out = new Map();
  for (const id of new Set([...raceKeys.keys(), ...hardKeys.keys()])) {
    out.set(id, { raceDays: raceKeys.get(id)?.size ?? 0, hardDays: hardKeys.get(id)?.size ?? 0 });
  }
  return out;
}

/** Sæsonens id ud fra nummeret. Kaster hvis sæsonen ikke findes. */
export async function resolveSeasonIdByNumber(supabase, seasonNumber) {
  const { data, error } = await supabase
    .from("seasons").select("id").eq("number", seasonNumber).maybeSingle();
  if (error) throw new Error(`seasons (number=${seasonNumber}): ${error.message}`);
  if (!data?.id) throw new Error(`season-load: season ${seasonNumber} not found`);
  return data.id;
}

/**
 * Hent og tæl belastningen for sæsonen `seasonId` (eller `seasonNumber`).
 * Kaster ved enhver læsefejl: en manglende belastning ville give alle fuldt fald,
 * og det må aldrig ske tavst. Sæsonskiftet fanger fejlen og kan køres igen.
 */
export async function loadSeasonDevelopmentLoad({ supabase, seasonId = null, seasonNumber = null }) {
  if (!supabase?.from) throw new Error("Supabase client required");
  const sid = seasonId ?? await resolveSeasonIdByNumber(supabase, seasonNumber);

  const races = await fetchAllRows(() => supabase
    .from("races").select("id, race_type").eq("season_id", sid).order("id"));
  const raceIds = races.map((r) => r.id);
  const singleRaceIds = races.filter((r) => r.race_type === "single").map((r) => r.id);

  async function resultRows(ids, resultType) {
    const out = [];
    for (let i = 0; i < ids.length; i += RACE_ID_CHUNK) {
      const chunk = ids.slice(i, i + RACE_ID_CHUNK);
      const rows = await fetchAllRowsKeyset((after) => {
        let q = supabase
          .from("race_results")
          .select("id, rider_id, race_id, stage_number")
          .in("race_id", chunk)
          .eq("result_type", resultType)
          .order("id", { ascending: true });
        if (after != null) q = q.gt("id", after);
        return q;
      });
      out.push(...rows);
    }
    return out;
  }

  const stageRows = await resultRows(raceIds, "stage");
  // Endagsløb har ingen 'stage'-rækker; rytterens 'gc'-række er hans løbsdag.
  const oneDayRows = await resultRows(singleRaceIds, "gc");

  const trainingRows = await fetchAllRowsKeyset((after) => {
    let q = supabase
      .from("rider_training_scores")
      .select("id, rider_id, day_type, was_race_day, session, game_day, tick_date")
      .eq("season_id", sid)
      .eq("day_type", "training")
      .eq("was_race_day", false)
      .in("session", HARD_TRAINING_SESSIONS)
      .order("id", { ascending: true });
    if (after != null) q = q.gt("id", after);
    return q;
  });

  // Kontroltal til prøvekørslen: at endagsløb faktisk tæller med (#6499).
  const oneDayRiderDays = new Set(
    oneDayRows.filter((r) => r?.rider_id != null && r.race_id != null).map((r) => `${r.rider_id}:${r.race_id}`),
  ).size;

  return {
    seasonId: sid,
    raceCount: raceIds.length,
    singleRaceCount: singleRaceIds.length,
    oneDayRiderDays,
    byRider: computeSeasonLoad({ stageRows, oneDayRows, trainingRows }),
  };
}
