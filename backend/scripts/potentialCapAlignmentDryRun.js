/**
 * #3503 · Dry-run: hvad sker der hvis potentiale-tallet følger det opnåede loft?
 *
 * READ-ONLY. Ingen writes overhovedet.
 *
 * Baggrund: `buildCapsForRider` sætter loftet til `Math.max(tapered, current)`
 * (riderProgression.js). Gulvet er bevidst — ingen spiller må miste evne han
 * ejer — men konsekvensen er at en rytter der overhaler sit potentiale-loft får
 * loftet med sig permanent. Så kan en 4-stjernet have et toploft på 99, mens
 * seks-stjernede ligger på 88. Stjernen er korrekt afledt af potentialet; det er
 * loftet der er løbet fra det.
 *
 * I1-definitionen (målt 11/8, gengivet her): rytterens HØJESTE lagrede cap må
 * ikke overstige det interpolerede loftByPotential({1:35 … 6:88}).
 *
 * Dette script svarer på: hvis vi lader potentiale-TALLET følge loftet i stedet
 * for at håndhæve loftet nedad — hvem flytter sig, hvor mange stjerner, og hvad
 * gør det ved base_value? (v4 er potentiale-monoton, så værdien stiger.)
 *
 *   node scripts/potentialCapAlignmentDryRun.js            # oversigt
 *   node scripts/potentialCapAlignmentDryRun.js --managers # + pr. manager
 *   node scripts/potentialCapAlignmentDryRun.js --json
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAllRows, fetchAllRowsChunkedIn } from '../lib/supabasePagination.js';
import { predictBaseValue } from '../lib/riderValuation.js';
import { ageForSeason } from '../lib/riderSeasonAge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL_V4 = JSON.parse(fs.readFileSync(path.join(__dirname, '../lib/riderValuationModelV4.json'), 'utf8'));

// Samme anker-tabel som PROGRESSION_CONFIG.loftByPotential (riderProgression.js).
// Gentaget her BEVIDST som en ren tabel, så inversionen nedenfor kan læses uden
// at kende motorens interne konfiguration — værdierne er ejer-låste ankre (spec §5).
const LOFT = { 1: 35, 2: 48, 3: 60, 4: 70, 5: 80, 6: 88 };

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function loftForPotential(p) {
  const v = clamp(Number(p) || 1, 1, 6);
  const lo = Math.floor(v), hi = Math.ceil(v);
  return LOFT[lo] + (LOFT[hi] - LOFT[lo]) * (v - lo);
}

// Inversion: hvilket potentiale ville give præcis dette loft? Tabellen er
// monotont stigende, så en simpel segment-søgning er eksakt.
function potentialForLoft(cap) {
  const c = Number(cap);
  if (!Number.isFinite(c)) return null;
  if (c <= LOFT[1]) return 1;
  if (c >= LOFT[6]) return 6;
  for (let lo = 1; lo < 6; lo++) {
    const a = LOFT[lo], b = LOFT[lo + 1];
    if (c >= a && c <= b) return lo + (c - a) / (b - a);
  }
  return 6;
}

// Stjernen spilleren ser er potentialet afrundet til nærmeste hele (1-6).
const stars = (p) => clamp(Math.round(Number(p) || 1), 1, 6);

const wantManagers = process.argv.includes('--managers');
const wantJson = process.argv.includes('--json');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  const { data: seasonRow } = await supabase.from('seasons').select('number').eq('status', 'active').maybeSingle();
  const season = seasonRow?.number ?? 1;

  const riders = await fetchAllRows(() =>
    supabase
      .from('riders')
      .select('id, firstname, lastname, potentiale, birthdate, primary_type, secondary_type, valuation_type, team_id, base_value')
      .eq('is_retired', false)
      .order('id')
  );
  const teams = await fetchAllRows(() => supabase.from('teams').select('id, name, is_ai, is_bank').order('id'));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const abil = await fetchAllRowsChunkedIn(riders.map((r) => r.id), (chunk) =>
    supabase.from('rider_derived_abilities').select('*').in('rider_id', chunk).order('rider_id')
  );
  const abilByRider = new Map(abil.map((a) => [a.rider_id, a]));

  const moved = [];
  let measured = 0, breached = 0, humanMeasured = 0, humanBreached = 0;

  for (const rider of riders) {
    const row = abilByRider.get(rider.id);
    if (!row?.ability_caps || rider.potentiale == null) continue;
    measured++;
    const team = rider.team_id ? teamById.get(rider.team_id) : null;
    const human = !!team && team.is_ai === false && team.is_bank !== true;
    if (human) humanMeasured++;

    const caps = Object.values(row.ability_caps).map(Number).filter(Number.isFinite);
    if (!caps.length) continue;
    const topCap = Math.max(...caps);
    const loft = loftForPotential(rider.potentiale);
    if (topCap <= loft + 0.5) continue; // I1 overholdt

    breached++;
    if (human) humanBreached++;

    const newPot = potentialForLoft(topCap);
    const age = ageForSeason(rider.birthdate, season);
    const before = predictBaseValue({ ...rider, age, potentiale: rider.potentiale }, row, MODEL_V4);
    const after = predictBaseValue({ ...rider, age, potentiale: newPot }, row, MODEL_V4);

    moved.push({
      rider_id: rider.id,
      name: `${rider.firstname ?? ''} ${rider.lastname ?? ''}`.trim(),
      team: team?.name ?? '(ingen)',
      human,
      age,
      pot_before: Number(rider.potentiale),
      pot_after: newPot,
      stars_before: stars(rider.potentiale),
      stars_after: stars(newPot),
      top_cap: topCap,
      loft_before: loft,
      value_before: before,
      value_after: after,
      value_delta: before != null && after != null ? after - before : null,
    });
  }

  const humanMoved = moved.filter((m) => m.human);
  const starSteps = new Map();
  for (const m of humanMoved) {
    const step = m.stars_after - m.stars_before;
    starSteps.set(step, (starSteps.get(step) ?? 0) + 1);
  }
  const sumDelta = (list) => list.reduce((n, m) => n + (m.value_delta ?? 0), 0);
  const sumBefore = (list) => list.reduce((n, m) => n + (m.value_before ?? 0), 0);

  if (wantJson) {
    console.log(JSON.stringify({ measured, breached, humanMeasured, humanBreached, moved }, null, 2));
    return;
  }

  const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)} %` : '—');
  const cz = (n) => `${Math.round(n).toLocaleString('da-DK')} CZ$`;

  console.log('=== #3503 dry-run · potentiale-tallet følger det opnåede loft ===');
  console.log('READ-ONLY. Intet er ændret.\n');
  console.log(`Ryttere målt:            ${measured}`);
  console.log(`Bryder I1 (top-cap > loft): ${breached} (${pct(breached, measured)})`);
  console.log(`  heraf spiller-ejede:   ${humanBreached} af ${humanMeasured} (${pct(humanBreached, humanMeasured)})\n`);

  console.log('Stjerne-flytning (spiller-ejede):');
  [...starSteps.entries()].sort((a, b) => a[0] - b[0]).forEach(([step, n]) => {
    const label = step === 0 ? 'uændret stjerne' : `+${step} stjerne${step > 1 ? 'r' : ''}`;
    console.log(`  ${label.padEnd(18)} ${String(n).padStart(5)} ryttere`);
  });

  const dHuman = sumDelta(humanMoved);
  const bHuman = sumBefore(humanMoved);
  console.log('\nBase_value-effekt (v4 er potentiale-monoton — værdien KAN kun stige):');
  console.log(`  spiller-ejede berørte: ${cz(bHuman)} → ${cz(bHuman + dHuman)}  (${dHuman >= 0 ? '+' : ''}${cz(dHuman)}, ${pct(dHuman, bHuman)})`);
  const dAll = sumDelta(moved);
  console.log(`  alle berørte:          ${dAll >= 0 ? '+' : ''}${cz(dAll)}`);
  console.log('  NB: market_value blander base_value med markedsmodellen (global_weight < 1,0 indtil 23/8),');
  console.log('      så den spillervendte prisflytning er MINDRE end tallet ovenfor indtil cutover.');

  // Den afgørende kobling: beslutning 1's tillæg (spec §6 trin 1) skal PRESSE
  // potentiale-overskuddet ned mod planens ~1,4 % pot 5-6. Denne rettelse
  // trækker den anden vej, så størrelsen af modtrækket skal kendes FØR valget.
  const potBefore = new Map(), potAfter = new Map();
  const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
  for (const rider of riders) {
    if (rider.potentiale == null || !abilByRider.get(rider.id)?.ability_caps) continue;
    const m = moved.find((x) => x.rider_id === rider.id);
    bump(potBefore, stars(rider.potentiale));
    bump(potAfter, stars(m ? m.pot_after : rider.potentiale));
  }
  const high = (map) => (map.get(5) ?? 0) + (map.get(6) ?? 0);
  console.log('\nPotentiale-fordeling, HELE bestanden (kobling til beslutning 1s udligning):');
  for (let s = 1; s <= 6; s++) {
    console.log(`  ${s}★  ${String(potBefore.get(s) ?? 0).padStart(5)} → ${String(potAfter.get(s) ?? 0).padStart(5)}`);
  }
  console.log(
    `  pot 5-6 i alt: ${pct(high(potBefore), measured)} → ${pct(high(potAfter), measured)} ` +
      `(planens mål: ~1,4 %)`
  );

  const top = [...humanMoved].sort((a, b) => (b.value_delta ?? 0) - (a.value_delta ?? 0)).slice(0, 10);
  console.log('\nStørste enkelt-flytninger (spiller-ejede):');
  for (const m of top) {
    console.log(
      `  ${m.name.padEnd(24)} ${m.team.padEnd(24)} ${m.stars_before}★→${m.stars_after}★ ` +
        `pot ${m.pot_before.toFixed(1)}→${m.pot_after.toFixed(1)} · loft ${m.top_cap.toFixed(0)} · ${m.value_delta >= 0 ? '+' : ''}${cz(m.value_delta ?? 0)}`
    );
  }

  if (wantManagers) {
    const byTeam = new Map();
    for (const m of humanMoved) {
      const cur = byTeam.get(m.team) ?? { n: 0, delta: 0, starUp: 0 };
      cur.n++; cur.delta += m.value_delta ?? 0;
      if (m.stars_after > m.stars_before) cur.starUp++;
      byTeam.set(m.team, cur);
    }
    console.log('\nPr. manager (sorteret efter værdi-flytning):');
    [...byTeam.entries()].sort((a, b) => b[1].delta - a[1].delta).forEach(([name, c]) =>
      console.log(`  ${name.padEnd(30)} ${String(c.n).padStart(3)} ryttere · ${String(c.starUp).padStart(3)} får ny stjerne · +${cz(c.delta)}`)
    );
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
