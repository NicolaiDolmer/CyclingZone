// #6150: små visningshjælpere delt af roadmap-fanerne.
import type { RoadmapVote } from "../../lib/roadmapModel.ts";

export type SaveState = "saving" | "saved" | "error";
export type Translate = (key: string, options?: Record<string, unknown>) => string;

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
  return new Intl.DateTimeFormat(isDanish(language) ? "da-DK" : "en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Copenhagen",
  }).format(d);
}

export function areaTitle(t: Translate, key: string): string {
  return t(`engines.${key}.title`);
}

export type VoteMap = Map<string, RoadmapVote>;
