// #4557 (S-M2c) · Rene formaterings-helpers for aarsmoedet. Ingen React,
// samme adskillelse som boardroom/boardroomFormat.js.
import { getBoardGoalLabel } from "../../lib/boardGoalLabel";

// GET /board/meeting's mandat-mål er RAA felter direkte fra
// board_mandates.goals (snake_case: type, target, label, label_key,
// cumulative, race_scope, nationality_code — se boardMandateMeeting.js §4.8),
// modsat /board/room's allerede-camelCasede mandate.goals. getBoardGoalLabel
// er den fælles, type-styrede resolver (lib/boardGoalLabel.js) og forventer
// netop denne snake_case-form, saa intet map-lag er noedvendigt her udover at
// pege paa de rigtige felter.
export function resolveMeetingGoalTitle(t, goal) {
  return getBoardGoalLabel(t, {
    type: goal?.type ?? null,
    target: goal?.target ?? null,
    label: goal?.label ?? "",
    label_key: goal?.label_key ?? null,
    cumulative: goal?.cumulative ?? false,
    race_scope: goal?.race_scope ?? null,
    nationality_code: goal?.nationality_code ?? null,
  });
}

// Samme titel-resolver, men for en af de tre forudberegnede valg
// (options.easier/keep/stretch — kun {target, label, satisfaction_bonus,
// satisfaction_penalty}, spec §4.2). Typen/label_key/etc. arves fra det
// oprindelige mål (kun target + label aendrer sig pr. valg).
export function resolveMeetingGoalOptionTitle(t, goal, option) {
  if (!option) return resolveMeetingGoalTitle(t, goal);
  return getBoardGoalLabel(t, {
    type: goal?.type ?? null,
    target: option.target ?? goal?.target ?? null,
    label: option.label ?? goal?.label ?? "",
    label_key: goal?.label_key ?? null,
    cumulative: goal?.cumulative ?? false,
    race_scope: goal?.race_scope ?? null,
    nationality_code: goal?.nationality_code ?? null,
  });
}

// "Astrid Holm" → "AH" — samme forkortelse som backend allerede bruger til
// mandate.goals[].owner.initials, men reaktionens `memberName` (fra
// sampleVoiceLine) er kun et fornavn+efternavn, ikke et initial-felt.
export function initialsFromName(name) {
  if (!name) return "";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

// N dage tilbage til auto-accept-deadline (rundet op, aldrig negativ — en
// overskredet deadline vises som 0, ikke et negativt tal, mens cron-jobbet
// endnu ikke har naaet at auto-underskrive).
export function daysUntil(iso, now = new Date()) {
  if (!iso) return null;
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return null;
  const diffMs = target - now.getTime();
  return Math.max(0, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
}
