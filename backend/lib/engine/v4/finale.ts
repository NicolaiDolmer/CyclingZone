// backend/lib/engine/v4/finale.ts
// Race Engine v4 F2 (#4030): M4 - punch-finale + placerings-opgoer i frontgruppen.
// SSOT: docs/superpowers/specs/2026-08-21-race-engine-v4-f2-core-design.md §4
// ("Finalen (M4)"). Mor-spec: 2026-08-20-race-engine-v4-intra-stage-design.md
// §3.2 (gruppe-tid-princip) + §4 M4 (ejer-godkendt scope).
//
// Fixer #3965 strukturelt ("foerste mand over toppen vinder naesten aldrig"):
// forspringet en rytter/gruppe baerer over etapens sidste segment (carriedGapSeconds
// = gruppens gap_seconds ved hook-kald, allerede akkumuleret af segmentLoop's
// generiske tempo-/gap-bogfoering over HELE finale-segmentet) staar ved magt
// MEDMINDRE en eksplicit, maalbar jagt-mekanik (chasePower/reserve > leadDefend/
// reserve, skaleret over rest-km) lukker den. Reserven (W') taeller eksplicit med
// paa begge sider — en forspringsrytter der stadig har krudt tilbage er sværere
// at indhente end en der er koert traet.
//
// REN — ingen import fra oevrigt backend, ingen IO/Date/Math.random. rng bruges
// KUN via ctx.rngFor (seedet, per-rytter-hash). Muterer aldrig input-state.

import type {
  AbilityKey,
  Entrant,
  EngineState,
  FinaleHook,
  RaceGroup,
  RiderState,
  SegmentHookContext,
  SegmentHookResult,
  TimelineEvent,
} from "./types.ts";
import { FINALE_EXTRA_TUNING } from "./tuning.ts";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Ability-vaerdier er 0-99 (abilityRegistry-skala) — samme normalisering som
// physiology.ts's normAbility (dupliceret lokalt: physiology.ts eksporterer den
// ikke, og finale.ts maa ikke aendre physiology.ts for at faa den eksponeret).
function normAbility(v: number | undefined): number {
  return clamp(Number(v) || 0, 0, 99) / 99;
}

// Fallback-demandvektor naar route.finale_type er null/ukendt (§4-tabellen i
// tuning.ts daekker de kendte FinaleType-vaerdier; finale.ts skal stadig kunne
// afgoere en placering paa en etape uden finale_type-klassifikation).
const DEFAULT_DEMAND_VECTOR: Partial<Record<AbilityKey, number>> = {
  tempo: 0.3,
  endurance: 0.3,
  tactics: 0.2,
  positioning: 0.2,
};

// Kollektiv "flugt"-evne: staying-power til at forsvare et forspring.
const FLIGHT_KEYS: AbilityKey[] = ["tempo", "endurance", "durability"];
// Kollektiv "jagt"-evne: villighed/kapacitet til at lukke et hul.
const CHASE_KEYS: AbilityKey[] = ["tempo", "endurance", "aggression"];

/**
 * Ren evne-vaegtet placerings-score for ÉN rytter (eksporteret for property-
 * testbarhed, jf. designdoc §4's monotoni-krav): summen af demandVector[key] *
 * normAbility(abilities[key]) for alle noegler i vektoren, plus en vaegtet bonus
 * for egen W'-reserve. Alle vaegte i demandVector/wprimeReserveWeight er >= 0
 * (tuning.ts), saa scoren er per konstruktion monotont ikke-faldende i enhver
 * enkelt evne/reserve isoleret betragtet — det er selve monotoni-garantien,
 * ikke en efterfoelgende guard.
 */
export function computeFinaleAbilityScore(
  abilities: Record<AbilityKey, number>,
  wprimeReserveFraction: number,
  demandVector: Partial<Record<AbilityKey, number>>,
  wprimeReserveWeight: number,
): number {
  let sum = 0;
  for (const key of Object.keys(demandVector) as AbilityKey[]) {
    const weight = demandVector[key] ?? 0;
    sum += weight * normAbility(abilities[key]);
  }
  return sum + wprimeReserveWeight * clamp(wprimeReserveFraction, 0, 1);
}

function wprimeReserveFraction(rider: RiderState | undefined): number {
  if (!rider || rider.wprimeMax <= 0) return 0;
  return clamp(rider.wprime / rider.wprimeMax, 0, 1);
}

function collectiveAbility(riderIds: string[], entrants: Readonly<Record<string, Entrant>>, keys: AbilityKey[]): number {
  if (riderIds.length === 0 || keys.length === 0) return 0;
  let total = 0;
  let n = 0;
  for (const riderId of riderIds) {
    const abilities = entrants[riderId]?.abilities;
    if (!abilities) continue;
    let s = 0;
    for (const key of keys) s += normAbility(abilities[key]);
    total += s / keys.length;
    n++;
  }
  return n > 0 ? total / n : 0;
}

function collectiveWprimeReserve(riderIds: string[], riders: Record<string, RiderState>): number {
  if (riderIds.length === 0) return 0;
  let total = 0;
  let n = 0;
  for (const riderId of riderIds) {
    const rider = riders[riderId];
    if (!rider) continue;
    total += wprimeReserveFraction(rider);
    n++;
  }
  return n > 0 ? total / n : 0;
}

type ScoredRider = { riderId: string; score: number };

/**
 * M4 finale-hook (kaldes paa etapens sidste segment, jf. types.ts's FinaleHook-
 * kontrakt). To trin:
 *
 * 1. Carried-gap-opgoer (§4 "carriedGapSeconds"): grupper sorteret front-til-bag
 *    (mindste gap_seconds foerst). Fronten (alle grupper med gap_seconds === 0)
 *    danner start-kontendentpuljen. Hver bagvedliggende gruppe proeves mod puljen
 *    med en eksplicit, deterministisk jagt-vs-flugt-beregning (collectiveAbility
 *    over FLIGHT_KEYS/CHASE_KEYS + W'-reserve-differencen, skaleret over
 *    segmentets rest-km) — indhentes gruppen (resterende gap < tuning.groups.
 *    mergeThresholdSeconds, samme taerskel segmentLoop's EFTERFOELGENDE mergeGroups-
 *    kald selv bruger), smelter dens ryttere ind i kontendentpuljen (og styrker
 *    dermed fronten mod endnu laengere tilbageliggende grupper). Indhentes den
 *    IKKE, bevarer gruppen sin (evt. reducerede) reelle gap som en selvstaendig
 *    gruppe — "rytter med forspring OG W'-reserve vinder MEDMINDRE indhentet".
 *
 * 2. Placerings-opgoer i kontendentpuljen (§4 "punch-tungt ved finale_type:
 *    punch"): hver kontendent faar en evne-vaegtet score (demandVectorByFinaleType,
 *    fallback DEFAULT_DEMAND_VECTOR). Kun de bedst placerede
 *    (placementFullResolutionCount) faar EGEN placerings-tier; resten bunches i
 *    én haleklump. Hver tier er en NY, reel gruppe hvis gap-skridt til naboen
 *    ALTID overstiger tuning.groups.mergeThresholdSeconds (+ margin), saa
 *    segmentLoop's mergeGroups-kald (som koerer LIGE EFTER denne hook) ikke
 *    folder placeringerne sammen igen. Lige score => samme tier => samme gruppe/
 *    tid (gruppe-tids-princippet, mor-spec §3.2).
 */
export const finaleHook: FinaleHook = (state: EngineState, ctx: SegmentHookContext): SegmentHookResult => {
  const { segment, route, entrants, tuning, rngFor } = ctx;
  const events: TimelineEvent[] = [];
  const extra = FINALE_EXTRA_TUNING;

  if (state.groups.length === 0) return { state, events };

  const finishKm = round2(segment.to_km);
  const remainingKm = Math.max(0, segment.to_km - segment.from_km);
  const mergeThreshold = tuning.groups.mergeThresholdSeconds;

  const sorted = [...state.groups].sort((a, b) => a.gap_seconds - b.gap_seconds || a.id.localeCompare(b.id));
  const frontPool = sorted.filter((g) => g.gap_seconds === 0);
  const chaseCandidates = sorted.filter((g) => g.gap_seconds > 0);

  let contenderIds: string[] = frontPool.flatMap((g) => g.rider_ids);
  let defenderIds: string[] = [...contenderIds];
  const survivingGroups: RaceGroup[] = [];
  let bestSurvivingGap = Infinity;
  let bestSurvivingGroupForEvent: RaceGroup | null = null;

  for (const group of chaseCandidates) {
    const carriedGapSeconds = Math.max(0, group.gap_seconds);
    const leadDefend = collectiveAbility(defenderIds, entrants, FLIGHT_KEYS);
    const leadReserve = collectiveWprimeReserve(defenderIds, state.riders);
    const chasePower = collectiveAbility(group.rider_ids, entrants, CHASE_KEYS);
    const chaseReserve = collectiveWprimeReserve(group.rider_ids, state.riders);

    const netClosingPower = Math.max(
      0,
      chasePower - leadDefend + extra.chaseWprimeWeight * (chaseReserve - leadReserve),
    );
    const closingSeconds = netClosingPower * remainingKm * extra.chaseClosingSecondsPerKmPerUnit;
    const newGap = Math.max(0, carriedGapSeconds - closingSeconds);
    const caught = newGap < mergeThreshold;

    if (caught) {
      contenderIds = [...contenderIds, ...group.rider_ids];
      defenderIds = [...defenderIds, ...group.rider_ids];
    } else {
      const survivor: RaceGroup = { ...group, gap_seconds: newGap, rider_ids: [...group.rider_ids] };
      survivingGroups.push(survivor);
      if (newGap < bestSurvivingGap) {
        bestSurvivingGap = newGap;
        bestSurvivingGroupForEvent = survivor;
      }
    }
  }

  // Hvis fronten selv IKKE er en ren peloton (dvs. et forspring der overlevede
  // hele finale-segmentet uindhentet uden nogen kontendent bagved overhovedet,
  // eller frontgruppens art er breakaway/solo/chase) markeres det som et
  // finale_attack: forspringet blev baaret helt i maal.
  const frontKindsHoldGap = frontPool.some((g) => g.kind !== "peloton") && survivingGroups.length === 0
    ? frontPool.find((g) => g.kind !== "peloton")
    : null;
  if (frontKindsHoldGap) {
    events.push({
      km: finishKm,
      type: "finale_attack",
      params: { kind: "carried_gap_held", group_id: frontKindsHoldGap.id, rider_ids: [...frontKindsHoldGap.rider_ids] },
    });
  } else if (bestSurvivingGroupForEvent) {
    events.push({
      km: finishKm,
      type: "finale_attack",
      params: {
        kind: "gap_survived",
        group_id: bestSurvivingGroupForEvent.id,
        gap_seconds: round2(bestSurvivingGroupForEvent.gap_seconds),
      },
    });
  }

  // ── Placerings-opgoer i kontendentpuljen ────────────────────────────────────
  const demandVector =
    (route.finale_type && tuning.finale.demandVectorByFinaleType[route.finale_type]) || DEFAULT_DEMAND_VECTOR;

  const scored: ScoredRider[] = contenderIds
    .map((riderId): ScoredRider | null => {
      const entrant = entrants[riderId];
      if (!entrant) return null;
      const score = computeFinaleAbilityScore(
        entrant.abilities,
        wprimeReserveFraction(state.riders[riderId]),
        demandVector,
        extra.wprimeReserveWeight,
      );
      return { riderId, score };
    })
    .filter((s): s is ScoredRider => s !== null)
    .sort((a, b) => b.score - a.score || a.riderId.localeCompare(b.riderId));

  const placementGroups: RaceGroup[] = [];
  let seq = 0;
  let cumulativeGap = 0;
  let prevScore: number | null = null;
  let tailStarted = false;

  scored.forEach((entry, rank) => {
    const inTailZone = rank >= extra.placementFullResolutionCount;
    if (inTailZone) {
      if (!tailStarted) {
        // Haleklump: ét gap-skridt bag sidste oploeste tier, resten deler tid.
        const scoreDelta = prevScore !== null ? Math.max(0, prevScore - entry.score) : 0;
        const jitter = rngFor("finale_placement_gap", entry.riderId)() * extra.placementGapJitterMaxSeconds;
        const step = mergeThreshold + extra.placementGapMarginSeconds + extra.placementGapScoreScale * scoreDelta + jitter;
        cumulativeGap += step;
        placementGroups.push({
          id: `finale-tail-${seq++}`,
          kind: "peloton",
          rider_ids: [entry.riderId],
          gap_seconds: cumulativeGap,
          cohesion: 1,
        });
        tailStarted = true;
      } else {
        placementGroups[placementGroups.length - 1].rider_ids.push(entry.riderId);
      }
      prevScore = entry.score;
      return;
    }

    if (prevScore === null || entry.score < prevScore) {
      if (prevScore !== null) {
        const scoreDelta = prevScore - entry.score;
        const jitter = rngFor("finale_placement_gap", entry.riderId)() * extra.placementGapJitterMaxSeconds;
        const step = mergeThreshold + extra.placementGapMarginSeconds + extra.placementGapScoreScale * scoreDelta + jitter;
        cumulativeGap += step;
      }
      placementGroups.push({
        id: cumulativeGap === 0 ? `finale-winner-${seq++}` : `finale-tier-${seq++}`,
        kind: "solo",
        rider_ids: [entry.riderId],
        gap_seconds: cumulativeGap,
        cohesion: 1,
      });
    } else {
      const last = placementGroups[placementGroups.length - 1];
      last.rider_ids.push(entry.riderId);
      if (last.rider_ids.length > 1) last.kind = "peloton";
    }
    prevScore = entry.score;
  });

  if (placementGroups.length > 1) {
    const winner = placementGroups[0];
    const runnerUpGap = placementGroups[1].gap_seconds;
    events.push({
      km: finishKm,
      type: "finale_attack",
      params: { kind: "placement_gap", group_id: winner.id, gap_seconds: round2(runnerUpGap - winner.gap_seconds) },
    });
  }

  const winnerGroup = placementGroups[0] ?? survivingGroups[0] ?? null;
  if (winnerGroup) {
    events.push({
      km: finishKm,
      type: "sprint_decided",
      params: {
        winner_rider_id: winnerGroup.rider_ids[0],
        group_id: winnerGroup.id,
        finale_type: route.finale_type,
      },
    });
  }

  const newGroups: RaceGroup[] = [...placementGroups, ...survivingGroups];
  const nextState: EngineState = { ...state, groups: newGroups };
  return { state: nextState, events };
};
