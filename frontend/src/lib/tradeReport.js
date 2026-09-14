// Pure helpers for "Report for review" on a single completed trade (#4346).
// Isolated from React so the eligibility/validation contract can be
// unit-tested without DOM — mirrors the pattern in feedbackForm.js.
// Mirrors the backend contract in backend/lib/feedbackInbox.js
// (submitTradeReport) — keep both in sync.

// Excludes "academy": an academy intake has no counterparty team, so there is
// nothing to report a trade AGAINST (see isTradeReportable below).
export const TRADE_REPORT_TYPES = ["auction", "transfer", "swap"];
export const TRADE_REPORT_MESSAGE_MIN_LENGTH = 10;
export const TRADE_REPORT_MESSAGE_MAX_LENGTH = 1000;

/**
 * TeamTransferHistoryTab builds event ids as `${type}:${rawId}` (see
 * teamTransferHistory.js) — this is the single place that format is parsed
 * back apart, so a future id-shape change only breaks in one spot.
 * @param {string} eventId
 * @returns {{ type: string, id: string } | null}
 */
export function parseTransferEventId(eventId) {
  if (typeof eventId !== "string") return null;
  const idx = eventId.indexOf(":");
  if (idx <= 0) return null;
  return { type: eventId.slice(0, idx), id: eventId.slice(idx + 1) };
}

/**
 * Can this transfer-history row be reported? Only a real, completed
 * two-team trade — not an academy intake (no counterparty) and not a
 * no_sale auction (rider stayed on the team, nothing changed hands).
 * @param {object} event — one row from buildTeamTransferHistory
 */
export function isTradeReportable(event) {
  if (!event || event.no_sale) return false;
  const parsed = parseTransferEventId(event.id);
  if (!parsed || !TRADE_REPORT_TYPES.includes(parsed.type)) return false;
  return Boolean(event.counterparty?.id);
}

/**
 * Validates a trade-report submission before it's sent to the backend.
 * @returns {string|null} an error key (resolved via transfers:report.*) or null when valid.
 */
export function validateTradeReport({ message }) {
  const trimmed = typeof message === "string" ? message.trim() : "";
  if (trimmed.length < TRADE_REPORT_MESSAGE_MIN_LENGTH) return "report.tooShort";
  if (trimmed.length > TRADE_REPORT_MESSAGE_MAX_LENGTH) return "report.tooLong";
  return null;
}
