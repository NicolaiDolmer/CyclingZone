// backend/lib/grandTourRestDays.js
// #3470: Grand Tour-hviledage — REN datafil, samme mønster som seasonPhaseProfiles.js
// (#3469): data, ikke gæt, kalibreret mod det RIGTIGE katalog (race_pool.date_text,
// læst read-only 6/8).
//
// Ejer-beslutning 6/8: en GT (21 etaper) skal have hviledage som i virkeligheden, MEN
// hviledagen må ikke efterlade et hul i KALENDEREN — et endagsløb fra puljen fylder
// samme game_day-slot (se raceCalendarLanePacker.js). Denne fil siger KUN (a) hvor
// mange hviledage et givet GT-løb skal have, udledt af date_text, og (b) EFTER hvilke
// etaper de placeres — den rører aldrig selve pakningen.
//
// ── Dataarkæologi (katalog-scan 6/8, de 3 eneste ≥15-etapers løb) ──────────────────
//   Giro della Penisola   8/5 - 31/5  → 24 dage / 21 etaper → 3 hviledage
//   Tour de l'Hexagone    (spænd 23 dage) / 21 etaper        → 2 hviledage
//   Vuelta Ibérica        22/8 - 13/9 → 23 dage / 21 etaper  → 2 hviledage
// Mønstret (efter etape 6/12/18 ved 3 hviledage, efter 9/15 ved 2) matcher virkelighedens
// Giro (3 hviledage) hhv. Tour/Vuelta (2 hviledage) — FROSSET, ikke en selvstændig optælling
// pr. sæson (samme "frosset mønster, ikke live-genberegnet" princip som
// raceStageOrderProfiles.js). 1-hviledags-mønstret (position 10, midtpunkt) er defensivt
// symmetrisk — INGEN af vores 3 GT'er rammer det i dag, men clamp()'en kan i princippet
// give 1 for et kortere date_text-spænd.
//
// REN + deterministisk (ingen DB/Date/random) — samme kontrakt som seasonPhaseProfiles.js.

import { parseRaceDateText } from "./seasonPhaseProfiles.js";

// Samme tærskel som tierRaceSelection.GRAND_TOUR_MIN_STAGES — importeres IKKE herfra
// (ville skabe en cirkulær afhængighed grandTourRestDays.js → tierRaceSelection.js →
// … → grandTourRestDays.js er ikke aktuel i dag, men værdien er bevidst frosset her som
// sin egen konstant, samme praksis som tierCalendarMaterializer.js re-eksporterer den).
export const GRAND_TOUR_MIN_STAGES = 15;

// Ejer-beslutning 25/8 (#4236): en Grand Tour har PRAECIS 2 hviledage. Foer blev antallet
// udledt af `date_text` og kunne blive 0-3 - to GT'er i samme saeson kunne have forskelligt
// antal uden at nogen havde besluttet det, og 0 hvis date_text manglede. Ensartet nu.
export const GRAND_TOUR_REST_DAYS = 2;

// Hviledags-ANTAL → 1-indekserede etape-numre EFTER hvilke en hviledag indsættes.
export const GT_REST_DAY_PATTERN = Object.freeze({
  0: Object.freeze([]),
  1: Object.freeze([10]),
  2: Object.freeze([9, 15]),
  3: Object.freeze([6, 12, 18]),
});

/**
 * Antal hviledage for et løb. Ejer-beslutning 25/8 (#4236): en Grand Tour har PRÆCIS
 * GRAND_TOUR_REST_DAYS (2). Ikke-GT'er (< GRAND_TOUR_MIN_STAGES etaper) har 0.
 * `dateText` indgår ikke længere — antallet er en spilregel, ikke en egenskab ved det
 * virkelige løbs datoer, og den gamle udledning gav uensartede 0-3.
 * @param {{stages?: number}} args
 * @returns {number} 0 eller GRAND_TOUR_REST_DAYS
 */
export function grandTourRestDayCount({ stages } = {}) {
  const stageCount = Number(stages);
  if (!Number.isFinite(stageCount) || stageCount < GRAND_TOUR_MIN_STAGES) return 0;
  return GRAND_TOUR_REST_DAYS;
}

/**
 * Hviledags-positioner for et GT med `stages` etaper og `restDays` hviledage:
 * 1-indekserede etape-numre EFTER hvilke en hviledag skal indsættes. Kun anker-punkter
 * der falder INDEN FOR løbets etape-antal medtages (defensivt for GT'er kortere end
 * 21 etaper — degraderer gracefully, en position der peger forbi sidste etape springes
 * over i stedet for at producere et ugyldigt segment).
 * @param {{stages?: number, restDays?: number}} args
 * @returns {number[]}
 */
export function grandTourRestDayPositions({ stages, restDays } = {}) {
  const pattern = GT_REST_DAY_PATTERN[restDays] ?? [];
  const total = Number(stages) || 0;
  return pattern.filter((afterStage) => afterStage > 0 && afterStage < total);
}
