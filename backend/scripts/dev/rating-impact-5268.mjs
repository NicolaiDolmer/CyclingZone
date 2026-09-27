// #5268 — READ-ONLY: hvad gør point-flytningen ved den SYNLIGE rating?
// Den synlige rating er rytterens bedste rolle (max over displayRecipes). Taktik
// og aggression indgår kun i baroudeurens opskrift, og Holdarbejde/Lederskab er
// endnu ikke i nogen opskrift (#5321), så flytningen kan kun sænke eller bevare.
//
//   infisical run --env=prod -- node backend/scripts/dev/rating-impact-5268.mjs
//
// Skriver intet (readOnlyFetch afviser alt andet end GET).
import { createClient } from "@supabase/supabase-js";
import { fetchAllRows } from "../../lib/supabasePagination.js";
import { DISPLAY_RECIPE_KEYS, ratingForRole } from "../../lib/weights/displayRecipes.js";
import {
  VARIANTS, loadRows, referencePlan, applyVariant, readOnlyFetch,
} from "../dry-run-5268-mental-abilities.js";

function best(abilities) {
  let role = null;
  let value = -1;
  for (const key of DISPLAY_RECIPE_KEYS) {
    const v = ratingForRole(abilities, key);
    if (v != null && v > value) { value = v; role = key; }
  }
  return { role, value };
}

function bucket(drop) {
  if (drop <= 0) return "0";
  if (drop <= 2) return "1-2";
  if (drop <= 5) return "3-5";
  if (drop <= 10) return "6-10";
  return "11+";
}

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Kør gennem Infisical (infisical run --env=prod -- ...)");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: readOnlyFetch },
  });

  const { rows } = await loadRows(supabase);
  const teamOf = new Map(rows.map(({ rider }) => [rider.id, rider.team_id]));
  const teams = await fetchAllRows(() => supabase.from("teams").select("id, is_ai, is_bank").order("id"));
  const human = new Set(teams.filter((t) => !t.is_ai && !t.is_bank).map((t) => t.id));
  const plan = referencePlan(rows);

  const out = {};
  for (const v of VARIANTS) {
    const applied = applyVariant(plan, v);
    const stat = { all: { n: 0, down: 0, buckets: {} }, human: { n: 0, down: 0, buckets: {} }, maxDrop: 0, baroBefore: 0, examples: [] };
    for (const e of applied) {
      const before = best(e.abilities);
      const after = best({ ...e.abilities, ...e.next });
      const drop = before.value - after.value;
      if (before.role === "baroudeur") stat.baroBefore += 1;
      const groups = human.has(teamOf.get(e.riderId)) ? ["all", "human"] : ["all"];
      for (const g of groups) {
        stat[g].n += 1;
        if (drop > 0) stat[g].down += 1;
        const b = bucket(drop);
        stat[g].buckets[b] = (stat[g].buckets[b] || 0) + 1;
      }
      if (drop > stat.maxDrop) stat.maxDrop = drop;
      if (drop >= 6 && human.has(teamOf.get(e.riderId)) && stat.examples.length < 5) {
        stat.examples.push(`${e.name} (${e.age}): ${before.value} ${before.role} -> ${after.value} ${after.role}`);
      }
    }
    out[v] = stat;
  }

  for (const v of VARIANTS) {
    const s = out[v];
    console.log(`\n### ${v.toUpperCase()}`);
    console.log(`Bedste rolle = baroudeur foer: ${s.baroBefore}`);
    for (const g of ["all", "human"]) {
      const b = s[g].buckets;
      console.log(`${g === "all" ? "Alle ryttere" : "Menneskehold"}: ${s[g].n} · synlig rating falder: ${s[g].down} · fald 1-2: ${b["1-2"] || 0} · 3-5: ${b["3-5"] || 0} · 6-10: ${b["6-10"] || 0} · 11+: ${b["11+"] || 0}`);
    }
    console.log(`Stoerste fald: ${s.maxDrop}`);
    for (const ex of s.examples) console.log(`  eks. ${ex}`);
  }
  console.log("\nREAD-ONLY: intet er skrevet.");
}

main().catch((err) => { console.error(err); process.exit(1); });
