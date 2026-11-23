// #6150: små visningshjælpere delt af roadmap-fanerne.
import { parseHorizon, type RoadmapVote } from "../../lib/roadmapModel.ts";
import { intlLocale } from "../../lib/intlLocale.ts";

import { resolveRoadmapCategory, roadmapCategoryLabel } from "../../lib/roadmapVoting.js";

export function itemCategoryTitle(item: { engine: string; category?: string | null }, language: string | undefined): string {
  return roadmapCategoryLabel(resolveRoadmapCategory(item), language);
}

function dayMonth(key: string): string {
  const [, month, day] = key.split("-").map(Number);
  return day + "/" + month;
}

export function formatRoadmapHorizon(horizon: string | null | undefined, language: string | undefined): string {
  const value = parseHorizon(horizon);
  const da = isDanish(language);
  switch (value.kind) {
    case "week":
      return (da ? "Uge " : "Week ") + value.week + " (" + dayMonth(value.start) + "-" + dayMonth(value.end) + ")";
    case "date":
      return new Intl.DateTimeFormat(intlLocale(language), {
        day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
      }).format(new Date(value.date));
    case "season": {
      const season = (da ? "Sæson " : "Season ") + value.season;
      return value.start ? (da ? "Starten af sæson " : "Start of season ") + value.season : season;
    }
    case "quarter": return "Q" + value.quarter + " " + value.year;
    case "year": return String(value.year);
    default: return "";
  }
}

export type SaveState = "saving" | "saved" | "error";
export type Translate = { (key: string): string; (key: string, opts: Record<string, unknown>): string };

export function isDanish(language: string | undefined): boolean {
  return !!language?.startsWith("da");
}

export function localTitle(row: { title_en: string; title_da: string }, language: string | undefined): string {
  return isDanish(language) ? row.title_da || row.title_en : row.title_en;
}

export function localBody(row: { body_en: string; body_da: string }, language: string | undefined): string {
  return isDanish(language) ? row.body_da || row.body_en : row.body_en;
}

/** Dag + kort måned uden årstal ("1 Oct" / "1. okt."). Ugyldig dato giver tom tekst. */
export function shortDate(iso: string | null | undefined, language: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(intlLocale(language), {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Copenhagen",
  }).format(d);
}

/**
 * Datointerval fra to datonøgler ("2026-11-02", "2026-11-08") som "2–8 Nov" /
 * "2.–8. nov.". Nøglerne er rene datoer, så de formateres i UTC (ingen tidszone-skred).
 */
export function dateRange(start: string, end: string, language: string | undefined): string {
  const a = new Date(`${start}T00:00:00Z`);
  const b = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return "";
  const fmt = new Intl.DateTimeFormat(intlLocale(language), { day: "numeric", month: "short", timeZone: "UTC" });
  return typeof fmt.formatRange === "function" ? fmt.formatRange(a, b) : `${fmt.format(a)} – ${fmt.format(b)}`;
}

export function areaTitle(t: Translate, key: string): string {
  return t(`engines.${key}.title`);
}

export type VoteMap = Map<string, RoadmapVote>;
