#!/usr/bin/env node
// Dry-run / scorecard for træningsbias (#1163, L2 teaser) — RØRER INGEN DB.
//
// Simulér-før-ship (ejer-regel): før træningsbiasen un-gates (sammen med #1137),
// kører vi den mod den ÆGTE rytter-population og rapporterer et scorecard, så vi
// kan se at tallene i lib/training.TRAINING_CONFIG er sunde:
//   • fokus-evner vokser MÆRKBART mere end uden træning (men ikke absurd),
//   • ikke-fokus betaler en lille pris (fokus-trade-off),
//   • INGEN rytter bryder sit cap,
//   • hård intensitet er positiv i forventning, men har reel downside (tilbageslag).
//
//   node scripts/previewTraining.js               # alle aktive ryttere, sæson 2
//   node scripts/previewTraining.js --season 3
//
// Deterministisk: samme population + samme CONFIG → samme output (seeded).

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { VISIBLE_ABILITIES } from "../lib/abilityDerivation.js";
import { buildCaps, developRiderSeason, peakAgeForType } from "../lib/riderProgression.js";
import {
  TRAINING_FOCUSES, TRAINING_FOCUS_KEYS, TRAINING_CONFIG, resolveTrainingModifier,
} from "../lib/training.js";
import { ageForSeason } from "../lib/riderProgressionEngine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const SEASON = (() => {
  const i = process.argv.indexOf("--season");
  return i >= 0 ? Math.max(2, parseInt(process.argv[i + 1], 10) || 2) : 2;
})();

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Mangler SUPABASE_URL / SUPABASE_SERVICE_KEY i backend/.env — kør lokalt med env sat.");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const abilitySum = (ab) => VISIBLE_ABILITIES.reduce((s, k) => s + (Number(ab[k]) || 0), 0);
const round1 = (n) => Math.round(n * 10) / 10;

async function main() {
  const [riders, abilityRows] = await Promise.all([
    fetchAllRows(() => supabase.from("riders")
      .select("id, primary_type, potentiale, birthdate")
      .eq("is_retired", false).order("id")),
    fetchAllRows(() => supabase.from("rider_derived_abilities").select("*").order("rider_id")),
  ]);
  const abById = new Map(abilityRows.map((a) => [a.rider_id, a]));

  // Kun ryttere i vækst-fasen (alder ≤ peak) påvirkes af træning i v1.
  const pop = [];
  for (const r of riders) {
    if (!r.primary_type || r.potentiale == null) continue;
    const abRow = abById.get(r.id);
    if (!abRow) continue;
    const age = ageForSeason(r.birthdate, SEASON);
    if (age == null) continue;
    const abilities = {};
    for (const k of VISIBLE_ABILITIES) if (abRow[k] != null) abilities[k] = Number(abRow[k]);
    const caps = (abRow.ability_caps && typeof abRow.ability_caps === "object")
      ? abRow.ability_caps : buildCaps(abilities, r.primary_type, r.potentiale);
    pop.push({ r, age, abilities, caps, inGrowth: age <= peakAgeForType(r.primary_type) });
  }
  const growth = pop.filter((p) => p.inGrowth);

  console.log(`\n=== Træningsbias dry-run (#1163) — sæson ${SEASON} ===`);
  console.log(`Population: ${pop.length} aktive ryttere (${growth.length} i vækst-fase, ${pop.length - growth.length} forbi peak — uændret af træning)`);
  console.log(`CONFIG: focusGrowthMult=${JSON.stringify(TRAINING_CONFIG.focusGrowthMult)} offFocusMult=${TRAINING_CONFIG.offFocusMult} setbackChance=${JSON.stringify(TRAINING_CONFIG.setbackChance)} setbackGrowthMult=${TRAINING_CONFIG.setbackGrowthMult}\n`);

  let capBreaches = 0;

  for (const intensity of TRAINING_CONFIG.intensities) {
    console.log(`── Intensitet: ${intensity.toUpperCase()} ─────────────────────────────`);
    console.log("fokus".padEnd(12), "Δfokus".padStart(8), "Δoff".padStart(8), "Δsum".padStart(8), "tilbageslag".padStart(12));
    for (const focus of TRAINING_FOCUS_KEYS) {
      const focusSet = new Set(TRAINING_FOCUSES[focus]);
      let extraFocus = 0, extraOff = 0, sumDelta = 0, setbacks = 0, nFocus = 0, nOff = 0;
      for (const p of growth) {
        const rider = { id: p.r.id, primary_type: p.r.primary_type, potentiale: p.r.potentiale, age: p.age };
        const base = developRiderSeason(rider, p.abilities, p.caps, SEASON).next;
        const mod = resolveTrainingModifier({ focus, intensity }, p.r.id, SEASON);
        const trained = developRiderSeason(rider, p.abilities, p.caps, SEASON, undefined, mod).next;
        if (mod?.setbackHit) setbacks++;
        for (const k of VISIBLE_ABILITIES) {
          if (base[k] == null) continue;
          if (trained[k] > p.caps[k]) capBreaches++;
          const d = trained[k] - base[k];
          if (focusSet.has(k)) { extraFocus += d; nFocus++; } else { extraOff += d; nOff++; }
        }
        sumDelta += abilitySum(trained) - abilitySum(base);
      }
      const n = growth.length || 1;
      console.log(
        focus.padEnd(12),
        round1(extraFocus / (nFocus || 1)).toString().padStart(8),
        round1(extraOff / (nOff || 1)).toString().padStart(8),
        round1(sumDelta / n).toString().padStart(8),
        `${Math.round((setbacks / n) * 100)}%`.padStart(12),
      );
    }
    console.log("");
  }

  console.log("── Scorecard ──────────────────────────────────────────");
  console.log(`  Cap-brud:           ${capBreaches}  ${capBreaches === 0 ? "✅" : "❌ BØR VÆRE 0"}`);
  console.log(`  Δfokus = ekstra ability-point/sæson på fokus-evner vs. uden træning`);
  console.log(`  Δoff   = pris på ikke-fokus-evner (fokus-trade-off, bør være svagt negativ)`);
  console.log(`  Δsum   = netto ability-sum-ændring vs. baseline (hård bør stadig være > normal i EV)`);
  console.log(`  tilbageslag% bør ≈ setbackChance (${JSON.stringify(TRAINING_CONFIG.setbackChance)})\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
