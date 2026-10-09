// #4847 preview mock for /api/training/train-now (VITE_PREVIEW_MOCK=1 only).
//
// The press is ON here (preview override of the real stage flag), so the owner can
// click it on preview before the flag moves. Query params give the before/after pair:
//   ?trainNow=off     the page exactly as today (no press)
//   ?trainNow=locked  the state right after a press
// #6139: the race selection panel (GET /api/races/:id/selection) follows the same
// state: after a press the riders that trained are locked, a rider bought after the
// press is free (trainNowSelectionPreview below).
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
    // #6139: the preview seed's race ("race-up-1" in seedData.js).
    todayRaces: [{ id: "race-up-1", name: "Tour de Preview" }],
  };
}

type SelectionBody = { riders?: Array<{ id: string }>; selection?: { rider_ids?: string[] } | null } & Record<string, unknown>;

// #6139: fictional preview riders (the names from the owner-approved mockup), so the
// panel shows both sides of the lock: two selected riders who trained, one bought
// and one moved up after the press. Preview only; prod data never passes here.
const PREVIEW_RIDER = { primaryType: "rouleur", secondaryType: null, suitability: 60, stageSuitability: null,
  aggression: 50, tactics: 50, form: 55, fatigue: 20, injured: false, abilities: null };
const PREVIEW_EXTRA = [
  { id: "preview-6139-trained-1", name: "A. Vandenberg", selected: true },
  { id: "preview-6139-trained-2", name: "M. Rasmussen", selected: true },
  { id: "preview-6139-bought", name: "L. Moreau", selected: false },
  { id: "preview-6139-moved", name: "J. Okafor", selected: false },
];

/**
 * #6139: after a press, the riders who trained are locked for today's race. In the
 * preview the selected riders trained, and the riders outside the selection play the
 * ones bought or moved after the press (no lock). Before the press: no lock.
 */
export function trainNowSelectionPreview(body: SelectionBody): SelectionBody {
  if (!Array.isArray(body?.riders)) return body;
  const selected = [...(body.selection?.rider_ids ?? []), ...PREVIEW_EXTRA.filter((r) => r.selected).map((r) => r.id)];
  const withExtra: SelectionBody = {
    ...body,
    riders: [...body.riders, ...PREVIEW_EXTRA.map(({ id, name }) => ({ ...PREVIEW_RIDER, id, name }))],
    selection: body.selection ? { ...body.selection, rider_ids: selected } : body.selection,
  };
  const { locked, lockedAt } = status();
  if (mode() === "off" || !locked) return withExtra;
  const trained = new Set(selected);
  return {
    ...withExtra,
    riders: (withExtra.riders ?? []).map((rider) => ({ ...rider, trainNowLocked: trained.has(rider.id) })),
    trainNowLock: { riderIds: [...trained].sort(), pressedAt: lockedAt },
  };
}

type BoardBody = { columns?: Array<{ id: string; selection?: { rider_ids?: string[] } | null } & Record<string, unknown>> } & Record<string, unknown>;
type SeasonBody = { riders?: Array<{ id: string }>; races?: Array<{ id: string }> } & Record<string, unknown>;

/**
 * #6383: the day board follows the same state as the selection panel. After a press the
 * first two preview riders trained today: the lock is on the two races that share the day
 * (one of the two is already in the squad, the other is not). Before the press: no lock.
 */
export function trainNowBoardPreview(body: BoardBody): BoardBody {
  const { locked, lockedAt } = status();
  if (mode() === "off" || !locked || !Array.isArray(body?.columns)) return body;
  const riders = (body.columns[0]?.riders as Array<{ id: string }> | undefined) ?? [];
  const first = body.columns[0]?.selection?.rider_ids?.[0];
  const second = riders.find((r) => r.id !== first)?.id;
  const trained = [first, second].filter((id): id is string => !!id).sort();
  return {
    ...body,
    columns: body.columns.map((col, i) => (i < 2 ? { ...col, trainNowLock: { riderIds: trained, pressedAt: lockedAt } } : col)),
  };
}

/** #6383: the season matrix gets the same lock, on the first race of the preview season. */
export function trainNowSeasonPreview(body: SeasonBody): SeasonBody {
  const { locked, lockedAt } = status();
  if (mode() === "off" || !locked || !Array.isArray(body?.riders) || !Array.isArray(body?.races)) return body;
  // One rider with a squad spot (shows locked and filled), one without (shows locked and empty).
  const trained = [body.riders[1], body.riders[4]].filter(Boolean).map((r) => r.id).sort();
  return {
    ...body,
    trainNowLockByRace: Object.fromEntries(
      body.races.slice(0, 1).map((race) => [race.id, { riderIds: trained, pressedAt: lockedAt }]),
    ),
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
