// Pure helpers for FeedbackModal (#2602). Isolated from React so the
// validation contract can be unit-tested without DOM. Mirrors the backend
// contract in backend/routes/api.js POST /api/feedback — keep both in sync.

// #4346: 'fairplay' tilføjet — kontaktformularens dropdown får en
// "Fair play / report a trade"-kategori. Skal matche FEEDBACK_CATEGORIES i
// backend/routes/api.js + player_feedback_category_check (database/2026-09-
// 14-4346-fairplay-trade-report.sql) — udvid alle tre sammen.
export const FEEDBACK_CATEGORIES = ["feedback", "bug", "idea", "fairplay"];
export const FEEDBACK_MESSAGE_MAX_LENGTH = 4000;

const VALID_CATEGORIES = new Set(FEEDBACK_CATEGORIES);

/**
 * Validates a feedback submission before it's sent to the backend.
 * @returns {string|null} an error key (resolved via feedback:error.*) or null when valid.
 */
export function validateFeedback({ category, message }) {
  if (!VALID_CATEGORIES.has(category)) return "error.invalidCategory";
  const trimmed = typeof message === "string" ? message.trim() : "";
  if (!trimmed) return "error.messageRequired";
  if (trimmed.length > FEEDBACK_MESSAGE_MAX_LENGTH) return "error.messageTooLong";
  return null;
}

/** Captures the current page path + viewport for a bug report's diagnostics. */
export function captureContext({ pathname, innerWidth, innerHeight } = {}) {
  return {
    page_path: typeof pathname === "string" ? pathname : null,
    viewport: Number.isFinite(innerWidth) && Number.isFinite(innerHeight)
      ? `${innerWidth}x${innerHeight}`
      : null,
  };
}
