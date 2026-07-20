/**
 * #1346 — afled UI-gate-state fra season-transition-readiness.
 * Payload kommer fra GET /api/admin/season-transition/preview (felt:
 * readiness) og fra 409-svar på POST /api/admin/season-transition.
 * Server-gaten er den egentlige guard; mangler readiness (gammel
 * backend-deploy) degraderer UI'et gracefully til ikke-blokeret.
 */

export const TRANSITION_CHECK_LABELS = {
  // #2361: skal stå øverst i den viste rækkefølge (samme rækkefølge som
  // backend-checks-objektet) — springer man season-end over, er det den
  // vigtigste og mest irreversible fejl at fange FØR transition.
  season_end_completed: "Season-end kørt (op/nedrykning + bonusser)",
  window_closed: "Transfervindue lukket",
  final_whistle_sent: "Final whistle sendt",
  squad_enforcement_completed: "Squad enforcement kørt",
  no_active_auctions: "Ingen aktive auktioner",
  all_races_completed: "Alle løb afviklet",
};

export function summarizeTransitionReadiness(readiness) {
  if (!readiness || typeof readiness !== "object" || !readiness.checks) {
    return { known: false, blocked: false, rows: [], failed: [] };
  }
  const rows = Object.entries(readiness.checks).map(([key, check]) => ({
    key,
    label: TRANSITION_CHECK_LABELS[key] || key,
    ok: Boolean(check?.ok),
    critical: Boolean(check?.critical),
    detail: check?.detail ?? null,
  }));
  const failed = rows.filter((r) => r.critical && !r.ok);
  return { known: true, blocked: failed.length > 0, rows, failed };
}
