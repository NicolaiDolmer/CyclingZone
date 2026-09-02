/**
 * [epic #4592] Inaktiv manager (S3-forberedelse) · Dormant-hold-rapport (READ-ONLY)
 *
 * Lister menneske-hold pr. division/pulje med last_seen, dage siden login og
 * dormancy-bucket (managerActivity.js — ejer-definition 2/9: 30 dage uden
 * login = inaktiv), og opsummerer "aktive mennesker pr. pulje" (active_7d).
 *
 * Kører KUN som read-only rapport til ejerens beslutningsgrundlag før S4
 * (28/9) — parkerer eller rører INGEN hold. Ingen writes overhovedet.
 *
 * "Menneske-hold" = is_ai=false, is_bank=false, is_test_account=false (samme
 * diskriminator som betaResetService/academyIntake/retentionScorecard).
 * is_frozen EKSKLUDERES bevidst ikke fra tallet her (til forskel fra de
 * scripts) — formålet er netop at se hvor mange af de reelle hold der
 * allerede er frosset, som del af S4-beslutningsgrundlaget.
 *
 *   node scripts/dormantTeamsReport.js            # markdown til stdout
 *   node scripts/dormantTeamsReport.js --json      # maskinlæsbart
 *
 * Kræver SUPABASE_URL + SUPABASE_SERVICE_KEY i miljøet (som øvrige backend/scripts).
 * Kør IKKE mod prod uden orkestratorens eksplicitte kommando — se PR-body.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { fetchAllRows, fetchAllRowsChunkedIn } from '../lib/supabasePagination.js';
import { daysSinceLastSeen, dormancyBucket } from '../lib/managerActivity.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const wantJson = process.argv.includes('--json');

const BUCKET_LABEL = {
  active_7d: 'aktiv (≤7d)',
  away_8_30d: 'væk (8-30d)',
  dormant_30d: 'inaktiv (≥30d)',
};

function fmtDays(d) {
  return d === null ? '—' : d.toFixed(1);
}

function fmtDate(iso) {
  return iso ? iso.slice(0, 10) : '(aldrig)';
}

function mdTable(headers, rows) {
  const line = (cells) => `| ${cells.join(' | ')} |`;
  return [
    line(headers),
    line(headers.map(() => '---')),
    ...rows.map(line),
  ].join('\n');
}

async function main() {
  const now = new Date();

  // Real menneske-hold — samme filter som betaResetService/academyIntake,
  // bevidst UDEN is_frozen-eksklusion (se filhoved).
  const teams = await fetchAllRows(() =>
    supabase
      .from('teams')
      .select('id, name, division, league_division_id, user_id, is_frozen')
      .eq('is_ai', false)
      .eq('is_bank', false)
      .eq('is_test_account', false)
      .order('id')
  );

  const poolRows = await fetchAllRows(() =>
    supabase.from('league_divisions').select('id, tier, pool_index, label').order('id')
  );
  const poolById = new Map(poolRows.map((p) => [p.id, p]));

  const userIds = [...new Set(teams.map((t) => t.user_id).filter(Boolean))];
  const userRows = await fetchAllRowsChunkedIn(userIds, (chunk) =>
    supabase.from('users').select('id, last_seen').in('id', chunk).order('id')
  );
  const userById = new Map(userRows.map((u) => [u.id, u]));

  const enriched = teams.map((t) => {
    const pool = poolById.get(t.league_division_id) ?? null;
    const user = t.user_id ? userById.get(t.user_id) ?? null : null;
    const days = user ? daysSinceLastSeen(user, now) : null;
    const bucket = dormancyBucket(user, now);
    return {
      team_id: t.id,
      name: t.name,
      division: t.division,
      pool_id: t.league_division_id,
      pool_label: pool?.label ?? `(ukendt pulje ${t.league_division_id ?? '—'})`,
      pool_index: pool?.pool_index ?? null,
      is_frozen: !!t.is_frozen,
      has_user: !!t.user_id,
      last_seen: user?.last_seen ?? null,
      days_since_login: days,
      bucket,
    };
  });

  // Sortér: division, pulje, dage siden login (mest inaktiv først).
  enriched.sort((a, b) => {
    if (a.division !== b.division) return (a.division ?? 0) - (b.division ?? 0);
    if (a.pool_label !== b.pool_label) return a.pool_label.localeCompare(b.pool_label);
    const ad = a.days_since_login ?? Infinity;
    const bd = b.days_since_login ?? Infinity;
    return bd - ad;
  });

  // Opsummering pr. pulje.
  const byPool = new Map();
  for (const row of enriched) {
    const key = row.pool_id ?? `division-${row.division}`;
    if (!byPool.has(key)) {
      byPool.set(key, {
        division: row.division,
        pool_label: row.pool_label,
        total: 0,
        active_7d: 0,
        away_8_30d: 0,
        dormant_30d: 0,
        frozen: 0,
      });
    }
    const agg = byPool.get(key);
    agg.total++;
    agg[row.bucket]++;
    if (row.is_frozen) agg.frozen++;
  }
  const poolSummaries = [...byPool.values()].sort((a, b) => {
    if (a.division !== b.division) return (a.division ?? 0) - (b.division ?? 0);
    return a.pool_label.localeCompare(b.pool_label);
  });

  const totals = poolSummaries.reduce(
    (acc, p) => {
      acc.total += p.total;
      acc.active_7d += p.active_7d;
      acc.away_8_30d += p.away_8_30d;
      acc.dormant_30d += p.dormant_30d;
      acc.frozen += p.frozen;
      return acc;
    },
    { total: 0, active_7d: 0, away_8_30d: 0, dormant_30d: 0, frozen: 0 }
  );

  if (wantJson) {
    console.log(JSON.stringify({ generated_at: now.toISOString(), teams: enriched, pools: poolSummaries, totals }, null, 2));
    return;
  }

  console.log(`=== [epic #4592] Dormant-hold-rapport (READ-ONLY, genereret ${now.toISOString()}) ===\n`);

  console.log('## Aktive mennesker pr. pulje\n');
  console.log(
    mdTable(
      ['Division', 'Pulje', 'Hold', 'Aktiv (≤7d)', 'Væk (8-30d)', 'Inaktiv (≥30d)', 'Heraf frosset'],
      poolSummaries.map((p) => [
        p.division ?? '—',
        p.pool_label,
        String(p.total),
        String(p.active_7d),
        String(p.away_8_30d),
        String(p.dormant_30d),
        String(p.frozen),
      ])
    )
  );
  console.log(
    `\n**Total:** ${totals.total} menneske-hold — ${totals.active_7d} aktive (≤7d), ` +
      `${totals.away_8_30d} væk (8-30d), ${totals.dormant_30d} inaktive (≥30d, ejer-definition #4307), ` +
      `${totals.frozen} allerede frosset.\n`
  );

  console.log('## Hold pr. division/pulje\n');
  console.log(
    mdTable(
      ['Division', 'Pulje', 'Hold', 'Last seen', 'Dage siden login', 'Status', 'Frosset'],
      enriched.map((r) => [
        r.division ?? '—',
        r.pool_label,
        r.name,
        fmtDate(r.last_seen),
        fmtDays(r.days_since_login),
        BUCKET_LABEL[r.bucket] ?? r.bucket,
        r.is_frozen ? 'ja' : '',
      ])
    )
  );
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
