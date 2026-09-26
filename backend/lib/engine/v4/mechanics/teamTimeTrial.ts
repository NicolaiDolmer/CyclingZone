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
// #5576: etape-modellen er udskilt som `runTimeTrialStage` og deles med
// enkeltstarten (mechanics/individualTimeTrial.ts), der koerer den med ét hold
// pr. rytter og sit eget segment-tik. Holdtidskoerslen er bit-uaendret af
// udskillelsen; forskellene bor i `TimeTrialMode`.
//
// Holdinddelingen kommer ind som et separat TeamRoster[]-parameter (grupperet
// af adapters/teamRosterAdapter.ts paa Entrant.team_id, M16), ikke laest ud af
// StageInput.startlist her. index.ts's simulateStageV4 forgrener paa
// profile_type "ttt" og kalder denne fil (wiret 6/9).
//
// ── FOELGESAGERNE (#4915) ──────────────────────────────────────────────────────
// Holdtidskoerslen gaar IKKE gennem segment-loopet, saa de tre mekanikker der
// bor dér (M10 uheld, M15 tidsgraense, M9 passager) naaede den ikke. Nu goer de:
//
//   M10  Samme trappe (mechanics/incidents.ts's resolveIncident), samme
//        seedede, segment-noeglede strømme, samme etape-loft. FORSKELLEN er
//        konsekvensen: i en TTT er HOLDET ankomstgruppen, og alle holdets
//        ryttere faar holdets tid. Et tidstab rammer derfor HOLDETS tid (holdet
//        venter/samler op), ikke rytterens alene — ellers ville uheldet vaere
//        usynligt i resultatet. En allerede droppet rytter er sin egen
//        ankomstgruppe; hans tidstab rammer kun ham. Et alvorligt styrt tager
//        rytteren ud (status "abandoned"); holdet koerer videre uden ham.
//   M15  Graensen er en HOLD-graense: holdets officielle tid maales mod det
//        vindende holds tid med etapetypens faktor (timeLimit.ts's
//        timeLimitSecondsFor). Ligger holdet over, er alle dets ryttere uden
//        for tidsgraensen. Grupetto-redningen gaelder IKKE: den er kalibreret
//        mod et massestartsfelt, og en TTT-ankomstgruppe er et helt hold, saa
//        "en stor gruppe reddes" ville enten redde alle hold eller intet.
//   M9   Maalpassagen koeres paa den endelige placeringsraekkefoelge, praecis
//        som paa en vejetape og som v3's lag (racePassages: "Maalorden ER
//        motorens rangering"): profil-skalaen for ttt, ingen maal-bonussekunder
//        (ttt staar i bonusExcludedProfileTypes, samme gate som v3). Genererede
//        TTT-ruter har hverken stigninger eller indlagte spurter
//        (raceRouteGenerator: CLIMB_SPEC.ttt og isTimeTrialProfile), saa kun
//        maalpassagen (og en evt. summit-finish-top) bygges her — en haandbygget
//        TTT-rute med indlagte vejpunkter giver ingen point dér.
//
// REN — ingen import fra oevrigt backend, ingen IO/Date/Math.random. Selve
// holdtiden er en ren CP/W'-fysiologi-simulation uden stoej; den ENESTE rng er
// M10's, og den bruger de samme seedede, segment-noeglede strømme som
// segment-loopet (rng.ts's segmentRngFor), saa determinisme (§2 invariant 1)
// holder og en rytters uheldslodtraekning afhaenger kun af (seed, segment,
// rider_id).
//
// Genbrug: initRiderStates (groups.ts) for wprimeMax/dayform/jour-sans (samme
// allerede-testede kontrakt som resten af motoren); deriveCp/deriveRechargeRate/
// tickPhysiology (physiology.ts) for selve fysiologi-tikket; makeEvent/
// gapUpdateEvent/finishEvent/sortTimeline (timeline.ts) for event-formerne.
// computeTeamSpeedKmh nedenfor DUPLIKERER segmentLoop.ts's interne
// hastigheds-formel (ikke eksporteret derfra) — samme "intern
// implementeringsdetalje er OK at duplikere"-praecedens som finale.ts's lokale
// normAbility/climbSelection.ts's lokale clamp/round2.

import type {
  Entrant,
  EngineTuning,
  GroupKind,
  ProfileType,
  RiderLoad,
  RngForFn,
  RouteV2,
  Segment,
  SegmentGroupSnapshot,
  SegmentKind,
  StageIncident,
  StageOutput,
  StagePassage,
  StageResult,
  TimelineEvent,
} from "../types.ts";
import { deriveCp, deriveRechargeRate, tickPhysiology } from "../physiology.ts";
import { initRiderStates } from "../groups.ts";
import { boundRngFor, segmentRngFor } from "../rng.ts";
import { gapUpdateEvent, finishEvent, incidentEvent, makeEvent, sortTimeline } from "../timeline.ts";
import { BONUS_SECONDS_EXTRA_TUNING, INCIDENTS_EXTRA_TUNING, TTT_EXTRA_TUNING } from "../tuning.ts";
import {
  applyThreeKmRuleToResults,
  incidentProbability,
  maxIncidentsForField,
  resolveIncident,
  segmentLengthFactor,
  threeKmRuleApplies,
  type IncidentsTuning,
} from "./incidents.ts";
import {
  applyReinstatementPointPenalty,
  JURY_REINSTATED_EVENT,
  juryReinstatements,
  OTL_STATUS,
  OUTSIDE_TIME_LIMIT_EVENT,
  reinstatedRiderIdsOf,
  TIME_LIMIT_TUNING,
  timeLimitSecondsFor,
  type TimeLimitJuryInput,
  type TimeLimitTuning,
} from "./timeLimit.ts";
import {
  buildFinishPassages,
  buildPassage,
  clampPassageBonusToPerRiderCap,
  inRacePassageWaypoints,
  komPointScale,
  passageTotals,
  passagesToTimelineEvents,
  sortPassages,
} from "./bonusSeconds.ts";

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
  time_seconds: number; // holdets officielle tid (k'te ankomst blandt de ankomne, round2)
  counted_rider_id: string; // rytteren hvis ankomst satte den officielle tid ("" hvis ingen kom i maal)
  arrived_rider_ids: string[]; // alle ryttere der KOM I MAAL, ankomst-sorteret (front til bag)
  dropped_rider_ids: string[]; // ryttere hvis W' ramte 0 og faldt ud af holdets front-rotation undervejs
  abandoned_rider_ids: string[]; // #4915: ryttere et alvorligt styrt (M10 trin 3) tog ud af loebet
  outside_time_limit: boolean; // #4915: holdets tid laa over hold-graensen (M15)
};

export type TeamTimeTrialOutput = StageOutput & { teams: TeamTimeTrialTeamResult[] };

/**
 * Injicerbar tuning (#4915). Udeladt = den rigtige motor-tuning. Findes saa
 * tests kan rigge et uheld deterministisk (risiko 0 eller 1) eller flytte
 * graensen, uden at aendre den rigtige signatur — samme moenster som
 * incidents.ts's createIncidentHook(tuning).
 */
export type TeamTimeTrialOptions = {
  incidentsTuning?: IncidentsTuning;
  timeLimitTuning?: TimeLimitTuning;
};

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

// ── Pr.-rytter-tilstand (IKKE et af de frosne types.ts-typer — rent internt
// bogholderi for tidskoerslerne; eksporteret som TYPE saa enkeltstarten
// (mechanics/individualTimeTrial.ts, #5576) kan skrive sit eget segment-tik
// paa den samme kerne, aldrig brugt uden for de to mekanikker) ─────────────────

export type TimeTrialRider = InternalRider;

type InternalRider = {
  rider_id: string;
  cp: number;
  wprimeMax: number;
  wprime: number;
  dayform: number;
  seconds_over_cp: number;
  work_norm: number;
  // "abandoned" (#4915): et alvorligt styrt (M10 trin 3). Rytteren tikker ikke
  // mere, tager ingen tørn og krydser aldrig stregen.
  status: "with_team" | "dropped" | "abandoned";
  elapsed_seconds: number;
};

type TeamState = {
  roster: TeamRoster;
  teamGroupId: string;
  entrantsById: Record<string, Entrant>;
  riders: Record<string, InternalRider>;
  lastEmittedGap: number | undefined;
};

/** Én startende enhed i en tidskoersel: et hold (TTT) eller én rytter (ITT). */
export type TimeTrialUnit = TeamState;

/**
 * Hvad der ADSKILLER holdtidskoerslen fra enkeltstarten (#5576). Alt andet —
 * egen start fra nul, M10's uheld, M15's graense pr. ankomstgruppe, M9's
 * maalpassage, placering og tidslinje-form — er den samme kerne
 * (`runTimeTrialStage`). En enkeltstart er en tidskoersel hvor hver enhed er
 * ét hold paa én rytter.
 */
export type TimeTrialMode = {
  /** group_id-praefiks: `<praefiks>-<enheds-id>`. */
  groupPrefix: string;
  /** finish-eventets win_type — skal vaere en noegle loebsfilmen allerede kender. */
  winType: string;
  /** Hold-events (`ttt_rider_dropped`, `ttt_team_result`). En enkeltstart har intet hold at falde af. */
  unitEvents: boolean;
  /** `gap_update` pr. enhed. Loebsfilmen tegner ingen gap-kurve paa en tidskoersel (#3463). */
  gapUpdates: boolean;
  /**
   * Afgoer vejpunkterne UNDERVEJS (bjergtoppe, indlagte spurter) paa hver
   * rytters egen passagetid (#5576). Enkeltstart: ja — en kuperet enkeltstart
   * har kategoriserede stigninger. Holdtidskoersel: nej, uaendret siden #4915
   * (genererede TTT-ruter har ingen, se filhovedet).
   */
  intermediatePassages: boolean;
  /**
   * #5515: juryen (#5582) doemmer PER RYTTER paa sluttid minus uheldets
   * tidstab. Enkeltstart: ja — enheden er én rytter, og hans tid er hans egen,
   * saa et mekanisk uheld aldrig kan koste loebet (RULES §9 raekke 4).
   * Holdtidskoersel: nej — holdets tid er den k'te rytters passage, og én
   * rytters uheld flytter den ikke; hold-graensen er uaendret siden #4915.
   */
  individualJury: boolean;
  /** Ét segment for én enhed. Muterer enhedens lokale rytter-tilstand; returnerer ny-droppede rider_ids. */
  tickUnitSegment: (unit: TimeTrialUnit, segment: Segment, segmentIndex: number, tuning: EngineTuning) => string[];
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
 * Udgaaede ryttere tikkes ikke. Muterer `riders` (lokal per-kald-tilstand,
 * aldrig kalderens input) og returnerer km-mærket ny-droppede rider_ids (til events).
 */
function tickTeamSegment(
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

// ── M10 i holdtidskoerslen (#4915) ─────────────────────────────────────────────

/**
 * M10 for ÉT segment paa tvaers af ALLE hold. Samme regler som
 * incidents.ts's incidentHook, linje for linje, bortset fra konsekvensen:
 *
 *   - Risiko: `incidentProbability` (positioning-daempet) x `segmentLengthFactor`.
 *   - Strømme: `rngFor` er segment-noeglet (rng.ts's segmentRngFor) med
 *     SAMME mekanik-navne som hooket ("incident", "incident_kind", ...).
 *   - Etape-loftet: `maxIncidentsForField` over HELE startfeltet, kronologisk.
 *   - Kandidater i stabil rider_id-orden paa tvaers af hold.
 *   - "En hjaelper taet paa": i en TTT ER gruppen holdet, saa en rytter der
 *     stadig er med holdet har altid holdkammerater omkring sig — praecis
 *     incidents.ts's hasHelperNearby-definition (en holdkammerat i samme
 *     gruppe). En droppet rytter koerer alene og har ingen.
 *
 * KONSEKVENSEN (se filhovedet): tidstabet rammer ankomstgruppen. For en
 * rytter der er med holdet er det HELE den med-holdet-gruppe (holdets tid);
 * for en droppet rytter kun ham selv. Et alvorligt styrt saetter "abandoned".
 *
 * Muterer `perTeam`'s lokale rytter-tilstand (aldrig kalderens input).
 */
function rollSegmentIncidents(args: {
  perTeam: TeamState[];
  route: RouteV2;
  segment: Segment;
  rngFor: RngForFn;
  fieldSize: number;
  loggedCount: number;
  tuning: IncidentsTuning;
}): { incidents: StageIncident[]; events: TimelineEvent[] } {
  const { perTeam, route, segment, rngFor, tuning } = args;
  const incidents: StageIncident[] = [];
  const events: TimelineEvent[] = [];

  let budget = maxIncidentsForField(args.fieldSize, tuning) - args.loggedCount;
  if (budget <= 0) return { incidents, events };
  const lengthFactor = segmentLengthFactor(segment, tuning);
  if (lengthFactor <= 0) return { incidents, events };

  const candidates: Array<{ riderId: string; team: TeamState }> = [];
  for (const team of perTeam) {
    for (const r of team.roster.riders) {
      if (team.riders[r.rider_id].status === "abandoned") continue;
      candidates.push({ riderId: r.rider_id, team });
    }
  }
  candidates.sort((a, b) => a.riderId.localeCompare(b.riderId));

  for (const { riderId, team } of candidates) {
    if (budget <= 0) break;
    const entrant = team.entrantsById[riderId];
    const rider = team.riders[riderId];
    if (!entrant || rider.status === "abandoned") continue;

    const rng = rngFor("incident", riderId);
    const p = clamp(incidentProbability(entrant.abilities.positioning, segment.kind, tuning) * lengthFactor, 0, 1);
    if (rng() >= p) continue;

    const kmFrac = rng();
    const incidentKm = round2(segment.from_km + kmFrac * (segment.to_km - segment.from_km));
    const protectedByRule = threeKmRuleApplies(incidentKm, route.distance_km, route.profile_type, tuning);
    const withTeam = rider.status === "with_team";
    const helperNearby =
      withTeam && team.roster.riders.some((r) => r.rider_id !== riderId && team.riders[r.rider_id].status === "with_team");

    const resolved = resolveIncident(
      {
        kind: rngFor("incident_kind", riderId)(),
        severity: rngFor("incident_severity", riderId)(),
        magnitude: rngFor("incident_time_loss", riderId)(),
        injury: rngFor("incident_injury", riderId)(),
      },
      { protectedByRule, helperNearby },
      tuning,
    );
    budget -= 1;

    if (resolved.outcome === "abandoned") {
      rider.status = "abandoned";
    } else if (resolved.outcome === "time_loss") {
      const loss = resolved.timeLossSeconds ?? 0;
      if (withTeam) {
        // Holdet er ankomstgruppen: hele den med-holdet-gruppe taber tiden.
        for (const r of team.roster.riders) {
          const teammate = team.riders[r.rider_id];
          if (teammate.status === "with_team") teammate.elapsed_seconds += loss;
        }
      } else {
        rider.elapsed_seconds += loss;
      }
    }
    // "protected_three_km_rule": ingen tidskonsekvens (kan i dag ikke ske paa
    // en ttt — den staar ikke i flatProfileTypes — men reglen er den samme).

    incidents.push({
      rider_id: riderId,
      km: incidentKm,
      kind: resolved.kind,
      severity: resolved.severity,
      outcome: resolved.outcome,
      time_loss_seconds: resolved.timeLossSeconds,
      injury_days: resolved.injuryDays,
      helper_assist: resolved.helperAssist,
    });
    events.push(
      incidentEvent(incidentKm, {
        riderId,
        kind: resolved.kind,
        outcome: resolved.outcome,
        timeLossSeconds: resolved.timeLossSeconds,
        severity: resolved.severity,
        injuryDays: resolved.injuryDays,
        helperAssist: resolved.helperAssist,
      }),
    );
  }

  return { incidents, events };
}

// ── M9 undervejs i en tidskoersel (#5576) ─────────────────────────────────────

/**
 * Vejpunkterne i ét segment (bjergtoppe og indlagte spurter, ikke maalet),
 * afgjort paa hver rytters EGEN passagetid: tiden ved segmentets start plus
 * den andel af segmentets tid der svarer til vejpunktets km (rytterens fart
 * er konstant inden for segmentet). Mod uret er den hurtigste op til toppen
 * den der tager bjergpointene — der er ingen gruppe at spurte ud af, saa
 * vejetapens evne-lodtraekning (computePassageOrder) hoerer ikke til her.
 *
 * Point-skalaerne er vejetapens (M9). Bonussekunder undervejs gives ikke paa
 * en tidskoersel — samme profil-gate som maalbonussen
 * (BONUS_SECONDS_EXTRA_TUNING.bonusExcludedProfileTypes).
 *
 * Et uheld paa segmentet afgoeres efter passagen: dets tidstab flytter ikke
 * raekkefoelgen ved et vejpunkt paa samme segment. Udgaaede ryttere er ude.
 */
function timeTrialIntermediatePassages(args: {
  route: RouteV2;
  segment: Segment;
  perTeam: readonly TeamState[];
  elapsedAtSegmentStart: ReadonlyMap<string, number>;
  tuning: EngineTuning;
}): StagePassage[] {
  const { route, segment, perTeam, elapsedAtSegmentStart, tuning } = args;
  const waypoints = inRacePassageWaypoints(route.waypoints, segment.from_km, segment.to_km);
  if (waypoints.length === 0) return [];
  const extra = BONUS_SECONDS_EXTRA_TUNING;
  const bonusExcluded = extra.bonusExcludedProfileTypes.includes(String(route.profile_type ?? ""));
  const lengthKm = segment.to_km - segment.from_km;

  const passages: StagePassage[] = [];
  for (const wp of waypoints) {
    const fraction = lengthKm > 0 ? clamp((wp.km - segment.from_km) / lengthKm, 0, 1) : 1;
    const arrivals: Array<{ riderId: string; at: number }> = [];
    for (const t of perTeam) {
      for (const r of t.roster.riders) {
        const rider = t.riders[r.rider_id];
        if (rider.status === "abandoned") continue;
        const before = elapsedAtSegmentStart.get(r.rider_id) ?? 0;
        arrivals.push({ riderId: r.rider_id, at: before + (rider.elapsed_seconds - before) * fraction });
      }
    }
    const order = arrivals.sort((a, b) => a.at - b.at || a.riderId.localeCompare(b.riderId)).map((a) => a.riderId);
    const isKom = wp.kind === "kom";
    const category = isKom ? (wp.category ?? null) : null;
    const passage = buildPassage({
      kind: wp.kind as StagePassage["kind"],
      index: wp.index,
      name: wp.name,
      km: wp.km,
      category,
      order,
      pointScale: isKom ? komPointScale(category, false) : extra.intermediateSprintPoints,
      bonusScale: isKom || bonusExcluded ? [] : tuning.bonusSeconds.intermediateSeconds,
    });
    if (passage) passages.push(passage);
  }
  return passages;
}

// ── M15 i holdtidskoerslen (#4915): hold-graensen ─────────────────────────────

export type TeamTimeLimitOutcome = {
  /** `results` med `status: "otl"` paa de ramte holds ryttere. Samme laengde/raekkefoelge/rank/tid. */
  results: StageResult[];
  /** Tidslinje-events (tom naar intet hold er ramt) — ALDRIG med procent eller sekundgraense. */
  events: TimelineEvent[];
  /** Motor-intern (fog-gated): graensen i sekunder. */
  limitSeconds: number;
  /** Motor-intern: det vindende holds tid. */
  winnerTimeSeconds: number;
  /** group_id ("ttt-<team_id>") for de hold der endte uden for graensen. */
  otlTeamGroupIds: string[];
  /** #5515: ryttere juryen genindsatte (kun naar `jury` er givet, dvs. enkeltstarten). */
  juryReinstatedRiderIds: string[];
};

/**
 * M15 som HOLD-graense (#4915). Reglen er timeLimit.ts's (graense =
 * vindertid x (1 + faktor for etapetypen)), men enheden er holdet:
 *
 *   1. Vindertiden = den bedste holdtid blandt ryttere der kom i maal.
 *   2. Et hold hvis officielle tid ligger OVER graensen er ude — alle dets
 *      ryttere der kom i maal faar status "otl".
 *   3. INGEN grupetto-redning (se filhovedet). Et helt hold er per konstruktion
 *      en "stor gruppe", saa redningen ville ophaeve graensen for alle hold.
 *
 * Udgaaede ryttere roeres ikke (terminal udfaldsklasse, samme som M15).
 * Rank, tid og raekkefoelge er uroerte — kun `status` aendres. Eventets form er
 * M15's egen (`rider_ids` + `rider_count`), saa renderer-laget kan laese den
 * uaendret, og tallet naar aldrig spilleren (#1791).
 *
 * `jury` (#5515) er KUN for enkeltstarten, hvor enheden er én rytter: juryen
 * (#5582, `juryReinstatements`) doemmer ham paa sluttid minus uheldets
 * tidstab, og en genindsat rytter beholder status "finished" med
 * `reinstated_by: "jury"`. Udeladt = hold-graensen bit-uaendret.
 */
export function applyTeamTimeLimit(args: {
  results: readonly StageResult[];
  profileType: ProfileType | null | undefined;
  distanceKm: number;
  tuning?: TimeLimitTuning;
  jury?: TimeLimitJuryInput;
}): TeamTimeLimitOutcome {
  const tuning = args.tuning ?? TIME_LIMIT_TUNING;
  const finishers = args.results.filter((r) => r.status === "finished");
  const unchanged: TeamTimeLimitOutcome = {
    results: args.results.map((r) => ({ ...r })),
    events: [],
    limitSeconds: 0,
    winnerTimeSeconds: 0,
    otlTeamGroupIds: [],
    juryReinstatedRiderIds: [],
  };
  if (finishers.length === 0) return unchanged;

  const winnerTimeSeconds = finishers.reduce((min, r) => Math.min(min, r.time_seconds), finishers[0].time_seconds);
  const limitSeconds = timeLimitSecondsFor(winnerTimeSeconds, args.profileType, tuning);

  const overLimitGroups = new Set(finishers.filter((r) => r.time_seconds > limitSeconds).map((r) => r.group_id));
  if (overLimitGroups.size === 0) return { ...unchanged, limitSeconds, winnerTimeSeconds };

  const overLimitRiderIds = new Set(finishers.filter((r) => overLimitGroups.has(r.group_id)).map((r) => r.rider_id));
  const juryIds = new Set(
    args.jury ? juryReinstatements({ results: args.results, otlRiderIds: overLimitRiderIds, limitSeconds, jury: args.jury }) : [],
  );

  const results = args.results.map((r) => {
    if (juryIds.has(r.rider_id)) return { ...r, reinstated_by: "jury" as const };
    if (overLimitRiderIds.has(r.rider_id)) return { ...r, status: OTL_STATUS };
    return { ...r };
  });
  const otlRiderIds = results.filter((r) => r.status === OTL_STATUS).map((r) => r.rider_id);
  const juryReinstatedRiderIds = results.filter((r) => juryIds.has(r.rider_id)).map((r) => r.rider_id);
  const otlGroups = new Set(results.filter((r) => r.status === OTL_STATUS).map((r) => r.group_id));

  const finishKm = round2(args.distanceKm);
  const events: TimelineEvent[] = [];
  if (juryReinstatedRiderIds.length > 0) {
    // Samme event og form som vejetapens jury (timeLimit.ts): antal, aldrig et tal.
    events.push({
      km: finishKm,
      type: JURY_REINSTATED_EVENT,
      params: { rider_ids: juryReinstatedRiderIds, rider_count: juryReinstatedRiderIds.length },
    });
  }
  if (otlRiderIds.length > 0) {
    events.push({
      km: finishKm,
      type: OUTSIDE_TIME_LIMIT_EVENT,
      params: { rider_ids: otlRiderIds, rider_count: otlRiderIds.length },
    });
  }
  return {
    results,
    events,
    limitSeconds,
    winnerTimeSeconds,
    otlTeamGroupIds: [...otlGroups].sort(),
    juryReinstatedRiderIds,
  };
}

// ── Top-niveau: hele TTT-etapen, alle hold ─────────────────────────────────────

/**
 * M13 (#4030): simulerer en HEL TTT-etape for alle deltagende hold og
 * returnerer et StageOutput-formet resultat (+ `teams`-opsummering, se
 * TeamTimeTrialOutput). index.ts's `simulateStageV4` forgrener paa
 * `input.route.profile_type === "ttt"` og kalder denne funktion med en
 * TeamRoster[] fra adapters/teamRosterAdapter.ts.
 *
 * "K'te rytters passage" (#2412): holdets officielle tid = round2(elapsed)
 * for den `TTT_EXTRA_TUNING.countbackRiderRank`'te ankomst blandt de ryttere
 * der KOM I MAAL (ankomst-sorteret; ryttere der aldrig droppes ankommer alle
 * samtidigt = holdets faelles tempo, droppede ryttere ankommer senere,
 * individuelt; en udgaaet rytter krydser aldrig stregen). ALLE holdets
 * startende ryttere faar denne tid i `results` (mor-spec §3.2 rent
 * gruppe-princip, #2412: "Alle ryttere paa holdet faar holdets tid i GC" —
 * v1-default; individuel afvigelse for droppede ryttere er eksplicit en
 * v2-detalje i #2412's egen skitse). `loads` afspejler derimod HVER rytters
 * REELLE fysiologiske forbrug (inkl. droppede ryttere, jf.
 * #3459-loebsdagskontrakten: belastning maales paa reelt arbejde, ikke paa
 * den nominelle klassements-tid).
 *
 * Placerings-raekkefoelgen inden for et hold (#4915) er den FAKTISKE ankomst:
 * holdets kerne foran, droppede ryttere efter i den raekkefoelge de kom i maal
 * (derefter rider_id). Den bestemmer hvem der faar maalpointene (M9), saa en
 * rytter holdet satte af kan ikke staa foran en holdkammerat der holdt hjulet.
 */
export function simulateTeamTimeTrialStage(
  route: RouteV2,
  teams: TeamRoster[],
  seed: string,
  tuning: EngineTuning,
  options: TeamTimeTrialOptions = {},
): TeamTimeTrialOutput {
  return runTimeTrialStage(route, teams, seed, tuning, options, TEAM_TIME_TRIAL_MODE);
}

/** Holdtidskoerslens variant af kernen: work-rotation i holdet, hold-events, gap-kurve pr. hold. */
const TEAM_TIME_TRIAL_MODE: TimeTrialMode = {
  groupPrefix: "ttt",
  // `ttt_win` og IKKE "team_time_trial" (wiringen 6/9): det er den win_type
  // baade v3's raceTimeline.js og loebsfilmen (frontend/src/lib/
  // stageTimelineFilm.js's WIN_TYPE_KEY) allerede kender, med faerdig
  // spiller-copy paa en+da ("leads home the fastest team of the day").
  // Et selvopfundet navn ville tavst falde tilbage paa den generiske
  // "finish"-linje — mekanikken var bygget foer filmen fik sine TT-varianter.
  winType: "ttt_win",
  unitEvents: true,
  gapUpdates: true,
  intermediatePassages: false,
  individualJury: false,
  tickUnitSegment: (unit, segment, segmentIndex, tuning) =>
    tickTeamSegment(segment, segmentIndex, unit.roster, unit.entrantsById, unit.riders, tuning),
};

/**
 * #5515: juryens input i en enkeltstart — etapens uheld og rytterens
 * indsatsvalg. Intet hold (en enkeltstart har ingen holdkammerat paa vejen) og
 * ingen jagt-tab (ingen gruppe at jage tilbage til).
 */
function timeTrialJuryInput(teams: readonly TeamRoster[], incidents: readonly StageIncident[]): TimeLimitJuryInput {
  const effortByRider: Record<string, Entrant["effort"]> = {};
  for (const team of teams) {
    for (const entrant of team.riders) effortByRider[entrant.rider_id] = entrant.effort;
  }
  return { incidents, effortByRider };
}

/**
 * Tidskoersels-kernen (#5576): M13's etape-model med enhedens eget tik som
 * eneste variabel. `simulateTeamTimeTrialStage` koerer den med hold som
 * enheder (bit-uaendret mod foer udskillelsen); mechanics/individualTimeTrial.ts
 * koerer den med én rytter pr. enhed. Se `TimeTrialMode` for forskellene.
 */
export function runTimeTrialStage(
  route: RouteV2,
  teams: TeamRoster[],
  seed: string,
  tuning: EngineTuning,
  options: TeamTimeTrialOptions,
  mode: TimeTrialMode,
): TeamTimeTrialOutput {
  const incidentsTuning = options.incidentsTuning ?? INCIDENTS_EXTRA_TUNING;
  const totalFieldCount = teams.reduce((sum, t) => sum + t.riders.length, 0);
  const events: TimelineEvent[] = [];
  events.push(
    makeEvent(0, "stage_start", { field_count: totalFieldCount, profile_type: route.profile_type, distance_km: route.distance_km }),
  );

  const perTeam: TeamState[] = teams.map((roster) => ({
    roster,
    teamGroupId: `${mode.groupPrefix}-${roster.team_id}`,
    entrantsById: Object.fromEntries(roster.riders.map((r) => [r.rider_id, r])) as Record<string, Entrant>,
    riders: initInternalRiders(roster, tuning, seed),
    lastEmittedGap: undefined,
  }));

  const rngForStage = boundRngFor(seed);
  const stageIncidents: StageIncident[] = [];
  const groupSnapshots: SegmentGroupSnapshot[] = [];
  const intermediatePassages: StagePassage[] = [];

  for (let segmentIndex = 0; segmentIndex < route.segments.length; segmentIndex++) {
    const segment = route.segments[segmentIndex];
    const elapsedAtSegmentStart = new Map<string, number>();
    if (mode.intermediatePassages) {
      for (const t of perTeam) {
        for (const r of t.roster.riders) elapsedAtSegmentStart.set(r.rider_id, t.riders[r.rider_id].elapsed_seconds);
      }
    }

    for (const t of perTeam) {
      const newlyDropped = mode.tickUnitSegment(t, segment, segmentIndex, tuning);
      if (!mode.unitEvents) continue;
      for (const riderId of newlyDropped) {
        events.push(makeEvent(segment.to_km, "ttt_rider_dropped", { team_id: t.roster.team_id, rider_id: riderId, group_id: t.teamGroupId }));
      }
    }

    // M9 undervejs (#5576): paa tikket, foer segmentets uheld (se
    // timeTrialIntermediatePassages).
    if (mode.intermediatePassages) {
      intermediatePassages.push(
        ...timeTrialIntermediatePassages({ route, segment, perTeam, elapsedAtSegmentStart, tuning }),
      );
    }

    // M10 (#4915): efter segmentets tik, foer snapshot — et tidstab paa dette
    // segment er dermed med i holdets position ved segmentets slutning.
    const segmentIncidents = rollSegmentIncidents({
      perTeam,
      route,
      segment,
      rngFor: segmentRngFor(rngForStage, segmentIndex),
      fieldSize: totalFieldCount,
      loggedCount: stageIncidents.length,
      tuning: incidentsTuning,
    });
    stageIncidents.push(...segmentIncidents.incidents);
    events.push(...segmentIncidents.events);

    // Holdets "position" for snapshot/gap-formaal: mindste elapsed blandt
    // holdets ryttere der stadig er paa vejen (den der er laengst fremme —
    // enten hele med-holdet-gruppen paa faelles tempo, eller den senest
    // droppede rytter). En udgaaet rytter tikker ikke mere, saa hans tid er
    // frosset og ville ellers traekke holdet "frem".
    const teamProxyElapsed = new Map<string, number>();
    for (const t of perTeam) {
      let minElapsed = Infinity;
      let maxElapsed = 0;
      for (const r of t.roster.riders) {
        const rider = t.riders[r.rider_id];
        maxElapsed = Math.max(maxElapsed, rider.elapsed_seconds);
        if (rider.status !== "abandoned") minElapsed = Math.min(minElapsed, rider.elapsed_seconds);
      }
      teamProxyElapsed.set(t.roster.team_id, Number.isFinite(minElapsed) ? minElapsed : maxElapsed);
    }
    const bestElapsed = Math.min(...[...teamProxyElapsed.values(), Infinity]);

    const groupEntries = perTeam.map((t) => {
      const stillWithTeam = t.roster.riders.filter((r) => t.riders[r.rider_id].status === "with_team").map((r) => r.rider_id);
      const gapSeconds = round2(Math.max(0, (teamProxyElapsed.get(t.roster.team_id) ?? 0) - bestElapsed));
      const kind: GroupKind = stillWithTeam.length <= 1 ? "solo" : "peloton";
      return { group_id: t.teamGroupId, kind, rider_ids: stillWithTeam, gap_seconds: gapSeconds };
    });
    groupSnapshots.push({ km: round2(segment.to_km), groups: groupEntries });

    if (!mode.gapUpdates) continue;
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
  const unsortedResults: StageResult[] = [];
  const loads: RiderLoad[] = [];
  const teamResults: TeamTimeTrialTeamResult[] = [];
  const arrivalElapsedByRider = new Map<string, number>();

  // Skadedage pr. rytter (M10, #2944): den LAENGSTE skade taeller, samme regel
  // som index.ts's buildResults.
  const injuryDaysByRider = new Map<string, number>();
  for (const incident of stageIncidents) {
    if (incident.injury_days == null) continue;
    const current = injuryDaysByRider.get(incident.rider_id) ?? 0;
    if (incident.injury_days > current) injuryDaysByRider.set(incident.rider_id, incident.injury_days);
  }

  for (const t of perTeam) {
    const arrived = t.roster.riders
      .filter((r) => t.riders[r.rider_id].status !== "abandoned")
      .map((r) => ({ rider_id: r.rider_id, elapsed: t.riders[r.rider_id].elapsed_seconds }))
      .sort((a, b) => a.elapsed - b.elapsed || a.rider_id.localeCompare(b.rider_id));
    const rank = clamp(TTT_EXTRA_TUNING.countbackRiderRank, 1, Math.max(1, arrived.length));
    const counted = arrived[rank - 1] ?? arrived[arrived.length - 1];
    // Et hold hvor ALLE udgik har ingen ankomst; tiden er da den seneste
    // frosne tid (rytterne staar alligevel som udgaaede, bagest).
    const fallbackElapsed = Math.max(0, ...t.roster.riders.map((r) => t.riders[r.rider_id].elapsed_seconds));
    const teamTimeSeconds = round2(counted?.elapsed ?? fallbackElapsed);
    const droppedIds = t.roster.riders.filter((r) => t.riders[r.rider_id].status === "dropped").map((r) => r.rider_id).sort();
    const abandonedIds = t.roster.riders.filter((r) => t.riders[r.rider_id].status === "abandoned").map((r) => r.rider_id).sort();

    teamResults.push({
      team_id: t.roster.team_id,
      team_group_id: t.teamGroupId,
      time_seconds: teamTimeSeconds,
      counted_rider_id: counted?.rider_id ?? "",
      arrived_rider_ids: arrived.map((a) => a.rider_id),
      dropped_rider_ids: droppedIds,
      abandoned_rider_ids: abandonedIds,
      outside_time_limit: false,
    });

    if (mode.unitEvents) {
      events.push(
        makeEvent(finishKm, "ttt_team_result", {
          team_id: t.roster.team_id,
          group_id: t.teamGroupId,
          time_seconds: teamTimeSeconds,
          counted_rider_id: counted?.rider_id ?? "",
          dropped_rider_ids: droppedIds,
        }),
      );
    }

    for (const r of t.roster.riders) {
      const internal = t.riders[r.rider_id];
      arrivalElapsedByRider.set(r.rider_id, internal.elapsed_seconds);
      unsortedResults.push({
        rider_id: r.rider_id,
        rank: 0,
        time_seconds: teamTimeSeconds,
        group_id: t.teamGroupId,
        status: internal.status === "abandoned" ? "abandoned" : "finished",
        injury_days: injuryDaysByRider.get(r.rider_id) ?? null,
      });
      loads.push({
        rider_id: r.rider_id,
        wprime_depleted_j_norm: round2(Math.max(0, internal.wprimeMax - internal.wprime)),
        seconds_over_cp: round2(internal.seconds_over_cp),
        work_norm: round2(internal.work_norm),
      });
    }
  }

  // Placering: udgaaede altid bagest (#2944, samme regel som buildResults),
  // ellers holdtid -> faktisk ankomst -> rider_id.
  const arrival = (riderId: string): number => arrivalElapsedByRider.get(riderId) ?? Number.MAX_SAFE_INTEGER;
  const byArrival = (a: StageResult, b: StageResult): number =>
    a.time_seconds - b.time_seconds || arrival(a.rider_id) - arrival(b.rider_id) || a.rider_id.localeCompare(b.rider_id);
  const finishedSorted = unsortedResults.filter((r) => r.status !== "abandoned").sort(byArrival);
  const abandonedSorted = unsortedResults.filter((r) => r.status === "abandoned").sort(byArrival);
  // M10's 3 km-regel er en placerings-konsekvens (en no-op paa en ttt i dag,
  // se rollSegmentIncidents) og maa kun flytte ryttere der kom i maal.
  const rankedResults: StageResult[] = [
    ...applyThreeKmRuleToResults(finishedSorted, sortTimeline(events)),
    ...abandonedSorted,
  ].map((r, index) => ({ ...r, rank: index + 1 }));
  loads.sort((a, b) => a.rider_id.localeCompare(b.rider_id));

  // M15 som hold-graense (#4915). Enkeltstarten faar juryen per rytter (#5515);
  // holdtidskoerslen er uaendret (se TimeTrialMode.individualJury).
  const timeLimit = applyTeamTimeLimit({
    results: rankedResults,
    profileType: route.profile_type,
    distanceKm: route.distance_km,
    tuning: options.timeLimitTuning,
    jury: mode.individualJury ? timeTrialJuryInput(teams, stageIncidents) : undefined,
  });
  const results = timeLimit.results;
  const otlGroups = new Set(timeLimit.otlTeamGroupIds);
  for (const team of teamResults) team.outside_time_limit = otlGroups.has(team.team_group_id);

  // M9 (#4915): maalpassagen paa den endelige placeringsraekkefoelge. Samme
  // funktioner som index.ts's vejetape-vej, saa skala og bonus-gate er de samme.
  const passages: StagePassage[] = clampPassageBonusToPerRiderCap(
    sortPassages([
      ...intermediatePassages,
      ...buildFinishPassages({
        results,
        waypoints: route.waypoints,
        distanceKm: route.distance_km,
        profileType: route.profile_type,
        finaleType: route.finale_type,
        tuning: tuning.bonusSeconds,
      }),
    ]),
  );

  const winnerTime = results[0]?.time_seconds ?? 0;
  const top = results.slice(0, Math.min(10, results.length)).map((r) => ({ rider_id: r.rider_id, rank: r.rank, gap: round2(r.time_seconds - winnerTime) }));
  const finish = finishEvent(finishKm, { top, winType: mode.winType });

  // Samme raekkefoelge som index.ts's vejetape-vej: alt paa sit eget km,
  // derefter finish-eventet, derefter tidsgraensens events (de kan foerst
  // afgoeres naar vinderen er i maal — #2410 §2.3 regel 4).
  const timelineEvents = [...sortTimeline([...events, ...passagesToTimelineEvents(passages)]), finish, ...timeLimit.events];

  return {
    timeline: { timeline_version: 2, events: timelineEvents },
    results,
    loads,
    groupSnapshots,
    incidents: [...stageIncidents].sort((a, b) => a.km - b.km || a.rider_id.localeCompare(b.rider_id)),
    passages,
    // UCI 2.6.032 (#5582): en genindsat rytter mister etapens point. En
    // holdtidskoersel genindsaetter aldrig nogen, saa den er bit-uaendret.
    passage_totals: applyReinstatementPointPenalty(passageTotals(passages), reinstatedRiderIdsOf(timeLimit)),
    teams: teamResults,
  };
}
