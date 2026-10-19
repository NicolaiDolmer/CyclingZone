#!/usr/bin/env node
// #6859 (owner 18/10): a READY production deploy of a NEWER main SHA that
// contains the target SHA proves the target is live too.
//
// Measured 18/10: Vercel never built a production deploy of exactly a9d79887
// (#6770). It went from the commit before straight to 20d7d5b9, which contains
// a9d79887. deploy-verify looked for the exact SHA only and waited 40 minutes
// to its timeout. Vercel (and Railway) may skip or supersede intermediate
// builds, so "a deploy of exactly this SHA" is too narrow as release evidence.
//
// Coverage rule (fail closed, every doubt = not covered):
//   - candidate != target, both full SHAs;
//   - target is an ancestor of candidate (`git merge-base --is-ancestor`);
//   - candidate is on main (ancestor of refs/remotes/origin/main);
//   - the candidate's deploy is READY (GitHub deployment status `success`,
//     Railway API status `SUCCESS`).
// A failed deploy of the target itself stays a failure; coverage only adds a
// success path for a target that has no READY deploy of its own.
//
// CLI (deploy-verify.yml, "Wait for Vercel + Railway deployments"):
//   node scripts/ci/deploy-coverage.mjs vercel  <target-sha>
//   node scripts/ci/deploy-coverage.mjs railway <target-sha>   # GitHub fallback without RAILWAY_TOKEN
// Prints ONE JSON line: {"covered":true,"sha":"<candidate>","id":<deployment id>}
// or {"covered":false}. Always exits 0; diagnostics go to stderr.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = 'NicolaiDolmer/CyclingZone';
// Same value as ENVIRONMENT in scripts/frontend-freshness.mjs (asserted in
// scripts/ci/deploy-coverage.test.mjs): only the frontend production project.
export const VERCEL_ENVIRONMENT = 'Production – cycling-zone';
export const MAIN_REF = 'refs/remotes/origin/main';
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;

const ok = run => { try { run(); return true; } catch { return false; } };

// Returns covers(candidate) -> boolean. `git(args)` throws on a non-zero exit.
// `refresh()` (git fetch of main) runs at most once per check: a newer main
// commit is usually missing in a checkout made before it was pushed.
export function createCoverageCheck(target, git, refresh) {
  let refreshed = false;
  const present = sha => ok(() => git(['cat-file', '-e', `${sha}^{commit}`]));
  const onMain = sha => ok(() => git(['merge-base', '--is-ancestor', sha, MAIN_REF]));
  return candidate => {
    if (!SHA.test(target ?? '') || !SHA.test(candidate ?? '')) return false;
    if (candidate.toLowerCase() === target.toLowerCase()) return false;
    const evidence = () => present(target) && present(candidate) && onMain(candidate);
    let found = evidence();
    if (!found && !refreshed && typeof refresh === 'function') {
      refreshed = true;
      if (!ok(refresh)) return false;
      found = evidence();
    }
    return found && ok(() => git(['merge-base', '--is-ancestor', target, candidate]));
  };
}

const vercelRow = row => row?.environment === VERCEL_ENVIRONMENT && row?.creator?.login === 'vercel[bot]';
const railwayRow = row => typeof row?.creator?.login === 'string' && row.creator.login.startsWith('railway');
export const PLATFORMS = {
  vercel: { query: `environment=${encodeURIComponent(VERCEL_ENVIRONMENT)}&per_page=30`, accept: vercelRow },
  railway: { query: 'per_page=100', accept: railwayRow },
};

// Newest READY GitHub deployment of a covering SHA. `api(path)` returns parsed
// JSON (or throws). Unusable evidence is never coverage.
export async function findCoveringDeployment({ platform, target, api, covers }) {
  const spec = PLATFORMS[platform];
  if (!spec || !SHA.test(target ?? '') || typeof covers !== 'function') return { covered: false };
  try {
    const rows = await api(`repos/${REPO}/deployments?${spec.query}`);
    if (!Array.isArray(rows)) return { covered: false };
    const candidates = rows
      .filter(row => spec.accept(row) && SHA.test(row?.sha ?? '') && Number.isSafeInteger(row?.id) && row.id > 0
        && Number.isFinite(Date.parse(row?.created_at)))
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    for (const row of candidates) {
      if (!covers(row.sha)) continue;
      const statuses = await api(`repos/${REPO}/deployments/${row.id}/statuses?per_page=1`);
      if (Array.isArray(statuses) && statuses[0]?.state === 'success') return { covered: true, sha: row.sha, id: row.id };
    }
    return { covered: false };
  } catch {
    return { covered: false };
  }
}

// Git adapter for CI and for scripts/railway-deploy-status.mjs. The checkout in
// deploy-verify.yml has persist-credentials: false; the repo is public, so an
// anonymous fetch of main works.
export function gitCoverageCheck(target, { cwd = process.cwd() } = {}) {
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const refresh = () => git(['fetch', '--quiet', '--no-tags', 'origin', `+refs/heads/main:${MAIN_REF}`]);
  return createCoverageCheck(target, git, refresh);
}

async function main(argv) {
  const [platform, target] = argv;
  const api = async path => JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  const result = await findCoveringDeployment({ platform, target, api, covers: gitCoverageCheck(target) });
  if (result.covered) console.error(`[deploy-coverage] ${platform}: READY deploy ${result.sha.slice(0, 7)} (id ${result.id}) contains ${String(target).slice(0, 7)}`);
  console.log(JSON.stringify(result));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(() => console.log(JSON.stringify({ covered: false })));
}
