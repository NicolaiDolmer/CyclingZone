// #6285: Tour-gennemtest. Koerer ALLE etaper i et navngivet loeb gennem v4 med
// de RIGTIGE prod-data (startliste, roller, holdordrer, evner, etapeprofiler)
// under en eller flere regel-revisioner, over N seeds, med akkumuleret
// klassement, og skriver et scorecard pr. etape + samlet med PASS/WARN/FAIL
// mod et benchmark fra virkelig cykelsport (lib/tourScorecard.mjs).
//
// READ-ONLY: Supabase bruges kun til SELECT. Output skrives KUN lokalt til
// balance-internals/ (gitignoreret), fordi det indeholder maalte tal og id'er.
// Revisionen tages som argument; scriptet aendrer intet i motoren.
//
// Koer:
//   infisical run --env=prod -- node backend/scripts/dev/tourDryRun.mjs --race-name="<loebets navn>" [--tier=1] --revision=orders_gc_v3 [--compare=orders_gc_v2] [--seeds=5] [--save-cache=balance-internals/tour-6285/cache.json]
//   node backend/scripts/dev/tourDryRun.mjs --cache=balance-internals/tour-6285/cache.json --revision=orders_gc_v3 --compare=orders_gc_v2
//   node backend/scripts/dev/tourDryRun.mjs --fixture=giro --revision=orders_gc_v2   (det anonymiserede Giro-felt, uden prod)
//
// Flag:
//   --race=<id> | --race-name=<navn>   loebet (navn matches uden store/smaa bogstaver)
//   --tier=<n>                          division ved flere loeb med samme navn (default 1)
//   --revision=<a[,b]>                  revision(er) der maales (default orders_gc_v3)
//   --compare=<rev>                     sammenligningsrevision side om side (default orders_gc_v2; "none" slaar fra)
//   --seeds=<n>                         seeds pr. revision (default 5)
//   --no-leadout-pair                   spring den parrede sprinttog-maaling over
//   --out-dir=<dir>                     default balance-internals/tour-6285
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderTourMarkdown, runTour } from "./lib/tourScorecard.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "..", "..", "..");
export const GIRO_FIXTURE = path.join(here, "..", "baselines", "giro-field-6088-2026-10-02.json");
export const DEFAULT_OUT_DIR = "balance-internals/tour-6285";

/** Parse CLI-argumenterne (rent, testbart). */
export function parseArgs(argv) {
  const get = (name, fallback = null) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(`--${name}=`.length) : fallback;
  };
  const revisions = String(get("revision", "orders_gc_v3")).split(",").map((s) => s.trim()).filter(Boolean);
  const compare = get("compare", "orders_gc_v2");
  const all = [...revisions];
  if (compare && compare !== "none" && !all.includes(compare)) all.push(compare);
  const seeds = Number(get("seeds", "5"));
  if (!Number.isInteger(seeds) || seeds < 1) throw new Error("--seeds skal vaere et positivt heltal");
  return {
    raceId: get("race"),
    raceName: get("race-name"),
    tier: Number(get("tier", "1")),
    revisions: all,
    seeds,
    leadoutPair: !argv.includes("--no-leadout-pair"),
    cache: get("cache"),
    saveCache: get("save-cache"),
    fixture: get("fixture"),
    outDir: get("out-dir", DEFAULT_OUT_DIR),
  };
}

/**
 * Vaelg loebet blandt kandidater med samme navn: praecis ét, ellers det i
 * divisionen med `tier`. Flere eller ingen = fejl med kandidaternes id'er.
 */
export function pickRace(candidates, divisionTierById, tier = 1) {
  if (candidates.length === 1) return candidates[0];
  if (!candidates.length) throw new Error("Intet loeb matcher navnet");
  const inTier = candidates.filter((r) => divisionTierById.get(r.league_division_id) === tier);
  const active = inTier.filter((r) => r.status !== "completed");
  const pool = active.length ? active : inTier;
  if (pool.length === 1) return pool[0];
  throw new Error(`Navnet er tvetydigt (${candidates.length} loeb, ${pool.length} i division ${tier}): ${candidates.map((r) => r.id).join(", ")}. Brug --race=<id>.`);
}

/** Filnavn uden mellemrum og specialtegn. */
export function slug(text) {
  return String(text).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "race";
}

async function fetchRace({ raceId, raceName, tier }) {
  const { createClient } = await import("@supabase/supabase-js");
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Mangler SUPABASE_URL / SUPABASE_SERVICE_KEY (infisical run --env=prod)");
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  const { ABILITY_KEYS } = await import("../../lib/raceSimulator.js");
  const one = async (q, what) => { const { data, error } = await q; if (error) throw new Error(`${what}: ${error.message}`); return data || []; };

  const raceCols = "id, name, stages, squad, race_class, status, league_division_id";
  let race;
  if (raceId) {
    [race] = await one(db.from("races").select(raceCols).eq("id", raceId), "races");
  } else {
    // pagination-safe: navnesoegning paa ét loebsnavn (en haandfuld rakker, én pr. division og saeson)
    const candidates = await one(db.from("races").select(raceCols).ilike("name", raceName).neq("status", "completed"), "races");
    const divIds = [...new Set(candidates.map((r) => r.league_division_id).filter(Boolean))];
    const divs = divIds.length ? await one(db.from("league_divisions").select("id, tier").in("id", divIds), "league_divisions") : [];
    race = pickRace(candidates, new Map(divs.map((d) => [d.id, d.tier])), tier);
  }
  if (!race) throw new Error("Loebet findes ikke");
  const profiles = await one(db.from("race_stage_profiles").select("*").eq("race_id", race.id), "race_stage_profiles"); // pagination-safe: ét løbs etaper (< 30 rækker)
  const entries = await one(db.from("race_entries").select("rider_id, team_id, race_role").eq("race_id", race.id), "race_entries"); // pagination-safe: ét løbs startliste (< 300 rækker)
  // pagination-safe: ét løbs ordrer (hold x etaper, < 1000 rækker)
  const orders = await one(db.from("race_team_orders").select("team_id, race_id, stage_number, breakaway_stance, riders").eq("race_id", race.id), "race_team_orders");
  const teamIds = [...new Set(entries.map((e) => e.team_id).filter(Boolean))];
  const riderIds = entries.map((e) => e.rider_id);
  const teams = [];
  for (let i = 0; i < teamIds.length; i += 50) teams.push(...await one(db.from("teams").select("id, is_ai").in("id", teamIds.slice(i, i + 50)), "teams"));
  const abilities = [];
  for (let i = 0; i < riderIds.length; i += 50) {
    abilities.push(...await one(db.from("rider_derived_abilities").select(["rider_id", ...ABILITY_KEYS].join(", ")).in("rider_id", riderIds.slice(i, i + 50)), "abilities"));
  }
  return { race, profiles, entries, orders, teams, abilities };
}

const abs = (p) => (path.isAbsolute(p) ? p : path.join(REPO_ROOT, p));

async function loadData(opts) {
  if (opts.fixture) return JSON.parse(readFileSync(opts.fixture === "giro" ? GIRO_FIXTURE : abs(opts.fixture), "utf8"));
  if (opts.cache && existsSync(abs(opts.cache))) return JSON.parse(readFileSync(abs(opts.cache), "utf8"));
  if (!opts.raceId && !opts.raceName) throw new Error("--race=<id>, --race-name=<navn>, --cache=<fil> eller --fixture=giro kraeves");
  return fetchRace(opts);
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const data = await loadData(opts);
  if (opts.saveCache) {
    mkdirSync(path.dirname(abs(opts.saveCache)), { recursive: true });
    writeFileSync(abs(opts.saveCache), JSON.stringify(data));
  }
  const { loadRaceEngineV4 } = await import("../../lib/raceEngineV4Bridge.js");
  const v4 = await loadRaceEngineV4();
  const runs = opts.revisions.map((revision) => runTour({ v4, data, revision, seeds: opts.seeds, leadoutPair: opts.leadoutPair }));
  const dropped = runs[0]?.droppedWithoutAbilities ?? 0;
  if (dropped > 0) console.warn(`ADVARSEL: ${dropped} ryttere paa startlisten mangler evner og er IKKE koert (feltet er mindre end i spillet).`);
  const generatedAt = new Date().toISOString();
  const raceLabel = `${data.race.name ?? data.race.id} (${data.profiles.length} etaper, ${data.entries.length} ryttere)`;
  const md = renderTourMarkdown({ raceLabel, runs, generatedAt });
  const stamp = generatedAt.slice(0, 16).replace(/[:T]/g, "-");
  const base = path.join(abs(opts.outDir), `${slug(data.race.name ?? data.race.id)}-${stamp}`);
  mkdirSync(path.dirname(base), { recursive: true });
  writeFileSync(`${base}.md`, md);
  writeFileSync(`${base}.json`, JSON.stringify({ race: data.race, generatedAt, runs }, null, 2));
  for (const r of runs) {
    const c = r.summary.counts;
    const todo = r.summary.gates.filter((g) => g.status === "todo").map((g) => g.check);
    console.log(`${r.revision}: PASS ${c.PASS} · WARN ${c.WARN} · FAIL ${c.FAIL} · TODO ${c.TODO} · N/A ${c["N/A"]}${todo.length ? ` (kendte aabne gates: ${todo.join(", ")})` : ""}`);
  }
  console.log(`Scorecard: ${base}.md (+ .json)`);
  return { runs, base };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
