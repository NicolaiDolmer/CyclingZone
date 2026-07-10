// Onboarding v2 Slice 1b — opt-in tour state helpers.
// Tour state stored as JSON {page: "riders"|"auctions", step: number} in localStorage.

const STORAGE_KEY = "cz-onboarding-tour-step";

// Onboarding step keys → tour pages (#2288: first_training_run/first_squad_selected
// har ingen dedikeret guidet tour endnu — "Show me how"-linket springes blot over
// for de trin, se OnboardingProgressCard's tourPage-fallback).
export const TOUR_PAGE_BY_STEP = {
  first_bid_placed: "auctions",
  board_plan_set: "board",
};

export function startTour(page) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ page, step: 0 }));
  } catch {
    // localStorage utilgængelig (private browsing) — tour springes blot over
  }
}

export function readTour() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.page !== "string" || typeof parsed?.step !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function advanceTour() {
  const cur = readTour();
  if (!cur) return null;
  const next = { ...cur, step: cur.step + 1 };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore — state lever kun i memory hvis localStorage fejler
  }
  return next;
}

export function endTour() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
