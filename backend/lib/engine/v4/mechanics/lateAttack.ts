// backend/lib/engine/v4/mechanics/lateAttack.ts
// #6368 (s5_profiles_v1 og senere; LIVE i s5_profiles_v3): det sene soloangreb som motoradfaerd.
// Spec docs/superpowers/specs/2026-10-12-s5-etapeprofiler-design.md §3-§4: udbrud
// og soloangreb er ikke en finaletype (det ville skrive resultatet paa forhaand);
// motoren afgoer om et staerkt angreb 5-15 km fra maal holder hjem, naar evner og
// taktik tillader det. Udbrudsfinalens gamle evne-vaegte er angrebets evne.
//
// Mekanikken laver KUN angrebet: den staerkeste angriber i favoritgruppen koerer
// fra med et forspring der vokser med hans forspring paa nr. 2 i gruppen. Om det
// holder, afgoeres af motorens egen jagt bagefter (tempo-modellen paa resten af
// ruten og finalens jagt-mod-flugt, finale.ts), aldrig her.
//
// Kaldes fra breakawayHook (M5) paa hvert segment; sker hoejst én gang pr. etape
// (kun paa vindues-segmentet, lateAttackSegmentIndex). REN: muterer aldrig input,
// rng kun via ctx.rngForStage (én lodtraekning pr. etape).
//
// #6368 lag 3 (ejer 26/10, KUN s5_profiles_v3): kun ledere (kaptajn, delt kaptajn,
// spurtkaptajn) og fri rolle maa angribe sent. En hjaelper (ogsaa paa Arbejd) maa kun,
// naar ingen af holdets kaptajner koerer i favoritgruppen (kaptajnen er sat). Jaegeren
// er morgenudbruddets rolle og angriber ikke sent. Nr. 2 i gruppen (forspringets
// maalestok) er stadig den staerkeste ANDEN rytter i gruppen uanset rolle: alle kan
// svare paa et angreb. Aeldre revisioner (v1/v2) er bit-identiske.
//
// #7383 (SLUKKET motorkontakt, KUN s5_profiles_v3): med kontakten taendt er 10 km fra maal
// altid en segmentgraense. Angrebet ser de to stykker som EET segment og vaelger sit
// segment som paa den udelte rute (lateAttackSegmentIndex), saa graensen hverken giver
// et angreb paa en etape der ikke havde et eller lander midt i en stigning/sektor.
// Slukket er der intet delt stykke, og funktionen er uaendret.

import { finalKmUndivided7383 } from "../adapters/finalKmBoundary7383.ts";
import { makeGroupId, splitGroup } from "../groups.ts";
import { S5_PROFILES_TUNING } from "../tuning.ts";
import type { AbilityKey, EngineState, Entrant, RaceGroup, RiderRole, RouteV2, SegmentHookContext, SegmentHookResult } from "../types.ts";

/** #6368 lag 3: rollerne der altid maa angribe sent under s5_profiles_v3. */
export const LATE_ATTACK_LEADER_ROLES: ReadonlySet<RiderRole> = new Set<RiderRole>(["captain", "co_captain", "sprint_captain", "free_role"]);
/** Rollerne der goer en hjaelper bunden: saa laenge en af dem koerer i gruppen, angriber han ikke. */
const TEAM_CAPTAIN_ROLES: ReadonlySet<RiderRole> = new Set<RiderRole>(["captain", "co_captain"]);

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function normAbility(v: number | undefined): number {
  return clamp(Number(v) || 0, 0, 99) / 99;
}

function finishKmOf(route: Pick<RouteV2, "distance_km" | "segments">): number {
  return Number.isFinite(route.distance_km) && route.distance_km > 0 ? route.distance_km : route.segments[route.segments.length - 1]?.to_km ?? 0;
}

/** Har ruten brostens- eller grussektorer (begge er "cobbles"-segmenter i motoren)? */
export function routeHasSectors(route: Pick<RouteV2, "segments">): boolean {
  return route.segments.some((s) => s.kind === "cobbles");
}

/** Chancen (0-1) for et sent angreb paa denne rute. 0 = terraenet giver ikke angrebet. */
export function lateAttackChance(route: Pick<RouteV2, "profile_type" | "finale_type" | "segments">): number {
  const t = S5_PROFILES_TUNING.lateAttack;
  const finale = route.finale_type;
  if (finale === "long_climb" || finale === "descent" || finale === "solo_tt") return 0;
  if (routeHasSectors(route)) return t.chanceWithSectors;
  if (finale && t.excludedFinales.includes(finale)) return 0;
  return t.hillyProfiles.includes(route.profile_type) ? t.chanceHilly : 0;
}

/**
 * Segmentet angrebet sker paa: det SENESTE segment (ikke etapens sidste, ikke en
 * nedkoersel) der slutter inden for vinduet `windowKm` fra maal. -1 = intet.
 * #7383: paa en rute delt ved 10 km fra maal vaelges segmentet paa den udelte rute og
 * oversaettes til den delte (det delte stykke selv -> halen, samme slut-km).
 */
export function lateAttackSegmentIndex(route: Pick<RouteV2, "distance_km" | "segments">): number {
  const undivided = finalKmUndivided7383(route.segments);
  if (!undivided) return lateAttackSegmentIndexOn(route);
  const index = lateAttackSegmentIndexOn({ distance_km: route.distance_km, segments: undivided.segments as RouteV2["segments"] });
  return index < undivided.headIndex ? index : index + 1;
}

function lateAttackSegmentIndexOn(route: Pick<RouteV2, "distance_km" | "segments">): number {
  const [minKm, maxKm] = S5_PROFILES_TUNING.lateAttack.windowKm;
  const finishKm = finishKmOf(route);
  for (let i = route.segments.length - 2; i >= 0; i--) {
    const seg = route.segments[i];
    const toGo = finishKm - seg.to_km;
    if (toGo > maxKm) break;
    if (toGo >= minKm && seg.kind !== "descent") return i;
  }
  return -1;
}

/** Angrebs-evnen: udbrudsvaegtene (+ brostensevnen paa sektorer) plus egen reserve. */
export function lateAttackScore(abilities: Record<AbilityKey, number> | undefined, reserve01: number, withSectors: boolean): number {
  if (!abilities) return 0;
  const t = S5_PROFILES_TUNING.lateAttack;
  let sum = 0;
  for (const [key, w] of Object.entries(t.demand) as [AbilityKey, number][]) sum += w * normAbility(abilities[key]);
  if (withSectors) for (const [key, w] of Object.entries(t.sectorDemand) as [AbilityKey, number][]) sum += w * normAbility(abilities[key]);
  return sum + t.reserveWeight * clamp(reserve01, 0, 1);
}

function isEscape(group: RaceGroup): boolean {
  return group.origin === "breakaway" && (group.kind === "breakaway" || group.kind === "solo");
}

/** Favoritgruppen: den forreste gruppe uden for dagens udbrud med mindst `minGroupRiders` koerende. */
function favouriteGroup(state: EngineState, entrants: Readonly<Record<string, Entrant>>): RaceGroup | null {
  const minRiders = S5_PROFILES_TUNING.lateAttack.minGroupRiders;
  const candidates = state.groups
    .filter((g) => !isEscape(g))
    .filter((g) => g.rider_ids.filter((id) => state.riders[id]?.status === "racing" && entrants[id]).length >= minRiders)
    .sort((a, b) => a.gap_seconds - b.gap_seconds || a.id.localeCompare(b.id));
  return candidates[0] ?? null;
}

/**
 * #6368 lag 3 (KUN s5_profiles_v3): maa rytteren angribe sent fra denne gruppe?
 * Ledere og fri rolle: ja. Hjaelper: kun naar ingen af holdets kaptajner (kaptajn
 * eller delt kaptajn) koerer i gruppen: sat, udgaaet eller ikke med. Uden hold-id
 * kan kaptajnen ikke findes, og hjaelperen bliver hos gruppen. Jaeger: nej.
 */
export function lateAttackRoleAllowed(riderId: string, groupRiderIds: readonly string[], state: Pick<EngineState, "riders">, entrants: Readonly<Record<string, Entrant>>): boolean {
  const entrant = entrants[riderId];
  if (!entrant) return false;
  if (LATE_ATTACK_LEADER_ROLES.has(entrant.role)) return true;
  if (entrant.role !== "helper") return false;
  const teamId = entrant.team_id;
  if (!teamId) return false;
  // En kaptajn der udgik paa en tidligere etape er ikke paa startlisten laengere
  // (raceRunner), saa "ingen kaptajn i feltet" taeller som sat, ikke som bundet.
  return !groupRiderIds.some((id) => {
    const e = entrants[id];
    return e?.team_id === teamId && TEAM_CAPTAIN_ROLES.has(e.role) && state.riders[id]?.status === "racing";
  });
}

/**
 * Det sene angreb paa dette segment (S5). Uaendret state naar segmentet ikke er
 * vindues-segmentet, terraenet ikke giver angrebet, lodtraekningen siger nej, eller
 * angriberen ikke er staerk nok til at komme fri. Monotont i angriberens evne: en
 * staerkere angriber faar aldrig et mindre forspring.
 */
export function lateAttack(state: EngineState, ctx: Pick<SegmentHookContext, "route" | "segment" | "segmentIndex" | "entrants" | "rngForStage" | "s5ProfilesV3">): SegmentHookResult {
  const none: SegmentHookResult = { state, events: [] };
  const { route, entrants } = ctx;
  if (ctx.segmentIndex !== lateAttackSegmentIndex(route)) return none;
  const chance = lateAttackChance(route);
  if (!(chance > 0)) return none;
  const group = favouriteGroup(state, entrants);
  if (!group) return none;
  const withSectors = routeHasSectors(route);
  const ranked = group.rider_ids
    .filter((id) => state.riders[id]?.status === "racing" && entrants[id] && entrants[id].effort !== "grupetto" && entrants[id].effort !== "save")
    .map((id) => {
      const rider = state.riders[id];
      const reserve = rider && rider.wprimeMax > 0 ? rider.wprime / rider.wprimeMax : 0;
      return { id, score: lateAttackScore(entrants[id].abilities, reserve, withSectors) };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  if (ranked.length < 2) return none;
  // #6368 lag 3 (KUN s5_profiles_v3): angriberen er den staerkeste der MAA angribe;
  // nr. 2 er den staerkeste anden rytter i gruppen (aeldre revisioner: ranked[0]/[1]).
  const roleGated = ctx.s5ProfilesV3 === true;
  const attacker = roleGated ? ranked.find((r) => lateAttackRoleAllowed(r.id, group.rider_ids, state, entrants)) : ranked[0];
  if (!attacker) return none;
  const runnerUp = ranked[0] === attacker ? ranked[1] : ranked[0];
  // Én lodtraekning pr. etape (etape-stabil stroem): angribes der overhovedet i dag?
  if (!(ctx.rngForStage("s5_late_attack")() < chance)) return none;
  const t = S5_PROFILES_TUNING.lateAttack;
  const edge = Math.max(0, attacker.score - runnerUp.score);
  const gainSeconds = round2(Math.min(t.maxGainSeconds, edge * t.gainSecondsPerScoreUnit));
  if (gainSeconds < t.minGainSeconds) return none;
  const newGroupId = makeGroupId("solo", ctx.segmentIndex * 1000 + 900);
  const groups = splitGroup(state.groups, group.id, [attacker.id], { id: newGroupId, kind: "solo", gapSecondsDelta: -gainSeconds });
  return {
    state: { ...state, groups },
    events: [{
      km: round2(ctx.segment.to_km),
      type: "finale_attack",
      params: { kind: "late_attack", rider_id: attacker.id, group_id: newGroupId, source_group_id: group.id, gained_seconds: gainSeconds },
    }],
  };
}
