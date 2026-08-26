// backend/lib/engine/v4/mechanics/teamTimeTrial.ts
// Race Engine v4 (#4030, M13 — natboelge-spor F3): TTT/holdtidskoersel.
// SSOT: docs/superpowers/specs/2026-08-20-race-engine-v4-intra-stage-design.md
// §8b beslutning 21 ("AEGTE TTT i v1 paa gruppe-modellen, #2412/#3463 lukkes ind").
// Design-skitse: gh issue #2412 ("Holdets tid = den k'te rytters passage...
// aggregér holdets TT/endurance-evner... Roller faar mening: en staerk
// TT-hjaelper loefter holdet selv uden egen chance"); verifikations-baggrund:
// gh issue #3463 ("ni ryttere fra samme hold ville hver faa deres egen tid").
//
// Diskriminator ITT vs. TTT: raceStageProfileGenerator.js's FINALE_WEIGHTS_BY_PROFILE
// mapper BAADE "itt"/"itt_hilly" OG "ttt" til finale_type "solo_tt" — de er
// altsaa IKKE til at skelne paa finale_type alene (#3463-verifikationen fandt
// netop dette). Den korrekte diskriminator er route.profile_type === "ttt".
//
// "Hold-som-gruppe paa gruppemodellen": ét hold = ÉN gruppe der koerer
// sammen. GroupKind (types.ts, frosset) har ingen dedikeret "team"-vaerdi —
// "peloton" (flere ryttere sammen) / "solo" (kun én tilbage) er den korrekte,
// semantisk naermeste genbrug uden at braekke den frosne kontrakt.
//
// Entrant (types.ts, frosset) baerer INTET team_id-felt — udenfor M13-scope
// at udvide kerne-kontrakten. Denne mekanik modtager derfor holdinddelingen
// som et separat TeamRoster[]-parameter (allerede grupperet af kalderen) i
// stedet for at laese den ud af StageInput.startlist. Se filens bund for det
// fulde wiring-forslag til index.ts/en ny adapter (arkitekt-scope, IKKE
// implementeret her — denne fil roerer hverken index.ts, segmentLoop.ts eller
// andre frosne/andre-workers-filer, jf. natboelge-mandatet).
//
// REN — ingen import fra oevrigt backend, ingen IO/Date/Math.random. Ingen rng
// overhovedet: TTT-tiden er en ren CP/W'-fysiologi-simulation (#2412-skitsen
// beskriver ingen stoej-komponent), saa determinisme (§2 invariant 1) holder
// trivielt uden en seedet rng-strøm. `seed` tages stadig som parameter (samme
// kontrakt-form som resten af motoren) fordi initRiderStates (groups.ts)
// bruger den til dagsform/jour-sans — IKKE fordi denne fil selv trækker rng.
//
// Genbrug: initRiderStates (groups.ts) for wprimeMax/dayform/jour-sans (samme
// allerede-testede kontrakt som resten af motoren); deriveCp/deriveRechargeRate/
// tickPhysiology (physiology.ts) for selve fysiologi-tikket; makeEvent/
// gapUpdateEvent/finishEvent/sortTimeline (timeline.ts) for event-formerne.
// computeTeamSpeedKmh nedenfor DUPLIKERER segmentLoop.ts's interne
// hastigheds-formel (ikke eksporteret derfra, og segmentLoop.ts er frosset for
// denne session) — samme "intern implementeringsdetalje er OK at duplikere"-
// praecedens som finale.ts's lokale normAbility/climbSelection.ts's lokale
// clamp/round2.

import type {
  Entrant,
  EngineTuning,
  GroupKind,
  RiderLoad,
  RouteV2,
  Segment,
  SegmentGroupSnapshot,
  SegmentKind,
  StageOutput,
  StageResult,
  TimelineEvent,
} from "../types.ts";
import { deriveCp, deriveRechargeRate, tickPhysiology } from "../physiology.ts";
import { initRiderStates } from "../groups.ts";
import { gapUpdateEvent, finishEvent, makeEvent, sortTimeline } from "../timeline.ts";
import { TTT_EXTRA_TUNING } from "../tuning.ts";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Offentlig kontrakt (M13) ───────────────────────────────────────────────────

/** Ét holds startende ryttere til en TTT-etape — kalderen har allerede grupperet. */
export type TeamRoster = {
  team_id: string;
  riders: Entrant[];
};

/** Pr.-hold-opsummering — bruges af harness/scorecard/why-rapport, IKKE en del af StageOutput. */
export type TeamTimeTrialTeamResult = {
  team_id: string;
  team_group_id: string; // "ttt-<team_id>" — group_id i StageResult/groupSnapshots
  time_seconds: number; // holdets officielle tid (k'te ankomst blandt starterne, round2)
  counted_rider_id: string; // rytteren hvis ankomst satte den officielle tid
  arrived_rider_ids: string[]; // ALLE starter-id'er, ankomst-sorteret (front til bag)
  dropped_rider_ids: string[]; // ryttere hvis W' ramte 0 og faldt ud af holdets front-rotation undervejs
};

export type TeamTimeTrialOutput = StageOutput & { teams: TeamTimeTrialTeamResult[] };

// ── Rotation (work-rotation i holdet, #2412: "roller faar mening") ────────────

/**
 * Ren rotations-funktion (eksporteret for testbarhed): partitionerer de
 * AKTIVE ryttere (sorteret, stabilt) i vinduer af `frontCount` og vaelger
 * vinduet der starter ved `(segmentIndex * frontCount) mod n` — en deterministisk
 * turnus-ordning UDEN styrke-bias (i modsaetning til segmentLoop.ts's
 * "staerkeste foerst"-frontFraction-model, som er korrekt for et almindeligt
 * felt men IKKE for en TTT: her tager ALLE ryttere tørn for pulsen, jf.
 * #2412's "roller faar mening: en staerk TT-hjaelper loefter holdet selv uden
 * egen chance" — det kraever at ogsaa svagere ryttere periodisk staar for.
 */
export function rotationFrontRiderIds(
  sortedActiveRiderIds: readonly string[],
  frontCount: number,
  segmentIndex: number,
): Set<string> {
  const n = sortedActiveRiderIds.length;
  if (n === 0) return new Set();
  const count = clamp(Math.round(frontCount), 1, n);
  const offset = (segmentIndex * count) % n;
  const front = new Set<string>();
  for (let i = 0; i < count; i++) {
    front.add(sortedActiveRiderIds[(offset + i) % n]);
  }
  return front;
}

// ── Hastigheds-formel (duplikeret fra segmentLoop.ts, se filhoved-noten) ──────

function computeTeamSpeedKmh(collectiveCp: number, kind: SegmentKind, tuning: EngineTuning): number {
  const baseSpeed = tuning.terrain.baseSpeedKmh[kind];
  const baseDemand = tuning.terrain.baseDemand[kind];
  const [lo, hi] = tuning.terrain.speedMultiplierBounds;
  const multiplier = clamp(1 + tuning.terrain.strengthSpeedGain * (collectiveCp - baseDemand), lo, hi);
  return baseSpeed * multiplier;
}

// ── Intern pr.-rytter-tilstand (IKKE et af de frosne types.ts-typer — rent
// internt bogholderi for denne mekanik, aldrig eksponeret udenfor filen) ──────

type InternalRider = {
  rider_id: string;
  cp: number;
  wprimeMax: number;
  wprime: number;
  dayform: number;
  seconds_over_cp: number;
  work_norm: number;
  status: "with_team" | "dropped";
  elapsed_seconds: number;
};

function initInternalRiders(roster: TeamRoster, tuning: EngineTuning, seed: string): Record<string, InternalRider> {
  const seeded = initRiderStates(roster.riders, tuning, seed);
  const out: Record<string, InternalRider> = {};
  for (const r of roster.riders) {
    const rs = seeded[r.rider_id];
    out[r.rider_id] = {
      rider_id: r.rider_id,
      cp: 0,
      wprimeMax: rs.wprimeMax,
      wprime: rs.wprime,
      dayform: rs.dayform,
      seconds_over_cp: 0,
      work_norm: 0,
      status: "with_team",
      elapsed_seconds: 0,
    };
  }
  return out;
}

/**
 * Ét fysiologi-tick for én rytter (front ELLER draft ELLER solo — `demand`
 * baerer forskellen). Ren wrapper om physiology.tickPhysiology der ogsaa
 * opdaterer elapsed_seconds/cp/akkumulatorerne paa den lokale InternalRider.
 */
function tickRider(rider: InternalRider, entrant: Entrant, segment: Segment, demand: number, dtSeconds: number, tuning: EngineTuning): void {
  const cp = Math.max(0, deriveCp(entrant.abilities, segment.kind, tuning.physiology.cpWeights) + rider.dayform);
  rider.cp = cp;
  const rechargeRate = deriveRechargeRate(entrant.abilities, tuning.physiology);
  const tick = tickPhysiology({ cp, wprimeMax: rider.wprimeMax, wprime: rider.wprime, demand, dtSeconds, rechargeRate });
  rider.wprime = tick.wprime;
  rider.seconds_over_cp += tick.secondsOverCp;
  rider.work_norm += tick.workNorm;
  rider.elapsed_seconds += dtSeconds;
}

/**
 * Kører ÉT segment for ét hold: (1) roterer front/draft blandt de STADIG
 * MED-HOLDET-ryttere og tikker dem paa holdets faelles tempo (kollektiv-CP =
 * gennemsnit af rotations-fronten, IKKE de staerkeste — work-rotation), (2)
 * markerer nye drop (W' <= 0) og fjerner dem fra holdets front-rotation fra
 * naeste segment, (3) tikker allerede-droppede ryttere SOLO (egen cp, ingen
 * hjul-rabat, egen fart — de fortsaetter etapen, blot uden holdets tempo-assist).
 * Muterer `riders` (lokal per-kald-tilstand, aldrig kalderens input) og
 * returnerer km-mærket ny-droppede rider_ids (til events).
 */
function tickTeamSegment(
  route: RouteV2,
  segment: Segment,
  segmentIndex: number,
  roster: TeamRoster,
  entrantsById: Record<string, Entrant>,
  riders: Record<string, InternalRider>,
  tuning: EngineTuning,
): string[] {
  const distanceKm = Math.max(0, segment.to_km - segment.from_km);
  const baseDemand = tuning.terrain.baseDemand[segment.kind];

  const activeIds = roster.riders
    .map((r) => r.rider_id)
    .filter((id) => riders[id].status === "with_team")
    .sort();

  const newlyDropped: string[] = [];

  if (activeIds.length > 0) {
    const frontCount = Math.max(1, Math.ceil(activeIds.length * tuning.work.frontFraction));
    const frontSet = rotationFrontRiderIds(activeIds, frontCount, segmentIndex);

    // Kollektiv-CP for holdets faelles tempo denne segment: gennemsnit af
    // rotations-frontens CP (§4 punkt 1-moenstret genbrugt paa en ROTERENDE
    // front i stedet for "staerkeste foerst" — se rotationFrontRiderIds-kommentaren).
    let cpSum = 0;
    let cpCount = 0;
    for (const id of frontSet) {
      const entrant = entrantsById[id];
      const rider = riders[id];
      if (!entrant) continue;
      const cp = Math.max(0, deriveCp(entrant.abilities, segment.kind, tuning.physiology.cpWeights) + rider.dayform);
      cpSum += cp;
      cpCount += 1;
    }
    const collectiveCp = cpCount > 0 ? cpSum / cpCount : 0;
    const speedKmh = computeTeamSpeedKmh(collectiveCp, segment.kind, tuning);
    const dtSeconds = speedKmh > 0 ? (distanceKm / speedKmh) * 3600 : 0;

    for (const id of activeIds) {
      const entrant = entrantsById[id];
      const rider = riders[id];
      if (!entrant) continue;
      const positionFactor = frontSet.has(id) ? tuning.work.frontWorkFactor[segment.kind] : tuning.work.draftFactor[segment.kind];
      const demand = baseDemand * positionFactor;
      tickRider(rider, entrant, segment, demand, dtSeconds, tuning);
      if (rider.wprime <= 0) newlyDropped.push(id);
    }

    for (const id of newlyDropped) {
      riders[id].status = "dropped";
    }
  }

  // Allerede-droppede (fra dette ELLER et tidligere segment) fortsaetter solo:
  // egen cp, fuld baseDemand (ingen laesrabat — de koerer alene), egen fart.
  for (const r of roster.riders) {
    const rider = riders[r.rider_id];
    if (rider.status !== "dropped" || newlyDropped.includes(r.rider_id)) continue;
    const entrant = entrantsById[r.rider_id];
    if (!entrant) continue;
    const soloCp = Math.max(0, deriveCp(entrant.abilities, segment.kind, tuning.physiology.cpWeights) + rider.dayform);
    const speedKmh = computeTeamSpeedKmh(soloCp, segment.kind, tuning);
    const dtSeconds = speedKmh > 0 ? (distanceKm / speedKmh) * 3600 : 0;
    tickRider(rider, entrant, segment, baseDemand, dtSeconds, tuning);
  }

  return newlyDropped;
}

// ── Top-niveau: hele TTT-etapen, alle hold ─────────────────────────────────────

/**
 * M13 (#4030): simulerer en HEL TTT-etape for alle deltagende hold og
 * returnerer et StageOutput-formet resultat (+ `teams`-opsummering, se
 * TeamTimeTrialOutput). Wiring-forslag (arkitekt-scope, se filhoved-noten):
 * index.ts's `simulateStageV4` forgrener paa `input.route.profile_type ===
 * "ttt"` og kalder denne funktion med en TeamRoster[] afledt af en ny adapter
 * der grupperer input.startlist paa team_id.
 *
 * "K'te rytters passage" (#2412): holdets officielle tid = round2(elapsed)
 * for den `TTT_EXTRA_TUNING.countbackRiderRank`'te ankomst blandt STARTENDE
 * ryttere (ankomst-sorteret; ryttere der aldrig droppes ankommer alle
 * samtidigt = holdets faelles tempo, droppede ryttere ankommer senere,
 * individuelt). ALLE holdets startende ryttere faar denne tid i `results`
 * (mor-spec §3.2 rent gruppe-princip, #2412: "Alle ryttere paa holdet faar
 * holdets tid i GC" — v1-default; individuel afvigelse for droppede ryttere
 * er eksplicit en v2-detalje i #2412's egen skitse). `loads` afspejler
 * derimod HVER rytters REELLE fysiologiske forbrug (inkl. droppede ryttere,
 * jf. #3459-loebsdagskontrakten: belastning maales paa reelt arbejde, ikke
 * paa den nominelle klassements-tid).
 */
export function simulateTeamTimeTrialStage(
  route: RouteV2,
  teams: TeamRoster[],
  seed: string,
  tuning: EngineTuning,
): TeamTimeTrialOutput {
  const totalFieldCount = teams.reduce((sum, t) => sum + t.riders.length, 0);
  const events: TimelineEvent[] = [];
  events.push(
    makeEvent(0, "stage_start", { field_count: totalFieldCount, profile_type: route.profile_type, distance_km: route.distance_km }),
  );

  const perTeam = teams.map((roster) => ({
    roster,
    teamGroupId: `ttt-${roster.team_id}`,
    entrantsById: Object.fromEntries(roster.riders.map((r) => [r.rider_id, r])) as Record<string, Entrant>,
    riders: initInternalRiders(roster, tuning, seed),
    lastEmittedGap: undefined as number | undefined,
  }));

  const groupSnapshots: SegmentGroupSnapshot[] = [];

  for (let segmentIndex = 0; segmentIndex < route.segments.length; segmentIndex++) {
    const segment = route.segments[segmentIndex];

    for (const t of perTeam) {
      const newlyDropped = tickTeamSegment(route, segment, segmentIndex, t.roster, t.entrantsById, t.riders, tuning);
      for (const riderId of newlyDropped) {
        events.push(makeEvent(segment.to_km, "ttt_rider_dropped", { team_id: t.roster.team_id, rider_id: riderId, group_id: t.teamGroupId }));
      }
    }

    // Holdets "position" for snapshot/gap-formaal: mindste elapsed blandt
    // holdets ryttere (den der stadig er laengst fremme — enten hele
    // med-holdet-gruppen paa faelles tempo, eller den senest droppede rytter).
    const teamProxyElapsed = new Map<string, number>();
    for (const t of perTeam) {
      let minElapsed = Infinity;
      for (const r of t.roster.riders) minElapsed = Math.min(minElapsed, t.riders[r.rider_id].elapsed_seconds);
      teamProxyElapsed.set(t.roster.team_id, Number.isFinite(minElapsed) ? minElapsed : 0);
    }
    const bestElapsed = Math.min(...[...teamProxyElapsed.values(), Infinity]);

    const groupEntries = perTeam.map((t) => {
      const stillWithTeam = t.roster.riders.filter((r) => t.riders[r.rider_id].status === "with_team").map((r) => r.rider_id);
      const gapSeconds = round2(Math.max(0, (teamProxyElapsed.get(t.roster.team_id) ?? 0) - bestElapsed));
      const kind: GroupKind = stillWithTeam.length <= 1 ? "solo" : "peloton";
      return { group_id: t.teamGroupId, kind, rider_ids: stillWithTeam, gap_seconds: gapSeconds };
    });
    groupSnapshots.push({ km: round2(segment.to_km), groups: groupEntries });

    for (const t of perTeam) {
      const gapSeconds = round2(Math.max(0, (teamProxyElapsed.get(t.roster.team_id) ?? 0) - bestElapsed));
      if (gapSeconds === 0) continue;
      if (t.lastEmittedGap === undefined || Math.abs(gapSeconds - t.lastEmittedGap) >= tuning.groups.gapUpdateThresholdSeconds) {
        events.push(gapUpdateEvent(segment.to_km, { groupId: t.teamGroupId, gapSeconds }));
        t.lastEmittedGap = gapSeconds;
      }
    }
  }

  const finishKm = round2(route.distance_km);
  const results: StageResult[] = [];
  const loads: RiderLoad[] = [];
  const teamResults: TeamTimeTrialTeamResult[] = [];

  for (const t of perTeam) {
    const arrived = t.roster.riders
      .map((r) => ({ rider_id: r.rider_id, elapsed: t.riders[r.rider_id].elapsed_seconds }))
      .sort((a, b) => a.elapsed - b.elapsed || a.rider_id.localeCompare(b.rider_id));
    const rank = clamp(TTT_EXTRA_TUNING.countbackRiderRank, 1, Math.max(1, arrived.length));
    const counted = arrived[rank - 1] ?? arrived[arrived.length - 1];
    const teamTimeSeconds = round2(counted?.elapsed ?? 0);
    const droppedIds = t.roster.riders.filter((r) => t.riders[r.rider_id].status === "dropped").map((r) => r.rider_id).sort();

    teamResults.push({
      team_id: t.roster.team_id,
      team_group_id: t.teamGroupId,
      time_seconds: teamTimeSeconds,
      counted_rider_id: counted?.rider_id ?? "",
      arrived_rider_ids: arrived.map((a) => a.rider_id),
      dropped_rider_ids: droppedIds,
    });

    events.push(
      makeEvent(finishKm, "ttt_team_result", {
        team_id: t.roster.team_id,
        group_id: t.teamGroupId,
        time_seconds: teamTimeSeconds,
        counted_rider_id: counted?.rider_id ?? "",
        dropped_rider_ids: droppedIds,
      }),
    );

    for (const r of t.roster.riders) {
      const internal = t.riders[r.rider_id];
      results.push({ rider_id: r.rider_id, rank: 0, time_seconds: teamTimeSeconds, group_id: t.teamGroupId, status: "finished" });
      loads.push({
        rider_id: r.rider_id,
        wprime_depleted_j_norm: round2(Math.max(0, internal.wprimeMax - internal.wprime)),
        seconds_over_cp: round2(internal.seconds_over_cp),
        work_norm: round2(internal.work_norm),
      });
    }
  }

  results.sort((a, b) => a.time_seconds - b.time_seconds || a.rider_id.localeCompare(b.rider_id));
  results.forEach((r, index) => {
    r.rank = index + 1;
  });
  loads.sort((a, b) => a.rider_id.localeCompare(b.rider_id));

  const winnerTime = results[0]?.time_seconds ?? 0;
  const top = results.slice(0, Math.min(10, results.length)).map((r) => ({ rider_id: r.rider_id, rank: r.rank, gap: round2(r.time_seconds - winnerTime) }));
  events.push(finishEvent(finishKm, { top, winType: "team_time_trial" }));

  return {
    timeline: { timeline_version: 2, events: sortTimeline(events) },
    results,
    loads,
    groupSnapshots,
    teams: teamResults,
  };
}

// ── Wiring-forslag til orkestratoren (IKKE implementeret her — beskrivelse) ───
//
// index.ts's simulateStageV4 (frosset for denne session) kan udvides saadan
// (arkitekt-scope):
//
//   if (input.route.profile_type === "ttt") {
//     const teams = groupStartlistByTeam(input.startlist, riderTeamIds); // NY adapter
//     return simulateTeamTimeTrialStage(input.route, teams, input.seed, input.tuning);
//   }
//   return simulateStageV4RoadStage(input); // eksisterende runSegmentLoop-vej
//
// `riderTeamIds: Record<string, string>` (rider_id -> team_id) findes IKKE i
// StageInput i dag (Entrant baerer intet team_id-felt) — en ny adapter under
// adapters/ (fx teamRosterAdapter.ts) skal laese team_id fra DB-laget
// (rider_derived_abilities/roster-raekken, samme sted entrantAdapter.ts
// allerede laeser fra) og bygge TeamRoster[]-parameteren, ELLER StageInput
// udvides med et `team_id`-felt paa Entrant (kraever arkitekt-godkendelse,
// da types.ts er frosset). Begge veje er additive og braekker intet
// eksisterende — ingen af dem er implementeret i denne fil/PR.
