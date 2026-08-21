// backend/lib/engine/v4/mechanics/descent.ts
// Race Engine v4 F2 (#4030): M3 - nedkoersel v2 (monotoni-garanti + descent
// attack + risiko-koblet incident).
// SSOT: docs/superpowers/specs/2026-08-21-race-engine-v4-f2-core-design.md §4
// punkt 3. Mor-spec: docs/superpowers/specs/2026-08-20-race-engine-v4-intra-
// stage-design.md §3.2 (monotoni, hardt krav) + §8 beslutning 6 (attack-loft
// 10-20 s paa T2-T3 + stor descending-evne-forskel) + beslutning 7
// (styrt-risiko koblet til angreb, daempet af descending).
//
// REN — ingen import fra oevrigt backend, ingen IO/Date/Math.random. Rene
// funktioner: input-state muteres aldrig, nyt state/array returneres
// (segmentLoop.ts's determinisme-krav forudsaetter dette, jf. groups.ts).
//
// MONOTONI (hardt krav, mor-spec §3.2): "inden for samme gruppe kan en
// daarligere rytter aldrig TAGE tid paa en bedre i den evne segmentet tester."
// Kun ryttere hvis descending-evne er MINDST tuning.descent.minAbilityGapForAttack
// point over gruppens SVAGESTE descender kan angribe (findAttackers). Fordi
// alle kandidater sammenlignes mod SAMME gruppe-minimum, er den kvalificerende
// delmaengde altid et sammenhaengende praefiks naar rytterne sorteres efter
// faldende descending-evne: enhver rytter med hoejere evne end en kvalificeret
// angriber kvalificerer ogsaa selv. En svagere descender kan derfor ALDRIG
// angribe mens en staerkere descender i samme gruppe bliver tilbage. Desuden
// faar ALLE angribere PRAECIS samme nye gruppe-gap (rent gruppe-princip,
// groups.ts) — der findes ingen individuel tidsforskel INDEN FOR en gruppe at
// invertere, saa garantien holder ogsaa naar angribernes indbyrdes evne varierer.
//
// RISIKO (beslutning 7): styrt-risikoen er REN INFORMATION i F2 — den taeller
// kun rider.incidents op og emitterer et incident-event; den paavirker IKKE
// gruppe-tilhoersforhold eller tid. Havde en ulykke fjernet en angribers
// vundne tid, kunne held/uheld invertere monotonien (en uheldsramt BEDRE
// descender kunne saa ende bag en heldig SVAGERE descender) — det er netop
// det haarde krav forbyder. Den fulde konsekvens (abandon/tidsstraf) hoerer
// til M10 (3 km-reglen, F3-scope) og RiderLoad/status-feltet, ikke M3.

import type {
  DescentHook,
  DescentTuning,
  EngineState,
  GroupKind,
  RaceGroup,
  RiderState,
  SegmentHookContext,
  SegmentHookResult,
  TimelineEvent,
} from "../types.ts";
import { makeGroupId, splitGroup } from "../groups.ts";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ── Pure helpers (eksporteret for direkte kontrakt-tests) ────────────────────

/**
 * Seedet styrt-risiko for én angribende rytter (beslutning 7): basis-risiko
 * daempet lineaert af descending-evnen (0-99-skala, point-for-point). ALDRIG
 * omvendt fortegn: risikoen kan kun FALDE med descending-evnen, aldrig stige
 * — clamp [0,1] fanger baade "ingen risiko" og "daempning overstiger basis".
 */
export function incidentProbability(
  descendingAbility: number,
  tuning: Pick<DescentTuning, "incidentRiskBase" | "incidentRiskDescendingDampening">,
): number {
  const ability = clamp(Number(descendingAbility) || 0, 0, 99);
  return clamp(tuning.incidentRiskBase - tuning.incidentRiskDescendingDampening * ability, 0, 1);
}

/**
 * Descent attack-gevinst i sekunder (beslutning 6): ALTID clamped til
 * tuning.descent.attackWindowSeconds ([10,20]-baandet, mor-spec §4 M3).
 * Skalerer lineaert med hvor langt den svageste angriber er OVER kvalifika-
 * tionstaersklen (groupMinDescending + minAbilityGapForAttack) — start-
 * kandidat-skalering (samme forbehold som tuning.ts's oevrige konstanter),
 * kalibreres i head-to-head-harnesset (f2-core-design.md §7).
 */
export function computeAttackGainSeconds(
  attackerMinDescending: number,
  groupMinDescending: number,
  tuning: Pick<DescentTuning, "attackWindowSeconds" | "minAbilityGapForAttack">,
): number {
  const [gainLo, gainHi] = tuning.attackWindowSeconds;
  const minGap = tuning.minAbilityGapForAttack;
  const gapAboveThreshold = attackerMinDescending - groupMinDescending - minGap;
  const fraction = minGap > 0 ? clamp(gapAboveThreshold / minGap, 0, 1) : 1;
  return round2(gainLo + fraction * (gainHi - gainLo));
}

type AttackCandidate = { riderId: string; descending: number };
type AttackerSelection = { attackers: AttackCandidate[]; groupMinDescending: number };

/**
 * Finder angribere i én gruppe (se filens monotoni-kommentar for praefiks-
 * beviset). Sorteret evne-faldende + rider_id-taerskel for determinisme ved
 * lige evner. Grupper med under 2 ryttere kan pr. definition ikke splitte.
 */
function findAttackers(
  group: RaceGroup,
  entrants: SegmentHookContext["entrants"],
  minAbilityGapForAttack: number,
): AttackerSelection {
  const candidates: AttackCandidate[] = [];
  for (const riderId of group.rider_ids) {
    const entrant = entrants[riderId];
    if (!entrant) continue;
    candidates.push({ riderId, descending: clamp(Number(entrant.abilities.descending) || 0, 0, 99) });
  }
  if (candidates.length < 2) return { attackers: [], groupMinDescending: 0 };
  const groupMinDescending = candidates.reduce((m, c) => Math.min(m, c.descending), candidates[0].descending);
  const attackers = candidates
    .filter((c) => c.descending - groupMinDescending >= minAbilityGapForAttack)
    .sort((a, b) => b.descending - a.descending || a.riderId.localeCompare(b.riderId));
  return { attackers, groupMinDescending };
}

/** Solo-angreb (én rytter) faar "solo"-kind; ellers arver angriberne "breakaway" naar de forlader en peloton, ellers kildens egen kind. */
function newGroupKind(sourceKind: GroupKind, attackerCount: number): GroupKind {
  if (attackerCount === 1) return "solo";
  if (sourceKind === "peloton") return "breakaway";
  return sourceKind;
}

/**
 * M3: nedkoersel v2. Kaldes pr. descent-segment (segmentLoop.ts kalder kun
 * denne hook naar `segment.kind === "descent"`). Behandler hver gruppe
 * uafhaengigt: kun T2-T3-segmenter (technicality >= minTechnicalityForAttack)
 * OG kun ved en kvalificerende descending-evne-forskel udloeser et split.
 * Ingen randomness i selve angrebs-beslutningen (rent taerskel-baseret,
 * f2-core-design.md §4 punkt 3) — kun styrt-risikoen er seeded.
 */
export const descentHook: DescentHook = (state: EngineState, ctx: SegmentHookContext): SegmentHookResult => {
  const segment = ctx.segment;
  const events: TimelineEvent[] = [];

  if (segment.kind !== "descent") return { state, events };
  if (segment.technicality < ctx.tuning.descent.minTechnicalityForAttack) return { state, events };

  let groups = state.groups;
  let riders: Record<string, RiderState> = state.riders;
  let seq = 0;
  let changed = false;

  for (const group of state.groups) {
    const { attackers, groupMinDescending } = findAttackers(group, ctx.entrants, ctx.tuning.descent.minAbilityGapForAttack);
    if (attackers.length === 0) continue;

    const attackerMinDescending = attackers.reduce((m, a) => Math.min(m, a.descending), attackers[0].descending);
    const gainSeconds = computeAttackGainSeconds(attackerMinDescending, groupMinDescending, ctx.tuning.descent);

    const attackerIds = attackers.map((a) => a.riderId);
    const kind = newGroupKind(group.kind, attackerIds.length);
    const newGroupId = makeGroupId(kind, ctx.segmentIndex * 1000 + seq);
    seq += 1;

    groups = splitGroup(groups, group.id, attackerIds, { id: newGroupId, kind, gapSecondsDelta: -gainSeconds });
    changed = true;

    events.push({
      km: round2(segment.to_km),
      type: "finale_attack",
      params: { direction: "descent", rider_ids: attackerIds, group_id: newGroupId, gained_seconds: gainSeconds },
    });

    // Risiko-kobling (beslutning 7): kun angribere ruller styrt-risiko, seeded
    // pr. rytter ("descent_incident"-streamen, per-rytter-hash), daempet af
    // descending-evnen. F2: ren information (counter + event), jf. filens
    // toppe-kommentar — ingen tid/gruppe-effekt (monotoni-vaernet).
    for (const attacker of attackers) {
      const rng = ctx.rngFor("descent_incident", attacker.riderId);
      const p = incidentProbability(attacker.descending, ctx.tuning.descent);
      const roll = rng();
      if (roll >= p) continue;
      const kmFrac = rng();
      const incidentKm = round2(segment.from_km + kmFrac * (segment.to_km - segment.from_km));
      const riderState = riders[attacker.riderId];
      if (riderState) {
        riders = { ...riders, [attacker.riderId]: { ...riderState, incidents: riderState.incidents + 1 } };
      }
      events.push({
        km: incidentKm,
        type: "incident",
        params: { rider_id: attacker.riderId, cause: "descent_attack" },
      });
    }
  }

  if (!changed) return { state, events };
  return { state: { ...state, groups, riders }, events };
};
