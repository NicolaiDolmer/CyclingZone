#!/usr/bin/env node
// Loft-semantik-sammenligning — beslutningsstøtte til ejer-review FØR en model vælges.
// READ-ONLY: kun SELECT mod prod-DB, INGEN writes/migrations/mutationer.
//
// BAGGRUND (verificeret 15/7): to uforenelige loft-semantikker lever side om side i
// riderProgression.js, og hvilken en rytter får afgøres af hvilken kodesti der først
// skrev ability_caps (feltet skrives KUN når NULL og genopbygges aldrig):
//   • buildCaps        → PROGRESSION_CONFIG.headroomByPotential  = headroom OVER baseline
//   • buildYouthCaps   → YOUTH_PROGRESSION_CONFIG.loftByPotential = ABSOLUT loft
// Konsekvens: en pot-4,5-rytter har et højere livstidsloft (813) end den bedste
// pot-6-rytter (737) — potentiale styrer ikke hvor god en rytter kan blive.
//
// Dette script beregner, for hver kandidat-semantik, hvad loftet VILLE være for hele
// den ægte population — så ejeren kan se ordningen FØR noget røres.
//
// Kør: node scripts/capSemanticsComparison.js

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { VISIBLE_ABILITIES } from "../lib/abilityDerivation.js";
import { buildYouthCaps, buildCaps, buildCapsForRider, PROGRESSION_CONFIG } from "../lib/riderProgression.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Mangler SUPABASE_URL / SUPABASE_SERVICE_KEY i backend/.env");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const SEASON1_YEAR = 2026; // jf. riderProgressionEngine.LAUNCH_REFERENCE_YEAR (sæson 1)
const POT_STEPS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6];
const sum = (o) => VISIBLE_ABILITIES.reduce((a, k) => a + (Number(o?.[k]) || 0), 0);

// ── Kandidat-semantikker ──────────────────────────────────────────────────────
// Alle returnerer et fuldt caps-objekt over VISIBLE_ABILITIES.

// A — absolut loft med gulv ved nuværende evne (ejer-valgt 15/7). Kalder den ÆGTE
// motor-funktion, ikke en kopi: scorecardet skal måle det koden faktisk gør.
function capsAbsoluteFloored(rider, abilities) {
  return buildCapsForRider(abilities, rider, rider.primary_type, rider.secondary_type);
}

// A' — absolut loft, men potentiale re-deriveres til det laveste trin hvis loft rummer
// rytterens nuværende evner. Gør feltet konsistent med evne; intet gulv nødvendigt.
function rederivePotential(rider, abilities) {
  for (const p of POT_STEPS) {
    const c = buildYouthCaps(p, rider.primary_type, rider.secondary_type);
    if (VISIBLE_ABILITIES.every((k) => (c[k] ?? 0) >= Math.round(Number(abilities[k]) || 0))) return p;
  }
  return 6;
}
function capsAbsoluteRederived(rider, abilities) {
  return buildYouthCaps(rederivePotential(rider, abilities), rider.primary_type, rider.secondary_type);
}

// B — headroom over baseline (dagens voksen-semantik), anvendt konsekvent på alle.
function capsHeadroom(rider, abilities) {
  return buildCaps(abilities, rider.primary_type, rider.potentiale);
}

const OPTIONS = [
  { key: "nu", label: "Nu (prod) — møntkast mellem de to semantikker", fn: null },
  { key: "A", label: "A — absolut loft + gulv ved nuværende evne", fn: capsAbsoluteFloored },
  { key: "A2", label: "A' — absolut loft + re-deriveret potentiale", fn: capsAbsoluteRederived },
  { key: "B", label: "B — headroom over baseline (alle)", fn: capsHeadroom },
];

async function main() {
  console.log("=== Loft-semantik-sammenligning (READ-ONLY) ===\n");

  const teams = await fetchAllRows(() =>
    supabase.from("teams").select("id,is_ai,is_test_account,is_frozen").order("id")
  );
  const realTeams = new Set(
    teams.filter((t) => !t.is_ai && !t.is_test_account && !t.is_frozen).map((t) => t.id)
  );
  const riders = await fetchAllRows(() =>
    supabase.from("riders")
      .select("id,team_id,birthdate,potentiale,primary_type,secondary_type,is_retired,is_academy")
      .order("id")
  );
  const abRows = await fetchAllRows(() =>
    supabase.from("rider_derived_abilities")
      .select(`rider_id,ability_caps,${VISIBLE_ABILITIES.join(",")}`)
      .order("rider_id")
  );
  const abByRider = new Map(abRows.map((a) => [a.rider_id, a]));

  const pop = riders.filter((r) =>
    !r.is_retired && r.team_id && realTeams.has(r.team_id) &&
    r.potentiale != null && r.primary_type && abByRider.has(r.id)
  );
  console.log(`Population (ægte hold, ikke-pensioneret): ${pop.length} ryttere\n`);

  const rows = [];
  for (const r of pop) {
    const abRow = abByRider.get(r.id);
    const abilities = {};
    for (const k of VISIBLE_ABILITIES) if (abRow[k] != null) abilities[k] = Number(abRow[k]);
    if (Object.keys(abilities).length !== VISIBLE_ABILITIES.length) continue;

    const age = SEASON1_YEAR - new Date(r.birthdate).getFullYear();
    // pot pr. option: alle bruger rytterens nuværende potentiale undtagen A', der
    // re-deriverer det — ordningen SKAL måles mod det potentiale spilleren ser.
    const rec = { pot: Number(r.potentiale), age, cur: sum(abilities), caps: {}, overCap: {}, potBy: {}, headroom: {} };

    for (const o of OPTIONS) {
      const caps = o.fn ? o.fn(r, abilities) : abRow.ability_caps;
      if (!caps || typeof caps !== "object") { rec.caps[o.key] = null; continue; }
      rec.caps[o.key] = sum(caps);
      rec.potBy[o.key] = o.key === "A2" ? rederivePotential(r, abilities) : Number(r.potentiale);
      // Loftet er en LØGN når current strengt overstiger det: rytteren er allerede
      // forbi sit erklærede livstidsloft. (current === cap er legitimt "ved loftet".)
      rec.overCap[o.key] = VISIBLE_ABILITIES.filter((k) => Number(abilities[k]) > Number(caps[k] ?? 0)).length;
      // Tilbageværende udvikling: summen af (loft − current) over evner der KAN vokse.
      // Måler hvor meget spil der er tilbage i rytteren under denne semantik.
      rec.headroom[o.key] = VISIBLE_ABILITIES
        .reduce((a, k) => a + Math.max(0, Number(caps[k] ?? 0) - Number(abilities[k])), 0);
    }
    rows.push(rec);
  }

  const youthAge = rows.filter((r) => r.age >= 16 && r.age <= 21);
  const adults = rows.filter((r) => r.age >= 22);
  // Loftet BINDER kun før peak: stepAbility falder (age > peakAge) uanset loft, så
  // "udvikling tilbage" for en 29-årig er fiktion. Mål kun på 22-28.
  const prePeak = adults.filter((r) => r.age <= PROGRESSION_CONFIG.peakAge);
  console.log(`  16-21: ${youthAge.length}   22+: ${adults.length}   heraf 22-${PROGRESSION_CONFIG.peakAge} (før peak): ${prePeak.length}\n`);

  // ── Scorecard pr. option ────────────────────────────────────────────────────
  const scorecard = [];
  for (const o of OPTIONS) {
    const maxByPot = new Map();
    for (const r of youthAge) {
      const v = r.caps[o.key];
      if (v == null) continue;
      const p = r.potBy[o.key];
      maxByPot.set(p, Math.max(maxByPot.get(p) ?? -1, v));
    }
    const pots = [...maxByPot.keys()].sort((a, b) => a - b);
    let inversions = 0;
    for (let i = 0; i < pots.length; i++)
      for (let j = i + 1; j < pots.length; j++)
        if (maxByPot.get(pots[i]) > maxByPot.get(pots[j])) inversions++;

    const overYouth = youthAge.filter((r) => r.overCap[o.key] > 0).length;
    const overAdult = adults.filter((r) => r.overCap[o.key] > 0).length;
    const pot6max = maxByPot.get(6) ?? null;
    const above6 = youthAge.filter((r) => r.potBy[o.key] < 6 && r.caps[o.key] > (pot6max ?? Infinity)).length;

    scorecard.push({
      option: o.key, label: o.label,
      inversions_pot_pairs: inversions,
      pot6_max_loft: pot6max,
      lavere_pot_over_pot6: above6,
      over_loft_16_21: overYouth, pct_over_16_21: +(100 * overYouth / youthAge.length).toFixed(1),
      over_loft_22plus: overAdult, pct_over_22plus: +(100 * overAdult / adults.length).toFixed(1),
      udvikling_tilbage_16_21: Math.round(youthAge.reduce((a, r) => a + (r.headroom[o.key] ?? 0), 0) / youthAge.length),
      udvikling_tilbage_22_28: Math.round(prePeak.reduce((a, r) => a + (r.headroom[o.key] ?? 0), 0) / prePeak.length),
    });
  }

  console.log("── Scorecard (16-21 med mindre andet er nævnt) ──");
  for (const s of scorecard) {
    console.log(`\n${s.label}`);
    console.log(`  ombytninger i pot-ordning : ${s.inversions_pot_pairs}  (0 = potentiale styrer loftet)`);
    console.log(`  pot 6 max loft            : ${s.pot6_max_loft}`);
    console.log(`  lavere-pot over pot 6     : ${s.lavere_pot_over_pot6} ryttere`);
    console.log(`  over loft 16-21 (løgn)    : ${s.over_loft_16_21} (${s.pct_over_16_21}%)`);
    console.log(`  over loft 22+ (løgn)      : ${s.over_loft_22plus} (${s.pct_over_22plus}%)`);
    console.log(`  udvikling tilbage 16-21   : ${s.udvikling_tilbage_16_21} evne-point/rytter`);
    console.log(`  udvikling tilbage 22-28   : ${s.udvikling_tilbage_22_28} evne-point/rytter (før peak — loftet binder kun her)`);
  }

  // ── Punkt-data til visualisering (unikke pot/loft-par pr. option) ───────────
  const points = {};
  for (const o of OPTIONS) {
    const seen = new Map();
    for (const r of youthAge) {
      const v = r.caps[o.key];
      if (v == null) continue;
      // Nøgles på optionens EGET potentiale — A' re-deriverer det, og ordningen skal
      // aflæses mod det potentiale spilleren faktisk ville se.
      const key = `${r.potBy[o.key]}|${v}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    points[o.key] = [...seen.entries()].map(([k, n]) => {
      const [p, s] = k.split("|").map(Number);
      return [p, s, n];
    }).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }

  const out = {
    generated_for: "loft-semantik ejer-beslutning",
    season1_year: SEASON1_YEAR,
    population: { total: rows.length, age_16_21: youthAge.length, age_22plus: adults.length },
    scorecard,
    points_16_21: points,
  };
  const outPath = join(__dirname, "../../docs/audits/2026-07-15-cap-semantics-comparison.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n✅ Skrevet: ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
