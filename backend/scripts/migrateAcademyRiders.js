// Migrér eksisterende is_academy-ryttere til den nye ungdoms-model (#1791). Deterministisk
// pr. rytter (seed = hash(rider.id)), identitets-bevarende (navn/alder/potentiale/type/hold/
// kontrakt urørt). Default dry-run med før/efter-scorecard; --apply skriver.
import { createClient } from "@supabase/supabase-js";
import { fetchAllRows } from "../lib/supabasePagination.js";
import { makeRng, STAT_KEYS, ARCHETYPE_BY_TYPE } from "../lib/fictionalRiderGenerator.js";
import { generateYouthStats } from "../lib/academyGenerator.js";
import { seedPhysiologyFromLegacy } from "../lib/physiologySeeding.js";
import { deriveAbilities } from "../lib/abilityDerivation.js";
import { deriveForRiderIds } from "../lib/backfillCores.js";

const ASOF_YEAR = 2026;
const PHYS = ["climbing","time_trial","flat","tempo","sprint","acceleration","punch","endurance","recovery","durability"];

// Deterministisk seed pr. rytter (FNV-1a på id) — reproducerbar migrering.
function hashSeed(id) {
  let h = 0x811c9dc5; const s = String(id);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

const topOf = (ab) => (ab ? Math.max(...PHYS.map((k) => Number(ab[k] ?? 0))) : null);
const avg = (xs) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

async function main() {
  const apply = process.argv.includes("--apply");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("Mangler SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY i env."); process.exit(1); }
  const supabase = createClient(url, key);

  const riders = await fetchAllRows(() => supabase.from("riders")
    .select(["id","birthdate","potentiale","primary_type","firstname","lastname", ...STAT_KEYS].join(", "))
    .eq("is_academy", true).order("id"));
  console.log(`Akademi-ryttere fundet: ${riders.length} (apply=${apply})`);
  if (riders.length === 0) { console.log("Ingen is_academy-ryttere — intet at migrere."); return; }

  // Nuværende afledte evner (FØR) til sammenligning.
  const curAb = await fetchAllRows(() => supabase.from("rider_derived_abilities")
    .select(["rider_id", ...PHYS].join(", ")).in("rider_id", riders.map((r) => r.id)));
  const curByRider = new Map(curAb.map((a) => [a.rider_id, a]));

  // Beregn foreslåede nye stats + (lokalt afledte) nye evner — INGEN writes.
  const rows = riders.map((r) => {
    const age = ASOF_YEAR - new Date(r.birthdate).getFullYear();
    const archetypeType = ARCHETYPE_BY_TYPE[r.primary_type] ? r.primary_type : "rouleur";
    const { stats } = generateYouthStats({ rng: makeRng(hashSeed(r.id)), age, potentiale: r.potentiale, archetypeType });
    const proposedRider = { ...r, ...stats };
    const proposedAb = deriveAbilities(seedPhysiologyFromLegacy(proposedRider), proposedRider);
    return { r, age, archetypeType, stats, curTop: topOf(curByRider.get(r.id)), newTop: topOf(proposedAb) };
  });

  // Scorecard (FØR/EFTER).
  const curTops = rows.map((x) => x.curTop).filter((v) => v != null);
  const newTops = rows.map((x) => x.newTop);
  console.log("\n=== FØR/EFTER top-evne ===");
  console.log(`  FØR : gns ${avg(curTops).toFixed(1)} · maks ${curTops.length ? Math.max(...curTops) : "—"} · ≥55: ${curTops.filter((v) => v >= 55).length}`);
  console.log(`  EFTER: gns ${avg(newTops).toFixed(1)} · maks ${Math.max(...newTops)} · ≥55: ${newTops.filter((v) => v >= 55).length}`);
  console.log("\nEksempler (navn, alder, pot, anlæg, top FØR→EFTER):");
  for (const x of rows.slice(0, 8)) {
    console.log(`  ${x.r.firstname} ${x.r.lastname} · ${x.age}å · pot ${x.r.potentiale} · ${x.archetypeType} · ${x.curTop ?? "?"}→${x.newTop}`);
  }

  if (!apply) { console.log("\nDRY-RUN — ingen writes. Kør med --apply for at migrere."); return; }

  // 1) Skriv nye (lave) stats.
  console.log("\n--apply: skriver nye stats...");
  for (const x of rows) {
    const patch = Object.fromEntries(STAT_KEYS.map((k) => [k, x.stats[k]]));
    const { error } = await supabase.from("riders").update(patch).eq("id", x.r.id);
    if (error) throw new Error(`stats update ${x.r.id}: ${error.message}`);
  }
  // 2) Re-derive (physiology→abilities→type→base_value + ungdoms-caps via Fase C4).
  console.log("Re-deriver (abilities + caps + base_value)...");
  const res = await deriveForRiderIds(supabase, rows.map((x) => x.r.id), { dryRun: false, log: console.log });
  console.log("Migrering fuldført:", JSON.stringify(res));
}

main().catch((e) => { console.error(e); process.exit(1); });
