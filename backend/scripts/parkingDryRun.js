/**
 * [epic #4592 del 2] Parkerings-dry-run (READ-ONLY)
 *
 * Printer hvem selectTeamsToPark() VILLE parkere lige nu (managerParking.js —
 * ejer-definition 2/9: 30 dage uden login, ikke frosset, ikke tilmeldt via
 * "Tilmeld dig næste sæson"-knappen) og hvor mange aktive mennesker hver
 * pulje ville have TILBAGE bagefter — samme "aktive mennesker pr. pulje"-tal
 * som dormantTeamsReport.js, men efter den hypotetiske parkering.
 *
 * Ingen writes overhovedet. Selve parkeringen (parkTeam) kaldes ALDRIG herfra.
 *
 *   node scripts/parkingDryRun.js            # markdown til stdout
 *   node scripts/parkingDryRun.js --json      # maskinlæsbart
 *
 * Kræver SUPABASE_URL + SUPABASE_SERVICE_KEY i miljøet (som øvrige backend/scripts).
 * Kør IKKE mod prod uden orkestratorens eksplicitte kommando — se PR-body.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { fetchAllRows, fetchAllRowsChunkedIn } from '../lib/supabasePagination.js';
import { selectTeamsToPark } from '../lib/managerParking.js';
import { daysSinceLastSeen } from '../lib/managerActivity.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const wantJson = process.argv.includes('--json');

function fmtDays(d) {
  return d === null ? '—' : d.toFixed(1);
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

  // Samme "menneskehold"-diskriminator som dormantTeamsReport.js. Bevidst
  // UDEN is_frozen-eksklusion i selve query'en — selectTeamsToPark filtrerer
  // frosne hold fra selv, så vi kan vise dem i totalen ("X frosne, ikke rørt").
  // schema-columns-ok: parked_at/next_season_signup_at kommer fra #4592-
  // migrationerne (applies post-merge, #2642) — manuelt script, fejler højt.
  const teams = await fetchAllRows(() =>
    supabase
      .from('teams')
      .select('id, name, division, league_division_id, user_id, is_frozen, parked_at, next_season_signup_at')
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

  const wouldPark = selectTeamsToPark({ teams, users: userRows, now });
  const wouldParkIds = new Set(wouldPark.map((t) => t.id));
  const userById = new Map(userRows.map((u) => [u.id, u]));

  const rows = teams.map((t) => {
    const pool = poolById.get(t.league_division_id) ?? null;
    const user = t.user_id ? userById.get(t.user_id) ?? null : null;
    return {
      team_id: t.id,
      name: t.name,
      division: t.division,
      pool_id: t.league_division_id,
      pool_label: pool?.label ?? `(ukendt pulje ${t.league_division_id ?? '—'})`,
      is_frozen: !!t.is_frozen,
      already_parked: t.parked_at != null,
      signed_up: t.next_season_signup_at != null,
      days_since_login: user ? daysSinceLastSeen(user, now) : null,
      would_park: wouldParkIds.has(t.id),
    };
  });

  rows.sort((a, b) => {
    if (a.would_park !== b.would_park) return a.would_park ? -1 : 1;
    const ad = a.days_since_login ?? Infinity;
    const bd = b.days_since_login ?? Infinity;
    return bd - ad;
  });

  // Aktive mennesker pr. pulje EFTER den hypotetiske parkering (samme
  // "occupancy frigives"-effekt som parkTeam's league_division_id=null).
  const byPool = new Map();
  for (const t of teams) {
    const key = t.league_division_id ?? `division-${t.division}`;
    if (!byPool.has(key)) {
      const pool = poolById.get(t.league_division_id) ?? null;
      byPool.set(key, {
        division: t.division,
        pool_label: pool?.label ?? `(ukendt pulje ${t.league_division_id ?? '—'})`,
        before: 0,
        after: 0,
        parked: 0,
      });
    }
    const agg = byPool.get(key);
    if (t.parked_at == null) agg.before += 1;
    if (t.parked_at == null && !wouldParkIds.has(t.id)) agg.after += 1;
    if (wouldParkIds.has(t.id)) agg.parked += 1;
  }
  const poolSummaries = [...byPool.values()].sort((a, b) => {
    if (a.division !== b.division) return (a.division ?? 0) - (b.division ?? 0);
    return a.pool_label.localeCompare(b.pool_label);
  });

  if (wantJson) {
    console.log(JSON.stringify({ generated_at: now.toISOString(), teams: rows, pools: poolSummaries, would_park_total: wouldPark.length }, null, 2));
    return;
  }

  console.log(`=== [epic #4592 del 2] Parkerings-DRY-RUN (READ-ONLY, genereret ${now.toISOString()}) ===\n`);
  console.log(`Ville parkere ${wouldPark.length} af ${teams.length} menneskehold ved cutover LIGE NU.\n`);

  console.log('## Aktive mennesker pr. pulje — før / efter hypotetisk parkering\n');
  console.log(
    mdTable(
      ['Division', 'Pulje', 'Aktive hold før', 'Ville parkere', 'Aktive hold efter'],
      poolSummaries.map((p) => [p.division ?? '—', p.pool_label, String(p.before), String(p.parked), String(p.after)])
    )
  );

  console.log('\n## Hold\n');
  console.log(
    mdTable(
      ['Division', 'Pulje', 'Hold', 'Dage siden login', 'Ville parkere', 'Frosset', 'Tilmeldt', 'Allerede parkeret'],
      rows.map((r) => [
        r.division ?? '—',
        r.pool_label,
        r.name,
        fmtDays(r.days_since_login),
        r.would_park ? 'JA' : '',
        r.is_frozen ? 'ja' : '',
        r.signed_up ? 'ja' : '',
        r.already_parked ? 'ja' : '',
      ])
    )
  );
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
