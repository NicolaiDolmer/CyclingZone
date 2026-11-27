// #8830 (review 27/11): ungdommens S6-afslutningsvaegte skal virke i den sti, der SKRIVER
// kalenderen (materializeTierCalendars med dryRun: false), ikke kun i en offline-plan.
// Foer rettelsen sendte seedRaceFor ikke `squad` med, saa en U23-/junior-mini-GT fik seniorens
// GT-afslutninger. Her koeres materializeTierCalendars mod en skrivbar falsk supabase.
//
// U23 LOESNING A (ejer 27/11): ungdommens mini-GT'er doemmes i S5-benchmark-gaten mod deres egen
// bjergtop-kvote (summen af bjergtop-terraenerne, eksakt). Testen doemmer (1) at squad naar
// generatoren i de profiler apply indsaetter (tierProfiles = dry-runnens profilesByPoolRaceId, #5405),
// og (2) at apply nu SKRIVER for baade U23 og junior med ungdommens bjergtoppe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runOfflineSeasonGates } from "../scripts/dev/seasonCalendarGatesOffline.mjs";
import { seniorAnchorsFromPlan, buildMiniEditionRow } from "./youthMiniEditions7471.js";
import { materializeTierCalendars } from "./tierCalendarMaterializer.js";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const MOUNTAIN = new Set(["mountain", "high_mountain"]);

/** Skrivbar falsk supabase (samme filter-grammatik som makeFixtureSupabase). @param {Record<string, any[]>} state */
function writableSupabase(state) {
  let seq = 1;
  /** @param {string} table */
  function from(table) {
    if (!state[table]) state[table] = [];
    /** @type {any[]} */
    const filters = [];
    /** @param {any} row */
    const matches = (row) => filters.every((f) =>
      f.t === "eq" ? row[f.c] === f.v : f.t === "in" ? f.v.includes(row[f.c])
        : f.t === "is" ? (row[f.c] ?? null) === f.v
          : f.t === "or" ? f.conds.some((/** @type {string} */ c) => {
            const [col, op, ...rest] = c.split(".");
            const raw = rest.join(".");
            if (op === "is") return (row[col] ?? null) === (raw === "null" ? null : raw);
            if (op === "eq") return row[col] === raw;
            throw new Error(`uunderstoettet .or()-operator ${op}`);
          }) : true);
    /** @type {any} */
    let opts = null;
    /** @type {any} */
    const b = {
      select(/** @type {any} */ _c, /** @type {any} */ o) { opts = o || null; return b; },
      eq(/** @type {string} */ c, /** @type {any} */ v) { filters.push({ t: "eq", c, v }); return b; },
      in(/** @type {string} */ c, /** @type {any[]} */ v) { filters.push({ t: "in", c, v }); return b; },
      is(/** @type {string} */ c, /** @type {any} */ v) { filters.push({ t: "is", c, v }); return b; },
      or(/** @type {string} */ e) { filters.push({ t: "or", conds: String(e).split(",") }); return b; },
      order() { return b; },
      limit() { return b; },
      range(/** @type {number} */ x, /** @type {number} */ y) { return Promise.resolve({ data: state[table].filter(matches).slice(x, y + 1), error: null }); },
      maybeSingle() { return Promise.resolve({ data: state[table].filter(matches)[0] ?? null, error: null }); },
      insert(/** @type {any} */ payload) {
        const rows = (Array.isArray(payload) ? payload : [payload]).map((r) => ({ id: `${table}-${seq++}`, ...r }));
        state[table].push(...rows.map((r) => JSON.parse(JSON.stringify(r))));
        return {
          select() { return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null }); },
          then(/** @type {any} */ res, /** @type {any} */ rej) { return Promise.resolve({ data: null, error: null }).then(res, rej); },
        };
      },
      update(/** @type {any} */ patch) {
        const chain = {
          eq(/** @type {string} */ c, /** @type {any} */ v) { filters.push({ t: "eq", c, v }); return chain; },
          in(/** @type {string} */ c, /** @type {any[]} */ v) { filters.push({ t: "in", c, v }); return chain; },
          then(/** @type {any} */ res, /** @type {any} */ rej) {
            for (const row of state[table]) if (matches(row)) Object.assign(row, patch);
            return Promise.resolve({ data: null, error: null }).then(res, rej);
          },
        };
        return chain;
      },
      then(/** @type {any} */ res, /** @type {any} */ rej) {
        if (opts?.head) return Promise.resolve({ count: state[table].filter(matches).length, data: null, error: null }).then(res, rej);
        return Promise.resolve({ data: state[table].filter(matches), error: null }).then(res, rej);
      },
    };
    return b;
  }
  return { from, state };
}

test("#8830 skrive-stien: ungdoms-mini-GT'en faar ungdommens bjergtoppe, og apply skriver for begge trupper (U23 loesning A)", { timeout: 300000 }, async () => {
  const youthFx = JSON.parse(readFileSync(join(FIX, "youthMiniEditions7471.json"), "utf8"));
  const catalog = JSON.parse(readFileSync(join(FIX, "racePoolCatalog.prod.json"), "utf8")).catalog;
  const senior = await runOfflineSeasonGates({ seasonNumber: 6, firstDay: "2026-11-30", lastDay: "2026-12-26", raceDayTarget: 140, baseSeed: 1 });
  const anchors = seniorAnchorsFromPlan({ tierPlan: senior.plan.planTiers.find((t) => t.tier === 1), catalog });
  for (const squad of ["u23", "junior"]) {
    const minis = youthFx.catalog.map((c) => ({ ...buildMiniEditionRow(c, squad), retired_at: null }));
    const sb = writableSupabase({
      league_divisions: [{ id: 900, tier: 1, pool_index: 0, label: `${squad} 1`, squad, retired_at: null }],
      teams: [], race_pool: minis, races: [], race_stage_profiles: [], race_stage_schedule: [], seasons: [],
    });
    const args = {
      supabase: sb, seasonId: "00000000-0000-0000-0000-000000000006", seasonNumber: 6, seasonStartDate: "2026-11-30",
      from: new Date("2026-11-29T12:00:00Z"), baseSeed: 1, realDays: 27, raceDayTarget: 140,
      seasonTransitionAt: null, seasonLastRaceDay: null, squad, seniorMiniAnchors: anchors,
    };
    const plan = await materializeTierCalendars({ ...args, dryRun: true });
    const tier = plan.planTiers[0];
    const gtIds = new Set(tier.pools[0].raceRows
      .filter((r) => r.race_type === "stage_race" && ["TourFrance", "GiroVuelta"].includes(r.race_class))
      .map((r) => r.pool_race_id));
    assert.ok(gtIds.size > 0, `${squad}: kalenderen har ingen mini-GT`);
    const mountainStages = [...tier.profilesByPoolRaceId].filter(([id]) => gtIds.has(id))
      .flatMap(([id, st]) => st.map((p) => ({ ...p, race_id: id }))).filter((p) => MOUNTAIN.has(p.profile_type));
    assert.ok(mountainStages.length > 0, `${squad}: mini-GT'erne har ingen bjergetaper`);
    const notSummit = mountainStages.filter((p) => p.finale_type !== "long_climb");
    assert.deepEqual(notSummit.map((p) => `${p.race_id} etape ${p.stage_number}: ${p.profile_type}/${p.finale_type}`), [],
      `${squad}: alle bjergetaper i en ungdoms-mini-GT ender paa toppen (squad naar generatoren i apply-stien)`);
    // U23 (loesning A, ejer 27/11) og junior: apply skriver, og de INDSATTE profiler har ungdommens bjergtoppe.
    const summary = await materializeTierCalendars({ ...args, dryRun: false });
    assert.ok(summary.racesInserted > 0, `${squad}: apply indsatte ingen loeb`);
    const insertedGt = new Set(sb.state.races.filter((r) => gtIds.has(r.pool_race_id)).map((r) => r.id));
    const insertedMountain = sb.state.race_stage_profiles.filter((p) => insertedGt.has(p.race_id) && MOUNTAIN.has(p.profile_type));
    assert.equal(insertedMountain.length, mountainStages.length, `${squad}: apply indsatte de samme bjergetaper som planen`);
    assert.ok(insertedMountain.every((p) => p.finale_type === "long_climb"), `${squad}: indsatte bjergetaper ender paa toppen`);
  }
});
