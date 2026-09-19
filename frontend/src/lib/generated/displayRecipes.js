// GENERERET FIL — REDIGÉR IKKE I HÅNDEN.
// Kilde: backend/lib/abilityRegistry.js + backend/lib/weights/displayRecipes.js
// Regenerér: node scripts/generate-ability-registry.mjs
// Drift-vagt: backend/lib/abilityRegistryGuards.test.js (CI fejler hvis stale).

// Visnings-opskrifterne. Rating = vægtet snit af rollens evner, afrundet,
// klampet [0,99]. Ingen normalisering, ingen kurve, ingen populations-ankre.
export const DISPLAY_RECIPES = Object.freeze([
  {
    "key": "sprinter",
    "weights": {
      "sprint": 4,
      "acceleration": 3,
      "positioning": 2,
      "flat": 2,
      "durability": 1
    }
  },
  {
    "key": "tt",
    "weights": {
      "time_trial": 5,
      "tempo": 2,
      "endurance": 1,
      "durability": 1,
      "positioning": 1
    }
  },
  {
    "key": "climber",
    "weights": {
      "climbing": 5,
      "tempo": 2,
      "endurance": 2,
      "recovery": 1,
      "durability": 1,
      "descending": 1,
      "punch": 1
    }
  },
  {
    "key": "puncheur",
    "weights": {
      "punch": 5,
      "tempo": 2,
      "acceleration": 1,
      "climbing": 1,
      "positioning": 1,
      "endurance": 1
    }
  },
  {
    "key": "brostensrytter",
    "weights": {
      "cobblestone": 5,
      "flat": 2,
      "durability": 2,
      "positioning": 1,
      "punch": 1,
      "endurance": 1
    }
  },
  {
    "key": "rouleur",
    "weights": {
      "flat": 4,
      "endurance": 2,
      "tempo": 2,
      "durability": 1,
      "positioning": 1,
      "recovery": 1,
      "sprint": 1
    }
  },
  {
    "key": "baroudeur",
    "weights": {
      "aggression": 4,
      "endurance": 2,
      "descending": 1,
      "recovery": 1,
      "punch": 1,
      "flat": 1,
      "tactics": 1
    }
  },
  {
    "key": "gc",
    "weights": {
      "climbing": 3,
      "time_trial": 3,
      "recovery": 2,
      "endurance": 2,
      "tempo": 2,
      "durability": 1,
      "descending": 1
    }
  }
]);

export const DISPLAY_RECIPE_KEYS = Object.freeze(DISPLAY_RECIPES.map((r) => r.key));

// Spejler backend abilityValue() 1:1 (#5321). Number(null) og Number("") er 0
// og finite — derfor talte en NULL-kolonne som et ægte nul og trak ratingen
// ned, mens en manglende nøgle (NaN) blev sprunget over. Samme rytter fik
// forskellig rating alt efter hvilke kolonner fladen hentede. Et ægte 0 tæller
// stadig med.
export function abilityValue(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    if (raw.trim() === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// Spejler backend ratingForRole() 1:1. Evner der mangler på rækken — eller
// står NULL — tæller hverken i tæller eller nævner, så en delvist udfyldt
// række ikke trækkes mod 0.
export function ratingForRole(abilities, roleKey) {
  const recipe = DISPLAY_RECIPES.find((r) => r.key === roleKey);
  if (!recipe) return null;
  let sum = 0;
  let wsum = 0;
  for (const [ability, weight] of Object.entries(recipe.weights)) {
    const v = abilityValue(abilities?.[ability]);
    if (v === null) continue;
    sum += v * weight;
    wsum += weight;
  }
  if (wsum <= 0) return null;
  return Math.max(0, Math.min(99, Math.round(sum / wsum)));
}
