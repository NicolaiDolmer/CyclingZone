/**
 * [epic #4592 del 2] Parkering af inaktive menneske-hold — CLI (dry-run som
 * default, --apply som eksplicit, adskilt sti).
 *
 * Genbruger UDELUKKENDE `backend/lib/managerParking.js`s rene funktioner
 * (`selectTeamsToPark`, `parkDormantTeams`) — ingen dubleret udvælgelses-
 * eller write-logik her. Reglen (30 dage, ejer-definition 2/9, #4307) bor ét
 * sted: `backend/lib/managerActivity.js`.
 *
 * Dette script er en manuel/observerbar CLI-indgang til den samme logik som
 * cutover-flowet (`economyEngine.js` → `parkDormantTeams`, kaldes KUN når
 * `season_signup_enabled='on'`) allerede bruger ved S4 28/9. Det erstatter
 * IKKE cutover-flowet og skal ikke wires ind i nogen automatisk sweep — det
 * er til ejerens manuelle "vis mig hvad der ville ske / gør det nu"-brug,
 * f.eks. hvis cutoveren skal køres manuelt uden for den normale flow-timing.
 *
 * Sikkerhed:
 *   - default (ingen flag): READ-ONLY. Lister kandidaterne (samme som
 *     `parkingDryRun.js`s "ville parkere"-liste), skriver INTET.
 *   - `--apply`: udfører de faktiske writes via `parkDormantTeams`. Kræver
 *     UDTRYKKELIG bekræftelse (`--yes-i-am-sure`) oveni, ellers exit 1 med
 *     forklaring — to separate flag forhindrer et enkelt copy-paste-uheld.
 *
 *   node backend/scripts/parkInactiveTeams.mjs                        # dry-run, markdown
 *   node backend/scripts/parkInactiveTeams.mjs --json                 # dry-run, maskinlæsbart
 *   node backend/scripts/parkInactiveTeams.mjs --apply --yes-i-am-sure # RIGTIGE writes
 *
 * Kræver SUPABASE_URL + SUPABASE_SERVICE_KEY i miljøet (som øvrige backend/scripts).
 * Kør IKKE --apply mod prod uden ejerens eksplicitte go til netop dette
 * kørselstidspunkt (jf. "ejer ser live-tilstand før store destruktive
 * prod-indgreb" — denne parkering er reversibel/ikke-destruktiv for selve
 * holdet, men rammer stadig en produktions-tilstand mange spillere ser).
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { fetchAllRows, fetchAllRowsChunkedIn } from '../lib/supabasePagination.js';
import { selectTeamsToPark, parkDormantTeams } from '../lib/managerParking.js';
import { daysSinceLastSeen } from '../lib/managerActivity.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const args = process.argv.slice(2);
const wantJson = args.includes('--json');
const wantApply = args.includes('--apply');
const confirmed = args.includes('--yes-i-am-sure');

function fmtDays(d) {
  return d === null ? '—' : d.toFixed(1);
}

async function fetchTeamsAndUsers() {
  const teams = await fetchAllRows(() =>
    supabase
      // schema-columns-ok: parked_at/next_season_signup_at tilføjes af
      // database/2026-09-03-4592-team-parked-at.sql og 2026-09-03-4592-next-
      // season-signup.sql (applies post-merge under #2642); allerede
      // verificeret anvendt i prod via information_schema (2026-09-03),
      // samme kommentar-mønster som managerParking.js's parkDormantTeams.
      .from('teams')
      .select('id, name, division, league_division_id, user_id, is_ai, is_bank, is_test_account, is_frozen, parked_at, next_season_signup_at')
      .eq('is_ai', false)
      .eq('is_bank', false)
      .eq('is_test_account', false)
      .order('id')
  );
  const userIds = [...new Set(teams.map((t) => t.user_id).filter(Boolean))];
  const users = await fetchAllRowsChunkedIn(userIds, (chunk) =>
    supabase.from('users').select('id, last_seen').in('id', chunk).order('id')
  );
  return { teams, users };
}

async function runDryRun() {
  const now = new Date();
  const { teams, users } = await fetchTeamsAndUsers();
  const userById = new Map(users.map((u) => [u.id, u]));
  const candidates = selectTeamsToPark({ teams, users, now });

  const rows = candidates.map((t) => {
    const user = t.user_id ? userById.get(t.user_id) ?? null : null;
    return {
      team_id: t.id,
      name: t.name,
      division: t.division,
      days_since_login: user ? daysSinceLastSeen(user, now) : null,
    };
  }).sort((a, b) => (b.days_since_login ?? Infinity) - (a.days_since_login ?? Infinity));

  if (wantJson) {
    console.log(JSON.stringify({ mode: 'dry-run', generated_at: now.toISOString(), candidates: rows.length, teams: rows }, null, 2));
    return;
  }

  console.log(`=== [epic #4592 del 2] parkInactiveTeams — DRY-RUN (READ-ONLY, ${now.toISOString()}) ===\n`);
  console.log(`Ville parkere ${rows.length} hold ved kørsel med --apply lige nu.\n`);
  for (const r of rows) {
    console.log(`  division ${r.division ?? '—'}  ${fmtDays(r.days_since_login)} dage siden login  ${r.name} (${r.team_id})`);
  }
  console.log('\nIngen writes udført. Kør med --apply --yes-i-am-sure for at parkere disse hold.');
}

async function runApply() {
  if (!confirmed) {
    console.error('--apply kræver også --yes-i-am-sure (to separate flag, forhindrer copy-paste-uheld). Ingen writes udført.');
    process.exit(1);
  }
  const now = new Date();
  const result = await parkDormantTeams({ supabase, now });
  if (wantJson) {
    console.log(JSON.stringify({ mode: 'apply', generated_at: now.toISOString(), ...result }, null, 2));
    return;
  }
  console.log(`=== [epic #4592 del 2] parkInactiveTeams — APPLY (${now.toISOString()}) ===\n`);
  console.log(`Kandidater: ${result.candidates}, parkeret: ${result.parked}, sprunget over/fejlet: ${result.skipped}.`);
  if (result.parkedTeamIds.length) {
    console.log(`Parkerede hold-id'er: ${result.parkedTeamIds.join(', ')}`);
  }
}

async function main() {
  if (wantApply) {
    await runApply();
  } else {
    await runDryRun();
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
