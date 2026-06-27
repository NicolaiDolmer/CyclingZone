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
// Only the hard scalars that drifted are pinned here. Derived tables (the prize
// examples 1300×75 and the division-bonus table) stay as prose — pinning them
// would require importing the full race points table too. Same scope boundary as
// rulesNumbers.js, where the bonus table is a documented mirror.

import { RULES_NUMBERS } from "./rulesNumbers.js";

// Interpolation keys used inside help.json. The drift guard (helpNumbers.test.js)
// asserts that every {{token}} in help.json is one of these and that each appears
// in both locales.
export const HELP_NUMBER_KEYS = Object.freeze([
  "startingBalance",
  "prizePerPoint",
  "squadCap",
  "initialSquad",
  "academySlots",
]);

// Build the interpolation map for a given UI language. Thousands-separated values
// (startingBalance) are locale-formatted so the rendered prose matches what the
// translator wrote ("500,000" in en, "500.000" in da); the small integers need no
// separator.
export function buildHelpNumbers(lang) {
  const locale = String(lang || "").toLowerCase().startsWith("da") ? "da-DK" : "en-US";
  return {
    startingBalance: RULES_NUMBERS.startingBalance.toLocaleString(locale),
    prizePerPoint: String(RULES_NUMBERS.prizePerPoint),
    squadCap: String(RULES_NUMBERS.squadCap),
    initialSquad: String(RULES_NUMBERS.initialSquadSize),
    academySlots: String(RULES_NUMBERS.academySlots),
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
