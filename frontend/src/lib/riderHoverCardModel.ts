// #2009 · Hover-miniprofilen: hvad kortet viser for én rytter, som ren data.
//
// Komponenten (components/ui/RiderHoverCard.tsx) regner intet selv; alt der
// afgør hvad spilleren ser, staar her og testes i riderHoverCardModel.test.ts.
//
// Scouting-fog (#2798, docs/GAME_INVARIANTS.md "fog of war"): potentialet er
// skjult for andres ryttere. Kortet viser det KUN naar rytteren er paa viewerens
// eget hold; for alle andre findes potentiale-raekken slet ikke i modellen, saa
// en kalder ikke ved et uheld kan vise den. Evnerne er offentlige (samme tal som
// rytterdatabasen og rytterprofilen viser for alle).
//
// Ejer 7/11: samme kort bliver loebssidens rytterkort (dagens plads, GC, troejer,
// egen plan). Den slags kontekst kommer ind som `extra` paa komponenten, ikke
// som nye felter her, saa modellen forbliver rytterens egne data.
import { ABILITY_CATEGORIES, ABILITY_SHORT } from "./generated/abilityRegistry.js";
import { riderBestRole } from "./riderRating.js";
import { ageForSeason } from "./riderAge.js";

export type AbilityGroupKey = "physical" | "mental" | "technical";

export type HoverCardRiderRow = {
  id: string;
  firstname?: string | null;
  lastname?: string | null;
  birthdate?: string | null;
  nationality_code?: string | null;
  primary_type?: string | null;
  secondary_type?: string | null;
  team_id?: string | null;
  team?: { id?: string | null; name?: string | null } | null;
  /** Evnerne fladet op paa raekken (flattenAbilities) eller som embed. */
  [ability: string]: unknown;
};

export type HoverCardAbility = { key: string; short: string; value: number | null };
export type HoverCardAbilityGroup = { key: AbilityGroupKey; abilities: HoverCardAbility[] };

export type RiderHoverCardModel = {
  id: string;
  name: string;
  nationalityCode: string | null;
  teamId: string | null;
  teamName: string | null;
  age: number | null;
  primaryType: string | null;
  secondaryType: string | null;
  /** Bedste rolle nu (samme tal som rytterdatabasen og profilen), eller null. */
  rating: number | null;
  ratingRole: string | null;
  groups: HoverCardAbilityGroup[];
  /** Rytteren er paa viewerens eget hold. */
  isOwn: boolean;
  /** Potentialet maa vises. Altid lig isOwn (scouting-fog). */
  showPotential: boolean;
};

function finiteOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function sameId(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a) === String(b);
}

/** Loeft en rider_derived_abilities-embed op paa raekken, hvis den ikke allerede er det. */
export function flattenHoverCardRow(row: HoverCardRiderRow | null | undefined): HoverCardRiderRow | null {
  if (!row || !row.id) return null;
  const embed = row.rider_derived_abilities as unknown;
  const abil = (Array.isArray(embed) ? embed[0] : embed) as Record<string, unknown> | null | undefined;
  if (!abil || typeof abil !== "object") return row;
  const out: HoverCardRiderRow = { ...row };
  for (const group of ABILITY_CATEGORIES) {
    for (const key of group.keys) out[key] = abil[key];
  }
  delete out.rider_derived_abilities;
  return out;
}

export function buildRiderHoverCardModel(
  row: HoverCardRiderRow | null | undefined,
  { viewerTeamId = null, seasonYear = null }: { viewerTeamId?: string | null; seasonYear?: number | null } = {},
): RiderHoverCardModel | null {
  const rider = flattenHoverCardRow(row);
  if (!rider) return null;
  const name = `${rider.firstname ?? ""} ${rider.lastname ?? ""}`.trim();
  const teamId = rider.team_id ?? rider.team?.id ?? null;
  const isOwn = sameId(teamId, viewerTeamId);
  const best = riderBestRole(rider);
  const groups: HoverCardAbilityGroup[] = ABILITY_CATEGORIES.map((group) => ({
    key: group.key as AbilityGroupKey,
    abilities: group.keys.map((key: string) => ({
      key,
      short: (ABILITY_SHORT as Record<string, string>)[key] ?? key,
      value: finiteOrNull(rider[key]),
    })),
  }));
  return {
    id: String(rider.id),
    name,
    nationalityCode: rider.nationality_code ?? null,
    teamId: teamId === null ? null : String(teamId),
    teamName: rider.team?.name ?? null,
    age: ageForSeason(rider.birthdate ?? null, seasonYear ?? Number.NaN),
    primaryType: rider.primary_type ?? null,
    secondaryType: rider.secondary_type ?? null,
    rating: finiteOrNull(best.rating),
    ratingRole: best.role ?? null,
    groups,
    isOwn,
    showPotential: isOwn,
  };
}

// ── Aabning: hover paa desktop, tryk paa mobil ─────────────────────────────

/** Har enheden en rigtig hover (mus/pegeplade)? Ellers aabner et tryk kortet. */
export function canHover(matchMedia: ((q: string) => { matches: boolean }) | null | undefined): boolean {
  if (typeof matchMedia !== "function") return false;
  try {
    return matchMedia("(hover: hover) and (pointer: fine)").matches === true;
  } catch {
    return false;
  }
}

export type Rect = { top: number; bottom: number; left: number; right: number; width: number; height: number };

/**
 * Hvor kortet staar i forhold til navnet: under, eller over hvis der ikke er
 * plads under. Holdes inden for vinduet med en lille margen.
 */
export function placeHoverCard(
  anchor: Rect,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  { gap = 6, margin = 8 }: { gap?: number; margin?: number } = {},
): { top: number; left: number; side: "below" | "above" } {
  const spaceBelow = viewport.height - anchor.bottom - gap - margin;
  const spaceAbove = anchor.top - gap - margin;
  const side: "below" | "above" = spaceBelow >= card.height || spaceBelow >= spaceAbove ? "below" : "above";
  const rawTop = side === "below" ? anchor.bottom + gap : anchor.top - gap - card.height;
  const maxTop = Math.max(margin, viewport.height - margin - card.height);
  const top = Math.min(Math.max(rawTop, margin), maxTop);
  const maxLeft = Math.max(margin, viewport.width - margin - card.width);
  const left = Math.min(Math.max(anchor.left, margin), maxLeft);
  return { top, left, side };
}
