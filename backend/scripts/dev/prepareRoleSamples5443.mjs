// #5443 / #3353 · Forbered sim-samples, vægttabeller og rolle-kort for de
// rolle-baserede værdi-kandidater (D-049, #5435).
//
// Ejeren besluttede 11/9 at det rating-tal spilleren SER skal være den rolle
// rytteren er bedst i lige nu — max over de otte rollers visnings-opskrift. Den
// sammenhængende model er så at VÆRDIEN regnes på det samme tal. Dette script
// bygger input til at måle det:
//
//   C4  bedste rolle nu     value_role = argmax over de 8 rollers display-score
//   C5  primær + sekundær   value_role = en blanding af de to rollers opskrifter
//   C6  bedste af de to     value_role = den af primær/sekundær der scorer højest
//
// Blandingen i C5 er eksakt: en rolles display-score er et VÆGTET SNIT, så
// w·score_A + (1−w)·score_B er selv et vægtet snit med vægtene
// w·ŵ^A + (1−w)·ŵ^B (ŵ = rollens vægte normaliseret til sum 1). Derfor kan C5
// udtrykkes som én vægttabel pr. (primær, sekundær)-par — ingen ny matematik i
// værdi-stien.
//
// READ-ONLY mod prod (kun SELECT: rytternes typer). Skriver kun filer.
//
//   infisical run --env=prod --silent -- node scripts/dev/prepareRoleSamples5443.mjs \
//     --sample=lib/riderProductionSample.json --out-dir=lib/refit5443

import "dotenv/config";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

import { fetchAllRows } from "../../lib/supabasePagination.js";
import { RIDER_TYPE_KEYS } from "../../lib/riderTypes.js";
import { DISPLAY_RECIPES, ratingForRole } from "../../lib/weights/displayRecipes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(__dirname, "../..");

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(`--${name}=`.length) : def;
};
const SAMPLE = resolve(join(BACKEND, String(arg("sample", "lib/riderProductionSample.json"))));
const OUT_DIR = resolve(join(BACKEND, String(arg("out-dir", "lib/refit5443"))));
const BLENDS = String(arg("blends", "0.7,0.5")).split(",").map(Number).filter((v) => Number.isFinite(v));

const RECIPES = Object.fromEntries(DISPLAY_RECIPES.map((r) => [r.key, { ...r.weights }]));

// Normaliser en opskrift til sum 1, så to opskrifter kan blandes lineært.
function normalized(weights) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  return Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, v / total]));
}

// Eksakt blanding af to rollers opskrifter: w·A + (1−w)·B på normaliseret form.
function blendRecipes(a, b, w) {
  const na = normalized(RECIPES[a]);
  const nb = normalized(RECIPES[b]);
  const out = {};
  for (const k of new Set([...Object.keys(na), ...Object.keys(nb)])) {
    const v = w * (na[k] ?? 0) + (1 - w) * (nb[k] ?? 0);
    if (v > 0) out[k] = Number(v.toFixed(6));
  }
  return out;
}

// Bedste rolle NU = den af de otte roller hvis visnings-opskrift giver det
// højeste tal på rytterens nuværende evner. Præcis D-049's regel, beregnet med
// spillets egen `ratingForRole` — ikke en kopi.
function bestRoleNow(abilities) {
  let best = null;
  let bestScore = -Infinity;
  for (const key of RIDER_TYPE_KEYS) {
    const v = ratingForRole(abilities, key);
    if (v == null) continue;
    // Stabil tie-break på rollenavn, så to kørsler giver samme svar.
    if (v > bestScore || (v === bestScore && best != null && key < best)) {
      bestScore = v;
      best = key;
    }
  }
  return { role: best, rating: bestScore === -Infinity ? null : bestScore };
}

async function main() {
  const art = JSON.parse(readFileSync(SAMPLE, "utf8"));
  console.log(`Sim-artefakt: ${SAMPLE} · ${art.samples.length} samples (seed ${art.base_seed}, K=${art.K})`);

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_KEY mangler. Kør via infisical.");
    process.exit(1);
  }
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  const riders = await fetchAllRows(() => sb.from("riders")
    .select("id, primary_type, secondary_type, is_retired").order("id"));
  const typesById = new Map(riders.map((r) => [r.id, r]));
  console.log(`Typer hentet for ${typesById.size} ryttere (kun SELECT).`);

  mkdirSync(OUT_DIR, { recursive: true });

  // ── C4: bedste rolle nu ────────────────────────────────────────────────────
  const c4Samples = [];
  const c4Map = {};
  const c4Changed = { same: 0, different: 0 };
  for (const s of art.samples) {
    const { role } = bestRoleNow(s.abilities);
    const r = role ?? s.primary_type;
    if (r === s.primary_type) c4Changed.same++; else c4Changed.different++;
    c4Map[s.rider_id] = r;
    // Offsettet foelger ogsaa rollen: under C4 ER rollen rytterens vaerditype.
    c4Samples.push({ ...s, primary_type: r, value_role: r, natural_type: s.primary_type });
  }
  writeFileSync(join(OUT_DIR, "sample-C4.json"), JSON.stringify({ ...art, samples: c4Samples }), "utf8");
  writeFileSync(join(OUT_DIR, "role-map-C4.json"), JSON.stringify(c4Map), "utf8");
  console.log(`C4: bedste rolle = naturlig rolle for ${c4Changed.same}, forskellig for ${c4Changed.different} (${((c4Changed.different / art.samples.length) * 100).toFixed(1)} %).`);

  // ── C6: bedste af primaer/sekundaer ────────────────────────────────────────
  const c6Samples = [];
  const c6Map = {};
  let c6Secondary = 0;
  let c6NoSecondary = 0;
  for (const s of art.samples) {
    const row = typesById.get(s.rider_id);
    const sec = row?.secondary_type;
    let role = s.primary_type;
    if (sec && sec !== s.primary_type && RECIPES[sec]) {
      const a = ratingForRole(s.abilities, s.primary_type);
      const b = ratingForRole(s.abilities, sec);
      if (b != null && (a == null || b > a)) { role = sec; c6Secondary++; }
    } else c6NoSecondary++;
    c6Map[s.rider_id] = role;
    c6Samples.push({ ...s, primary_type: role, value_role: role, natural_type: s.primary_type });
  }
  writeFileSync(join(OUT_DIR, "sample-C6.json"), JSON.stringify({ ...art, samples: c6Samples }), "utf8");
  writeFileSync(join(OUT_DIR, "role-map-C6.json"), JSON.stringify(c6Map), "utf8");
  console.log(`C6: sekundaer rolle valgt for ${c6Secondary} ryttere (${c6NoSecondary} uden brugbar sekundaer).`);

  // ── C5: blanding af primaer og sekundaer ───────────────────────────────────
  for (const w of BLENDS) {
    const tag = `C5-${Math.round(w * 100)}`;
    // Vaegttabel: de otte rene roller (saa validering og fallback virker) PLUS
    // en noegle pr. (primaer|sekundaer)-par.
    const table = { ...RECIPES };
    const samples = [];
    const map = {};
    let pairs = 0;
    for (const s of art.samples) {
      const row = typesById.get(s.rider_id);
      const sec = row?.secondary_type;
      let key = s.primary_type;
      if (sec && sec !== s.primary_type && RECIPES[sec]) {
        key = `${s.primary_type}|${sec}`;
        if (!table[key]) { table[key] = blendRecipes(s.primary_type, sec, w); pairs++; }
      }
      map[s.rider_id] = key;
      // primary_type beholdes, saa OFFSETTET stadig hoerer til den naturlige
      // rolle; kun opskriften (value_role) er blandet.
      samples.push({ ...s, value_role: key });
    }
    writeFileSync(join(OUT_DIR, `sample-${tag}.json`), JSON.stringify({ ...art, samples }), "utf8");
    writeFileSync(join(OUT_DIR, `weights-${tag}.json`), JSON.stringify(table, null, 2) + "\n", "utf8");
    writeFileSync(join(OUT_DIR, `role-map-${tag}.json`), JSON.stringify(map), "utf8");
    console.log(`${tag}: ${pairs} par-opskrifter bygget (vaegt ${w} paa primaer).`);
  }

  console.log(`\n✅ Skrevet til ${OUT_DIR}`);
  console.log("INTET er skrevet til databasen.");
}

main().catch((e) => {
  console.error("❌", e.message);
  console.error(e.stack);
  process.exit(1);
});
