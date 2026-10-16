// #3459 V3 — PRE-hoc "har rytteren løbsdag I DAG" lookup til trænings-UI'ets badge
// (frontend TrainingPage.jsx). Adskilt fra dailyTrainingEngine.js's
// loadRacedRiderIdsToday, som er POST-hoc (race_results.imported_at, læses EFTER
// løbet er kørt af motoren selv). Denne lookup viser badge'et FØR løbet afvikles:
// race_entries (holdets startfelt) JOIN race_stage_schedule (dagens etaper,
// scheduled_at i dagens danske kalenderdøgn) JOIN races (navn).
//
// Kun kaldt af GET /api/training/me når race_day_development_enabled er on
// (kald-stedet gater query'en helt - flag off = ingen ekstra DB-belastning, samme
// mønster som dailyTrainingEngine's raceDayDevelopmentOn-gate på D1-lookuppet;
// #4375 rettede kald-stedet fra motor-flagget til udviklings-flagget efter #4277
// splittede dem). Fail-safe by construction: ALDRIG throw, enhver fejl giver {}
// (ingen badge for nogen rytter) i stedet for at vælte hele
// /api/training/me-responsen for én best-effort-berigelse.

import { copenhagenMidnightUTC, copenhagenDateString } from "./copenhagenTime.js";
import { applyRiderEligibilityFilter, isRiderInjured, raceSquadOf } from "./riderEligibility.js";
import { teamWillStart, loadTeamsInStartedField } from "./raceStartOutlook.js";
import { loadWithdrawnRaceIdsForTeam } from "./raceWithdrawal.js"; // #6740
import { loadTrainNowLocksForRaces } from "./trainNowLock.js"; // #6740
import { loadSpentRaceDays } from "./raceSpentDays.js"; // #6740

// Ren sammenkobling — INGEN I/O. Holdets (race_id, rider_id)-entries krydses mod
// mængden af race_id'er der har en etape planlagt i dag, og løbsnavnet slås op.
// 1-rytter-1-løb/dag-invarianten (låst, #3113) betyder normalt højst ét match pr.
// rytter; ved en uventet dobbelt-række vinder sidste skrivning (harmløst — rent
// display, ingen game-state røres).
//
// #5945: startsByRaceId (race_id -> boolean) er holdets start-udsigt pr. løb. Et løb
// hvor holdet IKKE stiller op (under startgulvet, kan ikke fyldes op) giver ingen
// badge — ellers står rytteren som "løber i dag" mens motoren fjerner holdet ved
// start. Manglende nøgle = stiller op (bit-identisk med før #5945).
//
// #6740 (Codex P2): injuredRiderIds er udtagne ryttere der er skadet i dag. Motoren
// fjerner dem fra startfeltet, også når holdet starter via regel B, så de løber ikke.
export function computeRacingTodayByRider({ entryRows = [], todayRaceIds = [], raceNameById = new Map(), startsByRaceId = new Map(), injuredRiderIds = new Set() } = {}) {
  const todaySet = new Set(todayRaceIds);
  const out = {};
  for (const entry of entryRows) {
    if (!todaySet.has(entry.race_id)) continue;
    if (startsByRaceId.get(entry.race_id) === false) continue;
    if (injuredRiderIds.has(entry.rider_id)) continue;
    out[entry.rider_id] = { race: raceNameById.get(entry.race_id) ?? null };
  }
  return out;
}

// I/O-wrapper: 2 uafhængige queries (holdets entries + dagens globale etape-vindue)
// batched i ét Promise.all, + én opfølgende races-select for KUN de ramte løb —
// ingen N+1. race_stage_schedule-queryen er ikke team-scoped (globalt "hvilke løb
// har en etape i dag"-vindue, tabellen har et indeks på scheduled_at), men
// afgrænset til ét kalenderdøgn ad gangen — samme størrelsesorden som andre
// dags-scopede sweeps i repoet.
export async function loadRacingTodayByRider(supabase, teamId, riderIds, now = new Date()) {
  if (!supabase?.from || !teamId || !riderIds?.length) return {};
  try {
    const dayStart = copenhagenMidnightUTC(now);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const [{ data: entryRows, error: entryErr }, { data: schedRows, error: schedErr }] = await Promise.all([
      // pagination-safe: .eq("team_id")+.in("rider_id", riderIds) bounds this to
      // ÉT holds egen rytter-trup (typisk < 30, langt under PostgREST's 1000-
      // rækkers-loft) — samme mønster som dailyTrainingEngine.js's day-scopede loads.
      supabase.from("race_entries").select("race_id, rider_id").eq("team_id", teamId).in("rider_id", riderIds),
      // pagination-safe: dags-scopet (ét Copenhagen-kalenderdøgn), IKKE hele
      // tabellen — bundet af hvor mange etaper der reelt er planlagt til at køre
      // I DAG på tværs af hele spillet (typisk højst nogle titaller, langt under
      // 1000). Samme størrelsesorden/filosofi som riderDoubleBookingWatch's og
      // dailyTrainingEngine's dags-vinduer; fail-safe by construction (se modul-
      // kommentaren) hvis antagelsen alligevel skulle vise sig forkert en dag.
      supabase.from("race_stage_schedule").select("race_id")
        .gte("scheduled_at", dayStart.toISOString())
        .lt("scheduled_at", dayEnd.toISOString()),
    ]);
    if (entryErr || schedErr) return {};

    const todayRaceIds = [...new Set((schedRows ?? []).map((r) => r.race_id))];
    if (!todayRaceIds.length) return {};
    const todaySet = new Set(todayRaceIds);

    const raceIdsNeeded = [...new Set((entryRows ?? []).filter((e) => todaySet.has(e.race_id)).map((e) => e.race_id))];
    if (!raceIdsNeeded.length) return {};

    const { data: raceRows, error: raceErr } = await supabase.from("races").select("id, name, stages_completed, squad").in("id", raceIdsNeeded);
    if (raceErr) return {};

    const raceNameById = new Map((raceRows ?? []).map((r) => [r.id, r.name]));
    const { starts: startsByRaceId, injured: injuredRiderIds } = await loadStartsByRaceId({
      supabase, now, teamId, entryRows: entryRows ?? [], raceRows: raceRows ?? [], todaySet,
    });
    return computeRacingTodayByRider({ entryRows: entryRows ?? [], todayRaceIds, raceNameById, startsByRaceId, injuredRiderIds });
  } catch {
    // best-effort: en synkron/netværks-fejl her må ALDRIG vælte hele
    // /api/training/me-responsen pga. én best-effort-berigelse (samme fail-safe-
    // kontrakt som dailyTrainingEngine.js's loadRacedRiderIdsToday).
    return {};
  }
}

// #5945: pr. løb i dag — stiller holdet op? Frie egnede ryttere = holdets løbs-berettigede
// ryttere i LØBETS trup (raceSquadOf + applyRiderEligibilityFilter, samme kilde som
// stage-roles-stien) der hverken er skadet eller allerede står i et ANDET løb i dag eller i
// dette løb (samme begreber som frontendens partialSquadOutlook). Et juniorløb tæller
// derfor aldrig senior-/u23-/akademi-/pending-ryttere som frie. Kan truppens roster ikke
// hentes, sættes løbet ikke i mappet (badge som før #5945). Skadesopslaget er best-effort: svigter
// det, tæller ingen som skadet, så udsigten fejler mod "stiller op" (badge som før)
// frem for at skjule et badge pga. en fejl. Kaster aldrig.
//
// #6740: returnerer også de skadede ryttere, så computeRacingTodayByRider kan udelade dem.
async function loadStartsByRaceId({ supabase, now, teamId, entryRows, raceRows, todaySet }) {
  const starts = new Map();
  let injured = new Set();
  try {
    const raceById = new Map(raceRows.map((r) => [r.id, r]));
    const squads = [...new Set(raceRows.filter((r) => todaySet.has(r.id)).map((r) => raceSquadOf(r)))];
    const rosterBySquad = new Map();
    await Promise.all(squads.map(async (squad) => {
      const { data, error } = await applyRiderEligibilityFilter(
        // pagination-safe: .eq("team_id") afgraenser til ÉT holds egen trup (typisk < 30 ryttere),
        // langt under PostgREST's 1000-raekkers-loft.
        supabase.from("riders").select("id").eq("team_id", teamId),
        { squad },
      );
      if (!error) rosterBySquad.set(squad, (data ?? []).map((r) => r.id));
    }));
    const conditionIds = [...new Set([...rosterBySquad.values()].flat().concat(entryRows.map((e) => e.rider_id)))];
    try {
      const { data, error } = conditionIds.length
        ? await supabase.from("rider_condition").select("rider_id, injured_until").in("rider_id", conditionIds)
        : { data: [], error: null };
      if (!error) {
        const todayStr = copenhagenDateString(now);
        injured = new Set((data ?? []).filter((c) => isRiderInjured(c.injured_until ?? null, todayStr)).map((c) => c.rider_id));
      }
    } catch {
      // best-effort: skadesopslaget er berigelse; uden det tæller ingen som skadet.
      injured = new Set();
    }
    const stagesCompletedByRace = new Map(raceRows.map((r) => [r.id, Number(r.stages_completed) || 0]));
    const entriesByRace = new Map();
    for (const e of entryRows) {
      if (!todaySet.has(e.race_id)) continue;
      if (!entriesByRace.has(e.race_id)) entriesByRace.set(e.race_id, new Set());
      entriesByRace.get(e.race_id).add(e.rider_id);
    }
    // #6740: afmeldte hold (entries bevares, #4306), det faktiske felt for startede løb,
    // og Train now-låste ryttere (aldrig frie ved start, raceRunner/#6139). Hver læsning er
    // best-effort for sig: svigter den, gælder reglen fra før #6740 for netop den del.
    const raceIds = [...entriesByRace.keys()];
    const startedIds = raceIds.filter((id) => (stagesCompletedByRace.get(id) ?? 0) > 0);
    const [withdrawnIds, inFieldByRace, lockByRace] = await Promise.all([
      loadWithdrawnRaceIdsForTeam({ supabase, teamId, raceIds }).catch(() => new Set()),
      startedIds.length ? loadTeamsInStartedField({ supabase, raceIds: startedIds, teamId }).catch(() => new Map()) : new Map(),
      loadTrainNowLocksForRaces({ supabase, raceIds, riderIds: conditionIds, teamId }).catch(() => new Map()),
    ]);
    for (const [raceId, entered] of entriesByRace) {
      const stagesCompleted = stagesCompletedByRace.get(raceId) ?? 0;
      const withdrawn = withdrawnIds.has(raceId);
      const inField = inFieldByRace.has(raceId) ? inFieldByRace.get(raceId) : null;
      // Afmeldt eller startet: rosteret er ligegyldigt, svaret afgøres uden det.
      if (withdrawn || stagesCompleted > 0) {
        starts.set(raceId, teamWillStart({ stagesCompleted, inField, withdrawn }).starts);
        continue;
      }
      const roster = rosterBySquad.get(raceSquadOf(raceById.get(raceId)));
      if (!roster) continue;
      const boundElsewhere = new Set();
      for (const [otherId, otherRiders] of entriesByRace) {
        // Et afmeldt løb binder ingen (Rod A, #1823).
        if (otherId === raceId || withdrawnIds.has(otherId)) continue;
        for (const id of otherRiders) boundElsewhere.add(id);
      }
      const locked = lockByRace.get(raceId)?.riderIds ?? new Set();
      // #6740 (Codex P2): en rytter der allerede har brugt løbsdagen fjernes af motoren før
      // regel B og fyldes aldrig ind. Best-effort: svigter opslaget, tæller ingen som spent.
      const spent = new Set((await loadSpentRaceDays({ supabase, raceId, riderIds: [...new Set([...entered, ...roster])] })
        .catch(() => [])).map((row) => row.rider_id));
      const freeEligibleCount = roster.filter((id) => !entered.has(id) && !injured.has(id) && !boundElsewhere.has(id)
        && !locked.has(id) && !spent.has(id)).length;
      // #6740: kun udtagne der stadig er i løbets trup og ikke har brugt dagen tæller, som i
      // motoren (ghost- og spent-filtrene).
      const rosterSet = new Set(roster);
      const keptEntered = [...entered].filter((id) => rosterSet.has(id) && !spent.has(id));
      const { starts: willStart } = teamWillStart({
        entryCount: keptEntered.filter((id) => !injured.has(id)).length,
        // #6740 regel B: skadede udtagne holder holdet i løbet med de raske der er tilbage.
        injuredEntryCount: keptEntered.filter((id) => injured.has(id)).length,
        freeEligibleCount, stagesCompleted,
      });
      starts.set(raceId, willStart);
    }
  } catch {
    // best-effort: ren berigelse, tomt map = badge som før #5945.
    return { starts: new Map(), injured: new Set() };
  }
  return { starts, injured };
}
