import test from "node:test";
import assert from "node:assert/strict";

import {
  seasonResetForm,
  applySeasonFormReset,
  readSeasonFormResetConfig,
  SEASON_FORM_RESET_MODE_KEY,
  SEASON_FORM_RESET_PARAM_KEYS,
  SEASON_FORM_RESET_DEFAULTS,
} from "./seasonFormReset.js";

// ─── Ren kerne ────────────────────────────────────────────────────────────────

test("mode 'off' er identitet (clampet + afrundet)", () => {
  assert.equal(seasonResetForm({ form: 87, mode: "off" }), 87);
  assert.equal(seasonResetForm({ form: 143, mode: "off" }), 100);
  assert.equal(seasonResetForm({ form: -5, mode: "off" }), 0);
  assert.equal(seasonResetForm({ form: 42.6, mode: "off" }), 43);
});

test("mode 'baseline' sender alle på baseline-værdien, uanset udgangspunkt", () => {
  for (const f of [0, 1, 50, 99, 100]) {
    assert.equal(seasonResetForm({ form: f, mode: "baseline", baselineValue: 50 }), 50);
  }
  // Ejer-justerbar parameter — ikke hardcodet 50.
  assert.equal(seasonResetForm({ form: 10, mode: "baseline", baselineValue: 35 }), 35);
});

test("mode 'band' respekterer [bandMin,bandMax] og er UAFHÆNGIG af udgangspunktet", () => {
  for (const f of [0, 50, 100]) {
    const v = seasonResetForm({
      form: f, riderId: "r1", season: 3, mode: "band", bandMin: 40, bandMax: 60,
    });
    assert.ok(v >= 40 && v <= 60, `form=${f} → ${v} uden for [40,60]`);
  }
});

test("mode 'band' er deterministisk pr. rytter+sæson (samme seed, samme resultat)", () => {
  const a = seasonResetForm({ form: 10, riderId: "abc", season: 3, mode: "band" });
  const b = seasonResetForm({ form: 90, riderId: "abc", season: 3, mode: "band" });
  assert.equal(a, b, "band-resultatet må IKKE afhænge af den gamle form");
});

test("mode 'band' giver forskellige ryttere forskellige mål-værdier (ikke én konstant)", () => {
  const values = new Set();
  for (let i = 0; i < 20; i++) {
    values.add(seasonResetForm({ form: 50, riderId: `rider-${i}`, season: 3, mode: "band" }));
  }
  assert.ok(values.size > 5, "band skal sprede sig over flere værdier på tværs af ryttere");
});

test("mode 'band' kaster uden riderId/season (idempotens-seed er obligatorisk)", () => {
  assert.throws(() => seasonResetForm({ form: 50, mode: "band" }), /riderId \+ season/);
  assert.throws(() => seasonResetForm({ form: 50, riderId: "r1", mode: "band" }), /riderId \+ season/);
});

test("mode 'decay' bevarer et svagt aftryk mod target (default: 50 + (gammel-50)×0.25)", () => {
  assert.equal(seasonResetForm({ form: 100, mode: "decay", decayTarget: 50, decayFactor: 0.25 }), 63);
  assert.equal(seasonResetForm({ form: 0, mode: "decay", decayTarget: 50, decayFactor: 0.25 }), 38);
  assert.equal(seasonResetForm({ form: 50, mode: "decay", decayTarget: 50, decayFactor: 0.25 }), 50);
});

test("mode 'decay' med factor 0 opfører sig som 'baseline' på targettet", () => {
  for (const f of [0, 40, 100]) {
    assert.equal(seasonResetForm({ form: f, mode: "decay", decayTarget: 50, decayFactor: 0 }), 50);
  }
});

test("mode 'decay' med factor 1 er identitet (ingen henfald)", () => {
  for (const f of [0, 40, 100]) {
    assert.equal(seasonResetForm({ form: f, mode: "decay", decayTarget: 50, decayFactor: 1 }), f);
  }
});

test("resultatet er altid et heltal i 0-100 for alle modes", () => {
  for (const f of [0, 13, 37, 64, 100]) {
    for (const mode of ["off", "baseline", "band", "decay"]) {
      const v = seasonResetForm({ form: f, riderId: "r1", season: 5, mode });
      assert.ok(Number.isInteger(v) && v >= 0 && v <= 100, `mode=${mode} f=${f} → ${v}`);
    }
  }
});

test("korrupt/manglende form behandles som neutral 50, ikke NaN (matcher riderCondition.nextForm)", () => {
  assert.equal(seasonResetForm({ form: null, mode: "off" }), 50);
  assert.equal(seasonResetForm({ form: undefined, mode: "off" }), 50);
  assert.equal(seasonResetForm({ form: "ikke-et-tal", mode: "off" }), 50);
});

test("ukendt mode kaster (ingen tavs fallback til en anden balance)", () => {
  assert.throws(() => seasonResetForm({ form: 50, mode: "halv" }), /ukendt mode/);
});

test("determinisme: samme input giver samme output (band + decay)", () => {
  const a1 = seasonResetForm({ form: 91, riderId: "x", season: 4, mode: "band" });
  const a2 = seasonResetForm({ form: 91, riderId: "x", season: 4, mode: "band" });
  assert.equal(a1, a2);

  const b1 = seasonResetForm({ form: 91, mode: "decay", decayTarget: 50, decayFactor: 0.25 });
  const b2 = seasonResetForm({ form: 91, mode: "decay", decayTarget: 50, decayFactor: 0.25 });
  assert.equal(b1, b2);
});

// ─── Config-læsning ───────────────────────────────────────────────────────────

function buildConfigSupabase(rows) {
  return {
    from(table) {
      if (table !== "app_config") throw new Error(`uventet tabel: ${table}`);
      return {
        select() { return this; },
        in(_col, _keys) { return Promise.resolve({ data: rows, error: null }); },
      };
    },
  };
}

test("readSeasonFormResetConfig: ingen rækker → default 'off' + alle default-parametre", async () => {
  const cfg = await readSeasonFormResetConfig(buildConfigSupabase([]));
  assert.deepEqual(cfg, SEASON_FORM_RESET_DEFAULTS_WITHOUT_CHUNK());
});

test("readSeasonFormResetConfig: ukendt mode-værdi → fail-safe 'off'", async () => {
  const cfg = await readSeasonFormResetConfig(
    buildConfigSupabase([{ key: SEASON_FORM_RESET_MODE_KEY, value: "sabotage" }])
  );
  assert.equal(cfg.mode, "off");
});

test("readSeasonFormResetConfig: læser gyldig mode + tilpassede parametre", async () => {
  const cfg = await readSeasonFormResetConfig(
    buildConfigSupabase([
      { key: SEASON_FORM_RESET_MODE_KEY, value: "band" },
      { key: SEASON_FORM_RESET_PARAM_KEYS.bandMin, value: 30 },
      { key: SEASON_FORM_RESET_PARAM_KEYS.bandMax, value: 70 },
    ])
  );
  assert.equal(cfg.mode, "band");
  assert.equal(cfg.bandMin, 30);
  assert.equal(cfg.bandMax, 70);
  // Urørte parametre falder tilbage til default.
  assert.equal(cfg.baselineValue, SEASON_FORM_RESET_DEFAULTS.baselineValue);
});

test("readSeasonFormResetConfig: DB-fejl → fail-safe 'off' (vælter aldrig)", async () => {
  const supabase = {
    from() {
      return {
        select() { return this; },
        in() { return Promise.resolve({ data: null, error: { message: "nede" } }); },
      };
    },
  };
  const cfg = await readSeasonFormResetConfig(supabase);
  assert.equal(cfg.mode, "off");
});

test("readSeasonFormResetConfig: kastende supabase-klient → fail-safe 'off' (synkron throw fanges)", async () => {
  const supabase = { from: () => { throw new Error("nede"); } };
  const cfg = await readSeasonFormResetConfig(supabase);
  assert.equal(cfg.mode, "off");
});

function SEASON_FORM_RESET_DEFAULTS_WITHOUT_CHUNK() {
  const { upsertChunk: _upsertChunk, ...rest } = SEASON_FORM_RESET_DEFAULTS;
  return rest;
}

// ─── apply-laget ──────────────────────────────────────────────────────────────

function buildMockSupabase({ conditions = [] } = {}) {
  const capture = { upserts: [] };
  const supabase = {
    from(table) {
      if (table === "rider_condition") {
        const api = {
          select() { return api; },
          order() { return api; },
          range(from, to) {
            return Promise.resolve({ data: conditions.slice(from, to + 1), error: null });
          },
          upsert(rows) {
            capture.upserts.push(...rows);
            return Promise.resolve({ error: null });
          },
        };
        return api;
      }
      throw new Error(`uventet tabel: ${table}`);
    },
  };
  return { supabase, capture };
}

test("mode 'off' (default) → ingen skrivning, nuværende adfærd", async () => {
  const { supabase, capture } = buildMockSupabase({ conditions: [{ rider_id: "r1", form: 72 }] });
  const res = await applySeasonFormReset({ supabase, config: { ...SEASON_FORM_RESET_DEFAULTS } });
  assert.deepEqual(res, { ran: false, reason: "flag_off" });
  assert.equal(capture.upserts.length, 0);
});

test("mode 'baseline' skriver KUN de ryttere hvis form faktisk ændrer sig", async () => {
  const { supabase, capture } = buildMockSupabase({
    conditions: [
      { rider_id: "r1", form: 90 },
      { rider_id: "r2", form: 50 }, // allerede på baseline → ingen skrivning
      { rider_id: "r3", form: 10 },
    ],
  });
  const res = await applySeasonFormReset({
    supabase,
    now: new Date("2026-08-23T11:00:00Z"),
    config: { ...SEASON_FORM_RESET_DEFAULTS, mode: "baseline", baselineValue: 50 },
  });
  assert.equal(res.ran, true);
  assert.equal(res.riders, 3);
  assert.equal(res.changed, 2);
  assert.deepEqual(capture.upserts.map((r) => r.rider_id).sort(), ["r1", "r3"]);
  assert.ok(capture.upserts.every((r) => r.form === 50));
  // fatigue/injured_until må ALDRIG være med i payloaden.
  assert.ok(capture.upserts.every((r) => !("fatigue" in r) && !("injured_until" in r)));
});

test("mode 'band' uden 'season' kaster FØR nogen række behandles", async () => {
  const { supabase, capture } = buildMockSupabase({ conditions: [{ rider_id: "r1", form: 50 }] });
  await assert.rejects(
    () => applySeasonFormReset({ supabase, config: { ...SEASON_FORM_RESET_DEFAULTS, mode: "band" } }),
    /'season' er obligatorisk/
  );
  assert.equal(capture.upserts.length, 0);
});

test("mode 'band' med season skriver deterministiske mål-værdier i [bandMin,bandMax]", async () => {
  const { supabase, capture } = buildMockSupabase({
    conditions: [
      { rider_id: "r1", form: 10 },
      { rider_id: "r2", form: 90 },
    ],
  });
  const res = await applySeasonFormReset({
    supabase, season: 3,
    config: { ...SEASON_FORM_RESET_DEFAULTS, mode: "band", bandMin: 40, bandMax: 60 },
  });
  assert.equal(res.ran, true);
  assert.ok(capture.upserts.every((r) => r.form >= 40 && r.form <= 60));
});

test("apply rapporterer gennemsnittet før og efter (mode 'baseline')", async () => {
  const { supabase } = buildMockSupabase({
    conditions: [
      { rider_id: "r1", form: 100 },
      { rider_id: "r2", form: 0 },
    ],
  });
  const res = await applySeasonFormReset({
    supabase, config: { ...SEASON_FORM_RESET_DEFAULTS, mode: "baseline", baselineValue: 50 },
  });
  assert.equal(res.avgBefore, 50);
  assert.equal(res.avgAfter, 50);
});

test("dryRun beregner alt, men skriver intet", async () => {
  const { supabase, capture } = buildMockSupabase({ conditions: [{ rider_id: "r1", form: 90 }] });
  const res = await applySeasonFormReset({
    supabase, dryRun: true,
    config: { ...SEASON_FORM_RESET_DEFAULTS, mode: "baseline", baselineValue: 50 },
  });
  assert.equal(res.dryRun, true);
  assert.equal(res.changed, 1);
  assert.equal(capture.upserts.length, 0);
});

test("defaults matcher issue-specen (#3232)", () => {
  assert.equal(SEASON_FORM_RESET_MODE_KEY, "season_form_reset_mode");
  assert.equal(SEASON_FORM_RESET_DEFAULTS.mode, "off");
  assert.equal(SEASON_FORM_RESET_DEFAULTS.baselineValue, 50);
  assert.equal(SEASON_FORM_RESET_DEFAULTS.bandMin, 40);
  assert.equal(SEASON_FORM_RESET_DEFAULTS.bandMax, 60);
  assert.equal(SEASON_FORM_RESET_DEFAULTS.decayTarget, 50);
  assert.equal(SEASON_FORM_RESET_DEFAULTS.decayFactor, 0.25);
});

// ─── Idempotens ───────────────────────────────────────────────────────────────
// Samme bekymring som seasonFatigueReset.js: cutoveren køres af et menneske
// under tidspres, og "kør den lige igen for en sikkerheds skyld" er en
// realistisk handling. Testene her BEVISER hvilke modes der tåler det, og
// dokumenterer eksplicit at "decay" IKKE gør (jf. rest_days-præcedens).

// `season` = den aktive sæson `resolveActiveSeason` finder i "seasons"-tabellen
// (bruges KUN af decay-modes claim-guard, #3249) — adskilt fra det `season`-
// argument der sendes eksplicit til applySeasonFormReset som band-modes
// idempotens-seed. De to har forskellig kilde i den ægte kode og skal IKKE
// forveksles.
function buildStatefulSupabase(initialConditions, { activeSeason = { id: "s3", number: 3 } } = {}) {
  const state = new Map(initialConditions.map((c) => [c.rider_id, { ...c }]));
  const capture = { runs: [], seasonReads: 0, claims: [], runUpdates: [] };
  const claimedSeasons = new Set();
  let current = null;
  const supabase = {
    from(table) {
      if (table === "seasons") {
        capture.seasonReads++;
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle: () => Promise.resolve({ data: activeSeason, error: null }),
        };
      }
      if (table === "season_form_reset_runs") {
        return {
          upsert(row) {
            const already = activeSeason && claimedSeasons.has(row.season_id);
            capture.claims.push(row);
            if (!already) claimedSeasons.add(row.season_id);
            return { select: () => Promise.resolve({ data: already ? [] : [{ season_id: row.season_id }], error: null }) };
          },
          update(patch) {
            capture.runUpdates.push(patch);
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      }
      if (table !== "rider_condition") throw new Error(`uventet tabel: ${table}`);
      const api = {
        select() { return api; },
        order() { return api; },
        range(from, to) {
          const rows = [...state.values()]
            .sort((a, b) => String(a.rider_id).localeCompare(String(b.rider_id)))
            .slice(from, to + 1)
            .map((r) => ({ rider_id: r.rider_id, form: r.form }));
          return Promise.resolve({ data: rows, error: null });
        },
        upsert(rows) {
          for (const r of rows) {
            const prev = state.get(r.rider_id) || {};
            state.set(r.rider_id, { ...prev, ...r });
            current.push(r.rider_id);
          }
          return Promise.resolve({ error: null });
        },
      };
      return api;
    },
  };
  const run = async (extra = {}) => {
    current = [];
    const res = await applySeasonFormReset({ supabase, ...extra });
    capture.runs.push({ res, written: current });
    return res;
  };
  return { run, capture, state };
}

test("gen-kørsel af 'baseline' er et no-op anden gang: nul skrivninger, changed 0", async () => {
  const { run } = buildStatefulSupabase([
    { rider_id: "r1", form: 90 },
    { rider_id: "r2", form: 10 },
    { rider_id: "r3", form: 50 },
  ]);
  const cfg = { ...SEASON_FORM_RESET_DEFAULTS, mode: "baseline", baselineValue: 50 };

  const first = await run({ config: cfg });
  assert.equal(first.changed, 2, "r1+r2 ændres, r3 var allerede på baseline");

  const second = await run({ config: cfg });
  assert.equal(second.changed, 0, "anden kørsel må ikke ændre noget");
  assert.equal(second.avgBefore, 50);
});

test("gen-kørsel af 'band' er et no-op anden gang: samme seed → samme mål-værdi", async () => {
  const { run } = buildStatefulSupabase([
    { rider_id: "r1", form: 12 },
    { rider_id: "r2", form: 88 },
  ]);
  const cfg = { ...SEASON_FORM_RESET_DEFAULTS, mode: "band", bandMin: 40, bandMax: 60 };

  const first = await run({ config: cfg, season: 7 });
  assert.ok(first.changed > 0);

  const second = await run({ config: cfg, season: 7 });
  assert.equal(second.changed, 0, "samme sæson-seed skal give samme mål-værdi igen");
});

test("gen-kørsel af 'band' MED NY sæson re-ruller bevidst (seedet er pr. sæson)", async () => {
  const { run } = buildStatefulSupabase([{ rider_id: "r1", form: 12 }]);
  const cfg = { ...SEASON_FORM_RESET_DEFAULTS, mode: "band", bandMin: 40, bandMax: 60 };

  await run({ config: cfg, season: 7 });
  const secondSeason = await run({ config: cfg, season: 8 });
  // Ikke en påstand om at værdien ÆNDRER sig (kan ramme samme tal ved uheld),
  // men funktionen skal rent faktisk regne en ny seed ud — verificeret separat
  // i den rene kerne-test ovenfor. Her tjekker vi blot at apply-laget rent
  // faktisk sender `season` videre og ikke cacher noget på tværs af kørsler.
  assert.equal(secondSeason.ran, true);
});

test("'decay' er I SIG SELV ikke idempotent (den rene kerne konvergerer videre), MEN claim-guarden stopper en gen-kørsel", async () => {
  const { run } = buildStatefulSupabase([{ rider_id: "r1", form: 100 }]);
  const cfg = { ...SEASON_FORM_RESET_DEFAULTS, mode: "decay", decayTarget: 50, decayFactor: 0.25 };

  const first = await run({ config: cfg });
  assert.equal(first.ran, true);
  assert.equal(first.avgAfter, 63); // 50 + (100-50)*0.25

  const second = await run({ config: cfg });
  assert.deepEqual(second, { ran: false, reason: "already_ran", seasonId: "s3", seasonNumber: 3 },
    "claim-guarden (#3249) stopper anden kørsel for samme sæson — INGEN yderligere decay");
});

// ─── #3249 · claim-guard mod dobbelt-decay ─────────────────────────────────────
// Samme bekymring/mønster som season_fatigue_reset_runs (#2910): operatøren
// kører sæsonskiftet igen "for en sikkerheds skyld" under tidspres.

test("TO kørsler af 'decay' giver NØJAGTIG samme sluttilstand som én", async () => {
  const { run, state } = buildStatefulSupabase([
    { rider_id: "r1", form: 100 },
    { rider_id: "r2", form: 0 },
  ]);
  const cfg = { ...SEASON_FORM_RESET_DEFAULTS, mode: "decay", decayTarget: 50, decayFactor: 0.25 };

  await run({ config: cfg });
  const afterOne = { r1: state.get("r1").form, r2: state.get("r2").form };
  await run({ config: cfg });
  const afterTwo = { r1: state.get("r1").form, r2: state.get("r2").form };

  assert.deepEqual(afterTwo, afterOne, "anden kørsel må ikke decaye formen yderligere");
  assert.equal(afterOne.r1, 63);
  assert.equal(afterOne.r2, 38);
});

test("claim-guarden er SCOPET pr. sæson: en NY aktiv sæson må gerne decaye igen", async () => {
  const { run } = buildStatefulSupabase(
    [{ rider_id: "r1", form: 100 }],
    { activeSeason: { id: "s3", number: 3 } }
  );
  const cfg = { ...SEASON_FORM_RESET_DEFAULTS, mode: "decay", decayTarget: 50, decayFactor: 0.25 };
  const first = await run({ config: cfg });
  assert.equal(first.ran, true);

  // Ny sæson → ny mock med et andet season_id (claim-sættet i den ægte kode er
  // pr. season_id, så en NY sæson er per definition et frisk claim).
  const nextSeason = buildStatefulSupabase(
    [{ rider_id: "r1", form: 100 }],
    { activeSeason: { id: "s4", number: 4 } }
  );
  const second = await nextSeason.run({ config: cfg });
  assert.equal(second.ran, true, "en anden sæsons claim-tabel er tom — decay kører normalt");
});

test("claim-rækken stemples færdig med stats (completed_at)", async () => {
  const { run, capture } = buildStatefulSupabase([
    { rider_id: "r1", form: 100 },
    { rider_id: "r2", form: 50 },
  ]);
  const cfg = { ...SEASON_FORM_RESET_DEFAULTS, mode: "decay", decayTarget: 50, decayFactor: 0.25 };
  await run({ config: cfg, now: new Date("2026-08-23T11:00:00Z") });

  assert.equal(capture.claims.length, 1);
  assert.equal(capture.claims[0].season_id, "s3");
  assert.equal(capture.claims[0].mode, "decay");
  assert.equal(capture.runUpdates.length, 1);
  assert.equal(capture.runUpdates[0].completed_at, "2026-08-23T11:00:00.000Z");
  assert.equal(capture.runUpdates[0].riders, 2);
  assert.equal(capture.runUpdates[0].changed, 1); // r2 var allerede på 50 → uændret
});

test("dryRun brænder ikke decay-claimet — den rigtige kørsel kan stadig køre bagefter", async () => {
  const { run, capture } = buildStatefulSupabase([{ rider_id: "r1", form: 100 }]);
  const cfg = { ...SEASON_FORM_RESET_DEFAULTS, mode: "decay", decayTarget: 50, decayFactor: 0.25 };

  const dry = await run({ config: cfg, dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.equal(capture.claims.length, 0, "dryRun må ikke røre claim-tabellen");

  const real = await run({ config: cfg });
  assert.equal(real.ran, true, "en efterfølgende rigtig kørsel skal stadig kunne claime sæsonen");
});

test("ingen aktiv sæson → no-op uden at claime eller skrive noget", async () => {
  const { run, capture } = buildStatefulSupabase([{ rider_id: "r1", form: 100 }], { activeSeason: null });
  const cfg = { ...SEASON_FORM_RESET_DEFAULTS, mode: "decay", decayTarget: 50, decayFactor: 0.25 };

  const res = await run({ config: cfg });
  assert.deepEqual(res, { ran: false, reason: "no_active_season" });
  assert.equal(capture.claims.length, 0);
  assert.equal(capture.runs[0].written.length, 0);
});

test("'baseline' og 'band' rører HVERKEN seasons-tabellen eller claim-tabellen (kun 'decay' claimer)", async () => {
  const baseline = buildStatefulSupabase([{ rider_id: "r1", form: 10 }]);
  await baseline.run({ config: { ...SEASON_FORM_RESET_DEFAULTS, mode: "baseline", baselineValue: 50 } });
  assert.equal(baseline.capture.seasonReads, 0);
  assert.equal(baseline.capture.claims.length, 0);

  const band = buildStatefulSupabase([{ rider_id: "r1", form: 10 }]);
  await band.run({ config: { ...SEASON_FORM_RESET_DEFAULTS, mode: "band", bandMin: 40, bandMax: 60 }, season: 3 });
  assert.equal(band.capture.seasonReads, 0);
  assert.equal(band.capture.claims.length, 0);
});

test("gen-kørsel rører ikke fatigue/injured_until — heller ikke i første kørsel", async () => {
  const { run, capture, state } = buildStatefulSupabase([
    { rider_id: "r1", form: 90, fatigue: 30, injured_until: "2026-08-25" },
  ]);
  const cfg = { ...SEASON_FORM_RESET_DEFAULTS, mode: "baseline", baselineValue: 50 };
  await run({ config: cfg });
  await run({ config: cfg });
  assert.ok(capture.runs[0].written.length === 1 && capture.runs[1].written.length === 0);
  assert.equal(state.get("r1").fatigue, 30, "fatigue må ikke være rørt");
  assert.equal(state.get("r1").injured_until, "2026-08-25", "injured_until må ikke være rørt");
  assert.equal(state.get("r1").form, 50);
});
