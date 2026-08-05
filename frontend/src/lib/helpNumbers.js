// Hard game numbers interpolated into /help prose (#1916).
//
// Before this, help.json hardcoded the core economy/squad numbers in prose, so
// they drifted silently when a backend constant changed (#1907: startbudget
// 800k→500k, trup 8→12, præmie ×1500→×75). /rules never drifted because it reads
// lib/rulesNumbers.js, which is pinned to the backend constants by
// rulesNumbers.test.js. This applies the same pin to /help: the tal-bearing
// strings in help.json now use {{placeholders}} that HelpPage fills from
// RULES_NUMBERS at render time, so the rendered number always equals the backend
// single source of truth and can't drift. helpNumbers.test.js guards the wiring.
//
// Only the hard scalars that drifted are pinned here. The prize examples (1300×75)
// stay as prose — pinning them would require importing the full race points table.
//
// #3100: the division-bonus table used to be in that same "stays as prose" bucket,
// and it drifted exactly as predicted. #1608 added division 4 to the backend payout
// table; /help kept showing three divisions and a "Place 4-5" column that never
// existed in the payout code. Division 4 bonuses had been paid in production while
// both help surfaces denied the division existed, so the table is now pinned to
// RULES_NUMBERS like the rest. The bonus values live in RULES_NUMBERS already, so
// pinning them costs nothing extra.

import { RULES_NUMBERS } from "./rulesNumbers.js";

// Every bonusD<division>P<place> key in RULES_NUMBERS, derived rather than listed
// so a new division or placement in the backend table reaches /help automatically
// instead of requiring three separate files to be remembered.
const BONUS_KEYS = Object.keys(RULES_NUMBERS)
  .filter((k) => /^bonusD\d+P\d+$/.test(k))
  .sort();

// Interpolation keys used inside help.json. The drift guard (helpNumbers.test.js)
// asserts that every {{token}} in help.json is one of these and that each appears
// in both locales.
export const HELP_NUMBER_KEYS = Object.freeze([
  "startingBalance",
  "prizePerPoint",
  "squadCap",
  "initialSquad",
  "academySlots",
  "academySigningFeePct",
  ...BONUS_KEYS,
]);

// Build the interpolation map for a given UI language. Thousands-separated values
// (startingBalance) are locale-formatted so the rendered prose matches what the
// translator wrote ("500,000" in en, "500.000" in da); the small integers need no
// separator.
export function buildHelpNumbers(lang) {
  const locale = String(lang || "").toLowerCase().startsWith("da") ? "da-DK" : "en-US";
  const bonuses = {};
  for (const key of BONUS_KEYS) bonuses[key] = RULES_NUMBERS[key].toLocaleString(locale);
  return {
    startingBalance: RULES_NUMBERS.startingBalance.toLocaleString(locale),
    prizePerPoint: String(RULES_NUMBERS.prizePerPoint),
    squadCap: String(RULES_NUMBERS.squadCap),
    initialSquad: String(RULES_NUMBERS.initialSquadSize),
    academySlots: String(RULES_NUMBERS.academySlots),
    academySigningFeePct: String(RULES_NUMBERS.academySigningFeePct),
    ...bonuses,
  };
}

// ICU single-brace argument: {squadCap}. Only matches a bare {word}, so real ICU
// expressions ({count, plural, ...}) are never touched.
const ICU_ARG = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

// Interpolate help numbers into a string, or recursively into the arrays returned
// by t(key, { returnObjects: true }). i18next-icu interpolates plain string values
// but NOT the elements of a returnObjects array (steps/rows), so HelpPage runs the
// array results through this. Unknown args are left untouched.
export function interpolateHelp(value, vars) {
  if (typeof value === "string") return value.replace(ICU_ARG, (m, k) => (k in vars ? vars[k] : m));
  if (Array.isArray(value)) return value.map((v) => interpolateHelp(v, vars));
  return value;
}
