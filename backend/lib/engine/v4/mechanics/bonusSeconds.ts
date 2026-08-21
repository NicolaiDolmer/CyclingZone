// backend/lib/engine/v4/mechanics/bonusSeconds.ts
// Race Engine v4 F3 (#4030, #3855): M9 - bonussekunder ved maal (10/6/4) og
// indlagte spurter (3/2/1).
// SSOT: docs/superpowers/specs/2026-08-20-race-engine-v4-intra-stage-design.md
// §4 M9 ("bounded saa bjerg stadig dominerer GC") + §8 beslutning 11 ("fuld
// pakke fra start"). Kontekst: #2413 ("Bonussekunder ved etapemaal + indlagte
// spurter") — scope laaser: (a) KUN masse-etaper, ikke ITT; (b) GC-effekten er
// bounded (maks. ~10s/etape); (c) GC-fradraget selv sker i
// `accumulateStageRows`-flowet UDENFOR motor-kernen — v4's ansvar her stopper
// ved at beregne + emittere HVEM der faar hvor mange sekunder og HVORFOR
// (fog-gate-venligt: bonussekunder er kendt spilinformation, ikke en skjult
// vaegt).
//
// REN — ingen import fra oevrigt backend, ingen IO/Date/Math.random. rng
// bruges KUN via injiceret RngForFn (seedet, per-rytter-hash). Alle
// eksporterede funktioner er rene: intet input muteres.
//
// tuning.ts's frosne `EngineTuning.bonusSeconds` (types.ts, F2-placeholder for
// denne mekanik) baerer selve 10/6/4- og 3/2/1-baandene. BONUS_SECONDS_EXTRA_TUNING
// (tuning.ts, additiv M9-sektion) baerer de ekstra haandtag M9 selv har brug
// for (hvilke finale-typer der er masse-etaper, det haarde per-rytter-loft,
// spurt-evne-vaegtene) — samme "additiv sektion i tuning.ts"-moenster som
// finale.ts <- FINALE_EXTRA_TUNING og leadout.ts <- LEADOUT_EXTRA_TUNING.

import type {
  AbilityKey,
  Entrant,
  EngineState,
  FinaleType,
  RiderState,
  RngForFn,
  SegmentHookContext,
  SegmentHookResult,
  TimelineEvent,
} from "../types.ts";
import { gaussian } from "../rng.ts";
import { BONUS_SECONDS_EXTRA_TUNING } from "../tuning.ts";
import type { BonusSecondsTuning } from "../types.ts";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
// Runder NEDAD til 2 decimaler — bruges KUN af clampAwardsToPerRiderCap, hvor
// det haarde loft (#2413) kraever at summen ALDRIG kan ende over cap efter
// afrunding (nearest-rounding kunne i vaerste fald skubbe summen 0,01s over).
function roundDown2(n: number): number {
  return Math.floor(n * 100) / 100;
}
function normAbility(v: number | undefined): number {
  return clamp(Number(v) || 0, 0, 99) / 99;
}

// ── Bonus-award-kontrakt (lokal — ikke en del af den frosne StageOutput) ──────

export type BonusAwardReason = "finish" | "intermediate_sprint";

export type BonusAward = {
  rider_id: string;
  seconds: number;
  reason: BonusAwardReason;
  km: number;
};

/** bonus_seconds_awarded er en NY, aaben timeline-event-type (types.ts's `KnownTimelineEventType | (string & {})`-union tillader tilfoejelser uden at aendre den frosne fil). */
export function awardsToTimelineEvents(awards: readonly BonusAward[]): TimelineEvent[] {
  return awards.map((a) => ({
    km: round2(a.km),
    type: "bonus_seconds_awarded",
    params: { rider_id: a.rider_id, seconds: a.seconds, reason: a.reason },
  }));
}

// ── Maal-bonus (10/6/4) ─────────────────────────────────────────────────────

/**
 * #2413-scope: maal-bonus gaelder KUN masse-etaper, ikke ITT. `finaleType ===
 * null` (legacy/uklassificeret rute, jf. types.ts's RouteV2-kommentar) regnes
 * som masse-etape (sikker default — det ville kraeve en positiv ITT-klassifikation
 * at UDELUKKE bonussen, ikke omvendt).
 */
export function isMassFinishFinaleType(
  finaleType: FinaleType | null,
  eligibleFinaleTypes: readonly string[] = BONUS_SECONDS_EXTRA_TUNING.finishBonusEligibleFinaleTypes,
): boolean {
  if (finaleType == null) return true;
  return eligibleFinaleTypes.includes(finaleType);
}

/**
 * Maal-bonus til top 3 (§4 M9, 10/6/4): `orderedRiderIds` er rangeret
 * front-til-bag (samme raekkefoelge som `StageResult[]` sorteret paa rank,
 * eller finale.ts's interne placerings-opgoer FOER gruppe-sammenlaegning —
 * begge giver samme top-3, jf. WIRING-noten nederst). Tomt array naar etapen
 * ikke er en masse-etape (ITT-udelukkelsen).
 */
export function computeFinishBonusAwards(
  orderedRiderIds: readonly string[],
  finaleType: FinaleType | null,
  finishKm: number,
  tuning: Pick<BonusSecondsTuning, "finishSeconds">,
  eligibleFinaleTypes: readonly string[] = BONUS_SECONDS_EXTRA_TUNING.finishBonusEligibleFinaleTypes,
): BonusAward[] {
  if (!isMassFinishFinaleType(finaleType, eligibleFinaleTypes)) return [];
  const seconds = tuning.finishSeconds;
  const awards: BonusAward[] = [];
  const n = Math.min(3, orderedRiderIds.length);
  for (let i = 0; i < n; i++) {
    const riderId = orderedRiderIds[i];
    if (!riderId) continue;
    awards.push({ rider_id: riderId, seconds: seconds[i], reason: "finish", km: round2(finishKm) });
  }
  return awards;
}

// ── Indlagt spurt-bonus (3/2/1) ──────────────────────────────────────────────

/**
 * Ren evne-vaegtet spurt-score for ÉN rytter + seedet stoej (rank-guard-
 * moenstret fra climbSelection.ts/finale.ts: stoej flytter afstande/rangering
 * TILFAELDIGT — der er intet "sandt" fortegn at bevare her, i modsaetning til
 * M2/M3's monotoni-krav, fordi en indlagt spurt er en UAFHAENGIG delkonkurrence
 * (point-/bonussekund-jagt), ikke en fysisk gruppe-tidsforskel. Bevidst egne
 * evne-vaegte (intermediateSprintQualityWeights, forskellige fra finale.ts's
 * demandVectorByFinaleType) saa en indlagt spurt IKKE er en ren kopi af
 * maal-udfaldet — en udbrudsrytter med hoej sprint/acceleration kan tage den
 * indlagte spurt selvom feltet vinder etapen bagefter.
 */
export function computeIntermediateSprintOrder(
  riderIds: readonly string[],
  entrants: Readonly<Record<string, Entrant>>,
  rngFor: RngForFn,
  qualityWeights: Partial<Record<AbilityKey, number>>,
  noiseSd: number,
): string[] {
  const scored = riderIds.map((riderId) => {
    const abilities = entrants[riderId]?.abilities;
    let base = 0;
    if (abilities) {
      for (const key of Object.keys(qualityWeights) as AbilityKey[]) {
        base += (qualityWeights[key] ?? 0) * normAbility(abilities[key]);
      }
    }
    const noise = gaussian(rngFor("intermediate_sprint", riderId), 0, noiseSd);
    return { riderId, score: base + noise };
  });
  return scored
    .sort((a, b) => b.score - a.score || a.riderId.localeCompare(b.riderId))
    .map((s) => s.riderId);
}

/** Indlagt spurt-bonus til top 3 blandt de rytter der reelt kontesterer spurten (typisk fronten af feltet, jf. intermediateSprintHook). */
export function computeIntermediateSprintAwards(
  riderIds: readonly string[],
  entrants: Readonly<Record<string, Entrant>>,
  rngFor: RngForFn,
  km: number,
  tuning: Pick<BonusSecondsTuning, "intermediateSeconds">,
  qualityWeights: Partial<Record<AbilityKey, number>>,
  noiseSd: number,
): BonusAward[] {
  const order = computeIntermediateSprintOrder(riderIds, entrants, rngFor, qualityWeights, noiseSd);
  const seconds = tuning.intermediateSeconds;
  const awards: BonusAward[] = [];
  const n = Math.min(3, order.length);
  for (let i = 0; i < n; i++) {
    awards.push({ rider_id: order[i], seconds: seconds[i], reason: "intermediate_sprint", km: round2(km) });
  }
  return awards;
}

/**
 * M9-segment-hook: kaldes pr. segment (samme (state, ctx) -> {state, events}-
 * kontrakt som ClimbSelectionHook/DescentHook — se WIRING-noten). Uden
 * effekt paa segmenter der ikke rummer et sprint-waypoint. `state` returneres
 * ALTID uaendret: en indlagt spurt aendrer aldrig gruppe-tilhoersforhold eller
 * fysisk tid, kun bonussekund-events (ren information, ligesom M3's
 * incident-events i F2).
 *
 * Kontendentpuljen er fronten af loebet ved segmentets slutning (alle grupper
 * med `gap_seconds === 0`, samme "frontPool"-moenster som finale.ts) — det er
 * den bedste tilgaengelige approksimation af "hvem der reelt passerer
 * spurtlinjen foerst" uden en fuld intra-segment-position-model (F3-scope,
 * jf. designdoc §4 punkt 3's krav-tempo-model der KUN kender gruppe-niveau,
 * ikke position i gruppen).
 */
export const intermediateSprintHook = (state: EngineState, ctx: SegmentHookContext): SegmentHookResult => {
  const { segment, route, entrants, tuning, rngFor } = ctx;
  const events: TimelineEvent[] = [];

  const sprintWaypoints = route.waypoints.filter(
    (wp) => wp.kind === "sprint" && wp.km > segment.from_km && wp.km <= segment.to_km,
  );
  if (sprintWaypoints.length === 0 || state.groups.length === 0) return { state, events };

  const frontGap = state.groups.reduce((m, g) => Math.min(m, g.gap_seconds), state.groups[0].gap_seconds);
  const contenderIds = state.groups
    .filter((g) => g.gap_seconds === frontGap)
    .flatMap((g) => g.rider_ids)
    .sort();
  if (contenderIds.length === 0) return { state, events };

  for (const wp of sprintWaypoints) {
    const awards = computeIntermediateSprintAwards(
      contenderIds,
      entrants,
      rngFor,
      wp.km,
      tuning.bonusSeconds,
      BONUS_SECONDS_EXTRA_TUNING.intermediateSprintQualityWeights,
      BONUS_SECONDS_EXTRA_TUNING.intermediateSprintNoiseSd,
    );
    events.push(...awardsToTimelineEvents(awards));
  }
  return { state, events };
};

// ── Per-rytter-loft (#2413: samlet GC-effekt bounded ~10s/etape) ─────────────

/**
 * Klemmer den SAMLEDE bonus én rytter faar over hele etapen (maal + alle
 * indlagte spurter) ned til `maxTotalPerRider`, proportionalt paa tvaers af
 * alle den rytters awards (bevarer den relative vaegtning mellem
 * maal-/spurt-bonus i stedet for vilkaarligt at nulstille én kilde) — ALDRIG
 * en forhoejelse: awards under loftet er uaendrede. Determinstisk, ren
 * funktion af `awards`.
 */
export function clampAwardsToPerRiderCap(
  awards: readonly BonusAward[],
  maxTotalPerRider: number = BONUS_SECONDS_EXTRA_TUNING.maxTotalBonusSecondsPerRiderPerStage,
): BonusAward[] {
  const totalByRider = new Map<string, number>();
  for (const a of awards) totalByRider.set(a.rider_id, (totalByRider.get(a.rider_id) ?? 0) + a.seconds);
  return awards.map((a) => {
    const total = totalByRider.get(a.rider_id) ?? 0;
    if (total <= maxTotalPerRider || total <= 0) return { ...a };
    const scale = maxTotalPerRider / total;
    return { ...a, seconds: roundDown2(a.seconds * scale) };
  });
}

// ── Valgfri virtual_gc-anvendelse (EngineState.virtual_gc, F2: "alle 0") ─────

/**
 * Traekker (klemte) bonussekunder fra `virtual_gc`-deficittet (types.ts's
 * `EngineState.virtual_gc`-felt findes allerede, F2 lod det staa paa 0 for
 * alle). Rent hjaelpe-redskab — den PRIMAERE forbrugsvej for #2413's GC-fradrag
 * er `accumulateStageRows`-flowet UDENFOR kernen via `bonus_seconds_awarded`-
 * timeline-eventsene (issuets egen ordlyd), saa dette er valgfrit ekstra
 * hvis en fremtidig in-kernel GC-visning faar brug for det.
 */
export function applyAwardsToVirtualGc(
  virtualGc: Readonly<Record<string, number>>,
  awards: readonly BonusAward[],
): Record<string, number> {
  const next = { ...virtualGc };
  for (const award of awards) {
    const current = next[award.rider_id] ?? 0;
    next[award.rider_id] = round2(current - award.seconds);
  }
  return next;
}

// WIRING (kraever arkitekt-integration, ikke del af denne PR — se PR-body):
//
// 1. Indlagt spurt (intermediateSprintHook): segmentLoop.ts kalder i dag KUN
//    climb-/descent-/finale-hooks, gatet paa `segment.kind`/sidste-segment
//    (segmentLoop.ts linje ~225-254). Et sprint-waypoint kan i princippet
//    falde paa ETHVERT segment (flat/rolling/climb/...), saa wiring kraever
//    et NYT, ugated hook-kald PR segment (fx efter gap-bogfoeringen, foer
//    climb/descent-grenen) — det er en segmentLoop.ts-aendring (arkitekt-scope,
//    denne PR maa ikke redigere segmentLoop.ts). `MechanicHooks` (types.ts)
//    faar formentlig en ny `bonusSeconds`-noegle for at holde moenstret fra
//    DEFAULT_MECHANIC_HOOKS.
//
// 2. Maalbonus (computeFinishBonusAwards): index.ts's `simulateStageV4` har
//    allerede den rangerede `results: StageResult[]` (buildResults, linje
//    ~27-41) LIGE FOER `buildFinishEvent` kaldes. Wiring er additiv der:
//    `const finishAwards = computeFinishBonusAwards(results.map(r =>
//    r.rider_id), input.route.finale_type, input.route.distance_km,
//    input.tuning.bonusSeconds);` — og de resulterende events tilfoejes
//    tidslinjen sammen med de indlagte spurt-awards FOER det samlede
//    `clampAwardsToPerRiderCap`-kald (skal koeres paa BEGGE kilder samlet,
//    ikke hver for sig, for at loftet er korrekt).
//
// 3. GC-fradrag: sker i `accumulateStageRows`-flowet (#2413's egen ordlyd),
//    der laeser `bonus_seconds_awarded`-eventsene fra den persisterede
//    tidslinje. Ingen StageOutput/types.ts-aendring paakraevet for dette —
//    events er allerede en aaben union (types.ts's `KnownTimelineEventType |
//    (string & {})`).
