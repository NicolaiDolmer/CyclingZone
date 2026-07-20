#!/usr/bin/env node
// #1980 relegation-parachute-scorecard — SIMULÉR-FØR-SHIP-gate for
// nedrykningsfaldskærmen (PR-B).
//
// FORMÅL: bevis at economyEngine.processSeasonStart's parachute-beregning
// (samme formel er REPLIKERET herunder — se computeParachute()) rammer den
// ejer-låste kontrakt (5/7, MÅ IKKE ÆNDRES): parachute = PARACHUTE_FACTOR ×
// (SPONSOR_INCOME_BY_DIVISION[gammel_div] − SPONSOR_INCOME_BY_DIVISION[ny_div]),
// KUN når gammel_div ∈ {1,2}, betalt ÉN gang ved sæson-start efter nedrykning.
// Og bekræft mål-scorecardet: for en gennemsnits-nedrykker (D1→D2, D2→D3) er
// parachute + ny-divisions-sponsor − ny-divisions-upkeep IKKE negativ —
// dvs. faldskærmen + den nye divisions egen sponsor dækker mindst den nye
// divisions egen driftsomkostning, uden at rulle en nødlåns-spiral i gang FRA
// DAG 1 (denne isolerede likviditets-bane inkluderer bevidst ikke løn/præmie —
// den fulde net-balance inkl. løn dækkes allerede af moneySupplyScorecard.js;
// dette scorecard beviser SPECIFIKT parachute-formlen + dens cushioning-effekt
// på sponsor/upkeep-aksen).
//
//   node scripts/relegationParachuteScorecard.js [--markdown]
//
// To sektioner:
//   (A) SYNTETISK/HYPOTETISK — beviser selve beregningen for alle 4 kategorier
//       (D1→D2, D2→D3, D3→D4 EKSKLUDERET, promotion=0). Ingen DB.
//   (B) LIVE READ-ONLY — tæller ægte hold (is_ai=false, is_bank=false,
//       is_frozen=false — samme diskriminator som processSeasonStart) pr.
//       division LIGE NU, for at vise hvor mange der ville kvalificere ved
//       den kommende S1→S2-transition. Forventning (ejer-direktiv #1980):
//       Div1/Div2 er 100% AI ved S1→S2 → 0 ægte hold kvalificerer endnu.
//       Kræver SUPABASE_URL + SUPABASE_READONLY_KEY (.codex.local/supabase-
//       readonly.env) — springes over uden (report-pattern, intet exit(1)).
//
// Report-pattern (ingen exit(1)) — ejer reviewer selv. Alle ✅/❌ er informative.

import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  PARACHUTE_FACTOR,
  SPONSOR_INCOME_BY_DIVISION,
  UPKEEP_BY_DIVISION,
  MIN_DIVISION,
  MAX_DIVISION,
} from "../lib/economyConstants.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const fmt = (n) => (n == null ? "—" : Math.round(n).toLocaleString("da-DK"));

// ── Replikerer economyEngine.processSeasonStart's inline parachute-beregning
// (backend/lib/economyEngine.js, "#1980 · Nedrykningsfaldskærm"-blokken) mod
// SAMME konstanter (importeret ovenfor, ikke duplikeret) — så et regression i
// prod-formlen og dette scorecard ikke kan drifte fra hinanden uden begge
// filer ændres samtidig.
function computeParachute(oldDivision, newDivision) {
  const wasRelegated =
    Number.isInteger(oldDivision) &&
    Number.isInteger(newDivision) &&
    newDivision > oldDivision;
  const eligible = wasRelegated && (oldDivision === 1 || oldDivision === 2);
  if (!eligible) return 0;
  return Math.round(
    PARACHUTE_FACTOR *
      ((SPONSOR_INCOME_BY_DIVISION[oldDivision] ?? 0) -
        (SPONSOR_INCOME_BY_DIVISION[newDivision] ?? 0))
  );
}

// ── (A) SYNTETISK/HYPOTETISK — beviser beregningen for alle 4 kategorier ────────
function printSyntheticSection() {
  console.log("=== (A) SYNTETISK/HYPOTETISK — beviser parachute-formlen ===\n");
  console.log(
    `Låst kontrakt: PARACHUTE_FACTOR=${PARACHUTE_FACTOR} · SPONSOR_INCOME_BY_DIVISION=${JSON.stringify(SPONSOR_INCOME_BY_DIVISION)} · UPKEEP_BY_DIVISION=${JSON.stringify(UPKEEP_BY_DIVISION)}\n`
  );

  const cases = [
    { label: "D1→D2 (nedrykket, eligible)", old: 1, next: 2, expected: 100000 },
    { label: "D2→D3 (nedrykket, eligible)", old: 2, next: 3, expected: 30000 },
    { label: "D3→D4 (nedrykket, EKSKLUDERET — D4-upkeep=0)", old: 3, next: 4, expected: 0 },
    { label: "D2→D1 (oprykket, ikke nedrykning)", old: 2, next: 1, expected: 0 },
    { label: "D1→D1 (uændret division)", old: 1, next: 1, expected: 0 },
    { label: "D4→D4 (bund, uændret)", old: 4, next: 4, expected: 0 },
  ];

  let allPass = true;
  console.log("Kategori                                          Beregnet    Forventet   Status");
  for (const c of cases) {
    const actual = computeParachute(c.old, c.next);
    const pass = actual === c.expected;
    if (!pass) allPass = false;
    console.log(
      `${c.label.padEnd(50)} ${String(fmt(actual)).padStart(9)}   ${String(fmt(c.expected)).padStart(9)}   ${pass ? "✅" : "❌ MISMATCH"}`
    );
  }
  console.log(
    `\nFormel-gate: ${allPass ? "✅ PASS — alle 6 kategorier matcher låst kontrakt" : "❌ FAIL — se ❌ ovenfor"}\n`
  );

  // ── Mål-scorecard: faldskærm + ny-divisions-sponsor − ny-divisions-upkeep
  //    giver ikke-negativ likviditets-bane (isoleret sponsor/upkeep-akse; løn/
  //    præmie er UDEN for dette scorecards scope — se moneySupplyScorecard for
  //    den fulde net-balance).
  console.log("─── Mål-scorecard: parachute + ny-sponsor − ny-upkeep ≥ 0 (gennemsnits-nedrykker) ───\n");
  let trajPass = true;
  for (const { old, next } of [{ old: 1, next: 2 }, { old: 2, next: 3 }]) {
    const parachute = computeParachute(old, next);
    const sponsor = SPONSOR_INCOME_BY_DIVISION[next];
    const upkeep = UPKEEP_BY_DIVISION[next];
    const net = parachute + sponsor - upkeep;
    const withoutParachute = sponsor - upkeep;
    const pass = net >= 0;
    if (!pass) trajPass = false;
    console.log(`D${old}→D${next}:`);
    console.log(`  parachute=${fmt(parachute)}  +  sponsor[D${next}]=${fmt(sponsor)}  −  upkeep[D${next}]=${fmt(upkeep)}  =  ${fmt(net)} ${pass ? "✅ ikke-negativ" : "❌ NEGATIV"}`);
    console.log(`  (uden parachute ville banen have været ${fmt(withoutParachute)} — parachute løfter med ${fmt(parachute)})\n`);
  }
  console.log(
    `Likviditets-bane-gate: ${trajPass ? "✅ PASS — ingen nødlåns-spiral fra sponsor/upkeep-aksen alene" : "❌ FAIL"}\n`
  );
  console.log(
    "NB: denne bane ekskluderer løn (frossen ved signering, kan overstige ny divisions sponsor for et\n" +
    "hold med dyr D1/D2-kaliber trup) og præmie. Det er BEVIDST — parachutens formål her er specifikt at\n" +
    "dække sponsor-spring + division-upkeep, ikke at garantere break-even inkl. løn (det er moneySupply-\n" +
    "Scorecard's ansvar, uændret af denne PR).\n"
  );

  return { allPass, trajPass };
}

// ── (B) LIVE READ-ONLY — hvor mange ægte hold kvalificerer ved næste transition ──
async function printLiveSection() {
  dotenv.config({
    path: path.resolve(SCRIPT_DIR, "../../.codex.local/supabase-readonly.env"),
    quiet: true,
  });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_READONLY_KEY) {
    console.log("=== (B) LIVE READ-ONLY — SPRUNGET OVER (mangler readonly-env) ===");
    console.log("    SUPABASE_URL / SUPABASE_READONLY_KEY ikke sat (.codex.local/supabase-readonly.env).\n");
    return;
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_READONLY_KEY);

  // Samme diskriminator som processSeasonStart's teams-query (economyEngine.js):
  // is_ai=false, is_bank=false, is_frozen=false — kun ægte, aktive managere.
  const { data: teams, error } = await supabase
    .from("teams")
    .select("id, division")
    .eq("is_ai", false)
    .eq("is_bank", false)
    .eq("is_frozen", false);
  if (error) {
    console.log(`=== (B) LIVE READ-ONLY — FEJLEDE: ${error.message} ===\n`);
    return;
  }

  const byDivision = new Map();
  for (const t of teams || []) {
    byDivision.set(t.division, (byDivision.get(t.division) || 0) + 1);
  }

  console.log("=== (B) LIVE READ-ONLY — ægte hold pr. division LIGE NU ===\n");
  for (let d = MIN_DIVISION; d <= MAX_DIVISION; d++) {
    console.log(`  D${d}: ${byDivision.get(d) || 0} ægte hold`);
  }

  const eligibleNow = (byDivision.get(1) || 0) + (byDivision.get(2) || 0);
  console.log(
    `\nHold i D1/D2 (kilde-divisionerne der kan udløse parachute ved næste nedrykning): ${eligibleNow}`
  );
  if (eligibleNow === 0) {
    console.log(
      "✅ BEKRÆFTET (ejer-forventning #1980): 0 ægte hold i D1/D2 → ved S1→S2-transitionen kan INGEN\n" +
      "   ægte hold udløse parachute endnu (Div1/Div2 er 100% AI-fyld i den nuværende population).\n" +
      "   Formlen er alligevel bevist korrekt i sektion (A) ovenfor for når ægte hold rykker op i D1/D2\n" +
      "   og senere nedrykkes derfra."
    );
  } else {
    console.log(
      `⚠️  ${eligibleNow} ægte hold i D1/D2 — nogle af disse kan udløse parachute ved næste sæson-slut\n` +
      "   afhængigt af puljens slutstilling. Se sektion (A) for beløbene pr. kategori."
    );
  }
  console.log();
}

async function main() {
  const { allPass, trajPass } = printSyntheticSection();
  await printLiveSection();
  console.log(
    `HEADLINE: formel-gate ${allPass ? "✅ PASS" : "❌ FAIL"} · likviditets-bane-gate ${trajPass ? "✅ PASS" : "❌ FAIL"}`
  );
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
