// #2499 — værdi-bevægelse skal kunne SES. Ren helper til at vælge/formatere
// et delta-vindue fra backend-svaret { windows: { "7": {...}|null, "14": {...}|null } }
// (GET /api/riders/:id/value-trend, POST /api/riders/value-trend for batch).
// Ingen model-komponenter håndteres her (fog-gate) — kun det færdige total-delta.

// Foretræk 14-dages-vinduet (matcher issue-eksemplet "seneste 14 dage");
// fald tilbage til 7-dages hvis 14 mangler (ny rytter). null hvis intet vindue
// har nok historik — UI'et skal da UDELADE deltaet, aldrig fabrikere et tal.
export function pickBestValueTrendWindow(windows) {
  if (!windows) return null;
  return windows["14"] || windows["7"] || null;
}

// "up" | "down" | "flat" — flat ved afrundet 0-delta (ingen pil-støj for støj-niveau).
export function valueTrendDirection(window) {
  if (!window) return null;
  if (window.delta > 0) return "up";
  if (window.delta < 0) return "down";
  return "flat";
}
