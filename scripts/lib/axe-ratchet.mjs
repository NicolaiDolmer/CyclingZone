// Test infrastructure only. Counts are scoped to exact rule/DOM targets.
export const PROJECTS = ['desktop-chromium', 'mobile-chromium', 'mobile-webkit'];
export const SURFACES = ['dashboard', 'riders', 'rider', 'race', 'tactics', 'training', 'market', 'calendar'];
export const CASE_KEYS = PROJECTS.flatMap(project => SURFACES.map(surface => `${project}/${surface}`));
export const BASELINE_PATH = 'frontend/tests/e2e/axe-baseline.json';

export function fingerprints(violations) {
  const counts = {};
  for (const violation of violations) for (const node of violation.nodes) {
    const key = JSON.stringify([violation.id, node.target]);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}
function validateCounts(counts) {
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) throw Error('Invalid finding counts');
  for (const value of Object.values(counts)) if (!Number.isInteger(value) || value < 1) throw Error('Invalid finding count');
}
export function compareFindings(known, actual) {
  validateCounts(known); validateCounts(actual);
  const added = [], removed = [];
  for (const key of new Set([...Object.keys(known), ...Object.keys(actual)])) {
    const difference = (actual[key] ?? 0) - (known[key] ?? 0);
    if (difference > 0) added.push({ fingerprint: key, count: difference });
    if (difference < 0) removed.push({ fingerprint: key, count: -difference });
  }
  return { added, removed };
}
export function validateBaseline(baseline) {
  if (baseline?.schemaVersion !== 1 || typeof baseline.engineVersion !== 'string' || !baseline.engineVersion) throw Error('Invalid baseline version');
  const keys = Object.keys(baseline.cases ?? {}).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...CASE_KEYS].sort())) throw Error('Incomplete baseline matrix');
  for (const value of Object.values(baseline.cases)) validateCounts(value);
}
export function baselineFromReports(reports) {
  const cases = {}, versions = new Set();
  for (const field of ['runId', 'inputHash', 'revision']) {
    const identities = new Set(reports.map(report => report[field]));
    if (identities.size !== 1 || typeof [...identities][0] !== 'string' || ![...identities][0]) throw Error(`Mixed or missing scan ${field}`);
  }
  for (const report of reports) {
    if (Object.hasOwn(cases, report.key)) throw Error(`duplicate scan: ${report.key}`);
    cases[report.key] = report.findings; versions.add(report.engineVersion);
  }
  if (versions.size !== 1) throw Error('Scan engine version mismatch');
  const baseline = { schemaVersion: 1, engineVersion: [...versions][0], cases: Object.fromEntries(Object.entries(cases).sort()) };
  validateBaseline(baseline);
  return baseline;
}
export function assertNoGrowth(base, proposed) {
  validateBaseline(base); validateBaseline(proposed);
  if (base.engineVersion !== proposed.engineVersion) throw Error('Engine version change requires separate reviewed rebaseline');
  for (const key of CASE_KEYS) if (compareFindings(base.cases[key], proposed.cases[key]).added.length) throw Error(`Baseline growth: ${key}`);
}
export function reduceBaseline(baseline, reports) {
  validateBaseline(baseline);
  const candidate = baselineFromReports(reports);
  if (candidate.engineVersion !== baseline.engineVersion) throw Error('Scan engine version mismatch');
  for (const key of CASE_KEYS) if (compareFindings(baseline.cases[key], candidate.cases[key]).added.length) throw Error(`Cannot accept new findings: ${key}`);
  return candidate;
}
