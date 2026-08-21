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
  ProfileType,
  RaceGroup,
  RiderState,
  SegmentHookContext,
  SegmentHookResult,
  SegmentKind,
  StageResult,
  TimelineEvent,
} from "../types.ts";
import { makeGroupId, splitGroup } from "../groups.ts";
import { incidentEvent } from "../timeline.ts";
import { INCIDENTS_EXTRA_TUNING } from "../tuning.ts";

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

type CrashOutcome = { riderId: string; km: number; protectedByRule: boolean; timeLossSeconds: number | null };

/**
 * M10-mekanikken: incidents med km-maerke, tiltaenkt kaldt paa ETHVERT
 * segment (til forskel fra M2/M3, som kun kaldes paa hhv. climb/descent — se
 * filens WIRING-BEHOV-note nederst). Behandler hver gruppe uafhaengigt: for
 * hver stadig-racende rytter rulles en seedet, positioning-daempet
 * styrt-risiko; ved styrt afgoer 3 km-reglen konsekvensen (protected = ingen
 * state-aendring, kun event; unprotected = split til egen solo-gruppe med et
 * seedet sekund-tab). REN: intet input muteres, samme (state, ctx) -> samme
 * output.
 *
 * Fabrikken er eksporteret separat (i stedet for at hardkode INCIDENTS_EXTRA_
 * TUNING inde i funktionskroppen) saa tests kan injicere en rigget tuning —
 * fx risiko=1 for at gøre et styrt deterministisk uden at braekke
 * rng-stream-kontrakten — uden at aendre den rigtige eksports to-argument
 * (state, ctx)-signatur, som WIRING-BEHOV-noten forudsaetter er strukturelt
 * identisk med ClimbSelectionHook/DescentHook.
 */
export function createIncidentHook(
  tuning: typeof INCIDENTS_EXTRA_TUNING,
): (state: EngineState, ctx: SegmentHookContext) => SegmentHookResult {
  return function incidentHookImpl(state: EngineState, ctx: SegmentHookContext): SegmentHookResult {
    const { segment, route, entrants, rngFor } = ctx;
    const events: TimelineEvent[] = [];

    let groups: RaceGroup[] = state.groups;
    let riders: Record<string, RiderState> = state.riders;
    let seq = 0;
    let changed = false;

    for (const group of state.groups) {
      const crashes: CrashOutcome[] = [];

      for (const riderId of group.rider_ids) {
        const entrant = entrants[riderId];
        const riderState = riders[riderId];
        if (!entrant || !riderState || riderState.status !== "racing") continue;

        const rng = rngFor("incident", riderId);
        const p = incidentProbability(entrant.abilities.positioning, segment.kind, tuning);
        const roll = rng();
        if (roll >= p) continue;

        const kmFrac = rng();
        const incidentKm = round2(segment.from_km + kmFrac * (segment.to_km - segment.from_km));
        const protectedByRule = threeKmRuleApplies(incidentKm, route.distance_km, route.profile_type, tuning);

        let timeLossSeconds: number | null = null;
        if (!protectedByRule) {
          const [lo, hi] = tuning.unprotectedTimeLossSecondsRange;
          const lossFrac = rngFor("incident_time_loss", riderId)();
          timeLossSeconds = round2(lo + lossFrac * (hi - lo));
        }

        crashes.push({ riderId, km: incidentKm, protectedByRule, timeLossSeconds });

        const rs = riders[riderId];
        riders = { ...riders, [riderId]: { ...rs, incidents: rs.incidents + 1 } };
      }

      for (const crash of crashes) {
        if (crash.protectedByRule) {
          events.push(
            incidentEvent(crash.km, {
              riderId: crash.riderId,
              kind: "crash",
              outcome: "protected_three_km_rule",
              timeLossSeconds: null,
            }),
          );
          continue;
        }

        const newGroupId = makeGroupId("solo", ctx.segmentIndex * 1000 + seq);
        seq += 1;
        groups = splitGroup(groups, group.id, [crash.riderId], {
          id: newGroupId,
          kind: "solo",
          gapSecondsDelta: crash.timeLossSeconds ?? 0,
        });
        changed = true;

        events.push(
          incidentEvent(crash.km, {
            riderId: crash.riderId,
            kind: "crash",
            outcome: "time_loss",
            timeLossSeconds: crash.timeLossSeconds,
          }),
        );
      }
    }

    if (!changed) return { state: { ...state, riders }, events };
    return { state: { ...state, groups, riders }, events };
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

// ── WIRING-BEHOV (haard regel: jeg maa ikke aendre segmentLoop.ts/types.ts/
// index.ts — dette er en dokumentation af hvad arkitekten skal koble ind) ────
//
// 1. incidentHook() har PRAECIS SegmentHookContext -> SegmentHookResult-formen
//    (samme kontrakt som ClimbSelectionHook/DescentHook/FinaleHook, types.ts §-
//    mekanik-hooks), MEN skal kaldes paa ETHVERT segment (flat/rolling/climb/
//    descent/cobbles) — ikke kind-gated som M2/M3. segmentLoop.ts's nuvaerende
//    MechanicHooks-type har ingen "kald paa alle segmenter"-slot. To muligheder
//    for arkitekten: (a) tilfoej et additivt `incidents: IncidentHook`-felt til
//    MechanicHooks (types.ts) + et ubetinget kald i segmentLoop.ts's loop
//    (efter climb/descent-grenen, foer merge-trinnet saa incidentHook's splits
//    ogsaa kan mergeGroups-behandles samme segment), ELLER (b) kald
//    incidentHook() som et efterfoelgende, separat loop-gennemloeb i index.ts
//    oven paa runSegmentLoop's færdige state+tidslinje pr. segment (kraever at
//    groupSnapshots'ets km-graenser genbruges som segment-cursor).
// 2. applyThreeKmRuleToResults() kaldes i index.ts's simulateStageV4 EFTER
//    buildResults(state) og FOER buildFinishEvent(...) — se JSDoc'en ovenfor.
// 3. Rider-status "abandoned" (RiderState.status) er BEVIDST IKKE rørt af
//    denne fil — et styrt her fører aldrig til udgaaelse, kun tidstab/placering
//    (mor-spec §4 M10 naevner ikke abandon; det er et separat, ikke-scopet
//    fremtidigt haandtag paa samme status-felt).
