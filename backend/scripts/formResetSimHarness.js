#!/usr/bin/env node
// #3232 — sim-harness: sammenlign de tre kandidat-modes for sæsonskifte-
// form-nulstilling mod den FAKTISKE nuværende form-fordeling i prod.
// READ-ONLY — ingen writes, ingen mutationer. Genbruger den ÆGTE kerne-
// funktion (seasonResetForm fra lib/seasonFormReset.js) 1:1, så rapporten
// aldrig kan drifte fra hvad backend rent faktisk ville skrive ved ship.
//
// Population: aktive ryttere (is_retired=false) tilknyttet et RIGTIGT hold
// (ikke test-konto, ikke frosset, ikke bank — samme diskriminator som
// #2792/#2852 bruger for "rigtige hold"). AI-hold er INKLUDERET i
// populationen (de racer også), men brydes ud separat, fordi AI-ryttere
// aldrig træner og derfor sidder fast på form=50 (sd=0) — se KENDTE FUND
// nedenfor. Test-/frosne/bank-hold er UDELUKKET (irrelevante for balance).
//
//   node scripts/formResetSimHarness.js                  # default parametre
//   node scripts/formResetSimHarness.js --changed-threshold=10
//
// KENDTE FUND (2026-08-03-kørslen, se docs/audits/2026-08-03-form-reset-sim-3232.md):
//   - AI-ryttere har KONSTANT form=50 (sd=0) — trainingSweep kører aldrig for
//     is_ai-hold, så de har intet at bygge/miste form på. "band"-mode er den
//     ENESTE af de tre kandidater der rører AI-formen (introducerer støj hvor
//     der ellers ikke var nogen) — "baseline" og "decay" er begge no-op på en
//     rytter der allerede står på target.
//   - Menneske-rytteres NUVÆRENDE form-spredning er meget bredere end man
//     skulle tro (sd ≈ 35, mange ryttere presset helt ud i 0 eller 100) —
//     langt bredere end trætheds-spredningen #2910-analysen målte.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (service-role, read-only forbrug her).

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

import { seasonResetForm, SEASON_FORM_RESET_DEFAULTS } from "../lib/seasonFormReset.js";
import { fetchAllPaged } from "../lib/dbChunk.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  return def;
}

const CHANGED_THRESHOLD = Number(arg("changed-threshold", "15"));
// Fast "sæson"-seed for simuleringen — kun betydning for reproducerbarhed af
// bånd-mode på TVÆRS af kørsler af dette script, ikke for den ægte transition
// (som altid sender den ægte toSeasonNumber ind).
const SIM_SEASON = arg("season", "sim-2026-08-03");

function mean(xs) { return xs.reduce((a, b) => a + b, 0) / (xs.length || 1); }
function sd(xs) {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}
function percentileCont(sortedValues, p) {
  if (!sortedValues.length) return null;
  if (sortedValues.length === 1) return sortedValues[0];
  const idx = p * (sortedValues.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedValues[lo];
  const frac = idx - lo;
  return sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * frac;
}
function pearsonCorr(xs, ys) {
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  if (dx2 === 0 || dy2 === 0) return null; // konstant variabel → korrelation udefineret
  return num / Math.sqrt(dx2 * dy2);
}
function fmt(n, d = 1) { return Number.isFinite(n) ? n.toFixed(d) : "—"; }
function pad(value, width) {
  const s = String(value ?? "");
  return s.length >= width ? s.slice(0, width) : s + " ".repeat(width - s.length);
}

async function main() {
  // ── Rigtige hold (samme diskriminator som #2792/#2852) ──────────────────
  const { data: teamRows, error: teamErr } = await fetchAllPaged(() =>
    supabase.from("teams").select("id, is_ai, is_test_account, is_frozen, is_bank").order("id")
  );
  if (teamErr) throw new Error(`teams load: ${teamErr.message}`);
  const realTeams = new Map(); // team_id -> is_ai
  for (const t of teamRows || []) {
    if (t.is_test_account || t.is_frozen || t.is_bank) continue;
    realTeams.set(t.id, t.is_ai);
  }

  // ── Aktive ryttere på et rigtigt hold ────────────────────────────────────
  const { data: riderRows, error: riderErr } = await fetchAllPaged(() =>
    supabase.from("riders").select("id, team_id, is_retired").order("id")
  );
  if (riderErr) throw new Error(`riders load: ${riderErr.message}`);
  const riderIsAi = new Map(); // rider_id -> is_ai
  for (const r of riderRows || []) {
    if (r.is_retired) continue;
    if (!r.team_id || !realTeams.has(r.team_id)) continue;
    riderIsAi.set(r.id, realTeams.get(r.team_id));
  }

  // ── Nuværende form ────────────────────────────────────────────────────────
  const { data: conditionRows, error: condErr } = await fetchAllPaged(() =>
    supabase.from("rider_condition").select("rider_id, form").order("rider_id")
  );
  if (condErr) throw new Error(`rider_condition load: ${condErr.message}`);

  const population = (conditionRows || [])
    .filter((c) => riderIsAi.has(c.rider_id))
    .map((c) => ({
      riderId: c.rider_id,
      isAi: riderIsAi.get(c.rider_id),
      // mode "off" er identitet (clampet + afrundet, korrupt/manglende → 50)
      // — genbruger den ægte kerne i stedet for at re-implementere clampingen.
      before: seasonResetForm({ form: c.form, mode: "off" }),
    }));

  const modes = [
    { key: "baseline", label: `baseline (${SEASON_FORM_RESET_DEFAULTS.baselineValue})`,
      params: { baselineValue: SEASON_FORM_RESET_DEFAULTS.baselineValue } },
    { key: "band", label: `band (${SEASON_FORM_RESET_DEFAULTS.bandMin}-${SEASON_FORM_RESET_DEFAULTS.bandMax})`,
      params: { bandMin: SEASON_FORM_RESET_DEFAULTS.bandMin, bandMax: SEASON_FORM_RESET_DEFAULTS.bandMax } },
    { key: "decay", label: `decay (target ${SEASON_FORM_RESET_DEFAULTS.decayTarget}, ×${SEASON_FORM_RESET_DEFAULTS.decayFactor})`,
      params: { decayTarget: SEASON_FORM_RESET_DEFAULTS.decayTarget, decayFactor: SEASON_FORM_RESET_DEFAULTS.decayFactor } },
  ];

  function report(rows, label) {
    const before = rows.map((r) => r.before).sort((a, b) => a - b);
    console.log(`\n${label} — n=${rows.length}`);
    console.log(pad("", 28), pad("mean", 8), pad("sd", 8), pad("p10", 6), pad("p50", 6), pad("p90", 6), pad("corr", 8), pad(`|Δ|>=${CHANGED_THRESHOLD}`, 16));
    console.log("-".repeat(86));
    console.log(pad("FØR (nu)", 28), pad(fmt(mean(before)), 8), pad(fmt(sd(before)), 8),
      pad(fmt(percentileCont(before, 0.1), 0), 6), pad(fmt(percentileCont(before, 0.5), 0), 6), pad(fmt(percentileCont(before, 0.9), 0), 6),
      pad("—", 8), pad("—", 16));

    const lines = [];
    for (const m of modes) {
      const afters = rows.map((r) => seasonResetForm({
        form: r.before, riderId: r.riderId, season: SIM_SEASON, mode: m.key, ...m.params,
      }));
      const sortedAfter = [...afters].sort((a, b) => a - b);
      const corr = pearsonCorr(rows.map((r) => r.before), afters);
      const changed = rows.filter((r, i) => Math.abs(afters[i] - r.before) >= CHANGED_THRESHOLD).length;
      console.log(pad(m.label, 28), pad(fmt(mean(afters)), 8), pad(fmt(sd(afters)), 8),
        pad(fmt(percentileCont(sortedAfter, 0.1), 0), 6), pad(fmt(percentileCont(sortedAfter, 0.5), 0), 6), pad(fmt(percentileCont(sortedAfter, 0.9), 0), 6),
        pad(corr === null ? "n/a" : fmt(corr, 3), 8), pad(`${changed} (${fmt(100 * changed / rows.length, 1)}%)`, 16));
      lines.push({
        mode: m.key, label: m.label, n: rows.length,
        mean: mean(afters), sd: sd(afters),
        p10: percentileCont(sortedAfter, 0.1), p50: percentileCont(sortedAfter, 0.5), p90: percentileCont(sortedAfter, 0.9),
        corr, changed, changedPct: 100 * changed / rows.length,
      });
    }
    return {
      label, n: rows.length,
      before: { mean: mean(before), sd: sd(before), p10: percentileCont(before, 0.1), p50: percentileCont(before, 0.5), p90: percentileCont(before, 0.9) },
      modes: lines,
    };
  }

  console.log(`\nSIM-HARNESS #3232 — form-reset-modes mod ÆGTE prod-population (READ-ONLY, changed-threshold=${CHANGED_THRESHOLD})\n`);
  const all = report(population, "ALLE (human + AI)");
  const humans = report(population.filter((r) => !r.isAi), "KUN MENNESKE-hold");
  const ai = report(population.filter((r) => r.isAi), "KUN AI-hold");

  console.log("\nHUSK: 'population' = aktive ryttere på et rigtigt hold (ikke test/frosset/bank).");
  console.log("Snapshot taget FØR selve S2→S3-skiftet (23/8) — den faktiske transition-dags");
  console.log("fordeling kan afvige lidt, men formens sprednings-KARAKTER (bred hos mennesker,");
  console.log("flad hos AI) er en strukturel egenskab af mekanikken, ikke en dags-tilfældighed.\n");

  return { all, humans, ai };
}

main().catch((err) => {
  console.error("Sim-harness fejlede:", err.message);
  process.exit(1);
});
