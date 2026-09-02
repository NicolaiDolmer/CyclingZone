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
import { DESCENT_EXTRA_TUNING } from "../tuning.ts";

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

// ── Regruppering (#4604) ─────────────────────────────────────────────────────
// Se DESCENT_EXTRA_TUNING's kommentar i tuning.ts for HVORFOR laget findes.
// Fire garantier, alle rent strukturelle (ingen RNG, ingen ny stoej):
//   1. Et hul kan kun KRYMPE. Evne-faktoren er clampet til et POSITIVT baand,
//      saa regrupperingen aldrig kan vokse et hul — den generiske gap-bogfoering
//      i segmentLoop er fortsat det eneste sted et hul kan blive stoerre.
//   2. Raekkefolgen mellem grupper er invariant. Hver gruppe klampes til den
//      allerede opdaterede gap for gruppen umiddelbart foran, saa en jagende
//      gruppe kan lukke HELT op til — men aldrig forbi — den foran. Derfor kan
//      regrupperingen ikke invertere et udfald (mor-spec §2 invariant 3).
//   3. Ingen intra-gruppe-effekt. Der flyttes kun gruppe-gaps; alle i samme
//      gruppe beholder praecis samme tid (rent gruppe-princip, groups.ts).
//   4. Styrke straffes aldrig: en gruppe med bedre descending-evne end den
//      foran lukker MERE, en svagere lukker MINDRE. En staerkt koerende
//      frontgruppe holder tilsvarende mere af sit forspring.
// Selve sammensmeltningen naar hullet er lukket haandteres af segmentLoop's
// efterfoelgende mergeGroups (tuning.groups.mergeThresholdSeconds) — M3
// beslutter kun HVOR MEGET der lukkes, ikke hvornaer to grupper er én.

type DescentExtra = typeof DESCENT_EXTRA_TUNING;

/** Gennemsnitlig descending-evne i en gruppe (0-99). Tom gruppe => 0. */
export function groupDescendingMean(
  riderIds: readonly string[],
  entrants: SegmentHookContext["entrants"],
): number {
  let sum = 0;
  let count = 0;
  for (const riderId of riderIds) {
    const entrant = entrants[riderId];
    if (!entrant) continue;
    sum += clamp(Number(entrant.abilities.descending) || 0, 0, 99);
    count += 1;
  }
  return count > 0 ? sum / count : 0;
}

/**
 * Hvor mange sekunder af hullet til gruppen foran der lukkes paa ét
 * nedkoersels-segment. Eksporteret for direkte kontrakt-/property-tests.
 * ALTID >= 0 og ALTID <= gapToAheadSeconds (garanti 1 + 2 ovenfor).
 */
export function computeRegroupSeconds(
  gapToAheadSeconds: number,
  lengthKm: number,
  technicality: number,
  chaseDescending: number,
  aheadDescending: number,
  extra: DescentExtra = DESCENT_EXTRA_TUNING,
  isFinishDescent: boolean = false,
): number {
  const gap = Math.max(0, gapToAheadSeconds);
  if (gap === 0) return 0;
  const km = Math.max(0, lengthKm);
  if (km === 0) return 0;

  const techKey = (clamp(Math.round(technicality) || 2, 1, 3) as 1 | 2 | 3);
  const techFactor = extra.regroupTechnicalityFactor[techKey];

  const [abilityLo, abilityHi] = extra.regroupAbilityFactorBounds;
  const abilityDelta = chaseDescending - aheadDescending;
  const abilityFactor = clamp(
    1 + abilityDelta / extra.regroupAbilitySpanPoints,
    abilityLo,
    abilityHi,
  );

  // To led, og det STOERSTE af dem vinder — det er den form virkeligheden har:
  //   * absolut: et lille hul lukkes HELT paa en nedkoersel af rimelig laengde.
  //   * proportionalt: et stort hul kan ikke lukkes, men det KRYMPER alligevel
  //     (fronten sidder op naar vejen peger nedad, en jagende gruppe koerer
  //     hurtigere ned end en enkelt mand). Uden det proportionale led ville en
  //     selektion paa 10+ minutter passere en 15 km nedkoersel naesten uroert.
  const absoluteClose = extra.regroupSecondsPerKm * km * techFactor * abilityFactor;
  const fractionPerSegment = 1 - Math.pow(1 - clamp(extra.regroupGapFractionPerKm, 0, 1), km);
  const proportionalClose = gap * clamp(
    fractionPerSegment * techFactor * abilityFactor,
    0,
    extra.regroupMaxGapFractionPerSegment,
  );

  // En nedkoersel der ER finalen udligner langt mere — se
  // DESCENT_EXTRA_TUNING.regroupFinishMultiplier.
  const finishFactor = isFinishDescent ? extra.regroupFinishMultiplier : 1;
  const closing = Math.max(absoluteClose, proportionalClose) * finishFactor;
  return round2(Math.min(gap, Math.max(0, closing)));
}

/**
 * Lukker hullerne mellem grupper paa ét nedkoersels-segment, forfra og bagud.
 * Rent: nyt array returneres, input muteres aldrig. Deterministisk — sorteringen
 * (gap_seconds, id) er den samme som groups.mergeGroups bruger, saa resultatet
 * er uafhaengigt af input-arrayets raekkefolge.
 */
export function regroupOnDescent(
  groups: readonly RaceGroup[],
  entrants: SegmentHookContext["entrants"],
  lengthKm: number,
  technicality: number,
  extra: DescentExtra = DESCENT_EXTRA_TUNING,
  isFinishDescent: boolean = false,
): RaceGroup[] {
  if (groups.length <= 1) return groups.map((g) => ({ ...g }));
  const sorted = [...groups].sort((a, b) => a.gap_seconds - b.gap_seconds || a.id.localeCompare(b.id));

  const out: RaceGroup[] = [];
  let aheadGap = sorted[0].gap_seconds;
  let aheadDescending = groupDescendingMean(sorted[0].rider_ids, entrants);
  out.push({ ...sorted[0] });

  for (let i = 1; i < sorted.length; i++) {
    const group = sorted[i];
    const chaseDescending = groupDescendingMean(group.rider_ids, entrants);
    const gapToAhead = Math.max(0, group.gap_seconds - aheadGap);
    const closed = computeRegroupSeconds(gapToAhead, lengthKm, technicality, chaseDescending, aheadDescending, extra, isFinishDescent);
    const newGap = round2(Math.max(aheadGap, group.gap_seconds - closed));
    out.push({ ...group, gap_seconds: newGap });
    aheadGap = newGap;
    aheadDescending = chaseDescending;
  }
  return out;
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
  attackAbilityWindowPoints: number = DESCENT_EXTRA_TUNING.attackAbilityWindowPoints,
): AttackerSelection {
  const candidates: AttackCandidate[] = [];
  for (const riderId of group.rider_ids) {
    const entrant = entrants[riderId];
    if (!entrant) continue;
    candidates.push({ riderId, descending: clamp(Number(entrant.abilities.descending) || 0, 0, 99) });
  }
  if (candidates.length < 2) return { attackers: [], groupMinDescending: 0 };
  const groupMinDescending = candidates.reduce((m, c) => Math.min(m, c.descending), candidates[0].descending);
  const groupMaxDescending = candidates.reduce((m, c) => Math.max(m, c.descending), candidates[0].descending);

  // Gate 1 (uaendret): der skal overhovedet VAERE en kvalificerende evne-forskel
  // i gruppen, maalt fra svageste til bedste descender.
  if (groupMaxDescending - groupMinDescending < minAbilityGapForAttack) {
    return { attackers: [], groupMinDescending };
  }

  // Gate 2 (#4604): kun de reelt bedste descendere gaar med. Se
  // DESCENT_EXTRA_TUNING.attackAbilityWindowPoints i tuning.ts for maalingen
  // der udloeste den. Fortsat en ren evne-taerskel => praefiks-egenskaben, og
  // dermed monotoni-beviset i filens hoved, staar uroert.
  const attackFloor = groupMaxDescending - Math.max(0, attackAbilityWindowPoints);
  const attackers = candidates
    .filter((c) => c.descending >= attackFloor)
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
export const descentHook: DescentHook = (
  state: EngineState,
  ctx: SegmentHookContext,
  // Kun til kalibrering/tests: DescentHook-kontrakten er (state, ctx) — den
  // valgfrie tredje parameter aendrer ingen kalder-signatur, men lader
  // head-to-head-harnesset sweepe regrupperings-haandtagene uden at mutere
  // den deep-frosne DESCENT_EXTRA_TUNING.
  extra: DescentExtra = DESCENT_EXTRA_TUNING,
): SegmentHookResult => {
  const segment = ctx.segment;
  const events: TimelineEvent[] = [];

  if (segment.kind !== "descent") return { state, events };

  // 1. Regruppering FOERST (#4604): nedkoerslen udligner det stigningen skabte,
  //    inden nogen kan angribe paa den. Gaelder ALLE nedkoersler — ogsaa de
  //    ikke-tekniske, hvor der aldrig angribes.
  const segmentLengthKm = Math.max(0, segment.to_km - segment.from_km);
  let groups: RaceGroup[] = regroupOnDescent(
    state.groups,
    ctx.entrants,
    segmentLengthKm,
    segment.technicality,
    extra,
    ctx.segmentIndex === ctx.route.segments.length - 1,
  );
  let riders: Record<string, RiderState> = state.riders;
  let seq = 0;

  const gapBeforeById = new Map(state.groups.map((g) => [g.id, g.gap_seconds]));
  let changed = groups.some((g) => gapBeforeById.get(g.id) !== g.gap_seconds);

  // 2. Descent attack: uaendret gate (kun T2-T3), men nu paa den regrupperede
  //    struktur — et angreb skabt her overlever til maal praecis som foer.
  if (segment.technicality < ctx.tuning.descent.minTechnicalityForAttack) {
    if (!changed) return { state, events };
    return { state: { ...state, groups }, events };
  }

  // Snapshot: splitGroup nedenfor omtildeler `groups`, saa loopet skal koere
  // over den regrupperede struktur som den saa ud FOER foerste split (samme
  // moenster som den oprindelige `for (const group of state.groups)`).
  const groupsToScan = groups;
  for (const group of groupsToScan) {
    // Gate 0 (#4604): angreb gaar normalt kun fra en allerede reduceret gruppe.
    // Undtagelse: paa den svaereste vejtype kan der stadig rives et hul i en
    // stor gruppe. Se DESCENT_EXTRA_TUNING.maxGroupSizeForAttack.
    if (
      group.rider_ids.length > extra.maxGroupSizeForAttack
      && segment.technicality < extra.minTechnicalityForLargeGroupAttack
    ) continue;
    const { attackers, groupMinDescending } = findAttackers(
      group,
      ctx.entrants,
      ctx.tuning.descent.minAbilityGapForAttack,
      extra.attackAbilityWindowPoints,
    );
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
