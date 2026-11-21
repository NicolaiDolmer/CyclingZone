// #7947 PR 3 (#8530) · Preview (?trainingR5=1&trainingR5Levels=1): I dag-fanen R5 med
// indsatsvaelgeren Let/Mellem/Haard taendt, til billeder og ejerens egen klik-rundtur.
// Kun preview-mockens seed aendres; uden parameteren er seedet som foer, og prod roeres ikke.
// Navne, tal og niveauer er preview-fiktion.

type Seed = Record<string, unknown> & {
  plans?: Record<string, unknown>;
  riderWeekPlans?: Record<string, Record<string, Record<string, unknown>>>;
};

function levelsOn(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("trainingR5Levels") === "1";
  } catch {
    return false;
  }
}

export function seedEffortPickerPreview(seed: Seed): void {
  if (!levelsOn()) return;
  // Samme felt som API'et skal sende (`effortLevels`): kontakten training_effort_levels er taendt.
  seed.effortLevels = true;
  seed.plans = {
    ...(seed.plans ?? {}),
    // Sessioner paa et andet niveau end deres eget: aero paa Haard, udholdenhed paa Haard.
    "rider-r5-5": { focus: "aero", intensity: "hard" },
    "rider-r5-8": { focus: "endurance", intensity: "hard" },
  };
  // En programrytter hvis celler baerer et niveau (feltet `effort` paa ugedagens celle).
  const week = seed.riderWeekPlans?.["rider-r5-6"];
  if (week) for (const day of Object.values(week)) day.effort = "easy";
}
