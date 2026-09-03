// backend/lib/assistantSelectionMode.js
// #4201: assistentens udtagelses-tilstand. Fem spillere bad 24/8 om at vende
// auto-udtagelsen om — assistenten skal udfylde det spilleren ikke naaede, ikke
// fylde alt paa forhaand. Tre tilstande, valgt runtime i app_config UDEN deploy:
//
//   proactive (default) = som i dag: den proaktive sweep roerer KUN hold uden
//                         bruger (AI-hold). Ejer-direktiv 25/8, #4217.
//   late_fill           = AI-hold som i dag + manager-hold faar en trup udfyldt
//                         foerst naar loebet starter inden for N timer, og KUN
//                         hvis holdets trup i det loeb er helt tom.
//   opt_in              = AI-hold som i dag + de manager-hold der selv har slaaet
//                         assistenten til (teams.assistant_autopick_enabled).
//
// Fail-safe er "proactive": manglende noegle, ukendt vaerdi, DB-fejl eller en
// manglende teams-kolonne giver praecis dagens adfaerd. Reglerne bor i
// docs/ASSISTANT_RULES.md §1b — opdatér den i samme PR som en aendring her.
import { readFlagStage } from "./featureStage.js";

export const ASSISTANT_SELECTION_MODE_KEY = "assistant_selection_mode";
export const ASSISTANT_LATE_FILL_HOURS_KEY = "assistant_late_fill_hours";

export const ASSISTANT_MODES = Object.freeze({
  PROACTIVE: "proactive",
  LATE_FILL: "late_fill",
  OPT_IN: "opt_in",
});

export const DEFAULT_ASSISTANT_MODE = ASSISTANT_MODES.PROACTIVE;

// Ejer-valgt default for hvor taet paa start assistenten maa udfylde en tom trup.
// 24 timer = spillernes eget forslag (@jeppek, #4201: "hvis du ikke har udtaget
// truppen 1 doegn foer"). Kun en tidsgraense — ingen balance-vaegt.
export const DEFAULT_LATE_FILL_HOURS = 24;
// Ydergraenser saa en tastefejl i app_config ikke bliver til "hele saesonen".
export const MIN_LATE_FILL_HOURS = 1;
export const MAX_LATE_FILL_HOURS = 168;

const KNOWN_MODES = new Set(Object.values(ASSISTANT_MODES));

/** Ukendt/manglende vaerdi → default (proactive). Aldrig et kast. */
export function normalizeAssistantMode(value) {
  return KNOWN_MODES.has(value) ? value : DEFAULT_ASSISTANT_MODE;
}

/** Ikke-tal, NaN eller uden for [1, 168] → default (24). Aldrig et kast. */
export function normalizeLateFillHours(value) {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULT_LATE_FILL_HOURS;
  if (n < MIN_LATE_FILL_HOURS || n > MAX_LATE_FILL_HOURS) return DEFAULT_LATE_FILL_HOURS;
  return n;
}

/**
 * Laeser begge noegler fra app_config. readFlagStage er det ENE sted app_config
 * laeses (featureStage.js) og fejler fail-safe til null → vi normaliserer til
 * default. Returnerer altid et brugbart objekt.
 *
 * @returns {Promise<{mode: string, lateFillHours: number}>}
 */
export async function readAssistantSelectionConfig(supabase) {
  const [rawMode, rawHours] = await Promise.all([
    readFlagStage(supabase, ASSISTANT_SELECTION_MODE_KEY),
    readFlagStage(supabase, ASSISTANT_LATE_FILL_HOURS_KEY),
  ]);
  return {
    mode: normalizeAssistantMode(rawMode),
    lateFillHours: normalizeLateFillHours(rawHours),
  };
}
