// backend/lib/engine/v4/mechanics/luxuryHelper5982.ts
// #5982 (KUN s5_profiles_v3, SLUKKET): SIDSTE MAND — luksushjaelperen.
//
// SSOT: docs/RACE_ENGINE_RULES.md §1 ("Sidste mand") + §2e (holdspil), spec
// docs/superpowers/specs/2026-10-25-taktik-roller-design.md (§5, §9, §11) og
// ejer-beslutningen 26/10 paa #5982 (designbord S10): "kaptajnens sidste mand:
// sparer sig i feltet, arbejder foerst paa den afgoerende stigning (etapeplanen
// kan vaelge hvilken), og koerer sit eget loeb, hvis kaptajnen knaekker". Den
// delte kaptajn (#5981, sharedCaptain.ts) daekker overtagelsen; der er ingen
// separat loejtnant.
//
// ── HVAD ROLLEN ER I MOTOREN ─────────────────────────────────────────────────
// DB/API-rollen hedder 'luxury_helper' (EN "Last man", DA "Sidste mand").
// Motoren ser ham som en almindelig HJAELPER (`Entrant.role = "helper"`) med
// markoeren `Entrant.luxury_helper = true` (entrantAdapter.ts). Derfor goer alle
// andre mekanikker det samme som for en hjaelper: han forsoeger kun udbrud med
// en ordre (breakawayPermission.ts), holdkammerater venter paa ham ved et uheld,
// AI-reglerne og etapeplanens hjaelper-opgaver gaelder ham. Kun holdspillet (M16,
// teamPlay.ts) laeser markoeren, og kun under s5_profiles_v3.
//
// Holdspillet i tre faser langs ruten (ingen rng, ingen events, ingen state ud
// over team_cp_factor — samme renhed som teamPlay.ts):
//   1. FOER arbejdet: han sparer sig i feltet. Han koerer som en hjaelper paa
//      "Spar kraefter" (halv pris, og han taeller med som stoette paa samme
//      vilkaar som en spar-hjaelper).
//   2. ARBEJDET: den afgoerende stigning. Default er rutens SIDSTE kategoriserede
//      stigning; etapeplanens rutepunkt (stage_plan-ordren, #7003) kan pege paa
//      en anden. v4's holdspil betales FREMAD (team_cp_factor laeses af naeste
//      segments tick, og klatre-selektionen laeser reserven fra det tick), saa
//      den hjaelp der virker PAA stigningen, er den han giver paa vej ind i den.
//      Arbejdsvinduet er derfor de sidste km op til foden (approachKm): han
//      foerer kaptajnen ind paa stigningen og saetter tempoet. Her bruger han
//      ALT det han sparede: hans samlede pris over etapen er den samme som en
//      almindelig hjaelpers paa samme indsats, men den falder samlet i vinduet.
//      Kaptajnens laeskaerm fra ham har sit eget loft (LAST_MAN_TUNING), oven paa
//      holdets, og holdspillets samlede loft gaelder uaendret.
//   3. EFTER arbejdet: han er toemt og ruller i maal (ingen pris, ingen stoette).
//
// EGET LOEB: sidder kaptajnen ikke i hans gruppe (sat, knaekket, styrtet,
// udgaaet), koerer han sit eget loeb: ingen pris og ingen stoette, som en fri
// rolle i holdspillet. Kaptajnen er holdets 'captain'; et hold uden kaptajn
// bruger spurtkaptajnen (#6321, spurtkaptajn som eneste leder).
//
// INDSATS: "Alt ud" betyder at han koerer for sig selv (som en hjaelper paa alt
// ud: ingen pris, ingen stoette), hele dagen. De andre trin skalerer hans
// budget som for en hjaelper. En rute uden kategoriseret stigning har ingen
// afgoerende stigning: han er da en almindelig hjaelper hele dagen.
//
// HOEJST EN PR. HOLD: valideringen (raceSelection.js, raceStageRolesApi.js) og
// DB'ens partielle unikke index haandhaever det. Har et hold alligevel flere
// raekker (beskidt data), er den foerste i rider_id-orden sidste mand og resten
// almindelige hjaelpere (determinisme foer skoenhed, som teamPlay.ts).
//
// GARANTIER (konstruktion, property-testet i luxuryHelper5982.test.ts):
//  - Bevarelse: hans laeskaerm til kaptajnen er aldrig stoerre end det han selv
//    betalte i samme segment gange transferEfficiency.
//  - Hans samlede pris over etapen er aldrig stoerre end en almindelig hjaelpers.
//  - Bounded: eget loft pr. vindue, og kaptajnens samlede faktor holdes af
//    teamPlay's eksisterende loft (1 + captainMaxBonusFraction).
//  - Intet fortegns-skift: pris og bonus er begge >= 0.
//  - Et hold uden sidste mand, og alle aeldre revisioner, er byte-identiske.
//
// Tal og maalinger: kun privat (private-handoffs/5982/). REN — ingen IO, ingen Date, ingen rng.

import type { EffortLevel, EngineState, Entrant, RaceGroup, RouteV2, SegmentHookContext, TeamOrder } from "../types.ts";
import { TEAM_PLAY_EXTRA_TUNING } from "../tuning.ts";

/** DB/API-rollen. Motoren ser ham som "helper" + markoeren `luxury_helper`. */
export const LUXURY_HELPER_ROLE = "luxury_helper" as const;

/** #5982 (KUN s5_profiles_v3, deep-frosset). Kalibrering: private-handoffs/5982/. */
export const LAST_MAN_TUNING = Object.freeze({
  /** Arbejdsvinduet: de sidste km op til foden af den afgoerende stigning. */
  approachKm: 10,
  /** Hans laeskaerm til kaptajnen over hele vinduet, som andel af kaptajnens etape-loft (captainMaxBonusFraction). */
  ceilingShareOfCaptainMax: 0.5,
  /** Et rutepunkt (kom-vejpunkt) matcher en stigning naar toppen ligger hoejst saa mange km fra det. */
  climbMatchKm: 1,
});

export type LastManTuning = typeof LAST_MAN_TUNING;

/** Er rytteren sidste mand i motoren? (rollen "helper" + markoeren). */
export function isLastMan(entrant: Entrant | undefined): boolean {
  return entrant?.luxury_helper === true && entrant.role === "helper";
}

function isClimbIndex(route: RouteV2, index: number): boolean {
  return route.segments[index]?.kind === "climb";
}

/**
 * Etapeplanens rutepunkt for rytteren: det foerste led i hans kaede der skifter
 * ved en kategoriseret stigning (stage_plan-ordren, stagePlan.ts). Kun hans eget
 * holds ordre taeller. null = ingen plan eller intet stigningspunkt.
 */
export function planKomIndex(orders: readonly TeamOrder[], riderId: string, teamId: string): number | null {
  for (const order of orders) {
    if (order.kind !== "stage_plan" || String(order.team_id) !== teamId) continue;
    const riders = order.params?.["riders"];
    if (!Array.isArray(riders)) continue;
    for (const raw of riders) {
      if (!raw || typeof raw !== "object" || (raw as Record<string, unknown>)["rider_id"] !== riderId) continue;
      const legs = (raw as Record<string, unknown>)["legs"];
      if (!Array.isArray(legs)) return null;
      for (const leg of legs) {
        const from = leg && typeof leg === "object" ? (leg as Record<string, unknown>)["from"] : null;
        if (!from || typeof from !== "object") continue;
        const f = from as Record<string, unknown>;
        if (f["at"] === "kom" && Number.isInteger(f["kom_index"])) return f["kom_index"] as number;
      }
      return null;
    }
  }
  return null;
}

/**
 * Indekset (i route.segments) paa den afgoerende stigning, eller -1 naar ruten
 * ingen kategoriseret stigning har. Etapeplanens rutepunkt vinder, hvis det
 * peger paa en stigning paa ruten; ellers rutens sidste stigning.
 */
export function decisiveClimbIndex(
  route: RouteV2,
  planKom: number | null,
  tuning: LastManTuning = LAST_MAN_TUNING,
): number {
  let last = -1;
  for (let i = 0; i < route.segments.length; i++) if (isClimbIndex(route, i)) last = i;
  if (last < 0 || planKom === null) return last;
  const waypoint = route.waypoints.find((w) => w.kind === "kom" && w.index === planKom);
  if (!waypoint || !Number.isFinite(waypoint.km)) return last;
  let best = -1;
  let bestDiff = Infinity;
  for (let i = 0; i < route.segments.length; i++) {
    if (!isClimbIndex(route, i)) continue;
    const diff = Math.abs(route.segments[i].to_km - waypoint.km);
    if (diff < bestDiff) {
      best = i;
      bestDiff = diff;
    }
  }
  return best >= 0 && bestDiff <= tuning.climbMatchKm ? best : last;
}

export type LastManWindow = {
  /** Den afgoerende stigning (indeks i route.segments). */
  climb: number;
  /** Arbejdsvinduet i km: [fromKm, toKm]. toKm er foden af stigningen. */
  fromKm: number;
  toKm: number;
  /** Andel af etapens km FOER vinduet. */
  beforeShare: number;
  /** Andel af etapens km I vinduet. */
  windowShare: number;
};

/**
 * Arbejdsvinduet foran den afgoerende stigning: de sidste `approachKm` op til
 * foden. Starter stigningen ved km 0 (intet tilloeb), er vinduet selve
 * stigningen, saa hans arbejde aldrig forsvinder.
 */
export function lastManWindow(route: RouteV2, climbIndex: number, tuning: LastManTuning = LAST_MAN_TUNING): LastManWindow | null {
  if (!isClimbIndex(route, climbIndex) || !(route.distance_km > 0)) return null;
  const climb = route.segments[climbIndex];
  let fromKm = Math.max(0, climb.from_km - Math.max(0, tuning.approachKm));
  let toKm = climb.from_km;
  if (!(toKm > fromKm)) {
    fromKm = climb.from_km;
    toKm = climb.to_km;
  }
  const share = (km: number) => Math.max(0, Math.min(1, km / route.distance_km));
  return { climb: climbIndex, fromKm, toKm, beforeShare: share(fromKm), windowShare: share(toKm - fromKm) };
}

/** Km af [from, to] der ligger inden for [lo, hi]. */
function overlapKm(from: number, to: number, lo: number, hi: number): number {
  return Math.max(0, Math.min(to, hi) - Math.max(from, lo));
}

/** Holdets kaptajn (eller spurtkaptajnen paa et hold uden kaptajn), uanset status. */
export function lastManCaptainId(teamId: string, entrants: Readonly<Record<string, Entrant>>): string | null {
  const ids = Object.keys(entrants).filter((id) => String(entrants[id].team_id ?? "") === teamId).sort((a, b) => a.localeCompare(b));
  return ids.find((id) => entrants[id].role === "captain") ?? ids.find((id) => entrants[id].role === "sprint_captain") ?? null;
}

function groupOf(groups: readonly RaceGroup[], riderId: string): RaceGroup | undefined {
  return groups.find((g) => g.rider_ids.includes(riderId));
}

/** En sidste mand der arbejder for kaptajnen i DETTE segment. */
export type LastManWorker = { riderId: string; captainId: string; window: LastManWindow };

export type LastManView = {
  /** Entrants som holdspillet skal regne paa i dette segment (kun sidste mand er aendret). */
  entrants: Record<string, Entrant>;
  /** Dem der er i arbejdsvinduet med kaptajnen i gruppen. */
  working: LastManWorker[];
};

/**
 * Holdspillets visning af sidste mand i det aktuelle segment, eller null naar
 * feltet ingen sidste mand har (holdspillet er da byte-identisk). Visningen
 * aendrer KUN sidste mands egen raekke:
 *   - foer vinduet, kaptajnen i gruppen: indsats "save" (han sparer sig).
 *   - segmentet roerer vinduet, kaptajnen i gruppen: ude af holdets arbejds-
 *     pulje; hans arbejde regnes af applyLastManWork.
 *   - efter vinduet, eller kaptajnen ikke i gruppen: "free_role" i holdspillet
 *     (ingen pris, ingen stoette).
 *   - "Alt ud", eller ingen stigning paa ruten: uaendret (som en hjaelper).
 */
export function lastManView(state: EngineState, ctx: SegmentHookContext, tuning: LastManTuning = LAST_MAN_TUNING): LastManView | null {
  const entrants = ctx.entrants;
  const seenTeams = new Set<string>();
  let view: Record<string, Entrant> | null = null;
  const working: LastManWorker[] = [];
  for (const riderId of Object.keys(entrants).sort((a, b) => a.localeCompare(b))) {
    const entrant = entrants[riderId];
    if (!isLastMan(entrant)) continue;
    const teamId = typeof entrant.team_id === "string" ? entrant.team_id : "";
    if (teamId.length === 0 || seenTeams.has(teamId)) continue;
    seenTeams.add(teamId);
    view ??= { ...entrants };
    if (entrant.effort === "all_out") continue;
    const window = lastManWindow(ctx.route, decisiveClimbIndex(ctx.route, planKomIndex(ctx.orders, riderId, teamId), tuning), tuning);
    if (!window) continue;
    const captainId = lastManCaptainId(teamId, entrants);
    const ownGroup = groupOf(state.groups, riderId);
    const withCaptain = captainId !== null
      && captainId !== riderId
      && state.riders[captainId]?.status === "racing"
      && ownGroup !== undefined
      && groupOf(state.groups, captainId)?.id === ownGroup.id;
    const { from_km: segFrom, to_km: segTo } = ctx.segment;
    if (withCaptain && segTo <= window.fromKm) {
      view[riderId] = { ...entrant, effort: "save" };
    } else if (withCaptain && overlapKm(segFrom, segTo, window.fromKm, window.toKm) > 0) {
      view[riderId] = { ...entrant, role: "free_role" };
      working.push({ riderId, captainId: captainId as string, window });
    } else {
      view[riderId] = { ...entrant, role: "free_role" };
    }
  }
  return view ? { entrants: view, working } : null;
}

/**
 * Sidste mands arbejde i vinduet: han betaler, kaptajnen faar laeskaerm. Skriver
 * signerede CP-fraktioner ind i teamPlay's `deltas` (samme valuta: negativ =
 * pris, positiv = laeskaerm). `helperBase` er teamPlay.baseCostFraction("helper",
 * profil) og `costMultiplier` teamPlay.helperCostMultiplier, saa prisen altid
 * foelger hjaelperens kalibrering.
 */
export function applyLastManWork(
  view: LastManView,
  deltas: Map<string, number>,
  state: EngineState,
  ctx: SegmentHookContext,
  helperBase: number,
  costMultiplier: (effort: EffortLevel | undefined) => number,
  teamTuning: typeof TEAM_PLAY_EXTRA_TUNING = TEAM_PLAY_EXTRA_TUNING,
  tuning: LastManTuning = LAST_MAN_TUNING,
): void {
  const distanceKm = ctx.route.distance_km;
  if (!(distanceKm > 0) || !(helperBase > 0)) return;
  const { from_km: segFrom, to_km: segTo } = ctx.segment;
  const efficiency = Math.max(0, Math.min(1, teamTuning.transferEfficiency));
  for (const worker of view.working) {
    const { window } = worker;
    if (!(window.windowShare > 0) || !state.riders[worker.riderId] || !state.riders[worker.captainId]) continue;
    const full = Math.max(0, costMultiplier(ctx.entrants[worker.riderId]?.effort));
    const saved = Math.min(full, Math.max(0, costMultiplier("save")));
    // Budgettet er en almindelig hjaelpers dag paa samme indsats minus det han brugte foer vinduet.
    const budget = Math.max(0, helperBase * full - helperBase * saved * window.beforeShare);
    const windowPart = overlapKm(segFrom, segTo, window.fromKm, window.toKm) / distanceKm;
    const beforePart = overlapKm(segFrom, segTo, 0, window.fromKm) / distanceKm;
    const paidWork = Math.max(0, (budget / window.windowShare) * windowPart);
    const paid = paidWork + Math.max(0, helperBase * saved * beforePart);
    if (!(paid > 0)) continue;
    deltas.set(worker.riderId, (deltas.get(worker.riderId) ?? 0) - paid);
    const ceiling = Math.max(0, teamTuning.captainMaxBonusFraction * tuning.ceilingShareOfCaptainMax * (windowPart / window.windowShare));
    const bonus = Math.max(0, Math.min(paidWork * efficiency, ceiling));
    if (bonus > 0) deltas.set(worker.captainId, (deltas.get(worker.captainId) ?? 0) + bonus);
  }
}
