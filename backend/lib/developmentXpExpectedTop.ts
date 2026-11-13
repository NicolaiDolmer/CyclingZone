// Det sande tal bag potentiale-skønnet under XP-modellen (#6110, #7684): rytterens
// forventede topniveau.
//
// Spec: docs/superpowers/specs/2026-11-06-6110-xp-udvikling-design.md §6 og §11 trin 6.
//
// ═══ HVAD TALLET ER ══════════════════════════════════════════════════════════
// Uden loft findes "det sande loft" ikke længere. Det sande tal er i stedet det
// niveau, prislisten og rytterens XP pr. dag fører ham til med en standardkarriere
// fra hans nuværende evner, i hans naturlige rolle:
//   - prisen og XP pr. dag kommer fra XP-modellen selv (developmentXp.ts), så
//     tallet ikke kan drifte fra motoren;
//   - standardkarrieren er assistentens plan for rytterens type på hver dato, uden
//     træner, facilitet, Træn nu og dagsvariation. Tallet beskriver rytteren, ikke
//     hans nuværende arbejdsgiver;
//   - sæsonskiftet trækker de fysiske evner ned som motoren gør;
//   - topniveauet er den bedste rating, rytteren når undervejs. Den nuværende rating
//     er med som udgangspunkt, så tallet aldrig ligger under den.
// Samme fordeling som 10-sæsoners-kørslen (scripts/dev/tenSeasonSim6110.mjs), så
// det, kørslens gates måler, er det, skønnet og prognosen viser.
//
// ═══ HVEM BRUGER DET ═════════════════════════════════════════════════════════
// potentialEstimateWriter.js (det sande tal, når development_xp_model er tændt for
// datoen) og riderPrognosis.js (samme kilde under XP). Kontakten er slukket, så
// intet i spillet ændrer sig af denne fil. Tallet forlader aldrig serveren.
//
// Ren funktion: ingen DB, ingen Date, ingen Math.random. Alle balance-tal kommer
// fra `params` (privat, hard rule 17) eller fra motorens egne konfigurationer.

import {
  buyPoints, xpPerDate, xpSessionShare, xpTypeShare, type DevelopmentXpParams,
} from "./developmentXp.ts";
import { resolveProgram } from "./dailyTraining.js";
import { applyTrainingCatalog, v3SmartDefaultFocus } from "./trainingCatalogV3.js";
import { TRAINING_CONFIG, TRAINING_FOCUSES, programAbilityWeight } from "./training.js";
import { RECOVERY_INTENSITY, dayTypeForProgram } from "./trainingDayTypes.js";
import { PROGRESSION_CONFIG, abilityRoleClass, developRiderSeasonV2 } from "./riderProgression.js";
import { abilityMeta } from "./abilityRegistry.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { bestRoleForAbilities } from "./riderBestRoleCache.js";
import { SEASON_RACE_DAY_TARGET } from "./calendarRaceDayTargets.js";
import { TRAINING_RACE_DAY_CONFIG } from "./trainingRaceDayTick.js";
import { abilityValue } from "./weights/displayRecipes.js";

const MENTAL_ABILITIES: ReadonlySet<string> = new Set(
  (VISIBLE_ABILITIES as readonly string[]).filter((a) => abilityMeta(a)?.category === "mental"),
);

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export interface StandardCareer {
  /** Sidste sæson-alder i karrieren: der, hvor pensionsvinduet åbner. */
  endAge: number;
  /** Datoer med træning pr. sæson: kalenderens løbsdage delt på løbsdage pr. dato. */
  datesPerSeason: number;
  /** Belastningen, sæsonskiftets bremse ser. Samme som kørslen. */
  declineLoad: { raceDays: number; hardDays: number };
}

// Kalenderens nyeste sæsonmål, så karrieren følger kalenderen uden et eget tal.
const CALENDAR_RACE_DAYS = Math.max(...Object.values(SEASON_RACE_DAY_TARGET as Record<string, number>));
const STANDARD_DATES_PER_SEASON = Math.ceil(CALENDAR_RACE_DAYS / TRAINING_RACE_DAY_CONFIG.raceDaysPerDate);

export const STANDARD_CAREER: Readonly<StandardCareer> = Object.freeze({
  endAge: PROGRESSION_CONFIG.retirement.windowStartAge,
  datesPerSeason: STANDARD_DATES_PER_SEASON,
  declineLoad: Object.freeze({ raceDays: STANDARD_DATES_PER_SEASON, hardDays: 0 }),
});

/** Assistentens plan for typen med det katalog, der er live (v3). */
export function standardCareerProgram(primaryType: string | null, secondaryType: string | null = null) {
  const base = resolveProgram(null, primaryType as string);
  const focus = v3SmartDefaultFocus(base.focus, { primary_type: primaryType, secondary_type: secondaryType }, { v3: true });
  return applyTrainingCatalog({ focus, intensity: base.intensity }, { v3: true });
}

/**
 * Hver evnes andel af dagens XP i standardkarrieren: sessionens andel gange typens.
 * Samme fordeling som motorens XP-gren, uden dagens led (træner, variation, Træn nu).
 */
export function standardCareerShares(
  primaryType: string | null, secondaryType: string | null, params: DevelopmentXpParams,
): Record<string, number> {
  const program = standardCareerProgram(primaryType, secondaryType) as {
    focus?: string; intensity?: string; focusAbilities?: readonly string[]; offFocus?: boolean;
  };
  const out: Record<string, number> = {};
  if (program.intensity === "rest") return out;
  const grow = TRAINING_CONFIG.focusGrowthMult as Record<string, number>;
  const intensityShare = (grow[program.intensity as string] ?? 1) / grow.hard;
  const focusAbilities = program.focusAbilities
    ?? (TRAINING_FOCUSES as Record<string, readonly string[]>)[program.focus as string] ?? [];
  const noOffFocus = program.intensity === RECOVERY_INTENSITY || program.offFocus === false;
  const offFocusShare = noOffFocus ? 0 : params.offFocusShare;
  const skillDay = dayTypeForProgram(program) === "skill";
  for (const ability of VISIBLE_ABILITIES as readonly string[]) {
    const session = xpSessionShare({
      inFocus: focusAbilities.includes(ability), intensityShare,
      weight: programAbilityWeight(program, ability), offFocusShare,
    });
    if (!(session > 0)) continue;
    out[ability] = session * xpTypeShare(abilityRoleClass(primaryType, secondaryType, ability), params, { skillDay });
  }
  return out;
}

export interface ExpectedTopRider {
  /** Seeder sæsonskiftets afrunding som i motoren. */
  id: string | number;
  abilities: Record<string, unknown> | null | undefined;
  /** Sæson-alder nu (heltal). */
  age: number | null | undefined;
  potentiale: number | null | undefined;
  primaryType: string | null | undefined;
  secondaryType?: string | null;
}

export interface ExpectedCareer {
  /** Forventet topniveau: den bedste rating i karrieren, aldrig under den nuværende. */
  rating: number;
  /** Rating nu, med samme opskrift. */
  ratingNow: number;
  /** Evnerne i den sæson, toppen blev nået (heltal). */
  abilities: Record<string, number>;
  /** Sæson-alderen ved toppen. */
  atAge: number;
}

function ratingOf(abilities: Record<string, number>, primaryType: string | null, secondaryType: string | null): number | null {
  const { best_role_rating: rating } = bestRoleForAbilities(abilities, { primaryType, secondaryType });
  return isNum(rating) ? rating : null;
}

/**
 * Rytterens standardkarriere under XP-modellen. null når evnerne, alderen eller
 * ratingen mangler: så findes der intet sandt tal, og kalderen springer rytteren over.
 * Deterministisk: samme input giver altid samme svar.
 */
export function expectedCareer(
  rider: ExpectedTopRider, params: DevelopmentXpParams, career: Readonly<StandardCareer> = STANDARD_CAREER,
): ExpectedCareer | null {
  if (!rider || !rider.abilities) return null;
  if (!isNum(rider.age)) return null;
  const age = Math.round(rider.age);
  const primaryType = rider.primaryType ?? null;
  const secondaryType = rider.secondaryType ?? null;

  // Fælles normalisering (displayRecipes.abilityValue): SQL NULL forbliver en manglende
  // evne, aldrig et opdigtet nul. Er ingen brugbare evner tilbage, findes intet skøn.
  let state: Record<string, number> = {};
  for (const ability of VISIBLE_ABILITIES as readonly string[]) {
    const value = abilityValue(rider.abilities[ability]);
    if (value !== null) state[ability] = value;
  }
  if (Object.keys(state).length === 0) return null;
  const ratingNow = ratingOf(state, primaryType, secondaryType);
  if (ratingNow == null) return null;

  const shares = standardCareerShares(primaryType, secondaryType, params);
  const bars: Record<string, number> = {};
  let top = ratingNow;
  let topAbilities = { ...state };
  let topAge = age;
  for (let a = age; a <= career.endAge; a++) {
    const physical = xpPerDate({ potentiale: rider.potentiale, age: a }, params);
    const mental = xpPerDate({ potentiale: rider.potentiale, age: a, mental: true }, params);
    for (let d = 0; d < career.datesPerSeason; d++) {
      for (const [ability, share] of Object.entries(shares)) {
        const level = state[ability];
        if (!isNum(level)) continue;
        const riderXp = MENTAL_ABILITIES.has(ability) ? mental : physical;
        // Intet loft pr. dato, som motoren (#6110 R9): kun prisen bremser.
        const out = buyPoints({ level, bar: bars[ability] ?? 0, xp: riderXp * share }, params);
        bars[ability] = out.bar;
        state[ability] = out.level;
      }
    }
    const rating = ratingOf(state, primaryType, secondaryType);
    if (rating != null && rating > top) {
      top = rating;
      topAbilities = { ...state };
      topAge = a;
    }
    // Sæsonskiftet: alderen i den nye sæson, seedet som motoren.
    const dev = developRiderSeasonV2(
      { id: rider.id, primary_type: primaryType, potentiale: rider.potentiale, age: a + 1 },
      state, a, { load: career.declineLoad },
    );
    state = { ...state, ...(dev.next as Record<string, number>) };
  }
  return { rating: top, ratingNow, abilities: topAbilities, atAge: topAge };
}

/** Det sande tal bag skønnet under XP: forventet topniveau i ratingskala, eller null. */
export function expectedTopRating(
  rider: ExpectedTopRider, params: DevelopmentXpParams, career: Readonly<StandardCareer> = STANDARD_CAREER,
): number | null {
  return expectedCareer(rider, params, career)?.rating ?? null;
}
