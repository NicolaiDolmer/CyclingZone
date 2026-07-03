#!/usr/bin/env node
// #2083 — Ensret akademi-rytteres frosne løn til det fælles løn-system (SALARY_RATE 0.067).
//
// Baggrund: ungdoms-rework'et (#1791) sænkede akademirytteres base_value, men lod den
// frosne løn (sat med den gamle 0.10-akademi-rate på den gamle, højere værdi) blive
// hængende → spillere overbetalte. Denne ENGANGS-genberegning sætter lønnen =
// computeFrozenSalary(current base_value) med den delte 0.067-rate. Seniorer røres
// IKKE (deres frosne kontrakt-løn er bevidst bevaret — ejer-valgt 3/7).
//
//   node scripts/salaryUnifyRecompute.js            # DRY-RUN (default): rapportér før/efter
//   node scripts/salaryUnifyRecompute.js --apply    # skriv den genberegnede løn (efter ejer-review)
//
// Idempotent: re-kør = no-op når lønnen allerede matcher. Kør ALTID dry-run +
// ejer-review FØR --apply (økonomi-mutation mod prod).

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { computeFrozenSalary } from "../lib/contractSeed.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const APPLY = process.argv.includes("--apply");

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const fmt = (n) => (n == null ? "—" : Math.round(n).toLocaleString("da-DK"));

async function main() {
  console.log(`=== #2083 akademi-løn-ensretning ${APPLY ? "(APPLY)" : "(DRY-RUN)"} ===`);

  // Kun ejede akademiryttere med en løn (dem der faktisk belaster en manager).
  // Seniorer (is_academy=false) er bevidst udeladt — deres frosne løn bevares.
  const riders = await fetchAllRows(() =>
    supabase.from("riders")
      .select("id, firstname, lastname, base_value, prize_earnings_bonus, salary")
      .eq("is_academy", true)
      .not("team_id", "is", null)
      .not("salary", "is", null)
      .not("base_value", "is", null)
      .order("id"),
  );

  let sumBefore = 0;
  let sumAfter = 0;
  let nDown = 0;
  let nUp = 0;
  let nUnchanged = 0;
  const changes = [];
  for (const r of riders) {
    const before = Number(r.salary);
    const after = computeFrozenSalary({ base_value: r.base_value, prize_earnings_bonus: r.prize_earnings_bonus });
    sumBefore += before;
    sumAfter += after;
    if (after < before) nDown++;
    else if (after > before) nUp++;
    else { nUnchanged++; continue; }
    changes.push({ id: r.id, name: `${r.firstname} ${r.lastname}`, before, after, delta: after - before });
  }

  changes.sort((a, b) => a.delta - b.delta); // største fald først

  console.log(`\nAkademiryttere med løn: ${riders.length}`);
  console.log(`  ned ${nDown} · op ${nUp} · uændret ${nUnchanged}`);
  console.log(`  løn-sum FØR  : ${fmt(sumBefore)} CZ$`);
  console.log(`  løn-sum EFTER: ${fmt(sumAfter)} CZ$`);
  console.log(`  netto        : ${sumAfter - sumBefore >= 0 ? "+" : ""}${fmt(sumAfter - sumBefore)} CZ$`);

  console.log(`\nStørste ændringer (top 15):`);
  for (const c of changes.slice(0, 15)) {
    console.log(`  ${c.name.padEnd(28)} ${fmt(c.before).padStart(8)} → ${fmt(c.after).padStart(8)}  (${c.delta >= 0 ? "+" : ""}${fmt(c.delta)})`);
  }

  if (!APPLY) {
    console.log(`\n(DRY-RUN) Skriver intet. Kør med --apply efter ejer-review for at skrive ${changes.length} lønninger.`);
    return;
  }

  let written = 0;
  for (const c of changes) {
    const { error } = await supabase.from("riders").update({ salary: c.after }).eq("id", c.id);
    if (error) throw new Error(`update ${c.id} fejlede: ${error.message}`);
    written++;
  }
  console.log(`\n✅ Skrev ${written} genberegnede lønninger.`);
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
