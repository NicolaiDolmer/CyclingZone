function ensureSupabase(supabase) {
  if (!supabase?.from) {
    throw new Error("Supabase client is required");
  }
}

function ensureRace(race) {
  if (!race?.id || !race?.season_id) {
    throw new Error("Race context is required");
  }
}

// Single source of truth: economyConstants.js. Imported here for internal use AND re-exported
// so the many existing import-paths (adminImportResultsHandler, pcmResultsImport,
// raceResultsSheetSync, tests) keep one stable home without touching them.
import { PRIZE_PER_POINT } from "./economyConstants.js";
export { PRIZE_PER_POINT };
import { fetchAllRows } from "./supabasePagination.js";
import { applyRaceResultsBatchAtomic as applyRaceResultsBatchAtomicDefault } from "./stageResultRpc.js";
import { assertValidEntrantRows } from "./raceResultEntrantKey.js";
import { captureException } from "./sentry.js";

const RESULT_TYPE_TO_RACE_POINTS = {
  stage_race: {
    stage: "Etapeplacering",
    gc: "Klassement",
    points: "Pointtroje",
    mountain: "Bjergtroje",
    young: "Ungdomstroje",
    team: "EtapelobHold",
    leader: "Forertroje",
    mountain_day: "BjergtrojeDag",
    points_day: "PointtrojeDag",
    young_day: "UngdomstrojeDag",
  },
  // #3718 forward-guard: et endagsløb har ingen point-, bjerg- eller ungdomstrøje — hverken
  // her eller i virkeligheden (ejer-beslutning 14/8). Motoren har aldrig emittet de rækker for
  // `single` (målt sæson 2: kun `gc` og `team`, nul trøje-rækker), så mappingen var ubrugt —
  // men den var en åben dør: begyndte simulatoren at emitte `points`/`mountain`/`young` for et
  // endagsløb, blev de betalt uden en beslutning. Nu falder de på gulvet i stedet.
  // Rækkerne i race_points bevares: etapeløbs-grenen ovenfor bruger dem og udbetaler dem fuldt.
  single: {
    gc: "Klassiker",
    team: "KlassikerHold",
  },
};

export function buildRacePointsLookup({ racePoints = [], raceType = "stage_race" } = {}) {
  const typeMap = RESULT_TYPE_TO_RACE_POINTS[raceType] ?? RESULT_TYPE_TO_RACE_POINTS.stage_race;
  const lookup = {};
  for (const [enType, dkType] of Object.entries(typeMap)) {
    for (const row of racePoints || []) {
      if (row.result_type === dkType) {
        lookup[`${enType}__${row.rank}`] = row.points || 0;
      }
    }
  }
  return lookup;
}

export function buildRaceResultsFromPending({ pendingRows = [], pointsLookup = {}, raceId } = {}) {
  return (pendingRows || []).map((row) => {
    const pts = pointsLookup[`${row.result_type}__${row.rank}`] || 0;
    const teamId = row.rider?.team_id || null;
    const riderName = row.rider ? `${row.rider.firstname} ${row.rider.lastname}` : null;
    // #1993: snapshot holdnavnet på løbstidspunktet, så attributionen overlever
    // holdsletning/omdøbning (team_id-FK er ON DELETE SET NULL). Læses fra det
    // joinede team (rider:rider_id(..., team:team_id(name))); null hvis ingen join.
    const teamName = row.rider?.team?.name ?? null;

    return {
      race_id: raceId,
      rider_id: row.rider_id,
      rider_name: riderName,
      team_id: teamId,
      team_name: teamName,
      result_type: row.result_type,
      rank: row.rank,
      stage_number: row.stage_number || 1,
      finish_time: null,
      points_earned: pts,
      prize_money: pts * PRIZE_PER_POINT,
    };
  });
}

export async function applyRaceResults({
  supabase,
  race,
  resultRows = [],
  // #3022: array af de etape-numre denne skrivning dækker. Sat → delete+insert
  // køres ATOMISK via apply_race_results_batch-RPC'en (i stedet for kaldets
  // eget separate .delete() + dette kalds .insert() som to HTTP-round-trips) —
  // lukker fejlmode B (crash mellem delete og insert efterlader løbet
  // resultatløst). Uændret adfærd (ren .insert(), ingen forudgående delete) når
  // IKKE sat — bruges af /admin/approve-results, der aldrig har en eksisterende
  // race_results-mængde at erstatte for det løb.
  stageNumbers = null,
  ensureSeasonStandings = async () => {},
  updateStandings = async () => {},
  applyRaceResultsBatch = applyRaceResultsBatchAtomicDefault,
} = {}) {
  ensureSupabase(supabase);
  ensureRace(race);

  if (!resultRows.length) {
    throw new Error("No rows found");
  }

  const normalizedRows = resultRows.map((row) => ({
    race_id: race.id,
    rider_id: row.rider_id || null,
    rider_name: row.rider_name || null,
    team_id: row.team_id || null,
    team_name: row.team_name || null,
    result_type: row.result_type,
    rank: row.rank,
    stage_number: row.stage_number || 1,
    finish_time: row.finish_time || null,
    prize_money: Number(row.prize_money) || 0,
    points_earned: row.points_earned ?? 0,
    // #1499: deskriptive udbruds-etiketter (false for importerede/PCM-rækker uden flag).
    in_breakaway: row.in_breakaway === true,
    breakaway_caught: row.breakaway_caught === true,
    // Sub-2 (#2770): passage-lag-aggregater — bevidst INGEN coalesce til 0 (NULL =
    // legacy/ingen rutedata eller PCM-import, samme semantik som apply_stage_result-RPC'en).
    sprint_points: row.sprint_points ?? null,
    kom_points: row.kom_points ?? null,
    bonus_seconds: row.bonus_seconds ?? null,
  }));

  // Forward-guard (#3022): afvis rækker uden gyldig deltager-identitet eller en
  // intern batch-kollision FØR databasen rammes — matcher race_results_entrant_unique.
  assertValidEntrantRows(normalizedRows);

  let rowsInserted;
  if (Array.isArray(stageNumbers) && stageNumbers.length) {
    const { rowsInserted: inserted } = await applyRaceResultsBatch(supabase, {
      raceId: race.id,
      stageNumbers,
      resultRows: normalizedRows,
    });
    rowsInserted = inserted;
  } else {
    const { error: insertError } = await supabase.from("race_results").insert(normalizedRows);
    if (insertError) throw new Error(insertError.message);
    rowsInserted = normalizedRows.length;
  }

  // #2877: samme kobling som simulateStageByIndex (raceRunner.js) blev ramt af —
  // resultaterne ER skrevet på dette tidspunkt, men simulateRace's berigelses-
  // skrivning (persistRuns/persistPassages/persistIncidents/persistStageMoments)
  // kører FØRST efter denne funktion returnerer. Kastede standings-recompute'en
  // uhåndteret (fx statement timeout under samtidige afviklinger), væltede det
  // hele opkaldet og berigelsen blev aldrig skrevet — selvom resultaterne stod.
  // updateStandings er en fuld re-derivation fra race_results — inhærent
  // idempotent og self-healing (næste recompute retter den); berigelsen er det
  // ikke. Fanget + Sentry-capturet (synligt, ikke tavst skjult) i stedet for at
  // lade en recompute-fejl gøre allerede-skrevne resultater' berigelse gidsel.
  try {
    await ensureSeasonStandings(race.season_id);
    await updateStandings(race.season_id, race.id);
  } catch (err) {
    console.error(`  ⚠️  standings recompute failed after race ${race.id} results write — enrichment continues, standings will self-heal on next recompute: ${err.message}`);
    captureException(err, { tags: { flow: "race-results", stage: "standings-recompute" }, raceId: race.id });
  }

  return {
    rowsImported: rowsInserted,
  };
}

// #993-followup — Re-derivér points_earned + prize_money på eksisterende
// race_results ud fra den AKTUELLE race_points-config, og genberegn standings.
//
// Baggrund: points_earned/prize_money fryses ind i race_results ved import
// (buildRaceResultsFromPending). Når admin senere ændrer race_points slår det
// derfor ikke igennem på ranglisten — kun config-visningen opdateres. Denne
// funktion lukker afkoblingen: den re-mapper hver eksisterende resultatrække via
// dens gemte (result_type, rank) gennem en frisk buildRacePointsLookup.
//
// Pengeregel: løb med prize_paid_at != null springes HELT over (hverken point
// eller prize_money røres), så de udbetalte beløb fortsat matcher de allerede
// bogførte finance_transactions (reconciliation i prizePayoutEngine holder).
export async function rederiveSeasonRacePoints({
  supabase,
  seasonId,
  updateStandings,
  updateRiderValues,
} = {}) {
  ensureSupabase(supabase);
  if (!seasonId) throw new Error("seasonId is required");
  if (typeof updateStandings !== "function") {
    throw new Error("updateStandings is required");
  }

  const { data: races, error: racesError } = await supabase
    .from("races")
    .select("id, race_class, race_type, prize_paid_at")
    .eq("season_id", seasonId);
  if (racesError) throw new Error(racesError.message);

  let racesProcessed = 0;
  let racesSkippedPaid = 0;
  let racesSkippedNoClass = 0;
  let rowsUpdated = 0;

  // race_points deles ofte af flere løb (samme race_class) → cache pr. klasse.
  const pointsByClass = new Map();

  for (const race of races || []) {
    if (race.prize_paid_at) { racesSkippedPaid++; continue; }
    if (!race.race_class) { racesSkippedNoClass++; continue; }

    if (!pointsByClass.has(race.race_class)) {
      const { data: pts, error: ptsError } = await supabase
        .from("race_points")
        .select("result_type, rank, points")
        .eq("race_class", race.race_class);
      if (ptsError) throw new Error(ptsError.message);
      pointsByClass.set(race.race_class, pts || []);
    }

    const lookup = buildRacePointsLookup({
      racePoints: pointsByClass.get(race.race_class),
      raceType: race.race_type,
    });

    const results = await fetchAllRows(() => (
      supabase
        .from("race_results")
        .select("id, result_type, rank, points_earned, prize_money")
        .eq("race_id", race.id)
        .order("id", { ascending: true })
    ));

    for (const row of results || []) {
      const pts = lookup[`${row.result_type}__${row.rank}`] || 0;
      const prize = pts * PRIZE_PER_POINT;
      // Skip rækker der allerede matcher → undgå unødige writes.
      if (row.points_earned === pts && row.prize_money === prize) continue;

      const { error: updError } = await supabase
        .from("race_results")
        .update({ points_earned: pts, prize_money: prize })
        .eq("id", row.id);
      if (updError) throw new Error(updError.message);
      rowsUpdated++;
    }

    racesProcessed++;
  }

  await updateStandings(seasonId);

  // Re-deriving prize_money decouples race_results from rider value unless we
  // also refresh prize_earnings_bonus → market_value. updateStandings only
  // re-sums points; without this, admin point edits never reach rider values
  // (the values still reflect the config from the last payout/season-end).
  // Injected so the engine stays import-light + unit-testable; the endpoint
  // wires economyEngine.updateRiderValues in. Skips if not provided.
  let ridersUpdated = null;
  if (typeof updateRiderValues === "function") {
    ({ ridersUpdated } = (await updateRiderValues(supabase)) || {});
  }

  return { racesProcessed, racesSkippedPaid, racesSkippedNoClass, rowsUpdated, ridersUpdated };
}
