// #4847 preview mock for /api/training/train-now (VITE_PREVIEW_MOCK=1 only).
//
// The press is ON here (preview override of the real stage flag), so the owner can
// click it on preview before the flag moves. Query params give the before/after pair:
//   ?trainNow=off     the page exactly as today (no press)
//   ?trainNow=locked  the state right after a press
// Wired only in installPreviewMock.js, never in mockHandlers.js (Playwright
// fixtures share mockHandlers; the existing /training snapshots must not move).

type MockResponse = { status: number; body: unknown };

const TICK_DATE = "2026-10-01";
let pressedAt: string | null = null;

function mode(): string | null {
  try {
    return new URLSearchParams(window.location.search).get("trainNow");
  } catch {
    return null;
  }
}

function status() {
  const forcedLocked = mode() === "locked";
  const lockedAt = pressedAt ?? (forcedLocked ? `${TICK_DATE}T06:00:00.000Z` : null);
  const locked = lockedAt != null;
  return {
    enabled: true, available: !locked, reason: locked ? "locked" : null, tickDate: TICK_DATE,
    locked, lockedAt, settled: false,
  };
}

export function trainNowPreviewRoute(method: string): MockResponse | null {
  if (mode() === "off") return method === "GET" ? { status: 200, body: { enabled: false } } : { status: 404, body: { error: "not_found" } };
  if (method === "GET") return { status: 200, body: status() };
  if (method === "POST") {
    if (status().locked) return { status: 200, body: { ok: true, tickDate: TICK_DATE, settledRiderIds: [], afterRaceRiderIds: [] } };
    pressedAt = new Date().toISOString();
    return {
      status: 200,
      // #6006: an assistant-selected squad of 45 with 10 entered today.
      body: {
        ok: true, tickDate: TICK_DATE, lockedAt: pressedAt,
        settledRiderIds: Array.from({ length: 35 }, (_, i) => `preview-free-${i}`),
        afterRaceRiderIds: Array.from({ length: 10 }, (_, i) => `preview-racing-${i}`),
        settledGameDays: [15, 16, 17, 18], gameDays: [15, 16, 17, 18, 19],
      },
    };
  }
  return null;
}
