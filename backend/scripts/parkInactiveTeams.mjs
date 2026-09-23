/**
 * [epic #4592 del 2] Parkerings-sweep — CLI (dry-run som default, --apply som
 * eksplicit, adskilt sti).
 *
 * Genbruger UDELUKKENDE `backend/lib/managerParking.js` — ingen dubleret
 * udvælgelses- eller write-logik her. Reglen (30 dage, ejer-definition 2/9,
 * #4307) bor ét sted: `backend/lib/managerActivity.js`.
 *
 * Dette script er en manuel/observerbar CLI-indgang til PRÆCIS den sweep som
 * cutover-flowet (`economyEngine.processSeasonEnd` → `runParkingSweep`, kun
 * når `season_signup_enabled='on'`) kører ved sæsonskiftet:
 *   1. parkér inaktive hold (aldrig et hold med beskyttende abonnement)
 *   2. genindplacér parkerede hold hvis manager har tilmeldt sig igen
 *   3. nulstil next_season_signup_at
 * Det erstatter IKKE cutover-flowet og skal ikke wires ind i nogen automatisk
 * sweep — det er til ejerens manuelle "vis mig hvad der ville ske / gør det
 * nu"-brug, f.eks. hvis cutoveren skal køres manuelt uden for den normale
 * flow-timing. Trin 3 gør --apply til en SÆSONSKIFTE-handling: kør den ikke
 * midt i en sæson, så tabes spillernes tilmeldinger.
 *
 * Sikkerhed:
 *   - default (ingen flag): READ-ONLY. Lister kandidaterne, skriver INTET.
 *     Den fulde rapport (pr. division, puljestørrelser) er scripts/parkingDryRun.js.
 *   - `--apply`: udfører sweepen via `runParkingSweep`. Kræver UDTRYKKELIG
 *     bekræftelse (`--yes-i-am-sure`) oveni, ellers exit 1 med forklaring —
 *     to separate flag forhindrer et enkelt copy-paste-uheld.
 *
 *   node backend/scripts/parkInactiveTeams.mjs                        # dry-run, markdown
 *   node backend/scripts/parkInactiveTeams.mjs --json                 # dry-run, maskinlæsbart
 *   node backend/scripts/parkInactiveTeams.mjs --apply --yes-i-am-sure # RIGTIGE writes
 *
 * Kræver SUPABASE_URL + SUPABASE_SERVICE_KEY i miljøet (som øvrige backend/scripts).
 * Kør IKKE --apply mod prod uden ejerens eksplicitte go til netop dette
 * kørselstidspunkt (jf. "ejer ser live-tilstand før store destruktive
 * prod-indgreb" — parkeringen er reversibel/ikke-destruktiv for selve
 * holdet, men rammer stadig en produktions-tilstand mange spillere ser).
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import {
  loadParkingInputs,
  runParkingSweep,
  selectActiveSubscriptionTeamIds,
  selectTeamsToPark,
  selectTeamsToUnpark,
} from '../lib/managerParking.js';
import { daysSinceLastSeen } from '../lib/managerActivity.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const args = process.argv.slice(2);
const wantJson = args.includes('--json');
const wantApply = args.includes('--apply');
const confirmed = args.includes('--yes-i-am-sure');

function fmtDays(d) {
  return d === null ? '—' : d.toFixed(1);
}

async function runDryRun() {
  const now = new Date();
  const { teams, users, subscriptions } = await loadParkingInputs({ supabase });
  const userById = new Map(users.map((u) => [u.id, u]));
  const activeSubscriptionTeamIds = selectActiveSubscriptionTeamIds(subscriptions, now);
  const candidates = selectTeamsToPark({ teams, users, now, activeSubscriptionTeamIds });
  const candidateIds = new Set(candidates.map((t) => t.id));
  const subscriptionSkipped = selectTeamsToPark({ teams, users, now }).filter((t) => !candidateIds.has(t.id));
  const toUnpark = selectTeamsToUnpark({ teams });

  const toRow = (t) => {
    const user = t.user_id ? userById.get(t.user_id) ?? null : null;
    return {
      team_id: t.id,
      name: t.name,
      division: t.division,
      days_since_login: user ? daysSinceLastSeen(user, now) : null,
    };
  };
  const byDays = (a, b) => (b.days_since_login ?? Infinity) - (a.days_since_login ?? Infinity);
  const rows = candidates.map(toRow).sort(byDays);
  const skippedRows = subscriptionSkipped.map(toRow).sort(byDays);
  const unparkRows = toUnpark.map(toRow);

  if (wantJson) {
    console.log(JSON.stringify({
      mode: 'dry-run',
      generated_at: now.toISOString(),
      candidates: rows.length,
      teams: rows,
      subscription_skipped: skippedRows,
      unpark_candidates: unparkRows,
    }, null, 2));
    return;
  }

  console.log(`=== [epic #4592 del 2] parkInactiveTeams — DRY-RUN (READ-ONLY, ${now.toISOString()}) ===\n`);
  console.log(`Ville parkere ${rows.length} hold ved kørsel med --apply lige nu.\n`);
  for (const r of rows) {
    console.log(`  division ${r.division ?? '—'}  ${fmtDays(r.days_since_login)} dage siden login  ${r.name} (${r.team_id})`);
  }
  console.log(`\nSprunget over pga. abonnement: ${skippedRows.length}.`);
  for (const r of skippedRows) {
    console.log(`  division ${r.division ?? '—'}  ${fmtDays(r.days_since_login)} dage siden login  ${r.name} (${r.team_id})`);
  }
  console.log(`\nVille genindplacere ${unparkRows.length} parkerede hold (manager har tilmeldt sig igen).`);
  for (const r of unparkRows) {
    console.log(`  ${r.name} (${r.team_id})`);
  }
  console.log('\nIngen writes udført. Puljer og placeringer: scripts/parkingDryRun.js. Kør med --apply --yes-i-am-sure for at køre sweepen.');
}

async function runApply() {
  if (!confirmed) {
    console.error('--apply kræver også --yes-i-am-sure (to separate flag, forhindrer copy-paste-uheld). Ingen writes udført.');
    process.exit(1);
  }
  const now = new Date();
  const result = await runParkingSweep({ supabase, now });
  if (wantJson) {
    console.log(JSON.stringify({ mode: 'apply', generated_at: now.toISOString(), ...result }, null, 2));
    return;
  }
  const { park, unpark } = result;
  console.log(`=== [epic #4592 del 2] parkInactiveTeams — APPLY (${now.toISOString()}) ===\n`);
  console.log(`Parkering: kandidater ${park.candidates}, parkeret ${park.parked}, sprunget over/fejlet ${park.skipped}, beskyttet af abonnement ${park.subscriptionProtectedTeamIds.length}.`);
  if (park.parkedTeamIds.length) {
    console.log(`Parkerede hold-id'er: ${park.parkedTeamIds.join(', ')}`);
  }
  console.log(`Genindplacering: kandidater ${unpark.candidates}, genindplaceret ${unpark.unparked}, fejlet ${unpark.failedTeamIds.length}.`);
  for (const pl of unpark.placements) {
    console.log(`  ${pl.teamId} → division ${pl.division}, pulje ${pl.leagueDivisionId ?? '—'}`);
  }
  console.log(result.signupsResetError
    ? `Nulstilling af tilmeldinger FEJLEDE: ${result.signupsResetError}`
    : `Tilmeldinger nulstillet: ${result.signupsReset}.`);
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
