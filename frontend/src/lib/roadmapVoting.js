// Roadmap-voting (#954): ren logik for /roadmap-stemmer, holdt ude af
// RoadmapPage så den kan unit-testes med node:test (uden React/Supabase).
// Dual-akse 1-6 uden neutralt midtpunkt — beslutning fra brainstorm 2/6.

// 'club' = 5. kort (Klub & verden) ud over de fire doctrine-motorer — board,
// renommé, stab, museum og social bor dér (ejer-godkendt 11/6).
export const ENGINE_ORDER = ["races", "training", "youth", "market", "club"];

export const SCORE_MIN = 1;
export const SCORE_MAX = 6;
export const SCALE = [1, 2, 3, 4, 5, 6];

export function itemTitle(item, language) {
  return language?.startsWith("da") ? item.title_da : item.title_en;
}

export function groupItemsByEngine(items) {
  const grouped = Object.fromEntries(ENGINE_ORDER.map((engine) => [engine, []]));
  for (const item of items ?? []) {
    // Ukendte engines droppes frem for at vælte siden.
    if (grouped[item.engine]) grouped[item.engine].push(item);
  }
  for (const list of Object.values(grouped)) {
    list.sort((a, b) => a.sort_order - b.sort_order || a.title_en.localeCompare(b.title_en));
  }
  return grouped;
}

export function isValidScore(value) {
  return Number.isInteger(value) && value >= SCORE_MIN && value <= SCORE_MAX;
}

export function buildVotePayload({ itemId, userId, ideaScore, importanceScore }) {
  if (!itemId || !userId) throw new Error("itemId and userId are required");
  if (!isValidScore(ideaScore) || !isValidScore(importanceScore)) {
    throw new Error(`scores must be integers ${SCORE_MIN}-${SCORE_MAX}`);
  }
  return {
    item_id: itemId,
    user_id: userId,
    idea_score: ideaScore,
    importance_score: importanceScore,
    updated_at: new Date().toISOString(),
  };
}

// Privacy (#1599): når userId er sat, filtreres til KUN den brugers egne
// stemmer FØR Map'en bygges. Forsvars-lag 2 oven på query-filteret — så en
// admin-RLS-undtagelse (OR is_admin()) der lækker andres rows ikke kan skrive
// fremmede scores ind i brugerens sliders. Uden userId = uændret (unit-tests).
export function votesByItemId(votes, userId) {
  const rows = userId
    ? (votes ?? []).filter((vote) => vote.user_id === userId)
    : (votes ?? []);
  return new Map(rows.map((vote) => [vote.item_id, vote]));
}
