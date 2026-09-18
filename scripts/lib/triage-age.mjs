// scripts/lib/triage-age.mjs
// ============================================================
// Delt logik for triage:new-alders-guarden (#5329).
//
// WHY: #5329 kraever at "triage:new aeldre end 7 dage"-klassificeringen
// bruges to steder - en selvstaendig CI-guard (scripts/check-triage-age.mjs)
// og et afsnit i soendagens styringsrapport
// (scripts/weekly-steering-report.mjs, #5328 punkt 3). Delt her saa de to
// aldrig kan komme ud af trit (samme graense, samme sortering, samme
// escaping af titler i tabeller).
//
// Intake-gate (docs/WEEKLY_STEERING.md, styringssession 17/9): alle fund fra
// cloud-rutiner og sweeps oprettes med label `triage:new`, ikke
// `claude:todo`. Et issue er foerst "i koeen" naar mandagens styringssession
// har placeret det. Denne fil er REN LOGIK (ingen gh-kald) - execGh-kald
// ligger i kaldstederne, samme idiom som scripts/priority-hygiene.mjs.
//
// Refs #5329 #5328.

export const DEFAULT_TRIAGE_LABEL = 'triage:new';
export const DEFAULT_TRIAGE_AGE_DAYS = 7;

/**
 * Heltalsantal HELE dage mellem `iso` og `now` (>= 0). Samme idiom som
 * priority-hygiene.mjs' daysBetween - holder graenser (--days) forudsigelige.
 * @param {string} iso
 * @param {Date} now
 */
export function daysBetween(iso, now) {
  const then = new Date(iso).getTime();
  const diffMs = now.getTime() - then;
  return Math.max(0, Math.floor(diffMs / 86_400_000));
}

/**
 * Gør en issue-titel sikker i en markdown-tabelcelle: samme escaping som
 * priority-hygiene.mjs' sanitizeTitle (bevidst egen kopi - denne fil har
 * ingen runtime-afhaengighed til andre scripts, kun til lib/). Raekkefoelgen
 * er bindende: backslash foerst (CodeQL #361/#5176-lektion).
 * @param {string} title
 */
export function sanitizeTitle(title) {
  return String(title)
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .replace(/#(\d+)/g, '`#$1`');
}

/**
 * Klassificerer aabne `triage:new`-issues efter alder.
 * @param {Array<{number:number,title:string,createdAt:string,url?:string}>} issues
 * @param {number} days graense (default 7)
 * @param {Date} now
 * @returns {{overdue: object[], withinLimit: object[]}} overdue sorteret aeldst foerst
 */
export function classifyTriageAge(issues, days = DEFAULT_TRIAGE_AGE_DAYS, now = new Date()) {
  const overdue = [];
  const withinLimit = [];
  for (const issue of issues) {
    const daysOpen = daysBetween(issue.createdAt, now);
    const entry = { ...issue, daysOpen };
    if (daysOpen >= days) overdue.push(entry);
    else withinLimit.push(entry);
  }
  overdue.sort((a, b) => b.daysOpen - a.daysOpen);
  return { overdue, withinLimit };
}

/**
 * Markdown-afsnit til brug i baade den selvstaendige guard og styringsrapporten.
 * @param {{overdue: object[], withinLimit: object[], days: number}} opts
 */
export function formatTriageAgeSection({ overdue, withinLimit, days }) {
  const lines = [];
  if (overdue.length === 0) {
    lines.push(`Ingen \`triage:new\`-issues aeldre end ${days} dage. ✅ (${withinLimit.length} inden for graensen.)`);
    return lines.join('\n');
  }
  lines.push(
    `## ${overdue.length} \`triage:new\`-issue(s) aeldre end ${days} dage (kraever placering: bane + \`claude:todo\`, eller \`icebox\` med ejer-go)`,
  );
  lines.push('');
  lines.push('| # | Titel | Dage aaben |');
  lines.push('|---|---|---:|');
  for (const i of overdue) {
    lines.push(`| \`#${i.number}\` | ${sanitizeTitle(i.title)} | ${i.daysOpen} |`);
  }
  return lines.join('\n');
}
