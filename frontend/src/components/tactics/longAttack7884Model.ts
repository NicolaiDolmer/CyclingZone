// #7884/#8828 · "Angrib på <sted>" på taktikfanen (wireframe docs/design/tactics-7884/angrib-paa-wireframe.html).
// Ren data: stederne kommer fra serveren (GET team-orders `long_attack_7884`, kun når løbet tager imod
// dem); planen med et sted bygges her af rytterens plan uden sted + det valgte sted, i rutens orden.
// Serveren validerer den samme plan (tacticAttackTrigger7884.validateStagePlan7884) og afviser den
// neutralt, hvis ruten er ændret siden (fingeraftrykket).
import { STAGE_PLAN_FINAL_KM, triggerKm, type StagePlanLeg, type StagePlanRoute } from "../race/StagePlanModel.ts";

export type AttackPlaceTrigger7884 = { at: "climb_start"; kom_index: number } | { at: "finale" };
export type AttackPlaceLabel7884 =
  | { key: "climb"; name: string; summit_finish: boolean }
  | { key: "climbUnnamed"; category: string; km: number; summit_finish: boolean }
  | { key: "finale"; from_km: number };
export type AttackPlaceFacts7884 = { foot_km: number; climbs_after: number; summit_finish: boolean; valley_after_km?: number | null; category?: string | null };
export type AttackPlace7884 = { key: string; kind: "climb" | "finale"; trigger: AttackPlaceTrigger7884; label: AttackPlaceLabel7884; facts: AttackPlaceFacts7884 };
export type StagePlaces7884 = { fingerprint: string; places: AttackPlace7884[] };

/** Stederne for én etape fra serverens svar, eller null (løbet tager ikke imod dem). */
export function stagePlaces7884(raw: unknown, stage: number | null): StagePlaces7884 | null {
  if (stage == null || !raw || typeof raw !== "object") return null;
  const entry = (raw as Record<string, unknown>)[String(stage)];
  if (!entry || typeof entry !== "object") return null;
  const { fingerprint, places } = entry as { fingerprint?: unknown; places?: unknown };
  if (typeof fingerprint !== "string" || !Array.isArray(places) || places.length === 0) return null;
  return { fingerprint, places: places as AttackPlace7884[] };
}

type LegWithPlace = { task: StagePlanLeg["task"]; from?: StagePlanLeg["from"] | AttackPlaceTrigger7884; hunt?: StagePlanLeg["hunt"] };

export function isPlaceTrigger7884(from: unknown): from is AttackPlaceTrigger7884 {
  return !!from && typeof from === "object" && ((from as { at?: unknown }).at === "climb_start" || (from as { at?: unknown }).at === "finale");
}

export function placeKeyOf7884(trigger: AttackPlaceTrigger7884): string {
  return trigger.at === "finale" ? "finale" : `climb:${trigger.kom_index}`;
}

/** Planen uden stederne (samme regel som serveren): leddet fjernes, to ens led i træk bliver til ét. Uden sted: samme array. */
export function planWithoutAttack7884<T extends LegWithPlace>(legs: readonly T[]): T[] {
  if (!legs.some((leg, i) => i > 0 && isPlaceTrigger7884(leg.from))) return legs as T[];
  const out: T[] = [];
  legs.forEach((leg, i) => {
    if (i > 0 && isPlaceTrigger7884(leg.from)) return;
    const prev = out[out.length - 1];
    if (prev && prev.task === leg.task) return;
    out.push(leg);
  });
  return out;
}

/** Det sted rytterens plan angriber på (det første), eller null. */
export function attackPlaceKey7884(legs: readonly LegWithPlace[] | null | undefined): string | null {
  const leg = (legs ?? []).find((l, i) => i > 0 && isPlaceTrigger7884(l.from));
  return leg ? placeKeyOf7884(leg.from as AttackPlaceTrigger7884) : null;
}

/**
 * Planen med det valgte sted: angrebsleddet sættes ind ved foden i rutens orden; et gammelt punkt på
 * samme km (finalen og "de sidste km") giver plads til angrebet. `place` null = planen uden sted.
 * Returnerer null, når stedet ikke kan ligge i planen (kronologien, fx foden før forrige punkt).
 */
export function planWithAttack7884(legs: readonly StagePlanLeg[], place: AttackPlace7884 | null, route: StagePlanRoute): LegWithPlace[] | null {
  const base = planWithoutAttack7884(legs as LegWithPlace[]) as StagePlanLeg[];
  if (!place) return base;
  const foot = footKm7884(place, route);
  if (foot === null || !(foot > 0) || base.length === 0) return null;
  const kmOf = (leg: StagePlanLeg, i: number) => (i === 0 ? 0 : triggerKm(leg.from, route));
  const out: LegWithPlace[] = [];
  let placed = false;
  base.forEach((leg, i) => {
    const km = kmOf(leg, i);
    if (!placed && i > 0 && (leg.from?.at === "dropped" || (km !== null && km >= foot))) {
      out.push({ task: "attack", from: place.trigger });
      placed = true;
      if (km !== null && Math.abs(km - foot) < 1e-9) return; // samme punkt: angrebet tager det
    }
    out.push(leg);
  });
  if (!placed) out.push({ task: "attack", from: place.trigger });
  // Kronologi: strengt stigende km på tværs af gamle og nye punkter (sat-led tæller ikke).
  let last = -Infinity;
  for (let i = 1; i < out.length; i++) {
    const from = out[i].from;
    if (!from || (from as { at: string }).at === "dropped") continue;
    const km = isPlaceTrigger7884(from) ? foot : triggerKm(from as StagePlanLeg["from"], route);
    if (km === null) continue;
    if (!(km > last)) return null;
    last = km;
  }
  return out;
}

/** Foden i km. Finalen ligger hvor "de sidste km" begynder; en stigning ved sin fod (serverens fakta). */
export function footKm7884(place: AttackPlace7884, route: StagePlanRoute): number | null {
  if (place.kind === "finale") return Math.max(0, route.distance_km - STAGE_PLAN_FINAL_KM);
  return Number.isFinite(place.facts?.foot_km) ? place.facts.foot_km : null;
}

/** Dalen efter stigningen i ord (kun rutens geometri, ingen tal fra motoren). */
export type ValleyWord7884 = "longValley" | "valley" | null;
const LONG_VALLEY_KM = 40;
const VALLEY_KM = 15;
export function valleyWord7884(facts: AttackPlaceFacts7884): ValleyWord7884 {
  const km = facts.valley_after_km;
  if (facts.summit_finish || typeof km !== "number" || !Number.isFinite(km)) return null;
  if (km >= LONG_VALLEY_KM) return "longValley";
  if (km >= VALLEY_KM) return "valley";
  return null;
}

/** Rytterens gemte række med eller uden sted: fingeraftrykket følger kun en plan med et sted. */
export function withAttackRoute7884<R extends { plan?: unknown; long_attack_route_7884?: unknown }>(rider: R, fingerprint: string | null): R {
  const hasPlace = Array.isArray(rider.plan) && attackPlaceKey7884(rider.plan as LegWithPlace[]) !== null;
  const { long_attack_route_7884: _old, ...rest } = rider;
  return (hasPlace && fingerprint ? { ...rest, long_attack_route_7884: fingerprint } : rest) as R;
}

/**
 * Ordren uden stederne (samme objekt, naar ingen rytter har et sted). Bruges naar loebet ikke tager imod
 * dem (kontakten slukket eller noedstop) og ved kopi til andre etaper: "Brug paa flere etaper" kopierer
 * aldrig en stigning (designets afsnit 2).
 */
export function orderWithoutAttack7884<O extends { riders?: ReadonlyArray<{ plan?: unknown; long_attack_route_7884?: unknown }> | null }>(order: O): O {
  const riders = order?.riders ?? [];
  if (!riders.some((r) => Array.isArray(r.plan) && attackPlaceKey7884(r.plan as LegWithPlace[]) !== null)) return order;
  return {
    ...order,
    riders: riders.map((r) => {
      if (!Array.isArray(r.plan) || attackPlaceKey7884(r.plan as LegWithPlace[]) === null) return r;
      const { long_attack_route_7884: _fp, ...rest } = r;
      return { ...rest, plan: planWithoutAttack7884(r.plan as LegWithPlace[]) };
    }),
  };
}
