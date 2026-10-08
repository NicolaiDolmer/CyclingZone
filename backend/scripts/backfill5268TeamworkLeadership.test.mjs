// Tests for #5268-opfyldningen af tomme Holdarbejde/Lederskab. Ingen database.
//
// Det der skal holde (ejer-valg A + tillæg, 1/10):
//   1. Kun NULL-felter fyldes; en eksisterende værdi røres aldrig.
//   2. Værdien er fødselsformlen (deriveAbilities), ikke en kopi af den.
//   3. Idempotent: anden kørsel finder intet at fylde.
//   4. 0 ratingeffekt: rating pr. rolle før == efter.
//   5. Tør kørsel skriver intet.

import test from "node:test";
import assert from "node:assert/strict";

import {
  FILL_KEYS, buildFillPlan, applyFillToRow, ratingImpact, countNulls, distribution, pickExamples,
  lowValueDesignPoint, lowValueCandidateIds, parseArgs, backupSql, rollbackSql, backupTableName,
  renderPublicReport, renderPrivateReport, run, applyPlan,
} from "./backfill5268TeamworkLeadership.mjs";
import { deriveAbilities, CALIBRATION } from "../lib/abilityDerivation.js";
import { seedPhysiologyFromLegacy } from "../lib/physiologySeeding.js";
import { DISPLAY_RECIPE_KEYS, ratingForRole } from "../lib/weights/displayRecipes.js";
import { readOnlyFetch } from "./dry-run-5268-mental-abilities.js";

// ── Syntetisk bestand ───────────────────────────────────────────────────────
function makeRider(i, extra = {}) {
  const age = 17 + (i % 20);
  const s = (o) => 50 + ((i * 7 + o * 11) % 35);
  return {
    id: `r-${String(i).padStart(4, "0")}`,
    firstname: "Test", lastname: `Rytter ${i}`,
    birthdate: `${CALIBRATION.asOfYear - age}-06-01`,
    potentiale: 1 + (i % 6), generation_tag: null, archetype_draw: null,
    is_retired: i % 5 === 0, primary_type: ["sprinter", "climber", "rouleur"][i % 3],
    height: 180, weight: 70,
    stat_bj: s(1), stat_fl: s(2), stat_ned: s(3), stat_bro: s(4), stat_ftr: s(5),
    stat_sp: s(6), stat_acc: s(7), stat_bk: s(8), stat_kb: s(9), stat_tt: s(10),
    stat_prl: s(11), stat_udh: s(12), stat_res: s(13), stat_mod: s(14),
    ...extra,
  };
}

const birthOf = (rider) => deriveAbilities(seedPhysiologyFromLegacy(rider), rider);

// Evne-rækken: fødselsværdier for de rating-bærende evner, og teamwork/leadership
// i fire tilstande: begge NULL, kun teamwork NULL, kun leadership NULL, begge sat.
function makeRow(rider, i) {
  const b = birthOf(rider);
  const { rider_id: _id, formula_version: _fv, teamwork: _tw, leadership: _ld, hidden_potential: _hp, ...rest } = b;
  const mode = i % 4;
  return {
    rider_id: rider.id,
    ...rest,
    teamwork: mode === 0 || mode === 1 ? null : 3,
    leadership: mode === 0 || mode === 2 ? null : 42,
  };
}

function makeWorld(n = 80) {
  const riders = Array.from({ length: n }, (_, i) => makeRider(i));
  const rows = riders.map((r, i) => makeRow(r, i));
  return { riders, rows };
}

// ── 1 + 2: kun NULL, med fødselsformlen ─────────────────────────────────────
test("kun NULL-felter kommer i planen, og værdien er fødselsformlen", () => {
  const { riders, rows } = makeWorld();
  const { entries } = buildFillPlan(riders, rows);
  const byId = new Map(rows.map((r) => [r.rider_id, r]));
  assert.ok(entries.length > 0);
  for (const e of entries) {
    const row = byId.get(e.riderId);
    for (const k of FILL_KEYS) {
      if (row[k] === null) assert.equal(e.fill[k], birthOf(e.rider)[k], `${e.riderId}.${k}`);
      else assert.equal(e.fill[k], undefined, `${e.riderId}.${k} havde en værdi og må ikke fyldes`);
    }
  }
  // Rækker med begge felter sat er slet ikke med.
  const full = rows.filter((r) => r.teamwork !== null && r.leadership !== null).map((r) => r.rider_id);
  assert.ok(full.length > 0);
  for (const id of full) assert.ok(!entries.some((e) => e.riderId === id));
});

test("applyFillToRow overskriver aldrig en eksisterende værdi, heller ikke en lav", () => {
  const row = { rider_id: "x", teamwork: 2, leadership: null };
  const out = applyFillToRow(row, { teamwork: 60, leadership: 40 });
  assert.equal(out.teamwork, 2);
  assert.equal(out.leadership, 40);
  assert.equal(row.leadership, null, "input må ikke muteres");
});

test("prior-fødte ryttere springes over (de har en anden fødselsformel)", () => {
  const prior = makeRider(1, { archetype_draw: { primary: "climber", birth: { v: 1, tier: "solid", seed: 7 } } });
  const row = { rider_id: prior.id, teamwork: null, leadership: null };
  const { entries, skipped } = buildFillPlan([prior], [row]);
  assert.equal(entries.length, 0);
  assert.equal(skipped.priorBorn, 1);
});

test("rækker uden rytter springes over og tælles", () => {
  const { entries, skipped } = buildFillPlan([], [{ rider_id: "ghost", teamwork: null, leadership: null }]);
  assert.equal(entries.length, 0);
  assert.equal(skipped.noRider, 1);
});

// ── 3: idempotens ───────────────────────────────────────────────────────────
test("idempotent: efter opfyldning finder anden kørsel intet", () => {
  const { riders, rows } = makeWorld();
  const first = buildFillPlan(riders, rows);
  const fillById = new Map(first.entries.map((e) => [e.riderId, e.fill]));
  const after = rows.map((r) => (fillById.has(r.rider_id) ? applyFillToRow(r, fillById.get(r.rider_id)) : r));
  const second = buildFillPlan(riders, after);
  assert.equal(second.entries.length, 0);
  // Og at anvende samme fyld to gange giver samme række.
  for (const r of after) {
    assert.deepEqual(applyFillToRow(r, fillById.get(r.rider_id) ?? {}), r);
  }
});

// ── 4: 0 ratingeffekt ───────────────────────────────────────────────────────
test("rating pr. rolle er uændret før vs. efter for hver rytter", () => {
  const { riders, rows } = makeWorld(120);
  const { entries } = buildFillPlan(riders, rows);
  for (const e of entries) {
    const after = applyFillToRow(e.abilities, e.fill);
    for (const role of DISPLAY_RECIPE_KEYS) {
      assert.equal(ratingForRole(after, role), ratingForRole(e.abilities, role), `${e.riderId}/${role}`);
    }
  }
  const impact = ratingImpact(entries);
  assert.equal(impact.changedRiders, 0);
  assert.equal(impact.changedPairs, 0);
  assert.equal(impact.riders, entries.length);
});

// ── 5: tør kørsel skriver intet ─────────────────────────────────────────────
// Fake Supabase-klient: registrerer hvert metodekald. Læsende kæder returnerer
// data; enhver skrivende metode (update/insert/upsert/delete/rpc) registreres.
function fakeSupabase(tables) {
  const writes = [];
  const from = (table) => {
    const q = { table, filters: [] };
    const b = {
      select() { return b; },
      order() { return b; },
      in(col, vals) { q.filters.push((r) => vals.includes(r[col])); return b; },
      eq(col, v) { q.filters.push((r) => r[col] === v); return b; },
      is(col, v) { q.filters.push((r) => (r[col] ?? null) === v); return b; },
      range(a, z) {
        const data = (tables[table] ?? []).filter((r) => q.filters.every((f) => f(r))).slice(a, z + 1);
        return Promise.resolve({ data, error: null });
      },
      update(patch) {
        q.patch = patch;
        const exec = {
          eq(col, v) { q.filters.push((r) => r[col] === v); return exec; },
          is(col, v) { q.filters.push((r) => (r[col] ?? null) === v); return exec; },
          select() {
            const hit = (tables[table] ?? []).filter((r) => q.filters.every((f) => f(r)));
            for (const r of hit) Object.assign(r, patch);
            writes.push({ table, patch, n: hit.length });
            return Promise.resolve({ data: hit.map((r) => ({ rider_id: r.rider_id })), error: null });
          },
        };
        return exec;
      },
    };
    for (const m of ["insert", "upsert", "delete", "rpc"]) b[m] = () => { writes.push({ table, method: m }); return b; };
    return b;
  };
  return { from, rpc: () => { writes.push({ method: "rpc" }); }, writes };
}

test("tør kørsel (run uden --apply) kalder ingen skrivende metode", async () => {
  const { riders, rows } = makeWorld(40);
  const before = JSON.parse(JSON.stringify(rows));
  const sb = fakeSupabase({ riders, rider_derived_abilities: rows, rider_derived_ability_history: [], rider_ability_race_day_history: [] });
  const res = await run({ supabase: sb, opts: parseArgs([]), log: () => {}, now: new Date("2026-10-08T12:00:00Z") });
  assert.equal(sb.writes.length, 0);
  assert.deepEqual(rows, before, "evne-rækkerne er uændrede");
  assert.equal(res.applied, null);
  assert.ok(res.plan.entries.length > 0);
});

test("readOnlyFetch afviser enhver ikke-læsende forespørgsel", () => {
  for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
    assert.throws(() => readOnlyFetch("https://example.invalid/rest/v1/x", { method }), /ikke-læsende/);
  }
});

test("apply fylder kun NULL og er idempotent mod en fake database", async () => {
  const { riders, rows } = makeWorld(40);
  const table = "backup_5268_rider_derived_abilities_20261008";
  const backup = rows.filter((r) => r.teamwork === null || r.leadership === null)
    .map((r) => ({ rider_id: r.rider_id, teamwork: r.teamwork, leadership: r.leadership }));
  const valued = new Map(rows.map((r) => [r.rider_id, { teamwork: r.teamwork, leadership: r.leadership }]));
  const sb = fakeSupabase({ riders, rider_derived_abilities: rows, [table]: backup, rider_derived_ability_history: [], rider_ability_race_day_history: [] });
  const plan = buildFillPlan(riders, rows);
  const opts = parseArgs(["--apply", "--owner-go", `--backup-table=${table}`, `--expect-riders=${plan.entries.length}`]);
  await run({ supabase: sb, opts, log: () => {} });
  for (const r of rows) {
    const old = valued.get(r.rider_id);
    for (const k of FILL_KEYS) {
      if (old[k] !== null) assert.equal(r[k], old[k], `${r.rider_id}.${k} havde en værdi og blev rørt`);
      else assert.ok(Number.isInteger(r[k]) && r[k] >= 1, `${r.rider_id}.${k} blev ikke fyldt`);
    }
  }
  // Anden kørsel: intet at fylde, ingen nye skrivninger.
  const n = sb.writes.length;
  const res = await run({ supabase: sb, opts: parseArgs([]), log: () => {} });
  assert.equal(res.plan.entries.length, 0);
  assert.equal(sb.writes.length, n);
});

test("apply overskriver ikke et felt der har fået en værdi siden tør kørsel", async () => {
  const rider = makeRider(3);
  const row = { rider_id: rider.id, teamwork: null, leadership: null };
  const table = "backup_5268_rider_derived_abilities_20261008";
  const sb = fakeSupabase({ rider_derived_abilities: [row], [table]: [{ rider_id: rider.id, teamwork: null, leadership: null }] });
  const plan = buildFillPlan([rider], [{ ...row }]);
  row.teamwork = 4; // træning skrev evnen mellem tør kørsel og apply
  const res = await applyPlan(sb, plan, { backupTable: table, log: () => {} });
  assert.equal(row.teamwork, 4);
  assert.equal(row.leadership, plan.entries[0].fill.leadership);
  assert.equal(res.skippedSinceDryRun, 1);
});

test("apply nægter når en rytter mangler i backuppen", async () => {
  const rider = makeRider(3);
  const table = "backup_5268_rider_derived_abilities_20261008";
  const sb = fakeSupabase({ rider_derived_abilities: [{ rider_id: rider.id, teamwork: null, leadership: null }], [table]: [] });
  const plan = buildFillPlan([rider], [{ rider_id: rider.id, teamwork: null, leadership: null }]);
  await assert.rejects(() => applyPlan(sb, plan, { backupTable: table, log: () => {} }), /mangler i backup_5268/);
  assert.equal(sb.writes.length, 0);
});

test("--apply kræver owner-go, backup-tabel og forventet antal", () => {
  assert.equal(parseArgs([]).apply, false);
  assert.throws(() => parseArgs(["--apply"]), /owner-go/);
  assert.throws(() => parseArgs(["--apply", "--owner-go"]), /backup-table/);
  assert.throws(() => parseArgs(["--apply", "--owner-go", "--backup-table=evil; drop table x"]), /backup-table/);
  assert.throws(() => parseArgs(["--apply", "--owner-go", "--backup-table=backup_5268_rider_derived_abilities_20261008"]), /expect-riders/);
  assert.throws(() => parseArgs(["--bogus"]), /Ukendt/);
});

test("run med --apply nægter ved forkert --expect-riders og skriver intet", async () => {
  const { riders, rows } = makeWorld(20);
  const table = "backup_5268_rider_derived_abilities_20261008";
  const sb = fakeSupabase({ riders, rider_derived_abilities: rows, [table]: [], rider_derived_ability_history: [], rider_ability_race_day_history: [] });
  const opts = parseArgs(["--apply", "--owner-go", `--backup-table=${table}`, "--expect-riders=999999"]);
  await assert.rejects(() => run({ supabase: sb, opts, log: () => {} }), /expect-riders/);
  assert.equal(sb.writes.length, 0);
});

// ── SQL + rapport ───────────────────────────────────────────────────────────
test("backup- og rollback-SQL bruger kun et valideret tabelnavn", () => {
  const t = backupTableName(new Date("2026-10-08T10:00:00Z"));
  assert.equal(t, "backup_5268_rider_derived_abilities_20261008");
  assert.match(backupSql(t), /CREATE TABLE IF NOT EXISTS public\.backup_5268_rider_derived_abilities_20261008 AS/);
  assert.match(backupSql(t), /ENABLE ROW LEVEL SECURITY/);
  assert.match(rollbackSql(t), /SET teamwork = NULL[\s\S]*b\.teamwork IS NULL/);
  assert.match(rollbackSql(t), /SET leadership = NULL[\s\S]*b\.leadership IS NULL/);
  assert.throws(() => backupSql("riders"), /Ugyldigt/);
});

test("countNulls skelner aktive fra alle", () => {
  const riders = [makeRider(1, { is_retired: false }), makeRider(2, { is_retired: true })];
  const rows = [
    { rider_id: riders[0].id, teamwork: null, leadership: 5 },
    { rider_id: riders[1].id, teamwork: null, leadership: null },
  ];
  const c = countNulls(riders, rows);
  assert.deepEqual(c.all, { rows: 2, teamwork: 2, leadership: 1, either: 2, both: 1 });
  assert.deepEqual(c.active, { rows: 1, teamwork: 1, leadership: 0, either: 1, both: 0 });
});

test("designpunktet tæller lave værdier uden at ændre noget", () => {
  const pcm = makeRider(4, { is_retired: false });
  const prior = makeRider(5, { is_retired: false, archetype_draw: { birth: { v: 1, tier: "youth", seed: 1 } } });
  const seenHigh = makeRider(6, { is_retired: false });
  const rows = [
    { rider_id: pcm.id, teamwork: 1, leadership: null },
    { rider_id: prior.id, teamwork: 2, leadership: 3 },
    { rider_id: seenHigh.id, teamwork: 2, leadership: 40 },
  ];
  const history = [{ rider_id: seenHigh.id, teamwork: 30, leadership: null }];
  const d = lowValueDesignPoint([pcm, prior, seenHigh], rows, history);
  assert.equal(d.teamwork.total, 3);
  assert.equal(d.teamwork.priorBorn, 1);
  assert.equal(d.teamwork.pcm, 2);
  assert.equal(d.teamwork.neverAbove, 1, "rytteren set med 30 i historikken er ikke 'aldrig over'");
  assert.equal(d.teamwork.noHistoryAtAll, 1);
  assert.equal(d.leadership.total, 1);
  assert.equal(d.leadership.pcm, 0);
  assert.deepEqual(lowValueCandidateIds([pcm, prior, seenHigh], rows).sort(), [pcm.id, seenHigh.id].sort());
});

test("offentlig rapport har antal men ingen percentiler eller eksempel-værdier", () => {
  const { riders, rows } = makeWorld(60);
  const plan = buildFillPlan(riders, rows);
  const ctx = {
    stamp: "2026-10-08T12:00:00.000Z", apply: false,
    nulls: countNulls(riders, rows), plan, impact: ratingImpact(plan.entries),
    design: lowValueDesignPoint(riders, rows, []),
    table: "backup_5268_rider_derived_abilities_20261008",
    dist: distribution(plan.entries), examples: pickExamples(plan.entries, 10), privateFile: "balance-internals/5268/x.md",
  };
  const pub = renderPublicReport(ctx);
  const priv = renderPrivateReport(ctx);
  assert.ok(!/p50|p90/.test(pub), "percentiler hører til den private fil");
  assert.ok(/p50/.test(priv));
  assert.ok(!/foer -> efter/.test(pub));
  assert.ok(/Ryttere med aendret rating: \*\*0\*\*/.test(pub));
  assert.ok(pub.includes("Test Rytter"));
  assert.equal(ctx.examples.length, 10);
});
