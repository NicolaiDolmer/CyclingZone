// Read-only simulering af prestige/spredning-kalender-rebuilden (spec 2026-06-27).
// Bygger materialiserings-planen mod ÆGTE prod-katalog + puljer UDEN writes, og printer det
// ejeren skal godkende: præcis kvote/tæthed pr. division, prestige-fordeling, eksempel-uge,
// monument-binding. Kør: infisical run --env=prod -- node scripts/dev/sim-calendar-prestige.mjs
import { createClient } from "@supabase/supabase-js";
import { buildTierMaterializationPlan, MONUMENT_GAMEDAY_BASE } from "../../lib/tierCalendarMaterializer.js";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("Mangler SUPABASE_URL/SERVICE_KEY (infisical run --env=prod)"); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// real_day 0 = mandag 29/6 (motor-genstart). buildScheduleRows: dato = from + (real_day+1).
const FROM = new Date("2026-06-28T00:00:00Z");

function isRealManager(t) { return t.is_ai === false && !t.is_bank && !t.is_frozen && !t.is_test_account; }

const { data: season } = await supabase.from("seasons").select("id, number, start_date").eq("status", "active").maybeSingle();
const { data: divisions } = await supabase.from("league_divisions").select("id, tier, pool_index, label");
const { data: teams } = await supabase.from("teams").select("league_division_id, is_ai, is_bank, is_frozen, is_test_account");
const { data: catalog } = await supabase.from("race_pool").select("id, name, race_class, race_type, stages");

const realByDiv = new Map();
for (const t of teams || []) if (isRealManager(t) && t.league_division_id != null) realByDiv.set(t.league_division_id, (realByDiv.get(t.league_division_id) || 0) + 1);
const pools = (divisions || []).map((d) => ({ id: d.id, tier: d.tier, label: d.label, realManagerCount: realByDiv.get(d.id) || 0 }));

console.log(`Aktiv sæson #${season.number}; katalog=${catalog.length} løb; from(real_day0+1)=29/6\n`);
const { tierPlans } = buildTierMaterializationPlan({ pools, catalog, from: FROM });

const cphDate = (iso) => new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", weekday: "short", day: "2-digit", month: "2-digit" }).format(new Date(iso));
const cphTime = (iso) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Copenhagen", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

for (const tp of tierPlans) {
  const pool = tp.pools[0];
  const minL = Math.min(...tp.load), maxL = Math.max(...tp.load);
  console.log(`=== TIER ${tp.tier} (${pool.raceRows.length} løb/pulje, ${tp.pools.length} pulje(r)) ===`);
  console.log(`  kvote ${tp.quota} · density ${tp.density} · totalGameDays ${tp.totalGameDays} · quotaHit ${tp.quotaHit}${tp.shortfall ? ` (shortfall ${tp.shortfall})` : ""}`);
  console.log(`  tæthed/dag: ${minL === maxL ? `PRÆCIS ${minL}` : `${minL}–${maxL} (UJÆVN!)`} · tomme dage ${tp.emptyDays} · unplaced ${tp.unplacedStages}/${tp.unplacedSingles}`);
  const byClass = {};
  for (const r of pool.raceRows) byClass[r.race_class] = (byClass[r.race_class] || 0) + 1;
  console.log(`  prestige-fordeling: ${Object.entries(byClass).map(([c, n]) => `${c}:${n}`).join(", ")}`);
  const stageRaces = pool.raceRows.filter((r) => r.race_type === "stage_race");
  console.log(`  etapeløb ${stageRaces.length} (etaper: ${stageRaces.map((r) => r.stages).sort((a, b) => b - a).join(",")})`);

  // Monument-binding-check
  const mons = pool.raceRows.filter((r) => r.race_class === "Monuments");
  if (mons.length) {
    const allBanded = mons.every((m) => pool.stageRows.filter((s) => s.pool_race_id === m.pool_race_id).every((s) => s.game_day >= MONUMENT_GAMEDAY_BASE));
    console.log(`  monumenter ${mons.length}: binding-fri ${allBanded ? "OK" : "FEJL"}`);
  }
}

// Eksempel-uge for div 1 + div 3 (de 7 første dage).
function sampleWeek(tier, label) {
  const tp = tierPlans.find((t) => t.tier === tier);
  if (!tp) return;
  const pool = tp.pools[0];
  const nameById = new Map(pool.raceRows.map((r) => [r.pool_race_id, r]));
  const byDate = new Map();
  for (const s of pool.stageRows) {
    const d = cphDate(s.scheduled_at);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(s);
  }
  console.log(`\n--- Eksempel: ${label}, første 7 dage ---`);
  const dates = [...byDate.keys()].sort((a, b) => Date.parse(byDate.get(a)[0].scheduled_at) - Date.parse(byDate.get(b)[0].scheduled_at)).slice(0, 7);
  for (const d of dates) {
    const evs = byDate.get(d).sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at));
    const line = evs.map((s) => { const r = nameById.get(s.pool_race_id); return `${cphTime(s.scheduled_at)} ${r.name}${r.stages > 1 ? ` (${s.stage_number}/${r.stages})` : ""}`; }).join(" · ");
    console.log(`  ${d}: ${line}`);
  }
}
sampleWeek(1, "Division 1");
sampleWeek(3, "Division 3 — A");

console.log("\n(dryRun — INGEN writes)");
process.exit(0);
