// Read-only simulering af S3-regenereringen mod det RENSEDE katalog (#4075):
// prod-katalog filtreret til CSV'ens external_ids + arketyper fra den genbyggede JSON.
// Ingen writes. Output: D1-kalenderen (slots/gd/datoer) + profiler + nøgletal som JSON.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import { buildTierMaterializationPlan } from "../../lib/tierCalendarMaterializer.js";
import { resolveCalendarFrom } from "../../lib/calendarStartDate.js";
import { generateRaceStageProfiles } from "../../lib/raceStageProfileGenerator.js";
import { parseRacePoolCsv } from "../../lib/racePoolImport.js";
import { loadPoolsAndCatalog } from "../s3CalendarPackageScorecard.js";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const csv = readFileSync(new URL("../../../scripts/race_pool_seed.csv", import.meta.url), "utf8");
const { rows } = parseRacePoolCsv(csv);
const csvIds = new Set(rows.map((r) => r.external_id));
const arch = JSON.parse(readFileSync(new URL("../../../database/seed/race_pool_archetypes.json", import.meta.url), "utf8"));
const archById = new Map(arch.map((a) => [a.external_id, a.terrain_archetype]));

const { pools, catalog } = await loadPoolsAndCatalog(supabase);
const clean = catalog
  .filter((c) => csvIds.has(c.external_id))
  .map((c) => ({ ...c, terrain_archetype: archById.get(c.external_id) ?? c.terrain_archetype ?? null }));
// CSV-rækker der endnu ikke findes i prod (fx netop ændrede date_text/stages → ny
// external_id) syntetiseres, så simuleringen viser den kalender som seed+regen VIL give.
const prodIds = new Set(clean.map((c) => c.external_id));
for (const r of rows) {
  if (prodIds.has(r.external_id)) continue;
  clean.push({ id: "csv-" + r.external_id, external_id: r.external_id, name: r.name, race_class: r.race_class, race_type: r.race_type, stages: r.stages, date_text: r.date_text, terrain_archetype: archById.get(r.external_id) ?? null });
}
console.log(`Katalog: prod=${catalog.length} → renset=${clean.length} (CSV=${rows.length})`);

const from = resolveCalendarFrom({ firstRaceDate: "2026-08-25" });
const { tierPlans } = buildTierMaterializationPlan({ pools, catalog: clean, from, baseSeed: 1 });

const t1 = tierPlans.find((t) => t.tier === 1);
const d1 = t1.pools[0];
const nameById = new Map(clean.map((c) => [c.id, c.name]));
const classById = new Map(clean.map((c) => [c.id, c.race_class]));

for (const t of tierPlans) {
  console.log(`tier ${t.tier}: quota=${t.quota} quotaHit=${t.quotaHit} shortfall=${t.shortfall} races=${t.pools[0].raceRows.length} tomme=${t.emptyDays} udenAfgoerelse=${t.daysWithoutDecisionCount} maxOverlap=${t.maxOverlap} violations=${t.calendarViolations.length}`);
  if (t.calendarViolations.length) console.log("  VIOLATIONS:", t.calendarViolations.join(" | "));
}

// D1 slot-grid + profiler for GT'er
const raceMetaByPool = new Map(d1.raceRows.map((r) => [r.pool_race_id, r]));
const grid = d1.stageRows
  .map((s) => ({ ...s, name: nameById.get(s.pool_race_id), race_class: classById.get(s.pool_race_id), stages: raceMetaByPool.get(s.pool_race_id)?.stages }))
  .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));

const gtProfiles = {};
for (const r of d1.raceRows) {
  if (!["TourFrance", "GiroVuelta"].includes(r.race_class)) continue;
  const cat = clean.find((c) => c.id === r.pool_race_id);
  const profs = generateRaceStageProfiles({ id: r.pool_race_id, external_id: cat.external_id, terrain_archetype: cat.terrain_archetype, race_type: "stage_race", stages: r.stages, season_id: "00000000-0000-0000-0000-000000000003", season_variant: 0 });
  gtProfiles[r.name] = profs.map((p) => p.profile_type + "/" + p.finale_type);
}

writeFileSync(process.argv[2] || "sim-clean-calendar.json", JSON.stringify({ tierSummary: tierPlans.map((t) => ({ tier: t.tier, quota: t.quota, quotaHit: t.quotaHit, shortfall: t.shortfall, emptyDays: t.emptyDays, daysWithoutDecision: t.daysWithoutDecisionCount, maxOverlap: t.maxOverlap, violations: t.calendarViolations })), d1Grid: grid, gtProfiles }, null, 1));
console.log("Skrevet:", process.argv[2] || "sim-clean-calendar.json");
