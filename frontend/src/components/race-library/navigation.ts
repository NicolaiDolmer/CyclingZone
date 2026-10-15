import type { RaceEditionSummary, LibraryPool } from "../../lib/race-library/types.ts";
type Translate = (key: string, options?: Record<string, unknown>) => string;
export function editionHref(row: RaceEditionSummary, params: URLSearchParams, returnTo?: string) {
  const next = new URLSearchParams(params);
  next.set("raceId", row.id);
  next.set("season", String(row.seasonNumber));
  next.delete("tab");
  if (returnTo) next.set("returnTo", returnTo);
  return "/race-archive/" + encodeURIComponent(row.name) + "?" + next.toString();
}
export function editionDate(row: RaceEditionSummary, locale = "en-GB"): string {
  if (!row.startAt) return "";
  const formatter = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Copenhagen",
  });
  const start = formatter.format(new Date(row.startAt));
  const end = row.endAt ? formatter.format(new Date(row.endAt)) : start;
  return end === start ? start : start + " - " + end;
}

export function libraryPoolLabel(
  id: number | null,
  pools: LibraryPool[],
  t: Translate,
  division = false
): string {
  if (id === null) return t("library.shared");
  const pool = pools.find((p) => p.id === id);
  if (!pool) return t("library.unknown");
  const label = t("library.poolOption", { number: pool.pool_index + 1 });
  return division ? t("library.divisionOption", { number: pool.tier }) + " · " + label : label;
}
