/**
 * Sprint-metrics snapshot (#476).
 *
 * Kalder `get_sprint_metrics('sprint')` via service-role-key og opdaterer
 * `docs/SPRINT_DASHBOARD.md` Game-metrics-tabel + "Sidste opdatering"-linje.
 *
 * Skriver kun til disk hvis indholdet faktisk ændrer sig — så GHA-workflowet
 * kan diffe og kun åbne PR ved reelle ændringer. Skipper "Paying users"-rækken
 * (hardcoded 0 indtil post-day-30 Go-beslutning).
 *
 * Kør lokalt: `SUPABASE_URL=<your-url> SUPABASE_SERVICE_KEY=<your-key> node scripts/snapshot-sprint-metrics.mjs`
 * Kør i GHA:  `.github/workflows/sprint-metrics-snapshot.yml`
 */

import { createClient } from '@supabase/supabase-js';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');
const DASHBOARD_PATH = resolve(REPO_ROOT, 'docs', 'SPRINT_DASHBOARD.md');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('[snapshot-sprint-metrics] SUPABASE_URL or SUPABASE_SERVICE_KEY missing.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const numberFmt = new Intl.NumberFormat('en-US');

const fmtNumber = (n) => (n == null ? '—' : numberFmt.format(n));
const fmtPct = (n) => (n == null ? '—' : `${n}%`);
const fmtSecs = (n) => {
  if (n == null || n === 0) return '—';
  if (n < 60) return `${n}s`;
  const m = Math.floor(n / 60);
  const s = n % 60;
  if (m < 60) return s === 0 ? `${m}m` : `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}t ${m % 60}m`;
};

function fmtTrend(curr, prev, formatter) {
  if (curr == null || prev == null) return '—';
  if (curr === prev) return '→ ±0';
  const arrow = curr > prev ? '▲' : '▼';
  const sign = curr > prev ? '+' : '−';
  const delta = Math.abs(curr - prev);
  return `${arrow} ${sign}${formatter(delta)}`;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replace the "Nu" and "Trend (7d)" cells for a given metric row.
 * Markdown row format: `| <label> | <nu> | <trend> | <note> |`
 * Preserves the Note column verbatim.
 */
function updateMetricRow(content, label, nuCell, trendCell) {
  const re = new RegExp(
    `^(\\| ${escapeRegex(label)} \\|)([^|\\n]*)\\|([^|\\n]*)\\|([^\\n]*)$`,
    'm',
  );
  if (!re.test(content)) {
    console.warn(`[snapshot-sprint-metrics] Row not found in dashboard: "${label}"`);
    return content;
  }
  return content.replace(re, `$1 ${nuCell} | ${trendCell} |$4`);
}

async function fetchMetrics() {
  const { data, error } = await supabase.rpc('get_sprint_metrics', { p_window: 'sprint' });
  if (error) {
    throw new Error(`get_sprint_metrics('sprint') failed: ${error.message}`);
  }
  if (!data) {
    throw new Error('get_sprint_metrics returned null payload');
  }
  return data;
}

async function main() {
  console.log('=== Sprint Metrics Snapshot (#476) ===');
  const m = await fetchMetrics();

  console.log('Fetched metrics:', JSON.stringify({
    window: m.window,
    total_registered: m.total_registered,
    dau: m.dau,
    wau: m.wau,
    mau: m.mau,
    d7_retention_pct: m.d7_retention_pct,
    avg_session_secs: m.avg_session_secs,
  }, null, 2));

  const original = await readFile(DASHBOARD_PATH, 'utf8');
  let updated = original;

  updated = updateMetricRow(updated, 'Total registered players',
    fmtNumber(m.total_registered), '—');
  updated = updateMetricRow(updated, 'Daily active players (DAU)',
    fmtNumber(m.dau), fmtTrend(m.dau, m.dau_prev, fmtNumber));
  updated = updateMetricRow(updated, 'Weekly active players (WAU)',
    fmtNumber(m.wau), fmtTrend(m.wau, m.wau_prev, fmtNumber));
  updated = updateMetricRow(updated, 'Monthly active players (MAU)',
    fmtNumber(m.mau), fmtTrend(m.mau, m.mau_prev, fmtNumber));
  updated = updateMetricRow(updated, 'Returning testers (D7)',
    fmtPct(m.d7_retention_pct), fmtTrend(m.d7_retention_pct, m.d7_retention_prev_pct, fmtPct));
  updated = updateMetricRow(updated, 'Avg session length',
    fmtSecs(m.avg_session_secs), fmtTrend(m.avg_session_secs, m.avg_session_secs_prev, fmtSecs));

  const metricsChanged = updated !== original;
  if (!metricsChanged) {
    console.log('[snapshot-sprint-metrics] No metric changes — skipping write.');
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  updated = updated.replace(
    /^> \*\*Sidste opdatering:\*\* .*$/m,
    `> **Sidste opdatering:** ${today} (auto-snapshot via [\`sprint-metrics-snapshot.yml\`](../.github/workflows/sprint-metrics-snapshot.yml) — #476)`,
  );

  await writeFile(DASHBOARD_PATH, updated);
  console.log(`[snapshot-sprint-metrics] Wrote ${DASHBOARD_PATH}`);
}

main().catch((err) => {
  console.error('[snapshot-sprint-metrics] FATAL:', err.message);
  process.exit(1);
});
