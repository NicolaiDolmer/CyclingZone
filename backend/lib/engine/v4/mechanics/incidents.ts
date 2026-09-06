// backend/lib/engine/v4/mechanics/incidents.ts
// Race Engine v4 F3 (#4030 #4080): M10 - incidents med km-maerke + 3 km-reglen.
// SSOT: docs/superpowers/specs/2026-08-20-race-engine-v4-intra-stage-design.md
// §4 M10 + §8 beslutning 8 ("styrt sidste 3 km paa flade etaper = gruppens
// tid, kun placeringen ryger; ingen regel paa bjergetaper").
// F2-kerne: docs/superpowers/specs/2026-08-21-race-engine-v4-f2-core-design.md
// §3/§4 (segment-loop + mekanik-hook-kontrakten denne fil bygger imod).
//
// REN — ingen import fra oevrigt backend, ingen IO/Date/Math.random. Rene
// funktioner: input-state muteres aldrig, nyt state/array returneres (samme
// determinisme-krav som segmentLoop.ts/groups.ts).
//
// BYGGER OVEN PAA M3 (descent.ts): descent.ts taeller I DAG kun incidents op
// for descent-angribere (ren information, ingen tid/gruppe-effekt — se dens
// egen topkommentar). Denne fil GENBRUGER moenstret (seedet rng-stream pr.
// rytter, kmFrac-udtraekning inden for segmentet, `rider.incidents`-taelleren)
// men er BEVIDST BREDERE: incidentHook() rammer ALLE ryttere der stadig raser
// (status "racing"), paa ALLE segment-kinds — ikke kun descent-angribere — og
// har en REEL konsekvens (M10 ejer eksplicit "abandon/tidsstraf" jf. descent.ts's
// egen kommentar): et styrt UDEN 3 km-reglens beskyttelse splitter rytteren
// bagud i en ny solo-gruppe med et sekund-tab (rent gruppe-princip, groups.ts).
//
// ── #2944 TRAPPEN (ejer-beslutning 6/9, LAAST) ──────────────────────────────
// Ejerens klage (Discord 1/8, #2944): et styrt er i dag et BINAERT totaltab —
// enten intet, eller ude af loebet med skadedage. Varians uden mitigering
// opleves som uretfaerdighed, ikke spaending. Trappen erstatter det binaere:
//
//   TRIN 1  let styrt        tidstab, koerer videre               (ingen skade)
//   TRIN 2  haardt styrt     stort tidstab + skade i dage
//   TRIN 3  alvorligt styrt  udgaar (status "abandoned") + skadedage. SJAELDENT
//   TRIN 4  mekanisk uheld   ALTID kun tidstab. ALDRIG udgaaelse, ALDRIG skade.
//                            En hjaelper taet paa => hurtigere hjulskift =>
//                            STRENGT mindre tidstab.
//
// SKADE-REGLEN (#4520, allerede v3's regel i raceIncidents.js:108-117 og
// raceRunner.js:1431): KUN et styrt kan skade en rytter. Det er haandhaevet
// STRUKTURELT her — `resolveIncident` har praecis ÉN gren der kan saette
// injury_days, og den ligger inde i styrt-grenen. En mekanisk hændelse kan
// pr. konstruktion ikke naa den (property-testet over 500 seeds).
//
// HYPPIGHED: ejerens maal er ca. 1-2 % af rytterne pr. etape (#2944). To ting
// baerer det: (a) risikoen skaleres PR. KM (referenceSegmentKm) i stedet for
// pr. segment, saa rute-modellens granularitet ikke bestemmer raten, og (b) et
// HAARDT LOFT pr. etape arvet fra v3 (INCIDENT_MAX_FIELD_SHARE = 5 % af
// feltet). Loftet er regressionsvagt; maalet er basis-risikoen.
//
// 3 KM-REGLEN (mor-spec §8 beslutning 8): et styrt med km-maerke INDEN FOR
// tuning.threeKmRuleWindowKm af maalstregen PAA EN FLAD ETAPE (INCIDENTS_EXTRA_
// TUNING.flatProfileTypes) giver INGEN tidskonsekvens — rytteren bliver i sin
// gruppe med gruppens tid. Konsekvensen er REN PLACERING: incidentHook emitterer
// blot et "incident"-event med outcome "protected_three_km_rule" (ingen state-
// aendring); den faktiske placerings-demotion sker i EN SEPARAT postprocessing-
// funktion (applyThreeKmRuleToResults) fordi rank/placering foerst eksisterer
// EFTER hele segment-loopet (index.ts's buildResults, som denne fil ikke maa
// aendre — frosset for mig, jf. haarde regler). Se filens bundtekst for
// WIRING-BEHOV (index.ts skal kalde begge eksporter — arkitekt-scope).
//
// MONOTONI-BEMAERKNING: styrt er UHELD, ikke en testet evne-sammenligning (til
// forskel fra M2/klatring og M3/nedkoersel) — SS2 invariant 3's monotoni-krav
// gaelder kun mekanikker der SAMMENLIGNER ryttere paa en evne segmentet tester.
// incidentProbability() daemper DOG risikoen strengt monotont af positioning-
// evnen (samme "aldrig omvendt fortegn"-disciplin som descent.ts's
// incidentProbability), og unprotectedTimeLossSecondsRange er BEVIDST IKKE
// evne-skaleret (et uheld rammer lige haardt uanset offerets evner).

import type {
  EngineState,
  Entrant,
  IncidentKind,
  IncidentOutcome,
  IncidentSeverity,
  ProfileType,
  RaceGroup,
  RiderState,
  Segment,
  SegmentHookContext,
  SegmentHookResult,
  SegmentKind,
  StageIncident,
  StageResult,
  TimelineEvent,
} from "../types.ts";
import { makeGroupId, splitGroup } from "../groups.ts";
import { incidentEvent } from "../timeline.ts";
import { INCIDENTS_EXTRA_TUNING } from "../tuning.ts";

type IncidentsTuning = typeof INCIDENTS_EXTRA_TUNING;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ── Pure helpers (eksporteret for direkte kontrakt-tests) ────────────────────

/**
 * Seedet styrt-risiko for én rytter i ét segment (genbruger descent.ts's
 * incidentProbability-moenster): basis-risiko pr. segment-kind daempet
 * lineaert af positioning-evnen (0-99-skala, point-for-point). ALDRIG omvendt
 * fortegn: clamp [0,1] fanger baade "ingen risiko" og "daempning overstiger basis".
 */
export function incidentProbability(
  positioningAbility: number,
  segmentKind: SegmentKind,
  tuning: Pick<typeof INCIDENTS_EXTRA_TUNING, "baseRiskPerSegment" | "positioningDampening">,
): number {
  const ability = clamp(Number(positioningAbility) || 0, 0, 99);
  const base = tuning.baseRiskPerSegment[segmentKind] ?? 0;
  return clamp(base - tuning.positioningDampening * ability, 0, 1);
}

/** Er `profileType` en "flad etape" i 3 km-reglens forstand (mor-spec §8 beslutning 8)? */
export function isFlatStageForThreeKmRule(
  profileType: ProfileType,
  tuning: Pick<typeof INCIDENTS_EXTRA_TUNING, "flatProfileTypes">,
): boolean {
  return tuning.flatProfileTypes.includes(profileType);
}

/** Er `km` inden for `tuning.threeKmRuleWindowKm` af maalstregen (`distanceKm`)? */
export function isWithinThreeKmWindow(
  km: number,
  distanceKm: number,
  tuning: Pick<typeof INCIDENTS_EXTRA_TUNING, "threeKmRuleWindowKm">,
): boolean {
  return km >= 0 && km <= distanceKm && distanceKm - km <= tuning.threeKmRuleWindowKm;
}

/**
 * 3 km-reglen (mor-spec §8 beslutning 8): begge betingelser skal holde —
 * flad etape OG styrtet inden for vinduet fra maalstregen. Ingen regel paa
 * bjergetaper, uanset km-maerke.
 */
export function threeKmRuleApplies(
  km: number,
  distanceKm: number,
  profileType: ProfileType,
  tuning: Pick<typeof INCIDENTS_EXTRA_TUNING, "flatProfileTypes" | "threeKmRuleWindowKm">,
): boolean {
  return isFlatStageForThreeKmRule(profileType, tuning) && isWithinThreeKmWindow(km, distanceKm, tuning);
}

// ── #2944: laengde-skalering, felt-loft, hjaelper-naerhed, trappen ───────────

/**
 * Laengde-faktoren for ét segment: `baseRiskPerSegment` er defineret for et
 * segment paa `referenceSegmentKm`, og skaleres LINEAERT med den faktiske
 * laengde. Uden den bestemmer rute-modellens SEGMENT-ANTAL uheldsraten pr.
 * etape i stedet for etapens laengde (en bjergetape splittes i 12 segmenter,
 * en flad i 3 — samme risiko pr. segment ville give 4x raten paa bjerget).
 *
 * Aldrig negativ; et 0-km segment giver praecis 0.
 */
export function segmentLengthFactor(
  segment: Pick<Segment, "from_km" | "to_km">,
  tuning: Pick<IncidentsTuning, "referenceSegmentKm">,
): number {
  const lengthKm = Math.max(0, (Number(segment.to_km) || 0) - (Number(segment.from_km) || 0));
  const reference = tuning.referenceSegmentKm > 0 ? tuning.referenceSegmentKm : 1;
  return lengthKm / reference;
}

/**
 * v3's HAARDE LOFT pr. etape (raceIncidents.rollIncidents' INCIDENT_MAX_FIELD_
 * SHARE, default 0,05), arvet 1:1 inkl. `Math.ceil`-afrundingen — et lille felt
 * faar altid mindst ét muligt uheld.
 *
 * FORSKEL FRA v3 (bevidst): v3 ruller HELE etapen paa én gang og beholder ved
 * overskridelse de "mest afgoerende" hits (lavest u1). v4's hook kaldes pr.
 * SEGMENT og kan ikke se fremad, saa loftet er KRONOLOGISK: etapens foerste N
 * uheld staar. Begge er deterministiske haarde graenser ved samme andel.
 */
export function maxIncidentsForField(
  fieldSize: number,
  tuning: Pick<IncidentsTuning, "maxIncidentsFieldShare">,
): number {
  const n = Math.max(0, Math.floor(Number(fieldSize) || 0));
  if (n === 0) return 0;
  return Math.ceil(tuning.maxIncidentsFieldShare * n);
}

/**
 * "En hjaelper taet paa" (ejer-beslutning 6/9). "TAET PAA" er defineret som:
 * en ANDEN rytter der stadig raser og ligger i SAMME GRUPPE i dette segment.
 * Gruppen ER naerheds-modellen i v4 (mor-spec §3.2) — der findes ingen finere
 * positions-akse at maale afstand paa.
 *
 * HVORFOR ROLLE og ikke hold: `Entrant` (types.ts, frossen kerne-kontrakt)
 * baerer INTET team_id — kernen kender rolle, evner, effort og condition, ikke
 * holdtilhoersforhold. Rollen `helper` er derfor den del af ejerens formulering
 * ("rolle helper eller holdkammerat i samme gruppe") der faktisk kan afgoeres
 * her. Naar/hvis team_id lander i Entrant, strammes definitionen til
 * "holdkammerat ELLER helper i samme gruppe" ved at udvide DENNE ene funktion.
 */
export function hasHelperNearby(
  groupRiderIds: readonly string[],
  entrants: Readonly<Record<string, Entrant>>,
  riders: Readonly<Record<string, RiderState>>,
  victimRiderId: string,
): boolean {
  for (const riderId of groupRiderIds) {
    if (riderId === victimRiderId) continue;
    if (riders[riderId]?.status !== "racing") continue;
    if (entrants[riderId]?.role === "helper") return true;
  }
  return false;
}

/** De fire uafhaengige lodtraekninger ét uheld bruger. Alle uniform [0, 1). */
export type IncidentRolls = {
  kind: number; // art: mekanisk vs. styrt
  severity: number; // alvorstrin (kun laest for styrt)
  magnitude: number; // sekunder inden for trinnets spaend
  injury: number; // dage inden for trinnets spaend
};

export type ResolvedIncident = {
  kind: IncidentKind;
  severity: IncidentSeverity | null;
  outcome: IncidentOutcome;
  timeLossSeconds: number | null;
  injuryDays: number | null;
  helperAssist: boolean;
};

/**
 * TRAPPEN, som REN funktion (#2944, ejer-beslutning 6/9). Fire lodtraekninger
 * ind, ét udfald ud — ingen state, ingen rng, ingen tid.
 *
 * STRUKTUREL GARANTI: der findes praecis ÉN `return` der kan baere
 * `injuryDays !== null` eller `outcome === "abandoned"`, og den ligger INDE i
 * styrt-grenen efter `if (isMechanical) return ...`. En mekanisk haendelse kan
 * derfor ikke naa dem — det er #4520's regel haandhaevet af kontrolstroemmen,
 * ikke af et filter der kan glemmes.
 *
 * 3 KM-REGLEN og ALVOREN er UAFHAENGIGE akser: reglen beskytter TIDEN (mor-spec
 * §8 beslutning 8 handler om etapetiden), ikke kroppen. Et haardt styrt inden
 * for de sidste 3 km giver derfor stadig skadedage — rytteren faar gruppens tid,
 * men han er lige saa forslaaet. Et ALVORLIGT styrt udgaar uanset km-maerket:
 * en rytter der ikke koerer over stregen kan ikke faa gruppens tid.
 */
export function resolveIncident(
  rolls: IncidentRolls,
  context: { protectedByRule: boolean; helperNearby: boolean },
  tuning: IncidentsTuning,
): ResolvedIncident {
  const spanValue = (range: readonly [number, number], u: number): number => range[0] + u * (range[1] - range[0]);

  // ── TRIN 4: mekanisk uheld. Kan pr. konstruktion KUN koste tid. ──────────
  if (rolls.kind < tuning.mechanicalShare) {
    const helperAssist = context.helperNearby;
    const raw = spanValue(tuning.mechanicalTimeLossSecondsRange, rolls.magnitude);
    const scaled = helperAssist ? raw * tuning.mechanicalHelperTimeLossFactor : raw;
    return {
      kind: "mechanical",
      severity: null,
      outcome: context.protectedByRule ? "protected_three_km_rule" : "time_loss",
      timeLossSeconds: context.protectedByRule ? null : round2(scaled),
      injuryDays: null,
      helperAssist,
    };
  }

  // ── Styrt: alvorstrinnet afgoeres af sin EGEN lodtraekning. ──────────────
  const { hard, serious } = tuning.crashSeverityShares;
  const severity: IncidentSeverity =
    rolls.severity < serious ? "serious" : rolls.severity < serious + hard ? "hard" : "light";

  // TRIN 3: alvorligt styrt — udgaar. Ingen etapetid at tabe.
  if (severity === "serious") {
    return {
      kind: "crash",
      severity,
      outcome: "abandoned",
      timeLossSeconds: null,
      injuryDays: Math.round(spanValue(tuning.seriousCrashInjuryDaysRange, rolls.injury)),
      helperAssist: false,
    };
  }

  // TRIN 1 (let) og TRIN 2 (haardt). Kun trin 2 skader.
  const injuryDays =
    severity === "hard" ? Math.round(spanValue(tuning.hardCrashInjuryDaysRange, rolls.injury)) : null;
  const lossRange =
    severity === "hard" ? tuning.hardCrashTimeLossSecondsRange : tuning.unprotectedTimeLossSecondsRange;
  return {
    kind: "crash",
    severity,
    outcome: context.protectedByRule ? "protected_three_km_rule" : "time_loss",
    timeLossSeconds: context.protectedByRule ? null : round2(spanValue(lossRange, rolls.magnitude)),
    injuryDays,
    helperAssist: false,
  };
}

/**
 * M10-mekanikken: incidents med km-maerke + #2944's trappe, kaldt paa ETHVERT
 * segment (til forskel fra M2/M3, som kun kaldes paa hhv. climb/descent).
 *
 * Pr. stadig-racende rytter rulles en seedet, positioning-daempet og
 * laengde-skaleret risiko. Ved hit afgoer `resolveIncident` trinnet, og
 * konsekvensen paafoeres:
 *   - `protected_three_km_rule`  ingen gruppe-/tidsaendring (kun event +
 *                                evt. skadedage ved haardt styrt)
 *   - `time_loss`                split til egen solo-gruppe med sekund-tabet
 *   - `abandoned`                status "abandoned" + split ud af feltet, saa
 *                                han hverken traekker tempo eller merges tilbage
 *
 * REN: intet input muteres, samme (state, ctx) -> samme output.
 *
 * RNG-STREAMS ER SEGMENT-NOEGLEDE. `ctx.rngFor(mechanic, riderId)` er noeglet
 * paa (seed, mechanic, riderId) ALENE, saa den samme mekanik-streng ville give
 * den SAMME foerste vaerdi paa hvert eneste segment. For en mekanik der kaldes
 * pr. segment betyder det, at en rytter der styrter paa segment 0 ogsaa styrter
 * paa hvert oevrigt segment af samme kind. Denne fil laegger derfor segment-
 * indekset i mekanik-strengen (`incident:s3`). Per-rytter-hash-egenskaben er
 * uaendret: udfaldet afhaenger stadig KUN af (seed, segment, rider_id) — ikke
 * af hvem andre der er med i loebet.
 *
 * Fabrikken er eksporteret separat (i stedet for at hardkode INCIDENTS_EXTRA_
 * TUNING inde i funktionskroppen) saa tests kan injicere en rigget tuning —
 * fx risiko=1 for at gøre et styrt deterministisk uden at braekke
 * rng-stream-kontrakten — uden at aendre den rigtige eksports to-argument
 * (state, ctx)-signatur, som er strukturelt identisk med de oevrige hooks.
 */
export function createIncidentHook(
  tuning: IncidentsTuning,
): (state: EngineState, ctx: SegmentHookContext) => SegmentHookResult {
  return function incidentHookImpl(state: EngineState, ctx: SegmentHookContext): SegmentHookResult {
    const { segment, route, entrants, rngFor, segmentIndex } = ctx;
    const events: TimelineEvent[] = [];

    const logged: StageIncident[] = state.stage_incidents ?? [];
    const fieldSize = Object.keys(state.riders).length;
    let budget = maxIncidentsForField(fieldSize, tuning) - logged.length;
    if (budget <= 0) return { state, events };

    const lengthFactor = segmentLengthFactor(segment, tuning);
    if (lengthFactor <= 0) return { state, events };

    // Kandidaterne behandles i STABIL rider_id-orden paa tvaers af ALLE grupper
    // (ikke gruppe-for-gruppe), saa etape-loftet fordeles uafhaengigt af hvilken
    // raekkefoelge grupperne tilfaeldigvis staar i — samme disciplin som v3's
    // rollIncidents, der ogsaa sorterer feltet paa rider_id foer lodtraekningen.
    const candidates: Array<{ riderId: string; group: RaceGroup }> = [];
    for (const group of state.groups) {
      for (const riderId of group.rider_ids) {
        const riderState = state.riders[riderId];
        if (!entrants[riderId] || !riderState || riderState.status !== "racing") continue;
        candidates.push({ riderId, group });
      }
    }
    candidates.sort((a, b) => a.riderId.localeCompare(b.riderId));

    let groups: RaceGroup[] = state.groups;
    let riders: Record<string, RiderState> = state.riders;
    const newIncidents: StageIncident[] = [];
    let seq = 0;
    let changed = false;

    for (const { riderId, group } of candidates) {
      if (budget <= 0) break;

      const entrant = entrants[riderId]!;
      const rng = rngFor(`incident:s${segmentIndex}`, riderId);
      const p = clamp(incidentProbability(entrant.abilities.positioning, segment.kind, tuning) * lengthFactor, 0, 1);
      if (rng() >= p) continue;

      const kmFrac = rng();
      const incidentKm = round2(segment.from_km + kmFrac * (segment.to_km - segment.from_km));
      const protectedByRule = threeKmRuleApplies(incidentKm, route.distance_km, route.profile_type, tuning);
      const helperNearby = hasHelperNearby(group.rider_ids, entrants, riders, riderId);

      const resolved = resolveIncident(
        {
          kind: rngFor(`incident_kind:s${segmentIndex}`, riderId)(),
          severity: rngFor(`incident_severity:s${segmentIndex}`, riderId)(),
          magnitude: rngFor(`incident_time_loss:s${segmentIndex}`, riderId)(),
          injury: rngFor(`incident_injury:s${segmentIndex}`, riderId)(),
        },
        { protectedByRule, helperNearby },
        tuning,
      );

      budget -= 1;

      const rs = riders[riderId];
      riders = {
        ...riders,
        [riderId]: {
          ...rs,
          incidents: rs.incidents + 1,
          status: resolved.outcome === "abandoned" ? "abandoned" : rs.status,
        },
      };

      if (resolved.outcome !== "protected_three_km_rule") {
        // Baade et tidstab og en udgaaelse tager rytteren UD af sin gruppe:
        // han skal hverken traekke tempo eller arve gruppens maaltid.
        const gapDelta =
          resolved.outcome === "abandoned" ? tuning.abandonedGapSeconds : (resolved.timeLossSeconds ?? 0);
        groups = splitGroup(groups, group.id, [riderId], {
          id: makeGroupId("solo", segmentIndex * 1000 + seq),
          kind: "solo",
          gapSecondsDelta: gapDelta,
        });
        seq += 1;
        changed = true;
      }

      newIncidents.push({
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

    if (newIncidents.length === 0) return { state, events };
    const stageIncidents = [...logged, ...newIncidents];
    if (!changed) return { state: { ...state, riders, stage_incidents: stageIncidents }, events };
    return { state: { ...state, groups, riders, stage_incidents: stageIncidents }, events };
  };
}

/** M10-hook wired til den rigtige INCIDENTS_EXTRA_TUNING — se createIncidentHook's JSDoc. */
export const incidentHook = createIncidentHook(INCIDENTS_EXTRA_TUNING);

// ── Postprocessing: 3 km-reglens placerings-demotion (§4 M10) ────────────────

/**
 * Samler rider_id'er hvis SENESTE incident-event denne etape var
 * 3-km-reglen-beskyttet (outcome "protected_three_km_rule"). Ren funktion paa
 * selve tidslinjen — ingen state-afhaengighed.
 */
export function collectThreeKmRuleProtectedRiderIds(timelineEvents: readonly TimelineEvent[]): Set<string> {
  const ids = new Set<string>();
  for (const e of timelineEvents) {
    if (e.type !== "incident") continue;
    if (e.params?.outcome !== "protected_three_km_rule") continue;
    const riderId = e.params?.rider_id;
    if (typeof riderId === "string") ids.add(riderId);
  }
  return ids;
}

/**
 * 3 km-reglens placerings-konsekvens (mor-spec §8 beslutning 8: "kun
 * placeringen ryger"). Ren postprocessing PAA StageOutput.results: en
 * beskyttet rytters `time_seconds` (og dermed `group_id`) er allerede
 * uaendret af incidentHook (den blev aldrig splittet) — denne funktion
 * flytter KUN rytterens rank til sidst inden for sin egen time_seconds-klynge
 * (resten af klyngen rykker tilsvarende op), uden at røre nogen `time_seconds`.
 * Flere beskyttede ryttere i samme klynge ordnes indbyrdes efter rider_id
 * (determinisme). Ingen protected-ryttere => samme array-indhold (nyt array,
 * uaendret raekkefolge).
 *
 * WIRING (arkitekt-scope, index.ts er frosset for mig): kald denne EFTER
 * buildResults(state) og FOER buildFinishEvent(results, ...), med den
 * SORTEREDE tidslinje (inkl. incidentHook's events) som andet argument:
 *   let results = buildResults(state);
 *   results = applyThreeKmRuleToResults(results, sortTimeline(timeline));
 *   const finishEvent = buildFinishEvent(results, input.route.distance_km);
 */
export function applyThreeKmRuleToResults(
  results: readonly StageResult[],
  timelineEvents: readonly TimelineEvent[],
): StageResult[] {
  const protectedIds = collectThreeKmRuleProtectedRiderIds(timelineEvents);
  if (protectedIds.size === 0) return [...results];

  const clusters: StageResult[][] = [];
  for (const r of results) {
    const last = clusters[clusters.length - 1];
    if (last && last[0].time_seconds === r.time_seconds) {
      last.push(r);
    } else {
      clusters.push([r]);
    }
  }

  const reordered: StageResult[] = [];
  for (const cluster of clusters) {
    const unprotected = cluster.filter((r) => !protectedIds.has(r.rider_id));
    const protectedInCluster = cluster
      .filter((r) => protectedIds.has(r.rider_id))
      .sort((a, b) => a.rider_id.localeCompare(b.rider_id));
    reordered.push(...unprotected, ...protectedInCluster);
  }

  return reordered.map((r, index) => ({ ...r, rank: index + 1 }));
}

// ── WIRING (KOBLET IND 6/9, #2944) ──────────────────────────────────────────
//
// Mekanikken er ikke laengere doed kode. Den er wired praecis som M10's gamle
// WIRING-BEHOV-note foreslog (mulighed (a)):
//
// 1. `MechanicHooks.incidents` (types.ts, VALGFRIT felt) + et ubetinget kald i
//    segmentLoop.ts's loop — efter climb/descent-grenen og efter M5 (udbrud),
//    FOER finale-hooket og foer merge-trinnet, saa et uheld i finalen tager
//    rytteren ud af frontgruppen inden opgoeret, og saa splits kan merges igen
//    samme segment.
// 2. `applyThreeKmRuleToResults()` kaldes i index.ts's simulateStageV4 EFTER
//    buildResults(state) og FOER buildFinishEvent(...) — se JSDoc'en ovenfor.
// 3. Rider-status "abandoned" saettes NU af denne fil, men KUN paa trin 3
//    (alvorligt styrt) — ejer-beslutning 6/9. Et mekanisk uheld kan pr.
//    konstruktion aldrig naa dertil (#4520-reglen, se resolveIncident).
// 4. Skadedage baeres videre som `StageResult.injury_days` +
//    `StageOutput.incidents[]` (begge additive/valgfrie), saa flip-
//    infrastrukturen kan persistere dem praecis som v3 goer
//    (raceRunner.persistIncidents -> race_incidents + rider_condition).
