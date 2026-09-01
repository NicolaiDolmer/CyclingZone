// #4557 · Delte formaterings-helpers for Boardroom-siden. Ren funktion,
// ingen React — genbruges af ConfidenceCard/MandateCard/BoardCard/MemberPanel
// så "Sun 30 Aug"-stilen kun defineres ét sted.
import { formatDate } from "../../lib/intl";

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
