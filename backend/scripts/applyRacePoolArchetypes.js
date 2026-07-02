#!/usr/bin/env node
// Anvend database/seed/race_pool_archetypes.json → race_pool (country +
// terrain_archetype, match på external_id). Idempotent. Default = dry-run.
// Kræver at race_pool.country + terrain_archetype findes (migration
// 2026-06-28-race-pool-archetype-country.sql).
//   node scripts/applyRacePoolArchetypes.js            # dry-run (vis ændringer)
//   node scripts/applyRacePoolArchetypes.js --apply    # skriv
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { fetchAllRows } from "../lib/supabasePagination.js";
import { ARCHETYPE_PROFILES } from "../lib/raceStageProfileGenerator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const APPLY = process.argv.includes("--apply");
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("❌ Missing SUPABASE_URL/KEY"); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const data = JSON.parse(readFileSync(join(__dirname, "../../database/seed/race_pool_archetypes.json"), "utf8"));

// Validér arketyper mod den eneste sandhedskilde FØR vi rører DB.
const valid = new Set(Object.keys(ARCHETYPE_PROFILES));
const bad = data.filter((d) => !valid.has(d.terrain_archetype));
if (bad.length) {
  console.error(`❌ ${bad.length} rækker med ukendt terrain_archetype: ${[...new Set(bad.map((b) => b.terrain_archetype))].join(", ")}`);
  process.exit(1);
}

const catalog = await fetchAllRows(() => supabase.from("race_pool").select("id, external_id, country, terrain_archetype"));
const byExt = new Map(catalog.map((c) => [c.external_id, c]));
let changes = 0, missing = 0;
for (const d of data) {
  const cur = byExt.get(d.external_id);
  if (!cur) { console.log(`  ⚠ ukendt external_id: ${d.external_id} (${d.name})`); missing++; continue; }
  if (cur.country !== d.country || cur.terrain_archetype !== d.terrain_archetype) {
    changes++;
    console.log(`  ${d.name}: ${cur.terrain_archetype ?? "∅"} → ${d.terrain_archetype} · land ${cur.country ?? "∅"} → ${d.country}`);
    if (APPLY) {
      const { error } = await supabase.from("race_pool").update({ country: d.country, terrain_archetype: d.terrain_archetype }).eq("id", cur.id);
      if (error) throw new Error(`update ${d.external_id}: ${error.message}`);
    }
  }
}
console.log(`\n${APPLY ? "Skrev" : "(dry-run) ville skrive"} ${changes} ændringer · ${missing} ukendte external_id · ${data.length} rækker i filen.`);
const noArch = catalog.filter((c) => !data.find((d) => d.external_id === c.external_id));
if (noArch.length) console.log(`⚠ ${noArch.length} katalog-løb mangler en arketype i data-filen.`);
