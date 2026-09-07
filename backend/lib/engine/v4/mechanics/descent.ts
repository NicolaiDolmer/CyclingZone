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
// RISIKO (beslutning 7 + #4934): styrt-risikoen var REN INFORMATION i F2 — den
// taalte kun rider.incidents op og emitterede et event. Den er nu koblet ind i
// M10's uheldstrappe (mechanics/incidents.ts, #2944/#4882): descent leverer KUN
// "her skete et uheld for rytter X paa km Y med aarsag descent_attack", og
// incidents.ts's egen `resolveCrashIncident` afgoer alvorstrin, tidstab,
// skadedage og 3 km-reglen. Der findes ÉN uheldsmodel, ét felt-loft pr. etape
// (`maxIncidentsForField` over `state.stage_incidents`) og ÉN bogfoering af
// `riders[id].incidents` — descent hverken kopierer trappen eller taeller dobbelt.
//
// KONSEKVENSEN (ejer-beslutning 6/9, RACE_ENGINE_RULES §9 punkt 4): en angriber
// der styrter MISTER SIN GEVINST. Han splittes ud af den nyoprettede
// angrebsgruppe med `+gainSeconds` — praecis det delta angrebet gav ham — saa
// han lander tilbage paa kildegruppens gap, og DEREFTER laegges trappens
// tidstab (eller `abandonedGapSeconds` ved trin 3) oveni. Et 3-km-beskyttet
// styrt roerer hverken gruppe eller tid (reglen beskytter TIDEN, jf. incidents.ts).
//
// MONOTONIEN HOLDER STADIG, og det er samme argument som M10's egen
// monotoni-bemaerkning: et uheld er ikke en testet evne-sammenligning. Det
// haarde krav (mor-spec §3.2) forbyder at en DAARLIGERE rytter tager tid paa en
// bedre i den evne segmentet tester — og det gaelder angrebs-mekanikken, som er
// uroert. For selve uheldet holder den skarpere form: VED SAMME LODTRAEKNING
// faar en bedre nedkoerer aldrig et vaerre udfald. `incidentProbability` er
// ikke-stigende i descending (gulv-formen, #4905), saa `roll < p(bedre)`
// medfoerer `roll < p(daarligere)`, og trappens konsekvens er BEVIDST ikke
// evne-skaleret (incidents.ts's unprotectedTimeLossSecondsRange) — samme roll
// giver samme sekunder uanset evne. En bedre descender kan derfor kun styrte
// SJAELDNERE, aldrig haardere.

import type {
  DescentHook,
  DescentTuning,
  EngineState,
  GroupKind,
  RaceGroup,
  RiderState,
  SegmentHookContext,
  SegmentHookResult,
  StageIncident,
  TimelineEvent,
} from "../types.ts";
import { makeGroupId, splitGroup } from "../groups.ts";
import { incidentEvent } from "../timeline.ts";
import { DESCENT_EXTRA_TUNING, INCIDENTS_EXTRA_TUNING, WEATHER_EXTRA_TUNING } from "../tuning.ts";
import { hasHelperNearby, maxIncidentsForField, resolveCrashIncident, threeKmRuleApplies } from "./incidents.ts";
import { weatherAdjustedRiskBase } from "./weather.ts";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Afgoer om descentHook's no-op-garanti (samme state-reference, se testen
 * "no-op skal returnere praecis samme state-reference") gaelder. `groups`
 * faar altid en NY array-reference af regroupOnDescent (ogsaa naar ingen
 * vaerdi aendrer sig), saa dens no-op-status maales paa VAERDI (den
 * separat vedligeholdte `groupsChanged`-boolean). `riders` derimod
 * genbruger ALTID samme reference indtil noget rent faktisk mutation den
 * (`riders = { ...riders, ... }`) — dens no-op-status maales derfor paa
 * REFERENCE, uafhaengigt af `groupsChanged`. Fælden (#4950): et fremtidigt
 * kald der muterer `riders` uden ogsaa at saette `groupsChanged = true`
 * ville, med kun ÉT samlet flag, tabe mutationen tavst. De to uafhaengige
 * tjek forhindrer det.
 */
export function descentResultIsNoop(
  groupsChanged: boolean,
  riders: Record<string, RiderState>,
  stateRiders: Record<string, RiderState>,
): boolean {
  return !groupsChanged && riders === stateRiders;
}

// ── Pure helpers (eksporteret for direkte kontrakt-tests) ────────────────────

/**
 * Seedet styrt-risiko for én angribende rytter (beslutning 7, gulv #4905):
 * basis-risiko daempet MULTIPLIKATIVT af descending-evnen (0-99-skala), med et
 * GULV paa evne-multiplikatoren saa daempningen aldrig kan naa 0. Den gamle
 * subtraktive form (`incidentRiskDescendingDampening` i den frosne
 * DescentTuning-kontrakt, se tuning.ts's kommentar ved feltet) kunne naa
 * PRAECIS 0 ved enhver descending >= ~67 — netop de ryttere `findAttackers`
 * altid vaelger som angribere — hvilket gjorde nedkoerselsstyrt statistisk
 * usynlige, ogsaa i regn (issue-maaling: 40 loeb x 120 angreb = 0 uheld).
 * Gulvet (`incidentRiskFloorFraction`) og evne-daempningens raekkevidde
 * (`incidentRiskAbilityDampeningFraction`) bor i DESCENT_EXTRA_TUNING (samme
 * "additiv tuning uden om den frosne kontrakt"-moenster som #4604's
 * regrupperings-lag) — ikke i DescentTuning selv.
 *
 * ALDRIG omvendt fortegn: evne-multiplikatoren er `max(gulv, faldende
 * linje-i-ability)` — et max af en konstant og en ikke-stigende funktion er
 * selv ikke-stigende, saa risikoen kan kun FALDE (eller flade ud ved gulvet)
 * med descending-evnen, aldrig stige. clamp [0,1] fanger stadig
 * "ingen risiko" og en evt. urealistisk hoej basis-risiko efter vejr-forstaerkning.
 */
export function incidentProbability(
  descendingAbility: number,
  tuning: Pick<DescentTuning, "incidentRiskBase"> & {
    incidentRiskFloorFraction: number;
    incidentRiskAbilityDampeningFraction: number;
  },
): number {
  const ability = clamp(Number(descendingAbility) || 0, 0, 99);
  const floor = clamp(tuning.incidentRiskFloorFraction, 0, 1);
  const dampFraction = clamp(tuning.incidentRiskAbilityDampeningFraction, 0, 1);
  const abilityMultiplier = Math.max(floor, 1 - dampFraction * (ability / 99));
  return clamp(tuning.incidentRiskBase * abilityMultiplier, 0, 1);
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
  const secondsPerKm = isFinishDescent ? extra.regroupFinishSecondsPerKm : extra.regroupSecondsPerKm;
  const gapFractionPerKm = isFinishDescent ? extra.regroupFinishGapFractionPerKm : extra.regroupGapFractionPerKm;

  const absoluteClose = secondsPerKm * km * techFactor * abilityFactor;
  const fractionPerSegment = 1 - Math.pow(1 - clamp(gapFractionPerKm, 0, 1), km);
  const proportionalClose = gap * clamp(
    fractionPerSegment * techFactor * abilityFactor,
    0,
    extra.regroupMaxGapFractionPerSegment,
  );

  const closing = Math.max(absoluteClose, proportionalClose);
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

  // Etapens uheldsloft (#4934) deles med M10 — det er ÉN model, altsaa ét loft.
  // `state.stage_incidents` er etapens hidtidige bogfoering (M10 skriver den
  // samme liste), og segmentLoop kalder descent-hooket FOER incidents-hooket,
  // saa et nedkoersels-styrt bruger af det samme budget i den raekkefoelge det
  // sker paa vejen. Budgettet beregnes ÉN gang pr. hook-kald: loftet er pr.
  // ETAPE, ikke pr. gruppe.
  const loggedIncidents: StageIncident[] = state.stage_incidents ?? [];
  const newIncidents: StageIncident[] = [];
  let incidentBudget = maxIncidentsForField(Object.keys(state.riders).length, INCIDENTS_EXTRA_TUNING)
    - loggedIncidents.length;

  const gapBeforeById = new Map(state.groups.map((g) => [g.id, g.gap_seconds]));
  let changed = groups.some((g) => gapBeforeById.get(g.id) !== g.gap_seconds);

  // 2. Descent attack: uaendret gate (kun T2-T3), men nu paa den regrupperede
  //    struktur — et angreb skabt her overlever til maal praecis som foer.
  if (segment.technicality < ctx.tuning.descent.minTechnicalityForAttack) {
    if (descentResultIsNoop(changed, riders, state.riders)) return { state, events };
    return { state: { ...state, groups, riders }, events };
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
    //
    // M11-wiring (#3855, 6/9): basis-risikoen er VEJR-FORSTAERKET foer
    // daempningen — mor-spec §4 M11's egen formulering er "regn forstaerker
    // ... descent attack-risikoen", og weather.ts's wiring-note udpeger
    // netop dette kaldssted (mulighed (a), uden ny DescentTuning-noegle).
    // Raekkefoelgen er bevidst: vejret forstaerker FOERST, evnen daemper
    // DEREFTER, saa daempningen altid virker paa den faktiske risiko.
    // weatherTechniqueDampening laegges IKKE oveni her: proxy'en er halvt
    // descending, og den evne daemper allerede i incidentProbability —
    // to lag ville taelle den samme evne to gange (mechanics/cobbles.ts har
    // ikke det problem, fordi den daemper paa cobblestone).
    //
    // GULV (#4905, 6/9): evne-daempningen laegges paa OVENPAA vejr-forstaerkningen
    // (samme raekkefoelge som foer), men er nu multiplikativ MED et gulv fra
    // DESCENT_EXTRA_TUNING — se incidentProbability's kommentar. Uden gulvet
    // naaede den gamle subtraktive daempning 0 for enhver descending >= ~67,
    // uanset hvor meget vejret havde forstaerket basis-risikoen.
    const weatherAdjustedDescentTuning = {
      incidentRiskBase: weatherAdjustedRiskBase(
        ctx.tuning.descent.incidentRiskBase,
        ctx.route.weather,
        WEATHER_EXTRA_TUNING,
      ),
      incidentRiskFloorFraction: extra.incidentRiskFloorFraction,
      incidentRiskAbilityDampeningFraction: extra.incidentRiskAbilityDampeningFraction,
    };
    for (const attacker of attackers) {
      // Loftet er haardt: er etapens budget brugt, rulles der ikke engang.
      if (incidentBudget <= 0) break;
      const rng = ctx.rngFor("descent_incident", attacker.riderId);
      const p = incidentProbability(attacker.descending, weatherAdjustedDescentTuning);
      const roll = rng();
      if (roll >= p) continue;
      const kmFrac = rng();
      const incidentKm = round2(segment.from_km + kmFrac * (segment.to_km - segment.from_km));
      const riderState = riders[attacker.riderId];
      if (!riderState) continue;

      // ── Trappen (#4934): descent afgoer INTET om konsekvensen ────────────
      // Egne stream-navne (ikke M10's "incident_severity"/...): rammer baade
      // M3 og M10 den samme rytter i det samme segment, ville delte streams
      // give de to uheld IDENTISKE alvorstrin. Per-rytter-hash-egenskaben er
      // uaendret — udfaldet afhaenger kun af (seed, segment, rider_id), saa én
      // ekstra tilmelding flytter ikke andres udfald (invariant 1).
      const protectedByRule = threeKmRuleApplies(
        incidentKm,
        ctx.route.distance_km,
        ctx.route.profile_type,
        INCIDENTS_EXTRA_TUNING,
      );
      // "Hjaelper taet paa" maales i den gruppe han FAKTISK er i nu: den
      // nyoprettede angrebsgruppe SOM DEN SER UD I DETTE OEJEBLIK (en tidligere
      // angriber i samme loop kan allerede vaere splittet ud af sit eget
      // styrt). M10 maaler i rytterens egen gruppe paa samme maade. Feltet bag
      // ham kan ikke raekke ham et hjul.
      const attackGroupNow = groups.find((g) => g.id === newGroupId);
      const helperNearby = hasHelperNearby(
        attackGroupNow?.rider_ids ?? attackerIds,
        ctx.entrants,
        riders,
        attacker.riderId,
      );
      const resolved = resolveCrashIncident(
        {
          severity: ctx.rngFor("descent_incident_severity", attacker.riderId)(),
          magnitude: ctx.rngFor("descent_incident_time_loss", attacker.riderId)(),
          injury: ctx.rngFor("descent_incident_injury", attacker.riderId)(),
        },
        { protectedByRule, helperNearby },
        INCIDENTS_EXTRA_TUNING,
      );
      incidentBudget -= 1;

      riders = {
        ...riders,
        [attacker.riderId]: {
          ...riderState,
          incidents: riderState.incidents + 1,
          status: resolved.outcome === "abandoned" ? "abandoned" : riderState.status,
        },
      };

      if (resolved.outcome !== "protected_three_km_rule") {
        // GEVINSTEN BORTFALDER: `+gainSeconds` bringer ham praecis tilbage paa
        // kildegruppens gap (angrebsgruppen ligger `-gainSeconds` foran den),
        // og trappens tidstab laegges oveni. Ved trin 3 er "tidstabet"
        // abandonedGapSeconds — samme repraesentation af "ingen maaltid" som M10.
        const laterGapDelta = resolved.outcome === "abandoned"
          ? INCIDENTS_EXTRA_TUNING.abandonedGapSeconds
          : (resolved.timeLossSeconds ?? 0);
        groups = splitGroup(groups, newGroupId, [attacker.riderId], {
          id: makeGroupId("solo", ctx.segmentIndex * 1000 + seq),
          kind: "solo",
          gapSecondsDelta: gainSeconds + laterGapDelta,
        });
        seq += 1;
        changed = true;
      }

      newIncidents.push({
        rider_id: attacker.riderId,
        km: incidentKm,
        kind: resolved.kind,
        severity: resolved.severity,
        outcome: resolved.outcome,
        time_loss_seconds: resolved.timeLossSeconds,
        injury_days: resolved.injuryDays,
        helper_assist: resolved.helperAssist,
      });

      // Samme event-form som M10's (incidentEvent) + `cause`-feltet M3 altid
      // har baaret, saa harness/tests kan skelne kanalen uden at der findes to
      // event-taksonomier. Valgfrit `cause`-argument (#4950) i stedet for en
      // spread ovenpaa returvaerdien — samme moenster som severity/injuryDays/
      // helperAssist herover, og timeline-validatoren tjekker nu feltets form.
      events.push(
        incidentEvent(incidentKm, {
          riderId: attacker.riderId,
          kind: resolved.kind,
          outcome: resolved.outcome,
          timeLossSeconds: resolved.timeLossSeconds,
          severity: resolved.severity,
          injuryDays: resolved.injuryDays,
          helperAssist: resolved.helperAssist,
          cause: "descent_attack",
        }),
      );
    }
  }

  if (newIncidents.length > 0) {
    return {
      state: { ...state, groups, riders, stage_incidents: [...loggedIncidents, ...newIncidents] },
      events,
    };
  }
  if (descentResultIsNoop(changed, riders, state.riders)) return { state, events };
  return { state: { ...state, groups, riders }, events };
};
