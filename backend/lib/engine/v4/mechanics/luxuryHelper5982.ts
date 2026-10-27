// backend/lib/engine/v4/mechanics/luxuryHelper5982.ts
// #5982 (KUN s5_profiles_v3): LUKSUSHJAELPEREN (EN "Luxury helper", DB/API 'luxury_helper').
//
// SSOT: docs/RACE_ENGINE_RULES.md §1 ("Luksushjaelper") + §2e (holdspil) og
// ejer-beslutningen 27/10 (kommentar paa #7266): "Rollen hedder Luksushjaelper, og
// den er en genvej til etapeplanen: en hjaelper med planen 'spar dig, arbejd paa
// den afgoerende stigning', som spilleren kan aendre." Designbordet 26/10 (S10):
// han koerer sit eget loeb, hvis kaptajnen knaekker; den delte kaptajn (#5981)
// daekker overtagelsen.
//
// ── HVAD ROLLEN ER I MOTOREN ─────────────────────────────────────────────────
// Motoren ser ham som en almindelig HJAELPER (`Entrant.role = "helper"`) med
// markoeren `Entrant.luxury_helper = true` (entrantAdapter.ts). Alle mekanikker
// behandler ham som en hjaelper. Rollen tilfoejer kun to ting:
//
//   1. STANDARDPLANEN (genvejen). Har han ingen gemt etapeplan, koerer motoren
//      luksushjaelperens plan fra stagePlan.ts (suggestStagePlan med
//      `luxuryHelper`): "Bliv i laeet" (spar dig) -> "Koer tempo" fra toppen af
//      stigningen foer den afgoerende (dvs. paa den afgoerende stigning) -> "Koer
//      i maal" naar han er sat. Planen koeres af stagePlanEngine.ts PRAECIS som en
//      gemt plan; der er ingen egen motorlogik for at spare eller arbejde. Gemmer
//      spilleren en plan for ham (fx en anden stigning), vinder den gemte plan.
//      Ingen afgoerende stigning (flad etape, ingen stigning) = hjaelperens forslag.
//   2. EGET LOEB (det der ikke kan siges i en plan). Sidder kaptajnen ikke i hans
//      gruppe (sat, knaekket, styrtet, udgaaet), koerer han sit eget loeb: i
//      holdspillet (teamPlay.ts) er han da en fri rolle, uden pris og uden stoette.
//      Kaptajnen er holdets 'captain'; et hold uden kaptajn bruger spurtkaptajnen
//      (#6321). Den delte kaptajn tager de almindelige hjaelpere, ikke ham.
//
// HOEJST EN PR. HOLD: valideringen (raceSelection.js, raceStageRolesApi.js) og
// DB'ens partielle unikke index haandhaever det. Har et hold alligevel flere
// markoerer (beskidt data), er den foerste i rider_id-orden luksushjaelperen og
// resten almindelige hjaelpere (determinisme foer skoenhed, som teamPlay.ts).
//
// Uden en luksushjaelper i feltet er alt byte-identisk; aeldre revisioner laeser
// hverken etapeplanen eller holdspillets krog. REN: ingen IO, ingen Date, ingen rng.

import type { EngineState, Entrant, RaceGroup, SegmentHookContext } from "../types.ts";
import { suggestStagePlan, type StagePlanLeg, type StagePlanRoute } from "../../../stagePlan.ts";

/** DB/API-rollen. Motoren ser ham som "helper" + markoeren `luxury_helper`. */
export const LUXURY_HELPER_ROLE = "luxury_helper" as const;

/** Er rytteren en luksushjaelper i motoren? (rollen "helper" + markoeren). */
export function isLuxuryHelper(entrant: Entrant | undefined): boolean {
  return entrant?.luxury_helper === true && entrant.role === "helper";
}

/**
 * Feltets luksushjaelpere: hoejst én pr. hold (den foerste i rider_id-orden).
 * Tom liste = ingen i feltet (alt er da byte-identisk).
 */
export function luxuryHelperIds(entrants: Readonly<Record<string, Entrant>>): string[] {
  const seenTeams = new Set<string>();
  const out: string[] = [];
  for (const riderId of Object.keys(entrants).sort((a, b) => a.localeCompare(b))) {
    const entrant = entrants[riderId];
    if (!isLuxuryHelper(entrant)) continue;
    const teamId = entrant.team_id == null ? "" : String(entrant.team_id);
    if (teamId.length === 0 || seenTeams.has(teamId)) continue;
    seenTeams.add(teamId);
    out.push(riderId);
  }
  return out;
}

/**
 * Standardplanerne for feltets luksushjaelpere uden en gemt plan (`hasPlan`).
 * Samme forslag som etapeplanens flade viser spilleren (stagePlan.suggestStagePlan),
 * saa motoren koerer det spilleren ser. null-forslag (enkeltstart) udelades.
 */
export function luxuryHelperDefaultPlans(
  route: StagePlanRoute,
  entrants: Readonly<Record<string, Entrant>>,
  hasPlan: (riderId: string) => boolean,
): Array<[string, StagePlanLeg[]]> {
  const out: Array<[string, StagePlanLeg[]]> = [];
  for (const riderId of luxuryHelperIds(entrants)) {
    if (hasPlan(riderId)) continue;
    const teamId = String(entrants[riderId].team_id);
    const teamHasSprintCaptain = Object.values(entrants).some((e) => String(e.team_id ?? "") === teamId && e.role === "sprint_captain");
    const legs = suggestStagePlan({ role: "helper", route, teamHasSprintCaptain, luxuryHelper: true });
    if (legs) out.push([riderId, legs]);
  }
  return out;
}

/** Holdets kaptajn (eller spurtkaptajnen paa et hold uden kaptajn), uanset status. */
export function luxuryHelperCaptainId(teamId: string, entrants: Readonly<Record<string, Entrant>>): string | null {
  const ids = Object.keys(entrants).filter((id) => String(entrants[id].team_id ?? "") === teamId).sort((a, b) => a.localeCompare(b));
  return ids.find((id) => entrants[id].role === "captain") ?? ids.find((id) => entrants[id].role === "sprint_captain") ?? null;
}

function groupOf(groups: readonly RaceGroup[], riderId: string): RaceGroup | undefined {
  return groups.find((g) => g.rider_ids.includes(riderId));
}

/**
 * Holdspillets startliste i dette segment, eller null naar feltet ingen
 * luksushjaelper har (holdspillet er da byte-identisk). Kun hans egen raekke kan
 * aendres: sidder kaptajnen ikke i hans gruppe, er han en fri rolle (eget loeb).
 */
export function luxuryHelperTeamPlayEntrants(state: EngineState, ctx: SegmentHookContext): Record<string, Entrant> | null {
  const ids = luxuryHelperIds(ctx.entrants);
  if (ids.length === 0) return null;
  const view: Record<string, Entrant> = { ...ctx.entrants };
  for (const riderId of ids) {
    const entrant = ctx.entrants[riderId];
    const captainId = luxuryHelperCaptainId(String(entrant.team_id), ctx.entrants);
    const ownGroup = groupOf(state.groups, riderId);
    const withCaptain = captainId !== null
      && captainId !== riderId
      && state.riders[captainId]?.status === "racing"
      && ownGroup !== undefined
      && groupOf(state.groups, captainId)?.id === ownGroup.id;
    if (!withCaptain) view[riderId] = { ...entrant, role: "free_role" };
  }
  return view;
}
