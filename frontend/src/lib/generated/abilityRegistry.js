// GENERERET FIL — REDIGÉR IKKE I HÅNDEN.
// Kilde: backend/lib/abilityRegistry.js + backend/lib/weights/displayRecipes.js
// Regenerér: node scripts/generate-ability-registry.mjs
// Drift-vagt: backend/lib/abilityRegistryGuards.test.js (CI fejler hvis stale).

export const ABILITY_CATEGORIES = Object.freeze([
  {
    "key": "physical",
    "keys": [
      "climbing",
      "tempo",
      "punch",
      "sprint",
      "acceleration",
      "flat",
      "time_trial",
      "endurance",
      "durability",
      "recovery"
    ]
  },
  {
    "key": "mental",
    "keys": [
      "aggression",
      "tactics"
    ]
  },
  {
    "key": "technical",
    "keys": [
      "descending",
      "cobblestone",
      "positioning"
    ]
  }
]);

export const ABILITY_KEYS = Object.freeze(ABILITY_CATEGORIES.flatMap((c) => c.keys));

export const ABILITY_SHORT = Object.freeze({
  "climbing": "CLM",
  "tempo": "TMP",
  "punch": "PCH",
  "sprint": "SPR",
  "acceleration": "ACC",
  "flat": "FLT",
  "time_trial": "TT",
  "endurance": "END",
  "durability": "DUR",
  "recovery": "REC",
  "aggression": "AGR",
  "tactics": "TAC",
  "descending": "DSC",
  "cobblestone": "COB",
  "positioning": "POS"
});

export const ABILITY_ICONS = Object.freeze({
  "climbing": "▲",
  "tempo": "◈",
  "punch": "✦",
  "sprint": "↯",
  "acceleration": "▷",
  "flat": "▬",
  "time_trial": "◴",
  "endurance": "◎",
  "durability": "⬣",
  "recovery": "↺",
  "aggression": "➹",
  "tactics": "⌖",
  "descending": "▽",
  "cobblestone": "⬡",
  "positioning": "⊹"
});

export const ABILITY_I18N_KEYS = Object.freeze({
  "climbing": "rider:racePreview.derived.climbing",
  "tempo": "rider:racePreview.derived.tempo",
  "punch": "rider:racePreview.derived.punch",
  "sprint": "rider:racePreview.derived.sprint",
  "acceleration": "rider:racePreview.derived.acceleration",
  "flat": "rider:racePreview.derived.flat",
  "time_trial": "rider:racePreview.derived.time_trial",
  "endurance": "rider:racePreview.derived.endurance",
  "durability": "rider:racePreview.derived.durability",
  "recovery": "rider:racePreview.derived.recovery",
  "aggression": "rider:racePreview.derived.aggression",
  "tactics": "rider:racePreview.derived.tactics",
  "descending": "rider:racePreview.derived.descending",
  "cobblestone": "rider:racePreview.derived.cobblestone",
  "positioning": "rider:racePreview.derived.positioning"
});
