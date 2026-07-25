// Onboarding v2 Slice 1b — opt-in tour state helpers.
// Tour state stored as JSON {page: "riders"|"auctions", step: number} in localStorage.

const STORAGE_KEY = "cz-onboarding-tour-step";

// Onboarding step keys → tour pages. #2819: alle 4 trin er nu mappet. Før havde
// first_training_run/first_squad_selected ingen tour, og "Show me how"-knappen
// forsvandt tavst på præcis de to mest jargon-tunge trin (træningsfokus,
// holdudtagelse). Tilføj ALDRIG et trin her uden at mounte <OnboardingTour> med
// matchende data-tour-ankre på siden — knappen ville så føre til en tom tour.
export const TOUR_PAGE_BY_STEP = {
  first_bid_placed: "auctions",
  first_training_run: "training",
  first_squad_selected: "races",
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
