// #6855 · preview-mock for Kontrakter-fanens to endpoints
// (POST /api/riders/extend-contracts/quote og POST /api/riders/extend-contracts).
// Kun i installPreviewMock.js (VITE_PREVIEW_MOCK), aldrig i prod-bundlen.
//
// Uden den viste fanen sin fejltilstand på preview, fordi der ikke findes en
// backend. Tallene her er preview-tal fra seedet (løn uændret, loftet = aktiv
// sæson + 3 som i backenden); de rigtige tal kommer altid fra
// contractBatchExtension.js.
import { RIDERS, ACTIVE_SEASON } from "./seedData.js";

const MAX_AHEAD = 3;

interface Item { riderId: string; seasons: number }
interface MockResponse { status: number; body: unknown }

function readItems(body: unknown): Item[] {
  const raw = (body as { items?: unknown } | null)?.items;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => ({ riderId: String((x as Item)?.riderId ?? ""), seasons: Number((x as Item)?.seasons) }))
    .filter((x) => x.riderId && Number.isInteger(x.seasons) && x.seasons >= 1 && x.seasons <= MAX_AHEAD);
}

function quote(items: Item[]) {
  const currentSeason = Number((ACTIVE_SEASON as { number?: number }).number ?? 1);
  const maxSeason = currentSeason + MAX_AHEAD;
  const riders: unknown[] = [];
  const errors: unknown[] = [];
  let before = 0;
  let after = 0;
  for (const item of items) {
    const r = (RIDERS as Array<Record<string, unknown>>).find((x) => x.id === item.riderId);
    const end = Number(r?.contract_end_season ?? currentSeason);
    const anchor = Math.max(Number.isFinite(end) ? end : currentSeason, currentSeason);
    const room = Math.max(0, maxSeason - anchor);
    if (room === 0) {
      errors.push({ riderId: item.riderId, errorCode: "contract_extension_cap_reached", errorParams: { maxSeason } });
      continue;
    }
    const granted = Math.min(item.seasons, room);
    const salary = Number(r?.salary ?? 0);
    before += salary;
    after += salary;
    riders.push({
      riderId: item.riderId,
      requestedSeasons: item.seasons,
      grantedSeasons: granted,
      maxSeasons: room,
      capped: granted < item.seasons,
      currentSalary: salary,
      newSalary: salary,
      currentEndSeason: r?.contract_end_season ?? null,
      newEndSeason: anchor + granted,
    });
  }
  return {
    currentSeason,
    maxSeason,
    riders,
    errors,
    totals: { selectedSalaryBefore: before, selectedSalaryAfter: after, teamSalaryBefore: before, teamSalaryAfter: after },
    salaryCap: { active: false, withinCap: true, cap: null },
  };
}

export function contractsBatchMockRoute(method: string, pathname: string, body: unknown): MockResponse | null {
  if (method !== "POST") return null;
  if (pathname.endsWith("/api/riders/extend-contracts/quote")) {
    return { status: 200, body: quote(readItems(body)) };
  }
  if (pathname.endsWith("/api/riders/extend-contracts")) {
    const q = quote(readItems(body));
    if (q.errors.length > 0) return { status: 409, body: { errorCode: "contract_batch_rejected", errors: q.errors } };
    return { status: 200, body: { success: true, ...q } };
  }
  return null;
}
