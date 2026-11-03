#!/usr/bin/env node
// Main-only ordering gate. Never grants a PENDING flag exception (#7348).
// Mirrors auto-migrate.yml's push filter; unknown history/API state fails closed.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function hasMigrationChanges(paths) {
  return paths.some((path) => /^database\/2026-[^/]*\.sql$/.test(path));
}

const mainPush = (run) => run.head_branch === 'main' && run.event === 'push';

function settled(run, label) {
  if (!run || run.status !== 'completed') return 'pending';
  if (run.conclusion !== 'success') throw new Error(`Auto-migrate did not succeed for ${label}: ${run.conclusion}`);
  return 'success';
}

export function migrationVerdict(runs, sha, isAncestor = () => false) {
  const matching = runs.filter((run) => run.head_sha === sha && mainPush(run));
  // Prefer a newer run when a workflow was re-triggered for this SHA.
  const run = matching.sort((a, b) => b.id - a.id)[0];
  if (run?.status === 'completed' && run.conclusion === 'cancelled') {
    // auto-migrate.yml's concurrency group cancels a pending run when another
    // queues behind it; that successor applies every pending file, ours included.
    // Only the first later main push run that contains this SHA may release us.
    const successor = runs
      .filter((other) => mainPush(other) && other.id > run.id && other.head_sha !== sha && isAncestor(sha, other.head_sha))
      .sort((a, b) => a.id - b.id)[0];
    return settled(successor, `${sha} (cancelled; successor ${successor?.head_sha ?? 'not started'})`);
  }
  return settled(run, sha);
}

export async function waitForMigration({ sha, listRuns, sleep, isAncestor, attempts = 80 }) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (migrationVerdict(await listRuns(), sha, isAncestor) === 'success') return;
    if (attempt + 1 < attempts) await sleep();
  }
  throw new Error(`Timed out waiting for successful Auto-migrate for ${sha} (Auto-migrate may still be queued behind earlier migration merges)`);
}

export async function verifyMigrationOrder(paths, options) {
  if (!hasMigrationChanges(paths)) return;
  await waitForMigration(options);
}

export async function main(env = process.env) {
  if (env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF !== 'refs/heads/main') {
    throw new Error('Migration ordering gate requires a main push');
  }
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const sha = env.GITHUB_SHA;
  if (!/^[a-f0-9]{40}$/.test(sha ?? '') || event.after !== sha
      || !/^[a-f0-9]{40}$/.test(event.before ?? '') || /^0+$/.test(event.before)) {
    throw new Error('Missing or inconsistent push SHA range');
  }
  // Full history checkout makes multi-commit pushes and non-migration commits
  // independent of the latest Auto-migrate run on some other SHA.
  const paths = execFileSync('git', ['diff', '--name-only', '-z', '--no-renames', event.before, sha, '--', 'database'],
    { encoding: 'utf8' }).split('\0');
  if (!hasMigrationChanges(paths)) {
    console.log('No auto-migration changes in this push; strict flag check can run immediately.');
    return;
  }
  if (!env.GH_TOKEN) throw new Error('GH_TOKEN is required to observe Auto-migrate');
  if (!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? '')) throw new Error('Invalid repository');
  // No head_sha filter: a cancelled run is released by a later run on another SHA.
  const url = `https://api.github.com/repos/${env.GITHUB_REPOSITORY}/actions/workflows/auto-migrate.yml/runs?branch=main&event=push&per_page=100`;
  await verifyMigrationOrder(paths, {
    sha,
    isAncestor: (ancestor, descendant) => {
      try {
        execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    },
    listRuns: async () => {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`Cannot observe Auto-migrate: HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data.workflow_runs)) throw new Error('Invalid Auto-migrate response');
      return data.workflow_runs;
    },
    sleep: () => new Promise((resolve) => setTimeout(resolve, 15_000)),
  });
  console.log(`Auto-migrate succeeded for ${sha}; strict flag verification follows.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
