// #5013/#4751 — Abonnement pr. forum-kategori, delt klientlogik.
//
// To flader viser det SAMME valg: kategori-hovedet på forumsiden (til/fra for
// den kategori man står i) og den samlede liste i indstillingerne. De må ikke
// kunne drifte fra hinanden, så formen på svaret og reglerne for hvad man må
// slå fra bor her, ikke i hver side.
//
// Modellen er opt-out (se database/2026-09-08-5013-forum-category-mutes.sql):
// ingen række = spilleren følger kategorien. Klienten skal derfor kunne tegne
// den fulde liste selv når backend svarer med et tomt sæt — og en kategori
// backend ikke kender falder til "følger", aldrig til "slået fra".

export const FORUM_CATEGORY_KEYS = [
  "general",
  "feedback_ideas",
  "questions",
  "tactics",
  "transfers",
  "off_topic",
];

/** "archive" er et visnings-filter (#4492), ikke noget man kan abonnere på. */
export function isSubscribableCategory(category) {
  return FORUM_CATEGORY_KEYS.includes(category);
}

/**
 * Normalisér GET /api/forum/category-mutes til en fuld liste i den kanoniske
 * rækkefølge. Et defekt/tomt svar giver "følger alt" — den sikre default:
 * spilleren mister aldrig et signal på grund af en fejlet forespørgsel.
 */
export function normalizeCategoryMutes(payload) {
  const muted = new Set(
    (payload?.categories || [])
      .filter((row) => row && row.muted === true && isSubscribableCategory(row.category))
      .map((row) => row.category)
  );
  return FORUM_CATEGORY_KEYS.map((category) => ({ category, muted: muted.has(category) }));
}

/** Optimistisk lokal opdatering af ét flag — samme liste, ny værdi. */
export function applyCategoryMute(categories, category, muted) {
  return categories.map((row) => (row.category === category ? { ...row, muted } : row));
}

/** Er DENNE kategori slået fra? Ukendt kategori = følger (aldrig dæmpet). */
export function isCategoryMuted(categories, category) {
  return (categories || []).some((row) => row.category === category && row.muted === true);
}

/** Antal kategorier spilleren følger — bruges i indstillingernes opsummering. */
export function followedCategoryCount(categories) {
  return (categories || []).filter((row) => row.muted !== true).length;
}
