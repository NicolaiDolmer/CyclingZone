#!/usr/bin/env node
// #3360 · genberegning af EKSISTERENDE kontrakter til det nye løn-grundlag.
//
// ⚠️ EJER-GATED. Dette script må KUN køres ved sæsonskiftet (23/8), efter at
// ændringen er annonceret i roadbooken, så den rammer alle hold samtidig og ingen
// oplever at forudsætningerne skifter midt i en sæson. Løn er frosset ved signering
// (#1309) — uden denne genberegning bider grundlags-skiftet først om 2-3 sæsoner,
// efterhånden som kontrakter udløber.
//
// DRY-RUN ER DEFAULT. Skrivning kræver eksplicit --apply.
//
//   node scripts/salaryBasisRecompute.js                 # dry-run (default) + rapport
//   node scripts/salaryBasisRecompute.js --verify        # post-verify uden at skrive
//   node scripts/salaryBasisRecompute.js --apply         # SKRIVER (ejer-gated)
//   node scripts/salaryBasisRecompute.js --apply --include-ai   # også AI-hold
//
// Idempotent: scriptet skriver kun rækker hvor den beregnede løn AFVIGER fra den
// gemte. En anden kørsel er derfor en no-op, og en afbrudt kørsel kan genoptages.
// Post-verify (kører altid til sidst): læser tilbage og bekræfter at hver ejet
// rytters salary matcher computeFrozenSalary — og at INGEN endte på fallback-lønnen
// (den tavse fejlklasse fra #3389/#2796).
//
// Free agents (team_id NULL) røres ALDRIG — de har ingen kontrakt at genberegne.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { computeFrozenSalary } from "../lib/contractSeed.js";
import { resolveMarketBase } from "../lib/salaryBasis.js";
import { SALARY_BASIS_MODE, SALARY_MARKET_MODEL } from "../lib/economyConstants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const APPLY = process.argv.includes("--apply");
const VERIFY_ONLY = process.argv.includes("--verify");
const INCLUDE_AI = process.argv.includes("--include-ai");
const WRITE_CONCURRENCY = 25;

const fmt = (n) => (n == null || !Number.isFinite(n) ? "—" : Math.round(n).toLocaleString("da-DK"));
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

// Ejede ryttere + deres holds division. Rigtige hold = samme filter som ranglisten;
// AI/bank-hold kun med --include-ai (de har også kontrakter, men de er ikke
// spiller-vendt økonomi og bør ikke blande sig i før/efter-rapporten).
async function loadOwned(supabase) {
  const teams = await fetchAllRows(() => supabase
    .from("teams")
    .select("id, division, user_id, is_ai, is_bank, is_test_account, is_frozen")
    .order("id"));
  const eligible = new Map(teams
    .filter((t) => INCLUDE_AI || (t.user_id && !t.is_ai && !t.is_bank && !t.is_test_account && !t.is_frozen))
    .map((t) => [t.id, t]));

  const riders = await fetchAllRows(() => supabase
    .from("riders")
    // Begge grundlags-felter med, så scriptet er korrekt uanset SALARY_BASIS_MODE.
    .select("id, team_id, salary, market_value, base_value, current_production_value, is_academy, is_retired")
    .not("team_id", "is", null)
    .order("id"));

  return riders
    .filter((r) => eligible.has(r.team_id) && !r.is_retired)
    .map((r) => ({ ...r, division: eligible.get(r.team_id).division }));
}

// Eksporteret så idempotensen kan testes uden DB (salaryBasisRecompute.test.js):
// en anden kørsel på det allerede-skrevne resultat skal give NUL ændringer.
export function planChanges(owned) {
  const changes = [];
  let unchanged = 0;
  let fallbackHits = 0;
  for (const r of owned) {
    if (resolveMarketBase(r).source === "fallback") fallbackHits++;
    const after = computeFrozenSalary(r);
    const before = Number(r.salary);
    if (Number.isFinite(before) && before === after) { unchanged++; continue; }
    changes.push({ id: r.id, team_id: r.team_id, division: r.division, before: before || 0, after, delta: after - (before || 0) });
  }
  return { changes, unchanged, fallbackHits };
}

function report(owned, { changes, unchanged, fallbackHits }) {
  const sumBefore = owned.reduce((s, r) => s + (Number(r.salary) || 0), 0);
  const sumAfter = owned.reduce((s, r) => s + computeFrozenSalary(r), 0);

  console.log(`Løn-grundlag  : ${SALARY_BASIS_MODE}`);
  if (SALARY_BASIS_MODE === "market") {
    console.log(`Kurve         : ${fmt(SALARY_MARKET_MODEL.anchorSalary)} × (værdi / ${fmt(SALARY_MARKET_MODEL.anchorValue)})^${SALARY_MARKET_MODEL.exponent}`);
  }
  console.log(`Ryttere       : ${owned.length} ejede (${INCLUDE_AI ? "inkl." : "ekskl."} AI/bank/test/frosne hold)`);
  console.log(`Ændres        : ${changes.length} · uændret ${unchanged}`);
  console.log(`Σ løn         : ${fmt(sumBefore)} → ${fmt(sumAfter)} CZ$  (×${sumBefore ? (sumAfter / sumBefore).toFixed(2) : "—"})`);
  if (fallbackHits > 0) {
    console.log(`⚠️  ${fallbackHits} ejede ryttere har ingen læsbar værdi og ville få fallback-lønnen —`);
    console.log("    undersøg dem FØR --apply (det er #3389-fejlklassen, ikke en normalitet).");
  }

  const byDiv = new Map();
  for (const r of owned) {
    if (!byDiv.has(r.division)) byDiv.set(r.division, []);
    byDiv.get(r.division).push(r);
  }
  console.log("\nPr. division (pr. rytter):");
  for (const d of [...byDiv.keys()].sort((a, b) => a - b)) {
    const rs = byDiv.get(d);
    const b = rs.map((r) => Number(r.salary) || 0);
    const a = rs.map((r) => computeFrozenSalary(r));
    console.log(`  D${d}: ${String(rs.length).padStart(5)} ryttere · median løn ${String(fmt(median(b))).padStart(9)} → ${String(fmt(median(a))).padStart(9)} · Σ ${fmt(b.reduce((x, y) => x + y, 0))} → ${fmt(a.reduce((x, y) => x + y, 0))}`);
  }

  const up = changes.filter((c) => c.delta > 0).length;
  const down = changes.filter((c) => c.delta < 0).length;
  console.log(`\nRetning: ${up} op · ${down} ned`);
  const biggest = [...changes].sort((x, y) => y.delta - x.delta).slice(0, 5);
  console.log("Største stigninger:");
  for (const c of biggest) console.log(`  ${c.id}  D${c.division}  ${fmt(c.before)} → ${fmt(c.after)}  (+${fmt(c.delta)})`);
}

async function apply(supabase, changes) {
  let written = 0;
  for (let i = 0; i < changes.length; i += WRITE_CONCURRENCY) {
    const batch = changes.slice(i, i + WRITE_CONCURRENCY);
    await Promise.all(batch.map((c) =>
      supabase.from("riders").update({ salary: c.after }).eq("id", c.id).then(({ error }) => {
        if (error) throw new Error(`salaryBasisRecompute ${c.id}: ${error.message}`);
      })));
    written += batch.length;
    if (written % 500 === 0) console.log(`  ... ${written}/${changes.length}`);
  }
  return written;
}

// Post-verify: læs tilbage og bekræft at hver ejet rytters løn matcher formlen.
async function postVerify(supabase) {
  const owned = await loadOwned(supabase);
  const mismatched = owned.filter((r) => Number(r.salary) !== computeFrozenSalary(r));
  const fallback = owned.filter((r) => resolveMarketBase(r).source === "fallback");
  const nullSalary = owned.filter((r) => r.salary == null);
  console.log("\n── Post-verify ────────────────────────────────────────────────────────────");
  console.log(`  ${mismatched.length === 0 ? "✅" : "❌"} alle ejede ryttere matcher computeFrozenSalary (${mismatched.length} afviger)`);
  console.log(`  ${nullSalary.length === 0 ? "✅" : "❌"} ingen ejet rytter har NULL løn (#1309-invarianten) (${nullSalary.length})`);
  console.log(`  ${fallback.length === 0 ? "✅" : "⚠️ "} ingen ejet rytter på fallback-basen (${fallback.length})`);
  if (mismatched.length) {
    for (const r of mismatched.slice(0, 10)) {
      console.log(`     ${r.id}: gemt ${fmt(r.salary)} · forventet ${fmt(computeFrozenSalary(r))}`);
    }
  }
  return mismatched.length === 0 && nullSalary.length === 0;
}

// Kun kør mod DB når scriptet er invokeret direkte (import fra test må ikke ramme prod).
const INVOKED_DIRECTLY = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  console.log("=== #3360 løn-genberegning ===");
  console.log(APPLY ? "MODE: APPLY (skriver)\n" : VERIFY_ONLY ? "MODE: VERIFY-ONLY\n" : "MODE: DRY-RUN (skriver intet)\n");

  if (VERIFY_ONLY) {
    const ok = await postVerify(supabase);
    process.exit(ok ? 0 : 1);
  }

  const owned = await loadOwned(supabase);
  const plan = planChanges(owned);
  report(owned, plan);

  if (!APPLY) {
    console.log("\nDRY-RUN — intet skrevet. Kør med --apply når ejeren har godkendt (sæsonskiftet 23/8).");
    return;
  }

  console.log(`\nSkriver ${plan.changes.length} rækker ...`);
  const written = await apply(supabase, plan.changes);
  console.log(`✅ ${written} rækker opdateret.`);
  const ok = await postVerify(supabase);
  if (!ok) process.exit(1);
}

if (INVOKED_DIRECTLY) main().catch((e) => { console.error(e); process.exit(1); });
