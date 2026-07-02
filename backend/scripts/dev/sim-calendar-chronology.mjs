// Read-only simulering af kronologi-rebuilden (spec 2026-06-28). Bygger materialiserings-planen mod
// ÆGTE prod-katalog + puljer UDEN writes og printer det ejeren skal godkende:
//   - overlap-fordeling pr. division + max overlap vs cap (HARD gate)
//   - tæthed/IRL-dag (præcis density?), tomme dage, straddle
//   - Grand Tour-kronologi (21 game-dage) + IRL-fodaftryk + solo-stræk
//   - eksempel-uge (etaper pr. IRL-dag med tid + game-dag)
// Kør: infisical run --env=prod -- node scripts/dev/sim-calendar-chronology.mjs
import { createClient } from "@supabase/supabase-js";
import { buildTierMaterializationPlan, MONUMENT_GAMEDAY_BASE } from "../../lib/tierCalendarMaterializer.js";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("Mangler SUPABASE_URL/SERVICE_KEY (infisical run --env=prod)"); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const FROM = new Date("2026-06-28T00:00:00Z"); // real_day 0 = man 29/6

function isRealManager(t) { return t.is_ai === false && !t.is_bank && !t.is_frozen && !t.is_test_account; }
const { data: divisions } = await supabase.from("league_divisions").select("id, tier, pool_index, label");
const { data: teams } = await supabase.from("teams").select("league_division_id, is_ai, is_bank, is_frozen, is_test_account");
const { data: catalog } = await supabase.from("race_pool").select("id, name, race_class, race_type, stages");
const realByDiv = new Map();
for (const t of teams || []) if (isRealManager(t) && t.league_division_id != null) realByDiv.set(t.league_division_id, (realByDiv.get(t.league_division_id) || 0) + 1);
const pools = (divisions || []).map((d) => ({ id: d.id, tier: d.tier, label: d.label, realManagerCount: realByDiv.get(d.id) || 0 }));

const { tierPlans } = buildTierMaterializationPlan({ pools, catalog, from: FROM });
const cphDate = (iso) => new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", weekday: "short", day: "2-digit", month: "2-digit" }).format(new Date(iso));
const cphTime = (iso) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Copenhagen", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
const nameById = new Map(catalog.map((c) => [c.id, c.name]));

const summary = [];
for (const tp of tierPlans) {
  const pool = tp.pools[0];
  const minL = Math.min(...tp.load), maxL = Math.max(...tp.load);
  const capOk = tp.maxOverlap <= tp.overlapCap;
  console.log(`\n=== TIER ${tp.tier} — ${pool.raceRows.length} løb/pulje × ${tp.pools.length} pulje(r) ===`);
  console.log(`  kvote ${tp.quota} · density ${tp.density} · overlap-cap ${tp.overlapCap} · totalGameDays ${tp.totalGameDays} · quotaHit ${tp.quotaHit}${tp.shortfall ? ` (shortfall ${tp.shortfall})` : ""}`);
  console.log(`  tæthed/IRL-dag: ${minL === maxL ? `PRÆCIS ${minL}` : `${minL}–${maxL} (UJÆVN!)`} · tomme dage ${tp.emptyDays} · timelineLen ${tp.timelineLength} · straddle ${tp.straddleGameDays}`);
  console.log(`  OVERLAP: max ${tp.maxOverlap} (cap ${tp.overlapCap}) → ${capOk ? "OK" : "!!! OVER CAP !!!"} · histogram ${JSON.stringify(tp.overlapHistogram)}`);

  // Grand Tours: kronologi + IRL-fodaftryk.
  const gts = pool.raceRows.filter((r) => r.stages >= 15);
  for (const gt of gts) {
    const rows = pool.stageRows.filter((s) => s.pool_race_id === gt.pool_race_id);
    const gds = [...new Set(rows.map((s) => s.game_day))];
    const irlDays = new Set(rows.map((s) => cphDate(s.scheduled_at)));
    console.log(`  GT ${nameById.get(gt.pool_race_id)}: ${gt.stages} etaper · ${gds.length} game-dage · ${irlDays.size} IRL-dage`);
  }

  // Eksempel-uge (første 7 IRL-dage): etaper pr. dag.
  const byDay = new Map();
  for (const s of pool.stageRows) {
    const d = cphDate(s.scheduled_at);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(s);
  }
  const days = [...byDay.keys()].sort((a, b) => Date.parse(byDay.get(a)[0].scheduled_at) - Date.parse(byDay.get(b)[0].scheduled_at)).slice(0, 7);
  console.log(`  eksempel-uge:`);
  for (const d of days) {
    const evs = byDay.get(d).sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at));
    const distinct = new Set(evs.map((e) => e.pool_race_id)).size;
    console.log(`    ${d}: ${evs.map((e) => `${cphTime(e.scheduled_at)} ${(nameById.get(e.pool_race_id) || "?").slice(0, 18)}#${e.stage_number}(gd${e.game_day >= MONUMENT_GAMEDAY_BASE ? "M" : e.game_day})`).join(" · ")}  [${distinct} løb]`);
  }
  summary.push({ tier: tp.tier, quota: tp.quota, density: tp.density, overlapCap: tp.overlapCap, maxOverlap: tp.maxOverlap, capOk, overlapHistogram: tp.overlapHistogram, exactDensity: minL === maxL && minL === tp.density, emptyDays: tp.emptyDays, straddle: tp.straddleGameDays, timelineLength: tp.timelineLength });
}
console.log("\nJSON_SUMMARY " + JSON.stringify(summary));
