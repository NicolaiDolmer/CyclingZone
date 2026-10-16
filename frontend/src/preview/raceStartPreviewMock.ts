// #6740 preview (VITE_PREVIEW_MOCK only, tree-shaken from prod): the owner checks the
// "team does not start" and "rider injured" states on a Vercel preview without prod data.
//   ?raceStart=injured  first race on the day board: its first selected rider is injured
//                       (Injured badge, and the column says the team will not start)
//   ?raceStart=dns      first race has started, the team was removed at the start
//                       (Did not start instead of Lineup locked)
//   ?raceStart=short    first race: 6 selected, one injured, no free riders. Rule B: the
//                       column says the team starts with 5 (#6740 PR 2)
// Both modes also put the two new inbox messages at the top of the inbox.

type Column = { id: string; name?: string; selection?: { rider_ids?: string[] } | null; riders?: Array<{ id: string } & Record<string, unknown>> } & Record<string, unknown>;
type BoardBody = { columns?: Column[] } & Record<string, unknown>;

function mode(): string | null {
  try {
    return new URLSearchParams(window.location.search).get("raceStart");
  } catch {
    return null;
  }
}

export function raceStartBoardPreview(body: BoardBody): BoardBody {
  const m = mode();
  if ((m !== "injured" && m !== "dns" && m !== "short") || !Array.isArray(body?.columns) || !body.columns.length) return body;
  const [first, ...rest] = body.columns;
  if (m === "short") {
    // The board reads the roster from the first column, so six selected riders and nobody else = no free riders.
    const base = first.riders?.[0] ?? { id: "rider-1" };
    const riders = Array.from({ length: 6 }, (_, i) => ({ ...base, id: i === 0 ? base.id : `preview-short-${i + 1}`, injured: i === 0 }));
    const counts = { ...(first.counts as Record<string, unknown> ?? {}), selected: 6 };
    return { ...body, columns: [{ ...first, riders, counts, selection: { ...(first.selection ?? {}), rider_ids: riders.map((r) => r.id) } }, ...rest] };
  }
  if (m === "dns") {
    return { ...body, columns: [{ ...first, lineup_locked: true, stages_completed: 1, did_not_start: true }, ...rest] };
  }
  const injuredId = first.selection?.rider_ids?.[0];
  const riders = (first.riders ?? []).map((r) => (r.id === injuredId ? { ...r, injured: true } : r));
  return { ...body, columns: [{ ...first, riders }, ...rest] };
}

/** The two new inbox messages, built like the backend builds them (raceAvailabilityNotifications.js). */
export function raceStartPreviewNotifications(userId: string): Array<Record<string, unknown>> {
  const m = mode();
  if (m !== "injured" && m !== "dns") return [];
  const now = Date.now();
  return [
    {
      id: "prev-6740-dns", user_id: userId, type: "selection_warning", related_id: "race-up-1", is_read: false,
      created_at: new Date(now - 60_000).toISOString(),
      title: "Your team did not start",
      message: "Your team did not start Tour de Preview: fewer than 6 fit riders at the start.",
      metadata: {
        raceId: "race-up-1", titleCode: "notif.teamDidNotStart.title", titleParams: {},
        messageCode: "notif.teamDidNotStart.message", messageParams: { race: "Tour de Preview", min: 6 },
      },
    },
    {
      id: "prev-6740-injured", user_id: userId, type: "selection_warning", related_id: "race-up-1", is_read: false,
      created_at: new Date(now - 8 * 3600_000).toISOString(),
      title: "Rider injured",
      message: "A. Vandenberg crashed in Westkust Klassieker and is injured until 19/10. He will not ride Tour de Preview.",
      metadata: {
        raceId: "race-up-1", titleCode: "notif.riderInjured.title", titleParams: {},
        messageCode: "notif.riderInjured.messageMissed",
        messageParams: { rider: "A. Vandenberg", race: "Westkust Klassieker", until: "19/10", missed: "Tour de Preview" },
      },
    },
  ];
}
