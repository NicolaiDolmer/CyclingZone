// backend/lib/engine/v4/mechanics/leadout.ts
// Race Engine v4 F3 (#4030, #3855): M6 - sprint-tog. Leadout-roller flytter
// kaptajnens position i finale-opgoeret.
// SSOT: docs/superpowers/specs/2026-08-20-race-engine-v4-intra-stage-design.md
// §4 M6 ("leadout-roller flytter position i finale-opgoeret") + §8 beslutning 9
// ("bounded bidrag" — samme princip som M5's udbruds-flag).
// Ordre-kontrakt-reference: docs/superpowers/specs/2026-08-21-race-tactics-
// orders-v1-design.md (T3, "F3-udvidelser (additive): leadout_for (M6
// sprint-tog)") — types.ts's `TeamOrder` (§2, frosset af arkitekten) er
// BEVIDST et loest `{team_id, kind, params?}`-kontrakt-udkast praecis for at
// F3-mekanikker som denne kan definere deres egen `kind`/`params`-form uden at
// aendre den frosne type. `parseLeadoutOrders` nedenfor er den lokale
// fortolkning af det udkast: `kind: "leadout"`, `params: LeadoutOrderParams`.
//
// REN — ingen import fra oevrigt backend, ingen IO/Date/Math.random. Alle
// eksporterede funktioner er rene: samme input -> samme output, intet
// input muteres.
//
// BOUNDED (hardt krav, mor-spec §2 punkt 5 + §4 M6): leadout-bonussen kan
// ALDRIG afgoere en placering alene — den er ét additivt, clampet led i
// finale.ts's evne-vaegtede placerings-score (jf. computeFinaleAbilityScore,
// samme moenster som wprimeReserveWeight). En kaptajn uden leadout-stoette
// scorer PRAECIS som i dag (bonus 0); et fuldt sprint-tog kan aldrig hive en
// kaptajn med bundscore op over en topscoret rival — se WIRING-noten nederst
// og LEADOUT_EXTRA_TUNING.maxScoreBonus for det haarde loft.

import type { AbilityKey, Entrant, RiderState, TeamOrder } from "../types.ts";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function normAbility(v: number | undefined): number {
  return clamp(Number(v) || 0, 0, 99) / 99;
}

// ── Ordre-fortolkning ─────────────────────────────────────────────────────────

/**
 * Lokal fortolkning af TeamOrder.params for `kind === "leadout"`. Ét hold kan
 * kun designere ét sprint-tog pr. etape i v1 (én kaptajn) — flere
 * "leadout"-ordrer for samme team_id er en klient-fejl; parseLeadoutOrders
 * bruger den SIDSTE (array-raekkefoelge, deterministisk) og ignorerer
 * resten, saa motoren aldrig kaster paa daarlig input.
 */
export type LeadoutOrderParams = {
  captain_rider_id: string;
  // Front-til-bag raekkefoelge (sidste mand afleverer kaptajnen). Raekkefoelgen
  // paavirker IKKE scoren i v1 (kun kollektiv kvalitet gaelder) — baeres for
  // fremtidig UI/why-rapport-visning og AI-taktik-paritet (M14).
  leadout_rider_ids: string[];
};

export type LeadoutOrder = {
  team_id: string;
  captain_rider_id: string;
  leadout_rider_ids: string[];
};

function isLeadoutParams(params: Record<string, unknown> | undefined): params is LeadoutOrderParams {
  if (!params) return false;
  const p = params as Partial<LeadoutOrderParams>;
  return typeof p.captain_rider_id === "string" && Array.isArray(p.leadout_rider_ids);
}

/** Udtraekker gyldige M6-ordrer fra den raa TeamOrder[]-liste (§2's aabne kind/params-kontrakt). */
export function parseLeadoutOrders(orders: readonly TeamOrder[]): LeadoutOrder[] {
  const byTeam = new Map<string, LeadoutOrder>();
  for (const order of orders) {
    if (order.kind !== "leadout") continue;
    if (!isLeadoutParams(order.params)) continue;
    const leadoutRiderIds = order.params.leadout_rider_ids.filter((id): id is string => typeof id === "string");
    if (leadoutRiderIds.length === 0) continue;
    byTeam.set(order.team_id, {
      team_id: order.team_id,
      captain_rider_id: order.params.captain_rider_id,
      leadout_rider_ids: leadoutRiderIds,
    });
  }
  return [...byTeam.values()].sort((a, b) => a.team_id.localeCompare(b.team_id));
}

// ── Tog-kvalitet ──────────────────────────────────────────────────────────────

const QUALITY_KEYS: AbilityKey[] = ["positioning", "tempo", "acceleration"];

function wprimeReserveFraction(rider: RiderState | undefined): number {
  if (!rider || rider.wprimeMax <= 0) return 0;
  return clamp(rider.wprime / rider.wprimeMax, 0, 1);
}

/**
 * Kollektiv sprint-tog-kvalitet (0-1): gennemsnit af leadout-rytternes
 * positioning/tempo/acceleration-evne, VAEGTET af hver rytters resterende W'-
 * reserve (en udtoemt "hjaelper" trak sit slaeb tidligere og bidrager mindre
 * NU, i selve finale-opgoeret — samme reserve-princip som finale.ts's
 * wprimeReserveWeight). KUN leadout-ryttere der reelt er `contenderIds`
 * (samme finale-kontendentpulje som kaptajnen — hjaelpere der blev sluppet
 * tidligere paa etapen findes ikke laengere i finale-opgoerets frontpulje)
 * taeller med; et sprint-tog der ikke overlevede ind i finalen giver INGEN
 * bonus (kvalitet 0), hvilket er den korrekte "toget blev sprengt"-adfaerd.
 */
export function computeLeadoutQuality(
  leadoutRiderIds: string[],
  contenderIds: ReadonlySet<string>,
  entrants: Readonly<Record<string, Entrant>>,
  riderStates: Readonly<Record<string, RiderState>>,
): number {
  const present = leadoutRiderIds.filter((id) => contenderIds.has(id));
  if (present.length === 0) return 0;

  // To UAFHAENGIGE komponenter — "hvor gode er de" (avgAbility) ganges med
  // "hvor friske er de" (avgEffectiveness), IKKE en vaegtet gennemsnit af
  // (evne, vaegt)-par: et vaegtet gennemsnit af ÉT enkelt element er
  // uafhaengigt af vaegten (n=1 kollapser vaegtningen), saa et solo-leadout
  // med en helt udtoemt rytter ville faa PRAECIS samme kvalitet som en
  // frisk — det bryder "udtoemt hjaelper bidrager mindre"-intentionen for
  // netop det almindelige tilfaelde (1-2 leadout-ryttere). Produktet af de
  // to gennemsnit skalerer korrekt uanset togstoerrelse.
  let abilitySum = 0;
  let effectivenessSum = 0;
  let n = 0;
  for (const riderId of present) {
    const abilities = entrants[riderId]?.abilities;
    if (!abilities) continue;
    let s = 0;
    for (const key of QUALITY_KEYS) s += normAbility(abilities[key]);
    abilitySum += s / QUALITY_KEYS.length;
    const reserve = wprimeReserveFraction(riderStates[riderId]);
    // Reserve-gulv (0.15): selv en helt udtoemt rytter yder stadig LIDT
    // (position/skub taeller delvist uden krudt) — undgaar at effektiviteten
    // falder helt til 0 for en udtoemt, men stadig TILSTEDEVAERENDE rytter.
    effectivenessSum += 0.15 + 0.85 * reserve;
    n++;
  }
  if (n === 0) return 0;
  const avgAbility = abilitySum / n;
  const avgEffectiveness = effectivenessSum / n;
  return clamp(avgAbility * avgEffectiveness, 0, 1);
}

// ── Bounded score-bonus ────────────────────────────────────────────────────────

export type LeadoutBonusTuning = {
  maxScoreBonus: number; // haardt loft paa den samlede score-bonus (finale.ts's evne-skala, ~0-1)
  fullTrainSize: number; // antal leadout-ryttere der giver FULD stoerrelse-multiplikator (diminishing derover)
};

/**
 * Stoerrelses-multiplikator (0-1): flere ryttere i toget giver mere bonus,
 * med aftagende marginalnytte over `fullTrainSize` (ét ekstra sæt hjul
 * betyder mindre for et allerede 4-mands-tog end for et solo-tog).
 * `presentCount` er ANTALLET af leadout-ryttere der reelt er i kontendentpuljen
 * (jf. computeLeadoutQuality's `present`-filter) — et sprengt tog giver 0.
 */
export function trainSizeFactor(presentCount: number, fullTrainSize: number): number {
  if (presentCount <= 0 || fullTrainSize <= 0) return 0;
  return clamp(Math.sqrt(presentCount / fullTrainSize), 0, 1);
}

/**
 * Bounded finale-placerings-score-bonus for ÉN kaptajn (§4 M6, "bounded
 * effekt, aldrig deterministisk sejr"): kvalitet × stoerrelses-faktor ×
 * maxScoreBonus. Per konstruktion i [0, maxScoreBonus] — kan ALDRIG blive
 * negativ (intet straffer en kaptajn uden sprint-tog: ingen ordre = ingen
 * ordre-effekt, jf. tactics-orders-spec T4-defaultet), og kan ALDRIG overstige
 * loftet uanset hvor stort/staerkt toget er.
 */
export function computeLeadoutScoreBonus(quality: number, presentCount: number, tuning: LeadoutBonusTuning): number {
  const size = trainSizeFactor(presentCount, tuning.fullTrainSize);
  return clamp(quality, 0, 1) * size * Math.max(0, tuning.maxScoreBonus);
}

// ── Wireable adjustment (finale.ts-kompatibel scored-liste) ───────────────────

export type ScoredRiderLike = { riderId: string; score: number };

/**
 * Anvender leadout-bonussen paa en finale.ts-stil scored-liste (samme
 * `{riderId, score}`-form som finale.ts's interne `ScoredRider`): returnerer
 * en NY liste (input muteres aldrig) hvor hver ordre-designeret kaptajns
 * score er forhoejet med `computeLeadoutScoreBonus`. Kaptajner der IKKE er i
 * `scored` (ikke overlevet ind i finale-kontendentpuljen) ignoreres tavst.
 * Rene ryttere uden en leadout-ordre er upaavirkede (samme score som input).
 *
 * WIRET 3/9 (#4615): `SegmentHookContext` baerer nu `orders`, og finale.ts
 * kalder denne funktion paa den u-sorterede kontendent-liste LIGE FOER
 * `scored.sort(...)` — bonussen skal kunne flytte en placering, aldrig
 * efterrationalisere en allerede afgjort raekkefolge.
 */
export function applyLeadoutScoreBonuses(
  scored: readonly ScoredRiderLike[],
  leadoutOrders: readonly LeadoutOrder[],
  contenderIds: ReadonlySet<string>,
  entrants: Readonly<Record<string, Entrant>>,
  riderStates: Readonly<Record<string, RiderState>>,
  tuning: LeadoutBonusTuning,
): ScoredRiderLike[] {
  if (leadoutOrders.length === 0) return scored.map((s) => ({ ...s }));

  const bonusByCaptain = new Map<string, number>();
  for (const order of leadoutOrders) {
    if (!contenderIds.has(order.captain_rider_id)) continue;
    const presentLeadoutIds = order.leadout_rider_ids.filter((id) => contenderIds.has(id));
    const quality = computeLeadoutQuality(order.leadout_rider_ids, contenderIds, entrants, riderStates);
    const bonus = computeLeadoutScoreBonus(quality, presentLeadoutIds.length, tuning);
    if (bonus <= 0) continue;
    // Ét hold pr. kaptajn i v1 (parseLeadoutOrders afvæbner allerede dubletter
    // pr. team_id); to FORSKELLIGE hold kan i teorien pege paa samme
    // rider_id (data-fejl opstroems) — summér defensivt frem for at kaste.
    bonusByCaptain.set(order.captain_rider_id, (bonusByCaptain.get(order.captain_rider_id) ?? 0) + bonus);
  }
  if (bonusByCaptain.size === 0) return scored.map((s) => ({ ...s }));

  return scored.map((entry) => {
    const bonus = bonusByCaptain.get(entry.riderId);
    if (!bonus) return { ...entry };
    // Dobbelt-clamp: selv naar flere hold (data-fejl) peger paa samme rytter,
    // kan DENNE rytters SAMLEDE bonus aldrig overstige det enkelte loft.
    return { ...entry, score: entry.score + clamp(bonus, 0, tuning.maxScoreBonus) };
  });
}
