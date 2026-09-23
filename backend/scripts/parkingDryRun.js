/**
 * [epic #4592 del 2] Parkerings-dry-run (READ-ONLY)
 *
 * Viser hvad sæsonskiftets parkerings-sweep (managerParking.runParkingSweep)
 * VILLE gøre lige nu, uden at skrive noget:
 *   - pr. division: menneskehold før, parkeret, genindplaceret, efter
 *   - abonnement-skip: hold der ellers var parkeret, men har et beskyttende
 *     abonnement (managerParking.selectActiveSubscriptionTeamIds)
 *   - genindplaceringer: parkerede hold hvis manager har tilmeldt sig igen, og
 *     hvilken pulje de lander i (teamProfileEngine.choosePoolForNewTeam — samme
 *     regel som et nyt hold, simuleret ét hold ad gangen)
 *   - forventet puljestørrelse: pladser optaget pr. pulje før og efter sweepen,
 *     FØR AI-fyldet eventuelt lukker huller (se rækkefølge-valget i PR #4592)
 *
 * Udvælgelsen er de SAMME rene funktioner som sweepen bruger — ingen kopi.
 * Ingen writes overhovedet: parkTeam/unparkTeam/resetSeasonSignups kaldes
 * ALDRIG herfra.
 *
 *   node scripts/parkingDryRun.js            # markdown til stdout
 *   node scripts/parkingDryRun.js --json      # maskinlæsbart
 *
 * Kræver SUPABASE_URL + SUPABASE_SERVICE_KEY i miljøet (som øvrige backend/scripts).
 * Kør IKKE mod prod uden orkestratorens eksplicitte kommando.
 */
import 'dotenv/config';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { fetchAllRows } from '../lib/supabasePagination.js';
import {
  loadParkingInputs,
  selectActiveSubscriptionTeamIds,
  selectTeamsToPark,
  selectTeamsToUnpark,
} from '../lib/managerParking.js';
import { choosePoolForNewTeam, NEW_TEAM_PLACEMENT_TEAM_COLUMNS } from '../lib/teamProfileEngine.js';
import { daysSinceLastSeen } from '../lib/managerActivity.js';
import { MANAGER_ENTRY_DIVISION, MAX_DIVISION, POOL_TARGET_SIZE } from '../lib/economyConstants.js';

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

// Samme "optager en plads"-regel som choosePoolForNewTeam (#4183): alt der ikke
// er banken og ikke er markeret til fjernelse.
function holdsSeat(team) {
  return team.is_bank !== true && team.pending_removal_at == null;
}

/**
 * Ren simulering af sweepen på et øjebliksbillede. Eksporteret så den kan
 * testes uden DB.
 */
export function simulateParkingSweep({ humanTeams, users, subscriptions, pools, seatTeams, now }) {
  const activeSubscriptionTeamIds = selectActiveSubscriptionTeamIds(subscriptions, now);
  const wouldPark = selectTeamsToPark({ teams: humanTeams, users, now, activeSubscriptionTeamIds });
  const wouldParkIds = new Set(wouldPark.map((t) => t.id));
  const subscriptionSkipped = selectTeamsToPark({ teams: humanTeams, users, now })
    .filter((t) => !wouldParkIds.has(t.id));
  const wouldUnpark = selectTeamsToUnpark({ teams: humanTeams });

  // Pladserne efter sweepen: parkering frigør, genindplacering optager — ét
  // hold ad gangen, præcis som unparkSignedUpTeams (pickDivisionForNewTeam
  // læser occupancy forfra før hvert hold).
  const simTeams = seatTeams.map((t) => ({ ...t }));
  const simById = new Map(simTeams.map((t) => [t.id, t]));
  for (const t of wouldPark) {
    const sim = simById.get(t.id);
    if (sim) sim.league_division_id = null;
  }
  const placementPools = pools.filter((p) => p.tier === MANAGER_ENTRY_DIVISION || p.tier === MAX_DIVISION);
  const placements = [];
  for (const t of wouldUnpark) {
    const choice = choosePoolForNewTeam({ pools: placementPools, teams: simTeams });
    const sim = simById.get(t.id);
    if (sim) sim.league_division_id = choice.leagueDivisionId;
    placements.push({ team: t, division: choice.division, leagueDivisionId: choice.leagueDivisionId });
  }

  const poolById = new Map(pools.map((p) => [p.id, p]));
  const occupancy = (teams, poolId) => teams.filter((t) => holdsSeat(t) && t.league_division_id === poolId).length;
  const poolSizes = [...pools]
    .sort((a, b) => (a.tier - b.tier) || (a.pool_index - b.pool_index))
    .map((p) => ({
      pool_id: p.id,
      label: p.label ?? `(pulje ${p.id})`,
      tier: p.tier,
      before: occupancy(seatTeams, p.id),
      after: occupancy(simTeams, p.id),
      parked_out: wouldPark.filter((t) => t.league_division_id === p.id).length,
      placed_in: placements.filter((pl) => pl.leagueDivisionId === p.id).length,
    }));

  const divisions = [...new Set([
    ...humanTeams.map((t) => t.division),
    ...placements.map((pl) => pl.division),
  ].filter((d) => d != null))].sort((a, b) => a - b);
  const activeHuman = (t) => t.parked_at == null;
  const byDivision = divisions.map((division) => {
    const before = humanTeams.filter((t) => activeHuman(t) && t.division === division).length;
    const parked = wouldPark.filter((t) => t.division === division).length;
    const placedIn = placements.filter((pl) => pl.division === division).length;
    return {
      division,
      before,
      parked,
      subscription_skipped: subscriptionSkipped.filter((t) => t.division === division).length,
      placed_in: placedIn,
      after: before - parked + placedIn,
    };
  });

  return { wouldPark, subscriptionSkipped, placements, poolSizes, byDivision, poolById };
}

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const now = new Date();

  // Samme grundlag som sweepen (managerParking.loadParkingInputs).
  const { teams: humanTeams, users, subscriptions } = await loadParkingInputs({ supabase });
  const pools = await fetchAllRows(() =>
    supabase.from('league_divisions').select('id, tier, pool_index, label').order('id')
  );
  // ALLE hold (også AI) — pladser tæller uanset hvem der sidder på dem.
  const seatTeams = await fetchAllRows(() =>
    supabase.from('teams').select(`id, ${NEW_TEAM_PLACEMENT_TEAM_COLUMNS}`).order('id')
  );

  const sim = simulateParkingSweep({ humanTeams, users, subscriptions, pools, seatTeams, now });
  const userById = new Map(users.map((u) => [u.id, u]));
  const poolLabel = (id) => (id == null ? '—' : sim.poolById.get(id)?.label ?? `(ukendt pulje ${id})`);
  const daysFor = (t) => {
    const user = t.user_id ? userById.get(t.user_id) ?? null : null;
    return user ? daysSinceLastSeen(user, now) : null;
  };

  if (wantJson) {
    console.log(JSON.stringify({
      generated_at: now.toISOString(),
      pool_target_size: POOL_TARGET_SIZE,
      by_division: sim.byDivision,
      pools: sim.poolSizes,
      would_park: sim.wouldPark.map((t) => ({ team_id: t.id, name: t.name, division: t.division, pool_id: t.league_division_id, days_since_login: daysFor(t) })),
      subscription_skipped: sim.subscriptionSkipped.map((t) => ({ team_id: t.id, name: t.name, division: t.division, days_since_login: daysFor(t) })),
      placements: sim.placements.map((pl) => ({ team_id: pl.team.id, name: pl.team.name, division: pl.division, pool_id: pl.leagueDivisionId })),
    }, null, 2));
    return;
  }

  console.log(`=== [epic #4592 del 2] Parkerings-DRY-RUN (READ-ONLY, genereret ${now.toISOString()}) ===\n`);
  console.log(`Ville parkere ${sim.wouldPark.length} af ${humanTeams.length} menneskehold, springe ${sim.subscriptionSkipped.length} over pga. abonnement og genindplacere ${sim.placements.length}.\n`);

  console.log('## Pr. division (menneskehold)\n');
  console.log(mdTable(
    ['Division', 'Aktive før', 'Parkeres', 'Abonnement-skip', 'Genindplaceres', 'Aktive efter'],
    sim.byDivision.map((d) => [d.division, d.before, d.parked, d.subscription_skipped, d.placed_in, d.after].map(String)),
  ));

  console.log(`\n## Forventet puljestørrelse (optagne pladser, mål ${POOL_TARGET_SIZE}) — før AI-fyld\n`);
  console.log(mdTable(
    ['Division', 'Pulje', 'Før', 'Parkeret ud', 'Genindplaceret ind', 'Efter sweep', 'Under mål'],
    sim.poolSizes.map((p) => [
      String(p.tier), p.label, String(p.before), String(p.parked_out), String(p.placed_in), String(p.after),
      p.after > 0 && p.after < POOL_TARGET_SIZE ? String(POOL_TARGET_SIZE - p.after) : '',
    ]),
  ));

  console.log('\n## Abonnement-skip (ville ellers være parkeret)\n');
  console.log(sim.subscriptionSkipped.length
    ? mdTable(['Division', 'Pulje', 'Hold', 'Dage siden login'], sim.subscriptionSkipped.map((t) => [
      String(t.division ?? '—'), poolLabel(t.league_division_id), t.name, fmtDays(daysFor(t)),
    ]))
    : '(ingen)');

  console.log('\n## Genindplaceringer (parkeret + tilmeldt igen)\n');
  console.log(sim.placements.length
    ? mdTable(['Hold', 'Ny division', 'Ny pulje'], sim.placements.map((pl) => [
      pl.team.name, String(pl.division), poolLabel(pl.leagueDivisionId),
    ]))
    : '(ingen)');

  console.log('\n## Parkeres\n');
  console.log(sim.wouldPark.length
    ? mdTable(['Division', 'Pulje', 'Hold', 'Dage siden login'], [...sim.wouldPark]
      .sort((a, b) => (daysFor(b) ?? Infinity) - (daysFor(a) ?? Infinity))
      .map((t) => [String(t.division ?? '—'), poolLabel(t.league_division_id), t.name, fmtDays(daysFor(t))]))
    : '(ingen)');
}

// Kun når filen selv er entry-point'et — så simulateParkingSweep kan importeres
// i en test uden at ramme en database (samme main-guard som
// audit-4377-board-goal-counters.js).
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
