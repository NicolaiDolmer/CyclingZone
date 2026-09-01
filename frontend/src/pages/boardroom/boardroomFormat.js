// #4557 · Delte formaterings-helpers for Boardroom-siden. Ren funktion,
// ingen React — genbruges af ConfidenceCard/MandateCard/BoardCard/MemberPanel
// så "Sun 30 Aug"-stilen kun defineres ét sted.
import { formatDate } from "../../lib/intl";
import { getBoardGoalLabel } from "../../lib/boardGoalLabel";

// "Sun 30 Aug" — weekday + dag + kort maaned, lokaliseret via Intl (samme
// mekanisme som lib/intl.js's øvrige helpers).
export function formatWeekdayShortDate(date) {
  if (!date) return "";
  return formatDate(date, null, { weekday: "short", day: "numeric", month: "short" });
}

// "28 Aug" — dag + kort maaned uden ugedag (mandat-underskrift, milepaele).
export function formatShortDate(date) {
  if (!date) return "";
  return formatDate(date, null, { day: "numeric", month: "short" });
}

// Kun ugedagen ("Sun", "Sat", "Wed") — referat-feedets kompakte tidsstempel.
export function formatWeekdayOnly(date) {
  if (!date) return "";
  return formatDate(date, null, { weekday: "short" });
}

// #4557 (orkestrator-afgørelse efter #4570-afstemning) · mål-rækkens titel
// SKAL vises som hel saetning ("At least 3 race wins"), ikke goalType-
// korttitler. Genbruger den EKSISTERENDE type-styrede resolver
// (lib/boardGoalLabel.js) i stedet for at opfinde en ny — samme kilde som
// BoardPage. `goal.labelKey` (kontraktens navn) er fallback naar `type`
// mangler eller ikke er en kendt type: resolveren tjekker selv `label_key`
// naar det type-styrede spor ikke matcher.
export function resolveGoalTitle(t, goal) {
  return getBoardGoalLabel(t, {
    type: goal.type ?? null,
    target: goal.target ?? null,
    label: goal.label ?? "",
    label_key: goal.labelKey ?? null,
    cumulative: goal.cumulative ?? false,
    race_scope: goal.raceScope ?? null,
    nationality_code: goal.nationalityCode ?? null,
  });
}
