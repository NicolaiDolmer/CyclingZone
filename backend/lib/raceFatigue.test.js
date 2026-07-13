import { test } from "node:test";
import assert from "node:assert/strict";

import { raceFatigueLoad, applyRaceFatigue, stageEnteringFatigues } from "./raceFatigue.js";

// ── raceFatigueLoad ───────────────────────────────────────────────────────────

test("raceFatigueLoad: hårdere profiler koster mere end lette", () => {
  assert.ok(
    raceFatigueLoad("high_mountain") > raceFatigueLoad("mountain"),
    "high_mountain > mountain"
  );
  assert.ok(
    raceFatigueLoad("mountain") > raceFatigueLoad("flat"),
    "mountain > flat"
  );
  assert.ok(
    raceFatigueLoad("hilly") > raceFatigueLoad("rolling"),
    "hilly > rolling"
  );
});

test("raceFatigueLoad: alle kendte profiler er bounded 8–25", () => {
  const profiles = ["flat", "rolling", "hilly", "classic", "cobbles", "mountain", "high_mountain", "itt", "ttt"];
  for (const p of profiles) {
    const load = raceFatigueLoad(p);
    assert.ok(load >= 8 && load <= 25, `${p}: ${load} ikke i [8,25]`);
  }
});

test("raceFatigueLoad: ukendt profil → 12 (rolling-default)", () => {
  assert.equal(raceFatigueLoad("ukendtprofil"), 12);
  assert.equal(raceFatigueLoad(undefined), 12);
  assert.equal(raceFatigueLoad(null), 12);
  assert.equal(raceFatigueLoad(""), 12);
});

// ── applyRaceFatigue ──────────────────────────────────────────────────────────

// Minimal mock-supabase der sporer upsert-kald.
function makeSupabase({ conditionRows = [], selectError = null, upsertError = null } = {}) {
  const calls = [];
  function from(table) {
    const b = {
      select() { return b; },
      in()     { return b; },
      upsert(rows, opts) {
        calls.push({ table, op: "upsert", rows, opts });
        if (upsertError) return Promise.resolve({ error: upsertError });
        return Promise.resolve({ error: null });
      },
      then(resolve, reject) {
        if (selectError) return Promise.resolve({ data: null, error: selectError }).then(resolve, reject);
        return Promise.resolve({ data: conditionRows, error: null }).then(resolve, reject);
      },
    };
    return b;
  }
  return { from, __calls: calls };
}

test("applyRaceFatigue: eksisterende række får +load, clamped ved 100", async () => {
  const supabase = makeSupabase({ conditionRows: [{ rider_id: "r1", fatigue: 90 }] });
  const result = await applyRaceFatigue({ supabase, riderIds: ["r1"], profileType: "mountain" }); // load=18
  assert.equal(result.updated, 1);
  const upserted = supabase.__calls.find((c) => c.op === "upsert");
  assert.ok(upserted, "ingen upsert kaldt");
  const row = upserted.rows.find((r) => r.rider_id === "r1");
  // 90 + 18 = 108 → clamped til 100
  assert.equal(row.fatigue, 100, `forventet 100, fik ${row.fatigue}`);
});

test("applyRaceFatigue: rytter uden eksisterende condition-række starter fra 0+load", async () => {
  const supabase = makeSupabase({ conditionRows: [] }); // ingen eksisterende rækker
  await applyRaceFatigue({ supabase, riderIds: ["r-ny"], profileType: "flat" }); // load=10
  const upserted = supabase.__calls.find((c) => c.op === "upsert");
  const row = upserted.rows.find((r) => r.rider_id === "r-ny");
  assert.equal(row.fatigue, 10, `forventet 10 (0+10), fik ${row.fatigue}`);
});

test("applyRaceFatigue: tom riderIds → {updated:0} uden DB-queries", async () => {
  const supabase = makeSupabase();
  const result = await applyRaceFatigue({ supabase, riderIds: [], profileType: "flat" });
  assert.equal(result.updated, 0);
  assert.equal(supabase.__calls.length, 0, "ingen DB-kald ved tom riderIds");
});

test("applyRaceFatigue: null/undefined riderIds → {updated:0} uden DB-queries", async () => {
  const supabase = makeSupabase();
  const r1 = await applyRaceFatigue({ supabase, riderIds: null, profileType: "flat" });
  const r2 = await applyRaceFatigue({ supabase, riderIds: undefined, profileType: "flat" });
  assert.equal(r1.updated, 0);
  assert.equal(r2.updated, 0);
  assert.equal(supabase.__calls.length, 0);
});

test("applyRaceFatigue: select-fejl → kaster Error (kald-stedet sluger)", async () => {
  const supabase = makeSupabase({ selectError: { message: "connection refused" } });
  await assert.rejects(
    () => applyRaceFatigue({ supabase, riderIds: ["r1"], profileType: "flat" }),
    /rider_condition \(race fatigue\)/
  );
});

test("applyRaceFatigue: upsert-fejl → kaster Error (kald-stedet sluger)", async () => {
  const supabase = makeSupabase({
    conditionRows: [{ rider_id: "r1", fatigue: 20 }],
    upsertError: { message: "upsert boom" },
  });
  await assert.rejects(
    () => applyRaceFatigue({ supabase, riderIds: ["r1"], profileType: "flat" }),
    /rider_condition upsert \(race fatigue\)/
  );
});

test("applyRaceFatigue: updated_at sættes fra 'now'-parametren", async () => {
  const supabase = makeSupabase({ conditionRows: [] });
  const fixedNow = new Date("2026-06-12T10:00:00Z");
  await applyRaceFatigue({ supabase, riderIds: ["r1"], profileType: "rolling", now: fixedNow });
  const upserted = supabase.__calls.find((c) => c.op === "upsert");
  const row = upserted.rows.find((r) => r.rider_id === "r1");
  assert.equal(row.updated_at, "2026-06-12T10:00:00.000Z");
});

test("applyRaceFatigue: onConflict sat til rider_id i upsert-opts", async () => {
  const supabase = makeSupabase({ conditionRows: [] });
  await applyRaceFatigue({ supabase, riderIds: ["r1"], profileType: "flat" });
  const upserted = supabase.__calls.find((c) => c.op === "upsert");
  assert.equal(upserted.opts?.onConflict, "rider_id");
});

// ── stageEnteringFatigues (#1021-hybrid: intra-løb akkumulering) ───────────────

test("stageEnteringFatigues: load lægges til EFTER hver etape, så etape 1 køres frisk", () => {
  // flat=10, mountain=18, high_mountain=20. Start 0.
  // Entering hver etape = [0, 0+10, 10+18] = [0, 10, 28].
  assert.deepEqual(stageEnteringFatigues(0, ["flat", "mountain", "high_mountain"]), [0, 10, 28]);
});

test("stageEnteringFatigues: start-træthed bæres med ind i etape 1", () => {
  assert.deepEqual(stageEnteringFatigues(40, ["flat", "flat"]), [40, 50]);
});

test("stageEnteringFatigues: null/undefined/NaN start → 0 (neutral, ikke worst-case)", () => {
  assert.deepEqual(stageEnteringFatigues(null, ["mountain"]), [0]);
  assert.deepEqual(stageEnteringFatigues(undefined, ["flat"]), [0]);
  assert.deepEqual(stageEnteringFatigues("x", ["flat"]), [0]);
});

test("stageEnteringFatigues: clamp ved 100 over en lang tour", () => {
  const seq = stageEnteringFatigues(0, Array(21).fill("high_mountain")); // load 20/etape
  assert.equal(seq[0], 0);
  assert.equal(seq[5], 100); // 0,20,40,60,80,100,...
  assert.ok(seq.every((v) => v >= 0 && v <= 100));
});

test("stageEnteringFatigues: tom etape-liste → tom sekvens", () => {
  assert.deepEqual(stageEnteringFatigues(50, []), []);
});

// ── Race v3 S1 (#2352): effort-kobling (dormant seam, default='normal') ───────

test("stageEnteringFatigues: uden opts (default) er BIT-IDENTISK med eksplicit effort='normal'", () => {
  assert.deepEqual(
    stageEnteringFatigues(0, ["flat", "mountain", "high_mountain"]),
    stageEnteringFatigues(0, ["flat", "mountain", "high_mountain"], { effort: "normal" }),
  );
});

test("stageEnteringFatigues: effort='protect' giver +20% belastning pr. etape", () => {
  // flat=10 → protect: 10*1.2=12. Entering: [0, 12].
  const seq = stageEnteringFatigues(0, ["flat", "flat"], { effort: "protect" });
  assert.deepEqual(seq, [0, 12]);
});

test("stageEnteringFatigues: effort='save' giver -30% belastning pr. etape", () => {
  // flat=10 → save: 10*0.7=7. Entering: [0, 7].
  const seq = stageEnteringFatigues(0, ["flat", "flat"], { effort: "save" });
  assert.deepEqual(seq, [0, 7]);
});

test("stageEnteringFatigues: protect > normal > save i akkumuleret belastning", () => {
  const profiles = ["mountain", "mountain", "mountain"];
  const protect = stageEnteringFatigues(0, profiles, { effort: "protect" });
  const normal = stageEnteringFatigues(0, profiles);
  const save = stageEnteringFatigues(0, profiles, { effort: "save" });
  assert.ok(protect[2] > normal[2], `protect (${protect[2]}) skal være > normal (${normal[2]})`);
  assert.ok(normal[2] > save[2], `normal (${normal[2]}) skal være > save (${save[2]})`);
});

// ── Race v3 S3 (#2034): efforts-array (ét effort PR. ETAPE) ────────────────────

test("stageEnteringFatigues: uden 'efforts' er BIT-IDENTISK med det gamle enkelt-effort-flow", () => {
  const profiles = ["flat", "mountain", "high_mountain"];
  assert.deepEqual(stageEnteringFatigues(0, profiles), stageEnteringFatigues(0, profiles, {}));
});

test("stageEnteringFatigues: 'efforts' giver ét effort pr. etape, uafhængigt af hinanden", () => {
  // flat=10, mountain=18. Etape 1 protect (10*1.2=12), etape 2 save (18*0.7=12.6).
  const seq = stageEnteringFatigues(0, ["flat", "mountain"], { efforts: ["protect", "save"] });
  assert.deepEqual(seq, [0, 12]);
});

test("stageEnteringFatigues: 'efforts' kortere end profileTypes → manglende etaper falder til 'normal'", () => {
  const withShortEfforts = stageEnteringFatigues(0, ["flat", "flat"], { efforts: ["protect"] });
  const withExplicitNormal = stageEnteringFatigues(0, ["flat", "flat"], { efforts: ["protect", "normal"] });
  assert.deepEqual(withShortEfforts, withExplicitNormal);
});

test("stageEnteringFatigues: 'efforts' vinder over 'effort' når begge er sat", () => {
  const seq = stageEnteringFatigues(0, ["flat", "flat"], { effort: "save", efforts: ["protect", "protect"] });
  // Havde 'effort' (save) vundet, ville load være 7 pr. etape; 'efforts' (protect) giver 12.
  assert.deepEqual(seq, [0, 12]);
});

// ── Race v3 S3 (#2034): applyRaceFatigue({ effortByRider }) ───────────────────

test("applyRaceFatigue: uden effortByRider er BIT-IDENTISK med multiplikator 1.0 (før S3)", async () => {
  const supabase = makeSupabase({ conditionRows: [{ rider_id: "r1", fatigue: 20 }] });
  await applyRaceFatigue({ supabase, riderIds: ["r1"], profileType: "mountain" }); // load=18
  const row = supabase.__calls.find((c) => c.op === "upsert").rows.find((r) => r.rider_id === "r1");
  assert.equal(row.fatigue, 38); // 20 + 18*1.0
});

test("applyRaceFatigue: effortByRider ganger DENNE rytters load med effortFatigueMultiplier", async () => {
  const supabase = makeSupabase({ conditionRows: [{ rider_id: "r1", fatigue: 20 }] });
  const effortByRider = new Map([["r1", "protect"]]);
  await applyRaceFatigue({ supabase, riderIds: ["r1"], profileType: "mountain", effortByRider }); // load=18*1.2=21.6
  const row = supabase.__calls.find((c) => c.op === "upsert").rows.find((r) => r.rider_id === "r1");
  assert.equal(row.fatigue, 42); // 20 + 18*1.2 = 41.6 → afrundet 42 (smallint)
});

test("applyRaceFatigue: fatigue skrives ALTID som heltal (smallint) — aldrig float", async () => {
  // Regression (Sentry CYCLINGZONE-30 / Supabase 22P02): 32 + mountain(18)*protect(1.2)
  // = 53.599999999999994 i floating point → tidligere sendt rå til en smallint-kolonne
  // → "invalid input syntax for type smallint". Skal nu afrundes til 54.
  const supabase = makeSupabase({ conditionRows: [{ rider_id: "r1", fatigue: 32 }] });
  const effortByRider = new Map([["r1", "protect"]]);
  await applyRaceFatigue({ supabase, riderIds: ["r1"], profileType: "mountain", effortByRider });
  const row = supabase.__calls.find((c) => c.op === "upsert").rows.find((r) => r.rider_id === "r1");
  assert.ok(Number.isInteger(row.fatigue), `fatigue skal være heltal, fik ${row.fatigue}`);
  assert.equal(row.fatigue, 54);
});

test("applyRaceFatigue: rytter uden nøgle i effortByRider falder til multiplikator 1.0 (normal)", async () => {
  const supabase = makeSupabase({ conditionRows: [{ rider_id: "r1", fatigue: 20 }, { rider_id: "r2", fatigue: 20 }] });
  const effortByRider = new Map([["r1", "save"]]); // kun r1 nævnt
  await applyRaceFatigue({ supabase, riderIds: ["r1", "r2"], profileType: "flat", effortByRider }); // load=10
  const rows = supabase.__calls.find((c) => c.op === "upsert").rows;
  assert.equal(rows.find((r) => r.rider_id === "r1").fatigue, 27); // 20 + 10*0.7
  assert.equal(rows.find((r) => r.rider_id === "r2").fatigue, 30); // 20 + 10*1.0 (ikke i map → normal)
});
