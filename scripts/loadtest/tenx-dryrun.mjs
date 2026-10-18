/**
 * #6275 · 1x mod 10x i løbsdags-dry-run'en (backend/scripts/loadtestRaceDay.mjs).
 *
 *   node scripts/loadtest/tenx-dryrun.mjs                 # skala 1 og 10, markdown
 *   node scripts/loadtest/tenx-dryrun.mjs --scales 1,2,10 --json
 *
 * Ingen netværk, ingen DB: den ægte stage-scheduler kører mod dry-run'ens tællende
 * in-memory Supabase, og etapeafviklingen er dens kalibrerede omkostningsmodel.
 *
 * Hvad "skala N" betyder her (og hvad den IKKE betyder):
 *   - holdene vokser N gange: N × hold pr. seniorpulje og N × ungdomsgrupper (ungdom
 *     følger antallet af hold, YOUTH_GROUP_SIZE pr. gruppe). Aftentræningen afregner
 *     pr. hold og vokser derfor N gange.
 *   - seniorpyramiden (SENIOR_CALENDAR_POOLS_FROM_S4) er en konstant i koden og vokser
 *     IKKE. Ved 10x spillere i virkeligheden kommer der flere puljer og dermed flere
 *     seniorløb; dry-run'en undervurderer altså seniordelen af 10x.
 *   - ungdomsgrupperne er de puljer, der vokser, og de rammer den globale daglige
 *     etape-cap (MAX_STAGES_PER_DAY) på samme måde, som flere seniorpuljer ville.
 */
import { pathToFileURL } from 'node:url';
import { simulateRaceDay, COST_PROFILES, DEFAULT_LIMITS } from '../../backend/scripts/loadtestRaceDay.mjs';

export const BASE = Object.freeze({ teamsPerSeniorPool: 20, youthGroups: 10 });
export const USAGE = 'node scripts/loadtest/tenx-dryrun.mjs [--scales 1,10] [--scenario normal|season-last-day] [--json]';

export function parseArgs(argv) {
  const errors = [];
  const options = { scales: [1, 10], scenario: 'normal', json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') { options.json = true; continue; }
    if (arg !== '--scales' && arg !== '--scenario') { errors.push(`USAGE_UNKNOWN_ARG:${arg}`); continue; }
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) { errors.push(`USAGE_MISSING_VALUE:${arg.slice(2)}`); continue; }
    if (arg === '--scales') {
      const list = value.split(',').map((s) => s.trim());
      if (list.length && list.every((s) => /^[1-9]\d?$/.test(s) && Number(s) <= 20)) options.scales = [...new Set(list.map(Number))];
      else errors.push('USAGE_INVALID_SCALES');
    } else if (value === 'normal' || value === 'season-last-day') options.scenario = value;
    else errors.push('USAGE_INVALID_SCENARIO');
  }
  return { errors, options };
}

/**
 * Skala -> dry-run-parametre. simulateRaceDay kaldes direkte, så CLI'ens loft på 40
 * ungdomsgrupper/hold pr. pulje gælder ikke her (skala ≤ 20 holder tallene små).
 */
export function paramsForScale(scale) {
  return {
    teamsPerSeniorPool: BASE.teamsPerSeniorPool * scale,
    youthGroups: BASE.youthGroups * scale,
  };
}

export function summarize(scale, result) {
  const m = result.metrics;
  const check = (id) => result.checks.find((c) => c.id === id);
  return {
    scale,
    passed: result.passed,
    teams: m.teams,
    stagesExpected: m.stagesExpected,
    stagesRan: m.stagesRan,
    missing: m.missing,
    dailyStageCap: m.dailyStageCap,
    peakCallsPerMinute: m.peakCallsPerMinute,
    peakLimit: DEFAULT_LIMITS.maxBackendCallsPerMinute,
    maxTickDurationMs: m.maxTickDurationMs,
    stageDelayMsMax: m.stageDelayMsMax,
    trainingCloseCalls: m.trainingClose?.calls ?? null,
    trainingCloseMinutes: (() => {
      const job = m.concurrentJobs.find((j) => j.kind === 'training_close');
      return job ? Math.round(job.durationMs / 60000) : null;
    })(),
    failed: result.checks.filter((c) => !c.ok).map((c) => c.id),
    coverageNote: check('coverage')?.note ?? '',
  };
}

export function renderMarkdown(rows, scenario) {
  const lines = [];
  lines.push(`# Dry-run 1x mod 10x (#6275), scenarie ${scenario}`);
  lines.push('');
  lines.push('| Skala | Hold | Etaper kørt/planlagt | Peak kald/min (grænse) | Længste tick ms | Max etape-forsinkelse ms | Aftentræning kald / min (serielt) | Fejlede checks |');
  lines.push('|---:|---:|---|---|---:|---:|---|---|');
  for (const r of rows) {
    lines.push(`| ${r.scale}x | ${r.teams} | ${r.stagesRan}/${r.stagesExpected} | ${r.peakCallsPerMinute} (${r.peakLimit}) | ${r.maxTickDurationMs} | ${r.stageDelayMsMax} | ${r.trainingCloseCalls ?? 'n/a'} / ${r.trainingCloseMinutes ?? 'n/a'} | ${r.failed.join(', ') || 'ingen'} |`);
  }
  lines.push('');
  lines.push(`Daglig etape-cap: ${rows[0]?.dailyStageCap ?? 'n/a'}. Seniorpyramiden er konstant i dry-run'en; se scriptets header.`);
  return lines.join('\n');
}

export async function run(options) {
  const rows = [];
  for (const scale of options.scales) {
    const result = await simulateRaceDay({ scenario: options.scenario, profile: COST_PROFILES.current, ...paramsForScale(scale) });
    rows.push(summarize(scale, result));
  }
  return rows;
}

async function main(argv) {
  const { errors, options } = parseArgs(argv);
  if (errors.length) { process.stderr.write(`${errors.join('\n')}\n${USAGE}\n`); return 2; }
  const rows = await run(options);
  process.stdout.write(`${options.json ? JSON.stringify(rows, null, 2) : renderMarkdown(rows, options.scenario)}\n`);
  return rows.every((r) => r.passed) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => {
    process.stderr.write(`tenx-dryrun: ${err?.stack ?? err}\n`);
    process.exitCode = 1;
  });
}
