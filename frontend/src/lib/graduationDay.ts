// graduationDay — ren logik bag Graduation Day-siden (#2491).
//
// Siden selv (pages/GraduationDayPage.tsx) tegner; denne fil svarer paa de fire
// spoergsmaal der kan besvares uden DOM, saa de kan laases med `node --test`:
//
//   1. Hvilke OVERGANGE findes der i dag? (`groupGraduations`)
//   2. Er "Move up" blokeret, og hvorfor? (`moveUpBlock`)
//   3. Hvad er default-valget pr. rytter? (`defaultChoice`)
//   4. Hvad siger traeneren om rytteren? (`coachVerdictKey` — fog-gatet)
//
// Hard rule 31: nye frontend-filer skrives i .ts/.tsx.
//
// KILDEN til overgangene er serveren. Backendens `detectGraduates`
// (backend/lib/academyGraduation.js) skriver `from_squad`/`to_squad` paa
// academy_graduation-raekken via `transitionForRider` (backend/lib/squads.js),
// og GET /api/academy/me sender dem videre. Denne fil OPFINDER derfor ingen
// overgang og skaerer ingen vaek: den grupperer praecis de raekker der kom.

export type Squad = "junior" | "u23" | "senior";
export type GraduationChoice = "promote" | "sell" | "release";

export interface Graduate {
  riderId: string;
  name: string;
  age: number | null;
  deadline: string | null;
  fromSquad: string | null;
  toSquad: string;
  targetSquadCount: number | null;
  targetSquadMax: number | null;
  salary: number | null;
  market_value: number | null;
  contract_end_season: number | null;
  primary_type: string | null;
  secondary_type: string | null;
  nationality_code: string | null;
  rider_derived_abilities: Record<string, number> | null;
}

export interface GraduationGroup {
  key: string;
  fromSquad: string | null;
  toSquad: string;
  riders: Graduate[];
}

// Raekkefoelgen paa MAAL-truppen, yngst foerst. Spejler SQUAD_TRANSITIONS i
// backend/lib/squads.js (junior -> u23 foer u23 -> senior), saa kortene staar i
// samme raekkefoelge som spilleren moeder overgangene i spillet. En ukendt
// maal-trup (aeldre raekke uden `to_squad`) falder bagerst frem for at forsvinde.
const TARGET_ORDER: Record<string, number> = { u23: 0, senior: 1 };

/**
 * Gruppér graduates i ÉT kort pr. overgang.
 *
 * Nøglen er `from -> to`, ikke kun `to`: en junior og en U23-rytter kan begge
 * ende i samme maal-trup i en fremtidig regel-aendring, og de er stadig to
 * forskellige overgange for spilleren.
 */
export function groupGraduations(graduates: Graduate[] = []): GraduationGroup[] {
  const groups = new Map<string, GraduationGroup>();
  for (const g of graduates) {
    if (!g || !g.riderId) continue;
    const toSquad = g.toSquad || "senior";
    const fromSquad = g.fromSquad ?? null;
    const key = `${fromSquad ?? "unknown"}->${toSquad}`;
    const existing = groups.get(key);
    if (existing) existing.riders.push(g);
    else groups.set(key, { key, fromSquad, toSquad, riders: [g] });
  }
  return [...groups.values()].sort((a, b) => {
    const rank = (t: string) => TARGET_ORDER[t] ?? 99;
    return rank(a.toSquad) - rank(b.toSquad) || a.key.localeCompare(b.key);
  });
}

export interface MoveUpBlock {
  reason: "squad_full";
  count: number;
  max: number;
}

/**
 * Er "Move up" blokeret for denne rytter?
 *
 * PRAECIS den gate serveren bruger, og kun den. `resolveGraduation`s
 * promote-gren afviser udelukkende paa `hasRoomInTargetSquad`
 * (squad_cap_violation) — ungdomstrupper mod SQUAD_CAPS, senior mod divisionens
 * cap. Den er verificeret i backend/lib/academyGraduation.js: MANUEL oprykning
 * har med vilje INGEN gaelds-guard ("det er spillerens valg"; kun AUTO-defaulten
 * er konservativ), saa fladen maa heller ikke vise en "cannot afford"-blokering
 * der ikke findes i motoren.
 *
 * Ukendt loft (null) blokerer ikke: vi gaetter aldrig en cap vi ikke fik.
 */
export function moveUpBlock(graduate: Pick<Graduate, "targetSquadCount" | "targetSquadMax">): MoveUpBlock | null {
  const count = graduate?.targetSquadCount;
  const max = graduate?.targetSquadMax;
  if (!Number.isFinite(count as number) || !Number.isFinite(max as number)) return null;
  if ((count as number) + 1 <= (max as number)) return null;
  return { reason: "squad_full", count: count as number, max: max as number };
}

/**
 * Default-valget pr. rytter: `Move up` medmindre den er blokeret, saa `Sell`
 * (ejer-godkendt mockup 3g). Det spejler default-kaeden serveren koerer ved
 * fristen: op hvis der er plads, ellers saelg.
 */
export function defaultChoice(graduate: Pick<Graduate, "targetSquadCount" | "targetSquadMax">): GraduationChoice {
  return moveUpBlock(graduate) ? "sell" : "promote";
}

/**
 * Det valg der FAKTISK gaelder for rytteren lige nu — ÉN funktion, som baade
 * segmentet og "Confirm all" gaar igennem.
 *
 * CodeRabbit-fund (21/9): truppen kan blive fuld MENS listen staar aaben.
 * Rytter A og B er begge sat til `Move up` mod en trup med én ledig plads; A
 * tager pladsen, listen henter sig selv, og B er nu blokeret. Segmentet viste
 * allerede `Sell` (render-siden faldt tilbage naar `block` var sat), men det
 * GEMTE valg stod stadig paa `promote` — saa naeste "Confirm all" sendte
 * `promote` og fik `squad_cap_violation` igen, for en raekke der paa skaermen
 * sagde `Sell`. Det fandtes fordi visning og indsendelse hver havde sin egen
 * lille regel. Nu har de den samme.
 */
export function effectiveChoice(
  graduate: Pick<Graduate, "targetSquadCount" | "targetSquadMax">,
  stored: GraduationChoice | null | undefined,
): GraduationChoice {
  if (stored == null) return defaultChoice(graduate);
  if (stored === "promote" && moveUpBlock(graduate)) return "sell";
  return stored;
}

export type CoachVerdictKey = "unknown" | "unproven" | "climbing" | "arriving" | "settled";

export interface CoachVerdictInput {
  rating: number | null;
  band: { lo: number; hi: number } | null;
  level?: number | null;
  maxLevel?: number | null;
}

// Afstanden mellem rytterens rating i dag og midten af prognose-baandet,
// oversat til TRE grader af traener-sprog. Tallene er visnings-graenser for
// copy, ikke motor-parametre: de aendrer intet i spillet, kun hvilken af tre
// saetninger traeneren siger.
const CLIMBING_GAP = 6;
const ARRIVING_GAP = 2;

/**
 * Traenerens vurdering som en NOEGLE (i18n-teksten bor i academy.json).
 *
 * FOG-GATE (addendum Fase 4, YOUTH_RULES §2.6): vurderingen maa aldrig laekke
 * raat potentiale eller paastaa mere end spejderen faktisk ved.
 *   • intet baand (uscoutet/ukendt) -> "unknown"
 *   • baandet er endnu ikke faerdig-scoutet (level < maxLevel) -> "unproven",
 *     en hedged saetning der IKKE sammenligner tal
 *   • foerst med fuldt baand siger traeneren noget om afstanden
 * Sproget er bevidst blødt; "naaede sit loft" er forbudt sprog.
 */
export function coachVerdictKey({ rating, band, level = null, maxLevel = null }: CoachVerdictInput): CoachVerdictKey {
  if (!band || !Number.isFinite(band.lo) || !Number.isFinite(band.hi)) return "unknown";
  if (Number.isFinite(level as number) && Number.isFinite(maxLevel as number) && (level as number) < (maxLevel as number)) {
    return "unproven";
  }
  if (!Number.isFinite(rating as number)) return "unknown";
  const gap = (band.lo + band.hi) / 2 - (rating as number);
  if (gap >= CLIMBING_GAP) return "climbing";
  if (gap >= ARRIVING_GAP) return "arriving";
  return "settled";
}
