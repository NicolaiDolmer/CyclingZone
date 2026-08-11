/**
 * #3639 · Trænings-slot-rapport (READ-ONLY)
 *
 * Backwards-check: hvem står lige nu i et træningsfokus uden hovedrum, hvilke
 * managere er ramt, og hvor længe har slot'et været dødt?
 *
 * Kører præcis den samme logik som vagten (lib/trainingSlotHealth.js) og fladen
 * (cappedVisibleAbilities) — derfor kan rapportens tal og spillerens skærm ikke
 * divergere. Ingen writes overhovedet.
 *
 *   node scripts/trainingSlotHealthReport.js            # oversigt
 *   node scripts/trainingSlotHealthReport.js --teams    # + pr. hold
 *   node scripts/trainingSlotHealthReport.js --json     # maskinlæsbart
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { fetchAllRowsChunkedIn } from '../lib/supabasePagination.js';
import { cappedVisibleAbilities, TRAINING_FOCUSES, smartDefaultFocus } from '../lib/training.js';
import { focusSlotState, computeTrainingSlotHealth } from '../lib/trainingSlotHealth.js';
import { fetchSlotHealthInputs } from '../lib/trainingSlotHealthWatch.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const wantTeams = process.argv.includes('--teams');
const wantJson = process.argv.includes('--json');

function pct(n, d) {
  return d > 0 ? `${((100 * n) / d).toFixed(1)} %` : '—';
}

async function main() {
  const inputs = await fetchSlotHealthInputs(supabase);
  const { rows, totals } = computeTrainingSlotHealth(inputs);

  // Pr-rytter-detaljer til backwards-checket. Genbruger de allerede hentede
  // inputs; eneste ekstra læsning er hold-navne + plan-alder.
  const cappedByRider = new Map(inputs.abilityRows.map((r) => [r.rider_id, cappedVisibleAbilities(r)]));
  const riderIds = inputs.riders.map((r) => r.id);

  const riderRows = await fetchAllRowsChunkedIn(riderIds, (chunk) =>
    supabase.from('riders').select('id, firstname, lastname, team_id').in('id', chunk).order('id')
  );
  const riderMeta = new Map(riderRows.map((r) => [r.id, r]));
  const teamRows = await fetchAllRowsChunkedIn(
    [...new Set(riderRows.map((r) => r.team_id).filter(Boolean))],
    (chunk) => supabase.from('teams').select('id, name').in('id', chunk).order('id')
  );
  const teamName = new Map(teamRows.map((t) => [t.id, t.name]));

  // Hvor længe har slot'et været dødt? training_plans.updated_at er nærmeste
  // proxy: tidspunktet spilleren sidst rørte planen. Den er en UNDERgrænse —
  // evnen kan have ramt loftet senere — men den siger hvor længe spilleren har
  // ladet rytteren stå i fokusset uden at få noget.
  // Sorteret STIGENDE på updated_at, så den sidst skrevne værdi pr. rytter vinder
  // i map'et. Uden den sortering afgjorde chunk-rækkefølgen hvilken sæsons
  // plan-række der blev målt på, og alderen blev tilfældig.
  const planRows = await fetchAllRowsChunkedIn(riderIds, (chunk) =>
    supabase
      .from('training_plans')
      .select('rider_id, focus, updated_at')
      .in('rider_id', chunk)
      .order('updated_at', { ascending: true })
  );
  const planUpdatedAt = new Map(planRows.map((p) => [p.rider_id, p.updated_at]));

  const dead = [];
  const partial = [];
  for (const rider of inputs.riders) {
    const cappedKeys = cappedByRider.get(rider.id);
    if (!cappedKeys) continue;
    const focus = inputs.planByRiderId[rider.id] ?? smartDefaultFocus(rider.primary_type ?? null);
    const state = focusSlotState(focus, cappedKeys);
    if (state !== 'dead' && state !== 'partial') continue;
    const meta = riderMeta.get(rider.id) ?? {};
    const updatedAt = planUpdatedAt.get(rider.id) ?? null;
    const entry = {
      state,
      rider_id: rider.id,
      name: `${meta.firstname ?? ''} ${meta.lastname ?? ''}`.trim(),
      team: teamName.get(meta.team_id) ?? '(intet hold)',
      focus,
      chosen_by_player: inputs.planByRiderId[rider.id] != null,
      capped_abilities: TRAINING_FOCUSES[focus].filter((a) => cappedKeys.includes(a)),
      days_in_focus: updatedAt ? (Date.now() - Date.parse(updatedAt)) / 86_400_000 : null,
    };
    (state === 'dead' ? dead : partial).push(entry);
  }

  if (wantJson) {
    console.log(JSON.stringify({ totals, rows, dead, partial }, null, 2));
    return;
  }

  console.log('=== #3639 · Trænings-slot-rapport (spiller-ejede ryttere) ===\n');
  console.log(`I træning:      ${totals.ridersInTraining}`);
  console.log(`Helt døde:      ${totals.deadSlots} (${pct(totals.deadSlots, totals.ridersInTraining)}) — træningen giver NUL`);
  console.log(`Delvist døde:   ${totals.partialSlots} (${pct(totals.partialSlots, totals.ridersInTraining)}) — mindst én evne står stille\n`);

  console.log('Pr. fokus:');
  for (const r of rows) {
    console.log(
      `  ${r.focus.padEnd(10)} ${String(r.ridersInTraining).padStart(5)} i træning · ` +
        `${String(r.deadSlots).padStart(4)} døde · ${String(r.partialSlots).padStart(4)} delvist`
    );
  }

  const withDays = dead.filter((d) => d.days_in_focus != null);
  if (withDays.length) {
    const sorted = withDays.map((d) => d.days_in_focus).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    console.log(
      `\nHelt døde slots: median ${median.toFixed(1)} dage siden planen sidst blev rørt ` +
        `(længste ${Math.max(...sorted).toFixed(1)} dage).`
    );
  }
  const assistant = dead.filter((d) => !d.chosen_by_player).length;
  console.log(`Heraf ${assistant} hvor det er ASSISTENTENS fokus — spilleren har aldrig valgt det selv.`);

  if (wantTeams) {
    const byTeam = new Map();
    for (const d of [...dead, ...partial]) {
      const cur = byTeam.get(d.team) ?? { dead: 0, partial: 0 };
      if (d.state === 'dead') cur.dead++; else cur.partial++;
      byTeam.set(d.team, cur);
    }
    console.log('\nRamte hold (sorteret efter helt døde slots):');
    [...byTeam.entries()]
      .sort((a, b) => b[1].dead - a[1].dead || b[1].partial - a[1].partial)
      .forEach(([name, c]) => console.log(`  ${name.padEnd(32)} ${String(c.dead).padStart(3)} døde · ${String(c.partial).padStart(3)} delvist`));
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
