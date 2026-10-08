import { needsFrontendBuild } from '../frontend/scripts/vercel-build-decision.ts';

export const REPO = 'NicolaiDolmer/CyclingZone';
const ENVIRONMENT = 'Production – cycling-zone';
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const unknown = () => ({ state: 'unknown', reason: 'Freshness evidence unavailable or incomplete' });

export async function assessFrontendFreshness(version, target, git, observe) {
  if (!SHA.test(version?.release ?? '') || !SHA.test(target ?? '')) return unknown();
  const served = version.release;
  if (served === target) return { state: 'current' };
  try {
    git(['merge-base', '--is-ancestor', served, target]);
    const changed = (from, to) => git(['diff', '--name-only', '--no-renames', '-z', from, to, '--']).split('\0').filter(Boolean);
    if (!needsFrontendBuild(changed(served, target))) return { state: 'intentionally-unchanged' };
    const commits = git(['rev-list', '--ancestry-path', `${served}..${target}`]).trim().split(/\r?\n/).filter(Boolean);
    if (!commits.includes(target) || commits.length > 64 || commits.some(sha => !SHA.test(sha))) return unknown();
    for (const sha of commits) {
      // A build at an earlier commit can cover later independent changes.
      // Never accept a build missing any newer frontend input.
      if (needsFrontendBuild(changed(sha, target))) continue;
      const evidence = await observe(sha);
      if (evidence?.complete !== true || !['building', 'absent'].includes(evidence.state)) return unknown();
      if (evidence.state === 'building') return { state: 'building', buildSha: sha };
    }
    return { state: 'stale', reason: 'Frontend inputs changed with no observed covering build' };
  } catch { return unknown(); }
}

export async function readProductionBuildState(sha, api) {
  const unavailable = () => ({ complete: false, state: 'unknown' });
  try {
    const rows = await api(`repos/${REPO}/deployments?sha=${sha}&environment=${encodeURIComponent(ENVIRONMENT)}&per_page=100`);
    if (!Array.isArray(rows) || rows.length >= 100) return unavailable();
    if (!rows.length) return { complete: true, state: 'absent' };
    if (rows.some(row => row?.sha !== sha || row.environment !== ENVIRONMENT || row.creator?.login !== 'vercel[bot]'
      || !Number.isSafeInteger(row.id) || row.id <= 0 || !Number.isFinite(Date.parse(row.created_at)))) return unavailable();
    const latest = [...rows].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
    const statuses = await api(`repos/${REPO}/deployments/${latest.id}/statuses?per_page=100`);
    if (!Array.isArray(statuses) || !statuses.length || statuses.length >= 100) return unavailable();
    const state = statuses[0]?.state;
    if (['queued', 'pending', 'in_progress'].includes(state)) return { complete: true, state: 'building' };
    if (['success', 'failure', 'error', 'inactive'].includes(state)) return { complete: true, state: 'absent' };
    return unavailable();
  } catch { return unavailable(); }
}

export async function probeFrontendFreshness({ readMain, readVersion, git, observe }) {
  try {
    const target = await readMain();
    const result = await assessFrontendFreshness(await readVersion(), target, git, observe);
    if (await readMain() !== target) return unknown();
    return { ...result, target };
  } catch { return unknown(); }
}

