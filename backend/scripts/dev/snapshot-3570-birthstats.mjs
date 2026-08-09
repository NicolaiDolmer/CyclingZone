// #3570 — READ-ONLY snapshot af rytternes FØDSELS-anlæg (riders.stat_* + height/weight).
// KUN SELECT.
//
// Hvorfor: klassifikationen har været et lukket kredsløb (type → ability_caps → type).
// Alt der er afledt af `ability_caps` bærer derfor løkkens aftryk. De legacy-stats
// generatoren skrev ved fødslen (fictionalRiderGenerator.js's ARCHETYPES boost/damp
// direkte på stat_*) gør IKKE — de er rytterens medfødte profil og skrives aldrig af
// trænings- eller værdikæden. Det gør dem til den eneste løkke-frie identitets-forankring
// der findes for de ~8.200 eksisterende ryttere (som alle har archetype_draw = NULL).
//
//   infisical run --env=prod -- node scripts/dev/snapshot-3570-birthstats.mjs [outDir]
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE secrets (infisical run --env=prod)");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const OUT_DIR = process.argv[2] || path.join(import.meta.dirname, `.snapshot-3570-birth-${new Date().toISOString().slice(0, 10)}`);
fs.mkdirSync(OUT_DIR, { recursive: true });

const COLS = "id, birthdate, height, weight, potentiale, " +
  "stat_bj, stat_kb, stat_bk, stat_tt, stat_prl, stat_fl, stat_bro, stat_sp, stat_acc, stat_ned, stat_udh, stat_mod, stat_res, stat_ftr";

const out = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from("riders").select(COLS).range(from, from + 999)
    .or("is_retired.is.null,is_retired.eq.false");
  if (error) throw new Error(`riders: ${error.message}`);
  out.push(...(data || []));
  if (!data || data.length < 1000) break;
}

const nulls = out.filter((r) => r.stat_bj == null).length;
fs.writeFileSync(path.join(OUT_DIR, "birthstats.json"), JSON.stringify(out));
console.log(JSON.stringify({ takenAt: new Date().toISOString(), n: out.length, udenStats: nulls }, null, 2));
console.log(`Skrev ${out.length} rækker → ${OUT_DIR}`);
