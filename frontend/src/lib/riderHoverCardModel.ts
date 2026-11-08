// #2009 · Rytterkortet (hover-kort v2): hvad kortet viser for én rytter, som ren data.
//
// Komponenten (components/ui/RiderHoverCard.tsx) regner intet selv; alt der
// afgør hvad spilleren ser, staar her og testes i riderHoverCardModel.test.ts.
//
// Scouting-fog (#2798, docs/GAME_INVARIANTS.md "fog of war"): potentialet er
// skjult for andres ryttere. Kortet viser det KUN naar rytteren er paa viewerens
// eget hold; for alle andre findes potentiale-raekken slet ikke i modellen, saa
// en kalder ikke ved et uheld kan vise den. Det samme gaelder form, traethed og
// planen for naeste etape: holdets egne oplysninger, aldrig en andens. Evnerne er
// offentlige (samme tal som rytterdatabasen og rytterprofilen viser for alle).
//
// Ejer 7/11: samme kort er loebssidens rytterkort (dagens plads, GC, troejer,
// egen plan). Loebets tal kommer ind som `race` i konteksten.
import { ABILITY_CATEGORIES, ABILITY_SHORT } from "./generated/abilityRegistry.js";
import { riderBestRole } from "./riderRating.js";
import { ageBadgeKey, ageForSeason, contractExpiringBadgeKey, retirementRiskBadgeKey } from "./riderAge.js";

export type AbilityGroupKey = "physical" | "mental" | "technical";

export type HoverCardTeam = {
  id?: string | null;
  name?: string | null;
  manager_name?: string | null;
  is_ai?: boolean | null;
  is_bank?: boolean | null;
};

export type HoverCardRiderRow = {
  id: string;
  firstname?: string | null;
  lastname?: string | null;
  birthdate?: string | null;
  nationality_code?: string | null;
  primary_type?: string | null;
  secondary_type?: string | null;
  team_id?: string | null;
  team?: HoverCardTeam | null;
  is_retired?: boolean | null;
  is_academy?: boolean | null;
  salary?: number | null;
  market_value?: number | null;
  contract_end_season?: number | null;
  /** Evnerne fladet op paa raekken (flattenAbilities) eller som embed. */
  [ability: string]: unknown;
};

export type HoverCardAbility = { key: string; short: string; value: number | null };
export type HoverCardAbilityGroup = { key: AbilityGroupKey; abilities: HoverCardAbility[] };

/** Troejerne i loebets dag-typer, samme raekkefoelge som loebssiden. */
export const JERSEY_DAY_TYPES = ["leader", "points_day", "mountain_day", "young_day"] as const;
export type JerseyDayType = (typeof JERSEY_DAY_TYPES)[number];

export type HoverCardRaceResultRow = { result_type?: string | null; stage_number?: number | null; rank?: number | null };
export type HoverCardRaceInput = {
  raceId: string;
  raceName: string | null;
  raceType: string | null;
  stages: number | null;
  stagesCompleted: number | null;
  /** Rytterens raekker paa seneste koerte etape (alle dag-typer). */
  results: HoverCardRaceResultRow[];
};
export type HoverCardRace = {
  raceId: string;
  raceName: string | null;
  /** Seneste koerte etape (null = loebet er ikke startet). */
  stageNumber: number | null;
  stageCount: number | null;
  stageRank: number | null;
  gcRank: number | null;
  jerseys: JerseyDayType[];
};

export type HoverCardRecentRow = { race_id?: string | null; stage_number?: number | null; rank?: number | null; imported_at?: string | null };
export type HoverCardRecent = { raceDays: number; wins: number; podiums: number };

export type HoverCardPlan = { role: string | null; tasks: string[] | null; effort: string | null };
export type HoverCardOwn = { form: number | null; fatigue: number | null; plan: HoverCardPlan | null };

export type HoverCardActions = { profile: true; compare: true; watchlist: boolean; bid: boolean };

export type RiderHoverCardModel = {
  id: string;
  name: string;
  nationalityCode: string | null;
  teamId: string | null;
  teamName: string | null;
  age: number | null;
  primaryType: string | null;
  secondaryType: string | null;
  /** Spillets egne status-maerker (noegler i RiderBadges). */
  badges: string[];
  /** Bedste rolle nu (samme tal som rytterdatabasen og profilen), eller null. */
  rating: number | null;
  ratingRole: string | null;
  marketValue: number | null;
  salary: number | null;
  contractEndSeason: number | null;
  race: HoverCardRace | null;
  recent: HoverCardRecent | null;
  groups: HoverCardAbilityGroup[];
  /** Rytteren er paa viewerens eget hold. */
  isOwn: boolean;
  isRetired: boolean;
  /** Potentialet maa vises. Altid lig isOwn (scouting-fog). */
  showPotential: boolean;
  /** Form, traethed og naeste etapes plan. Kun egne ryttere, ellers null. */
  own: HoverCardOwn | null;
  actions: HoverCardActions;
};

export type HoverCardContext = {
  viewerTeamId?: string | null;
  seasonYear?: number | null;
  /** Aktiv saesons nummer (kontrakt-udloebs-maerket). */
  activeSeasonNumber?: number | null;
  market?: { inAuction?: boolean; listed?: boolean } | null;
  condition?: { form?: number | null; fatigue?: number | null; injured?: boolean } | null;
  race?: HoverCardRaceInput | null;
  recent?: HoverCardRecent | null;
  plan?: HoverCardPlan | null;
};

function finiteOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
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

/**
 * Dette loeb: rytterens plads paa seneste koerte etape, hans plads i det samlede
 * klassement og de troejer han baerer efter etapen (plads 1 i en dag-type).
 */
export function summarizeRaceNow(input: HoverCardRaceInput | null | undefined): HoverCardRace | null {
  if (!input || !input.raceId) return null;
  const completed = finiteOrNull(input.stagesCompleted);
  const stageNumber = completed && completed > 0 ? completed : null;
  const onStage = (input.results ?? []).filter((r) => stageNumber !== null && (finiteOrNull(r.stage_number) ?? 1) === stageNumber);
  const rankOf = (type: string) => {
    const hit = onStage.find((r) => r.result_type === type);
    return hit ? finiteOrNull(hit.rank) : null;
  };
  const isStageRace = input.raceType === "stage_race";
  const jerseys = isStageRace ? JERSEY_DAY_TYPES.filter((type) => rankOf(type) === 1) : [];
  return {
    raceId: String(input.raceId),
    raceName: input.raceName ?? null,
    stageNumber,
    stageCount: finiteOrNull(input.stages),
    stageRank: rankOf("stage"),
    gcRank: isStageRace ? rankOf("leader") : null,
    jerseys,
  };
}

export const RECENT_WINDOW_DAYS = 35;

/**
 * Sidste 5 uger: loebsdage (etaper og endagsloeb), sejre og podier. Kun etape-
 * resultater taeller, og en etape taeller én gang selv om raekken er dobbelt.
 */
export function summarizeRecentResults(
  rows: HoverCardRecentRow[] | null | undefined,
  now: Date = new Date(),
  windowDays: number = RECENT_WINDOW_DAYS,
): HoverCardRecent {
  const since = now.getTime() - windowDays * 86_400_000;
  const seen = new Map<string, number | null>();
  for (const r of rows ?? []) {
    const at = r.imported_at ? Date.parse(r.imported_at) : Number.NaN;
    if (!Number.isFinite(at) || at < since || at > now.getTime()) continue;
    const key = `${r.race_id ?? ""}:${r.stage_number ?? 1}`;
    const rank = finiteOrNull(r.rank);
    const prev = seen.get(key);
    if (prev === undefined || (rank !== null && (prev === null || rank < prev))) seen.set(key, rank);
  }
  let wins = 0;
  let podiums = 0;
  for (const rank of seen.values()) {
    if (rank === 1) wins += 1;
    if (rank !== null && rank >= 1 && rank <= 3) podiums += 1;
  }
  return { raceDays: seen.size, wins, podiums };
}

/** Status-maerkerne i spillets egen raekkefoelge (samme noegler som RiderBadges). */
export function hoverCardBadges(rider: HoverCardRiderRow, ctx: HoverCardContext): string[] {
  const seasonYear = ctx.seasonYear ?? Number.NaN;
  const keys: Array<string | null | false | undefined> = [
    ageBadgeKey(rider, seasonYear),
    rider.is_academy === true && "academy",
    ctx.condition?.injured === true && "injured",
    ctx.market?.inAuction === true && "auction",
    ctx.market?.listed === true && "listed",
    rider.is_retired === true ? null : retirementRiskBadgeKey(rider, seasonYear),
    rider.team_id ? contractExpiringBadgeKey(rider, ctx.activeSeasonNumber ?? Number.NaN) : null,
  ];
  return keys.filter((k): k is string => typeof k === "string" && k.length > 0);
}

export function buildRiderHoverCardModel(
  row: HoverCardRiderRow | null | undefined,
  ctx: HoverCardContext = {},
): RiderHoverCardModel | null {
  const rider = flattenHoverCardRow(row);
  if (!rider) return null;
  const viewerTeamId = ctx.viewerTeamId ?? null;
  const name = `${rider.firstname ?? ""} ${rider.lastname ?? ""}`.trim();
  const teamId = rider.team_id ?? rider.team?.id ?? null;
  const isOwn = sameId(teamId, viewerTeamId);
  const isRetired = rider.is_retired === true;
  const best = riderBestRole(rider);
  const groups: HoverCardAbilityGroup[] = ABILITY_CATEGORIES.map((group) => ({
    key: group.key as AbilityGroupKey,
    abilities: group.keys.map((key: string) => ({
      key,
      short: (ABILITY_SHORT as Record<string, string>)[key] ?? key,
      value: finiteOrNull(rider[key]),
    })),
  }));
  const other = !isOwn && viewerTeamId !== null;
  return {
    id: String(rider.id),
    name,
    nationalityCode: rider.nationality_code ?? null,
    teamId: teamId === null ? null : String(teamId),
    teamName: rider.team?.name ?? null,
    age: ageForSeason(rider.birthdate ?? null, ctx.seasonYear ?? Number.NaN),
    primaryType: rider.primary_type ?? null,
    secondaryType: rider.secondary_type ?? null,
    badges: hoverCardBadges(rider, ctx),
    rating: finiteOrNull(best.rating),
    ratingRole: best.role ?? null,
    marketValue: finiteOrNull(rider.market_value),
    salary: teamId === null ? null : finiteOrNull(rider.salary),
    contractEndSeason: teamId === null ? null : finiteOrNull(rider.contract_end_season),
    race: summarizeRaceNow(ctx.race),
    recent: ctx.recent ?? null,
    groups,
    isOwn,
    isRetired,
    showPotential: isOwn,
    own: isOwn
      ? {
        form: finiteOrNull(ctx.condition?.form),
        fatigue: finiteOrNull(ctx.condition?.fatigue),
        plan: ctx.plan ?? null,
      }
      : null,
    actions: {
      profile: true,
      compare: true,
      watchlist: other && !isRetired,
      // Bud giver kun mening paa en aktiv rytter, der har et hold (fri rytter
      // hentes andre veje), og kun naar viewer selv har et hold at byde fra.
      bid: other && !isRetired && teamId !== null,
    },
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
