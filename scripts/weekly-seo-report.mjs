// GitHub issue evidence, not an assertion that Lighthouse measured healthy scores.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const executeFile = promisify(execFile);
const REPOSITORY = 'NicolaiDolmer/CyclingZone';
const ISSUE_LIMIT = 100;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

async function readGithub(args) {
  const { stdout } = await executeFile('gh', args, {
    encoding: 'utf8', timeout: 10_000, maxBuffer: 1_048_576, windowsHide: true,
  });
  return stdout;
}

export async function readWeeklySeoDrops({ now, runGh = readGithub }) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('Weekly SEO evidence requires an explicit valid now.');
  }
  const end = now.getTime();
  const start = end - WEEK_MS;
  const since = new Date(start).toISOString();
  const until = now.toISOString();
  const unknown = (status) => ({ status, since, until, issues: null });
  try {
    const rows = JSON.parse(await runGh([
      'issue', 'list', '--repo', REPOSITORY, '--label', 'perf-seo-drop',
      '--state', 'all', '--search', `created:>=${since.slice(0, 10)}`,
      '--json', 'number,url,state,createdAt', '--limit', String(ISSUE_LIMIT),
    ]));
    if (!Array.isArray(rows)) return unknown('unavailable');
    for (const row of rows) {
      if (!Number.isSafeInteger(row?.number) || row.number < 1 ||
          row.url !== `https://github.com/${REPOSITORY}/issues/${row.number}` ||
          !['OPEN', 'CLOSED'].includes(row.state) ||
          typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))) {
        return unknown('unavailable');
      }
    }
    if (rows.length >= ISSUE_LIMIT) return unknown('incomplete');
    const unique = new Map();
    for (const row of rows) {
      const created = Date.parse(row.createdAt);
      if (created >= start && created <= end) unique.set(row.number, {
        number: row.number, url: row.url, state: row.state, createdAt: row.createdAt,
      });
    }
    const issues = [...unique.values()].sort((a, b) =>
      Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.number - a.number);
    return { status: 'complete', since, until, issues };
  } catch {
    // Missing CLI/login/network or malformed output is unknown, never a zero count.
    return unknown('unavailable');
  }
}

export function renderWeeklySeoDrops(result) {
  if (result?.status === 'incomplete') return 'SEO-fald-issues: ufuldstændig GitHub-liste; antal ukendt.';
  if (result?.status !== 'complete' || !Array.isArray(result.issues)) {
    return 'SEO-fald-issues: ukendt (GitHub-kilden kunne ikke læses).';
  }
  return [
    '## SEO-fald-issues, seneste 7 dage',
    `${result.issues.length} oprettede issues i perioden ${result.since} til ${result.until}.`,
    ...result.issues.map((issue) => `- [#${issue.number}](${issue.url}) (${issue.state})`),
  ].join('\n');
}
