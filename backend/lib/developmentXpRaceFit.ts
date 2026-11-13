// #6110 R15b: løbsdagen, når løbet passer til rytteren (ejer 13/11).
//
// Spec: docs/superpowers/specs/2026-11-06-6110-xp-udvikling-design.md (§4, E2).
// Dommerens prøve: dommer6110.loebsdag-passer.test.js.
//
// ═══ REGLEN ══════════════════════════════════════════════════════════════════
// På en etape, der passer rytterens PRIMÆRE type, giver løbsdagen i alle roller
// mindst lige så meget XP i alt som rytterens bedste hårde træningspas samme dato
// (holdets træner og facilitet, holdets katalog, uden Træn nu og uden intention).
// Mangler der noget, løftes dagen præcis op til det: et gulv, ikke et tillæg.
// Løftet lægges i de evner, etapen træner, med samme procent i hver, så etapens
// egen fordeling bevares. Intet løft, når rytteren er sat til at køre roligt
// (dagens intention under normal). Alle andre løbsdage er uændrede.
//
// Kun under XP-modellen (development_xp_model, slukket). applyDailyTick kalder
// gulvet i XP-grenen før dagsudsvinget, så løftet får samme udsving som resten
// af dagen (R11). Den gamle model ser aldrig noget herfra.
//
// Ren funktion: ingen DB, ingen Date, ingen Math.random.

import { TRAINING_FOCUSES } from "./training.js";
import { sessionsByLevelFor } from "./trainingDayTypes.js";
import { applyTrainingCatalog } from "./trainingCatalogV3.js";
import {
  XP_RACE_DAY_FOCUS, developmentXpAbilityDelta,
  type DevelopmentXpParams, type XpAbilityDeltaInput, type XpTickProgram,
} from "./developmentXp.ts";

/**
 * Hvilke etaper passer hvilken primær type ("hjemmebane"). Data, ikke kode: ejerens
 * svar på de åbne spørgsmål (typer uden hjemmebane, grænse-etaper) bliver nye rækker
 * her. Følger det, spillet allerede siger om, hvem etaperne er lavet til.
 */
export const XP_RACE_FIT_HOME_STAGES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  climber: Object.freeze(["mountain", "high_mountain"]),
  sprinter: Object.freeze(["flat"]),
  puncheur: Object.freeze(["hilly", "classic"]),
  tt: Object.freeze(["itt", "itt_hilly"]),
  brostensrytter: Object.freeze(["cobbles"]),
});

/** Passer etapen rytterens primære type? Den sekundære type tæller ikke (ejer 13/11). */
export function xpRaceFitsRider(primaryType: string | null | undefined, profileType: string | null | undefined): boolean {
  if (typeof primaryType !== "string" || typeof profileType !== "string") return false;
  if (!Object.hasOwn(XP_RACE_FIT_HOME_STAGES, primaryType)) return false;
  return XP_RACE_FIT_HOME_STAGES[primaryType].includes(profileType);
}

/** Det, løbsdagens kald (withRaceDayRoleYieldXp) bærer med til tick'et under XP. */
export interface XpRaceDayFit {
  profileType: string | null;
  catalogV3: boolean;
}

/** Rytterens felter, som et træningspas regnes med (samme enhed som tick'et). */
export type XpRaceFitRider = Pick<XpAbilityDeltaInput,
  "age" | "potentiale" | "primaryType" | "secondaryType" | "staff" | "facilityTier" | "riderLevel" | "trainingCfg" | "budgetDivisor">;

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
// Afrundingsværn, ikke et balance-tal: langt under enhver visning og ethvert købt point.
const FLOAT_GUARD = 1e-12;
// Som developmentXpTick tæller: kun positiv, endelig XP er XP.
const earned = (x: unknown): number => (isNum(x) && x > 0 ? x : 0);

/**
 * Rytterens bedste hårde træningspas samme dato: XP i alt over `abilities` for det af
 * holdets hårde pas, der giver mest. Med træner og facilitet, uden Træn nu, uden
 * intention og uden løbsdagens tillæg, præcis som en træningsdag regnes.
 */
export function xpBestHardSessionTotal(
  rider: XpRaceFitRider,
  { catalogV3 = false, abilities }: { catalogV3?: boolean; abilities: readonly string[] },
  params: DevelopmentXpParams,
): number {
  let best = 0;
  for (const focus of sessionsByLevelFor({ catalogV3 }).hard as readonly string[]) {
    const program = applyTrainingCatalog({ focus, intensity: "hard" }, { v3: catalogV3 }) as XpTickProgram;
    let total = 0;
    for (const ability of abilities) {
      total += earned(developmentXpAbilityDelta({ ...rider, ability, program, academyRateMult: 1, yieldMult: 1 }, params));
    }
    if (total > best) best = total;
  }
  return best;
}

/**
 * R15b-gulvet på løbsdagens XP pr. evne (før dagsudsving og Træn nu). `day` er dagens
 * XP for de evner, tick'et tæller. Returnerer den løftede dag, eller null når intet
 * ændres (etapen passer ikke, rytteren kører roligt, eller dagen holder allerede).
 */
export function developmentXpRaceFitFloor(
  { day, program, fit, academyRateMult = 1, rider }: {
    day: Readonly<Record<string, number>>;
    program: XpTickProgram | null | undefined;
    fit: XpRaceDayFit | null | undefined;
    academyRateMult?: number;
    rider: XpRaceFitRider;
  },
  params: DevelopmentXpParams,
): Record<string, number> | null {
  if (!fit || !program || program.focus !== XP_RACE_DAY_FOCUS) return null;
  if (!xpRaceFitsRider(rider.primaryType, fit.profileType)) return null;
  // Samme læsning af intentionen som selve dagen: ugyldig = normal.
  const intention = isNum(academyRateMult) && academyRateMult >= 0 ? academyRateMult : 1;
  if (intention < 1) return null;

  const abilities = Object.keys(day);
  const stageAbilities = [...new Set(
    program.focusAbilities ?? (TRAINING_FOCUSES as Record<string, readonly string[]>)[program.focus as string] ?? [],
  )].filter((a) => abilities.includes(a));
  let total = 0;
  for (const ability of abilities) total += earned(day[ability]);
  let stageTotal = 0;
  for (const ability of stageAbilities) stageTotal += earned(day[ability]);
  if (!(stageTotal > 0)) return null;

  const best = xpBestHardSessionTotal(rider, { catalogV3: fit.catalogV3 === true, abilities }, params);
  // Målet ligger en flydende-tals-margin over passet, så en anden summeringsrækkefølge
  // (fx dagsudsvinget ganget på evne for evne) aldrig lander dagen en brøkdel under det.
  const missing = best * (1 + FLOAT_GUARD) - total;
  if (!(missing > 0)) return null;

  const lifted: Record<string, number> = { ...day };
  for (const ability of stageAbilities) {
    const xp = earned(day[ability]);
    lifted[ability] = xp + (xp * missing) / stageTotal;
  }
  return lifted;
}
