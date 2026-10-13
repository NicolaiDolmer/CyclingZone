// backend/lib/stageProfileLegacyMapping.test.js
// #6369 Fase 0: S5-ordforraadet (stageProfileTypes.js), migrationen og legacy-mappingen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  LEGACY_PROFILE_TYPES, S5_NEW_PROFILE_TYPES, STAGE_PROFILE_TYPES,
  LEGACY_FINALE_TYPES, S5_NEW_FINALE_TYPES, STAGE_FINALE_TYPES,
  FINALE_TYPE_ALIASES, canonicalFinaleType,
  TERRAIN_TYPES, FINISH_TYPES, SURFACE_TYPES, SECTOR_KINDS,
  FINISH_MATRIX, TIME_TRIAL_FINISH_TYPES, isFinishAllowed,
  S5_PLACEHOLDER_SOURCE_PROFILE, withS5ProfilePlaceholders,
} from "./stageProfileTypes.js";
import { legacyStageToS5Axes, summarizeSectors, surfaceOf } from "./stageProfileLegacyMapping.js";
import { PROFILE_TYPES, FINALE_TYPES, DEMAND_VECTORS } from "./raceStageProfileGenerator.js";

const MIGRATION = new URL("../../database/2026-10-13-6369-s5-stage-profile-types.sql", import.meta.url);

function checkList(sql, constraint) {
  const block = sql.split(`ADD CONSTRAINT ${constraint}`)[1];
  assert.ok(block, `${constraint} findes i migrationen`);
  const m = block.match(/IN\s*\(([^)]*)\)/);
  assert.ok(m, `${constraint}: IN-listen findes`);
  return m[1].split(",").map((s) => s.trim().replace(/'/g, ""));
}

// ── Ordforraadet ───────────────────────────────────────────────────────────────

test("S5-listerne er de gamle + de nye; intet gammelt er fjernet (S1-S4-historik)", () => {
  assert.deepEqual([...STAGE_PROFILE_TYPES].sort(), [...LEGACY_PROFILE_TYPES, ...S5_NEW_PROFILE_TYPES].sort());
  assert.deepEqual([...STAGE_FINALE_TYPES], [...LEGACY_FINALE_TYPES, ...S5_NEW_FINALE_TYPES]);
  assert.equal(new Set(STAGE_PROFILE_TYPES).size, STAGE_PROFILE_TYPES.length);
  assert.equal(new Set(STAGE_FINALE_TYPES).size, STAGE_FINALE_TYPES.length);
  assert.deepEqual([...S5_NEW_PROFILE_TYPES], ["medium_mountain"]);
  assert.deepEqual([...S5_NEW_FINALE_TYPES], ["flat_sprint", "uphill_sprint", "wall_finish"]);
});

test("generatoren re-eksporterer S5-listerne (én kilde, ingen haandholdt kopi)", () => {
  assert.equal(PROFILE_TYPES, STAGE_PROFILE_TYPES);
  assert.equal(FINALE_TYPES, STAGE_FINALE_TYPES);
});

test("migrationen udvider de to CHECK'er til praecis S5-listerne, additivt og idempotent", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  assert.deepEqual(checkList(sql, "race_stage_profiles_profile_type_check"), [...STAGE_PROFILE_TYPES]);
  assert.deepEqual(checkList(sql, "race_stage_profiles_finale_type_check"), [...STAGE_FINALE_TYPES]);
  assert.match(sql, /finale_type IS NULL OR/, "finale_type maa fortsat vaere NULL");
  assert.match(sql, /DROP CONSTRAINT IF EXISTS race_stage_profiles_profile_type_check/);
  assert.match(sql, /DROP CONSTRAINT IF EXISTS race_stage_profiles_finale_type_check/);
  assert.match(sql, /lock_timeout/);
  const code = sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
  assert.doesNotMatch(code, /\bUPDATE\b|\bDELETE\b|\bINSERT\b/i);
  assert.doesNotMatch(code, /races_engine_rules_revision_check/, "regel-revisionens CHECK hoerer til taend-PR'en");
});

test("flat_sprint er alias for de gamle spurt-vaerdier; ukendt -> null", () => {
  assert.equal(canonicalFinaleType("bunch_sprint"), "flat_sprint");
  assert.equal(canonicalFinaleType("reduced_sprint"), "flat_sprint");
  assert.equal(canonicalFinaleType("flat_sprint"), "flat_sprint");
  assert.equal(canonicalFinaleType("wall_finish"), "wall_finish");
  assert.equal(canonicalFinaleType("punch"), "punch");
  for (const bad of [null, undefined, "", "sprint", 3]) assert.equal(canonicalFinaleType(bad), null);
  for (const [from, to] of Object.entries(FINALE_TYPE_ALIASES)) {
    assert.ok(LEGACY_FINALE_TYPES.includes(from));
    assert.ok(STAGE_FINALE_TYPES.includes(to));
  }
});

test("akserne: terraen er en delmaengde af profile_type, afslutninger uden udbrud", () => {
  for (const t of TERRAIN_TYPES) assert.ok(STAGE_PROFILE_TYPES.includes(t), t);
  assert.ok(!FINISH_TYPES.includes("breakaway"), "udbrud er motoradfaerd i S5, ikke en afslutning");
  for (const f of FINISH_TYPES) {
    assert.ok(f === "ttt" || STAGE_FINALE_TYPES.includes(f), `${f} er hverken en finale_type eller ttt`);
  }
  assert.deepEqual([...SURFACE_TYPES], ["asphalt", "cobbles", "gravel"]);
  assert.deepEqual([...SECTOR_KINDS], ["cobbles", "gravel"]);
});

// ── Matrixen (spec §3) ─────────────────────────────────────────────────────────

test("matrixen daekker alle seks terraener og bruger kun kendte afslutninger", () => {
  assert.deepEqual(Object.keys(FINISH_MATRIX), [...TERRAIN_TYPES]);
  for (const [terrain, finishes] of Object.entries(FINISH_MATRIX)) {
    assert.ok(finishes.length > 0, terrain);
    for (const f of finishes) {
      assert.ok(FINISH_TYPES.includes(f), `${terrain}: ${f}`);
      assert.ok(!TIME_TRIAL_FINISH_TYPES.includes(f), `${terrain}: ${f} er et format, ikke en celle`);
    }
  }
});

test("matrixen = spec §3's tabel", () => {
  assert.equal(isFinishAllowed("flat", "flat_sprint"), true);
  assert.equal(isFinishAllowed("flat", "uphill_sprint"), true);
  assert.equal(isFinishAllowed("flat", "punch"), false);
  assert.equal(isFinishAllowed("rolling", "punch"), true);
  assert.equal(isFinishAllowed("rolling", "wall_finish"), false);
  assert.equal(isFinishAllowed("hilly", "wall_finish"), true);
  assert.equal(isFinishAllowed("hilly", "long_climb"), false);
  assert.equal(isFinishAllowed("medium_mountain", "long_climb"), true);
  assert.equal(isFinishAllowed("medium_mountain", "uphill_sprint"), false);
  for (const terrain of ["mountain", "high_mountain"]) {
    assert.equal(isFinishAllowed(terrain, "long_climb"), true);
    assert.equal(isFinishAllowed(terrain, "descent"), true);
    for (const f of ["flat_sprint", "uphill_sprint", "punch", "wall_finish"]) assert.equal(isFinishAllowed(terrain, f), false);
  }
  // Nedkoersel kraever en top paa kat. 3 eller haardere: aldrig paa flad/boelget.
  assert.equal(isFinishAllowed("flat", "descent"), false);
  assert.equal(isFinishAllowed("rolling", "descent"), false);
});

test("isFinishAllowed: tidskoersler er formater; ukendte vaerdier og udbrud er aldrig lovlige", () => {
  assert.equal(isFinishAllowed("flat", "solo_tt"), true);
  assert.equal(isFinishAllowed("hilly", "ttt"), true);
  assert.equal(isFinishAllowed("cobbles", "solo_tt"), false);
  for (const t of TERRAIN_TYPES) assert.equal(isFinishAllowed(t, "breakaway"), false);
  assert.equal(isFinishAllowed("volcano", "flat_sprint"), false);
  assert.equal(isFinishAllowed("flat", "bunch_sprint"), false, "matrixen taler S5-navne; brug canonicalFinaleType foerst");
});

// ── Pladsholderne ──────────────────────────────────────────────────────────────

test("pladsholdere: alle nye profiltyper har en eksisterende kilde; eksisterende noegler roeres aldrig", () => {
  for (const t of S5_NEW_PROFILE_TYPES) assert.ok(LEGACY_PROFILE_TYPES.includes(S5_PLACEHOLDER_SOURCE_PROFILE[t]), t);
  const table = { mountain: { a: 1 }, flat: { b: 2 } };
  const out = withS5ProfilePlaceholders(table);
  assert.equal(out.medium_mountain, table.mountain);
  assert.equal(out.flat, table.flat);
  assert.deepEqual(Object.keys(table), ["mountain", "flat"], "input muteres ikke");
  assert.equal(withS5ProfilePlaceholders({ medium_mountain: 7, mountain: 1 }).medium_mountain, 7);
  assert.equal("medium_mountain" in withS5ProfilePlaceholders({ flat: 1 }), false);
  assert.equal(DEMAND_VECTORS.medium_mountain, DEMAND_VECTORS.mountain, "Fase 0 opfinder ingen nye vaegte");
});

// ── Legacy-mappingen ───────────────────────────────────────────────────────────

test("legacy: hver kendt profile_type (alle finaler + NULL) giver lovlige akse-vaerdier", () => {
  for (const profile_type of STAGE_PROFILE_TYPES) {
    for (const finale_type of [null, ...STAGE_FINALE_TYPES]) {
      const axes = legacyStageToS5Axes({ profile_type, finale_type });
      assert.ok(axes, `${profile_type}/${finale_type}`);
      assert.ok(TERRAIN_TYPES.includes(axes.terrain), `${profile_type}: terraen ${axes.terrain}`);
      assert.ok(FINISH_TYPES.includes(axes.finish), `${profile_type}/${finale_type}: afslutning ${axes.finish}`);
      assert.ok(SURFACE_TYPES.includes(axes.surface), `${profile_type}: underlag ${axes.surface}`);
      assert.notEqual(axes.finish, "breakaway");
    }
  }
});

test("legacy: de seks terraen-etiketter er sig selv; resten er markeret udledt", () => {
  for (const t of TERRAIN_TYPES) {
    const axes = legacyStageToS5Axes({ profile_type: t, finale_type: "punch" });
    assert.equal(axes.terrain, t);
    assert.equal(axes.inferred.terrain, false);
  }
  assert.deepEqual(
    Object.fromEntries(["itt", "itt_hilly", "ttt", "cobbles", "gravel", "classic"].map((p) => {
      const axes = legacyStageToS5Axes({ profile_type: p, finale_type: null });
      assert.equal(axes.inferred.terrain, true, p);
      return [p, axes.terrain];
    })),
    { itt: "flat", itt_hilly: "hilly", ttt: "flat", cobbles: "flat", gravel: "hilly", classic: "hilly" },
  );
});

test("legacy: spurterne bliver flad spurt; geometri-finalerne bevares", () => {
  const f = (profile_type, finale_type) => legacyStageToS5Axes({ profile_type, finale_type });
  assert.equal(f("flat", "bunch_sprint").finish, "flat_sprint");
  assert.equal(f("rolling", "reduced_sprint").finish, "flat_sprint");
  assert.equal(f("hilly", "punch").finish, "punch");
  assert.equal(f("mountain", "long_climb").finish, "long_climb");
  assert.equal(f("mountain", "descent").finish, "descent");
  assert.equal(f("medium_mountain", "wall_finish").finish, "wall_finish");
  assert.equal(f("flat", "uphill_sprint").finish, "uphill_sprint");
  for (const [p, fin] of [["flat", "bunch_sprint"], ["hilly", "punch"], ["mountain", "long_climb"]]) {
    assert.equal(f(p, fin).inferred.finish, false, `${p}/${fin}`);
  }
});

test("legacy: udbrud og NULL har ingen geometri -> den gamle rutes afslutning, markeret udledt", () => {
  const expected = { flat: "flat_sprint", rolling: "flat_sprint", hilly: "descent", medium_mountain: "descent", mountain: "descent", high_mountain: "descent" };
  for (const [terrain, finish] of Object.entries(expected)) {
    for (const finale_type of ["breakaway", null, undefined, "noget_ukendt"]) {
      const axes = legacyStageToS5Axes({ profile_type: terrain, finale_type });
      assert.equal(axes.finish, finish, `${terrain}/${finale_type}`);
      assert.equal(axes.inferred.finish, true, `${terrain}/${finale_type}`);
    }
  }
  assert.equal(legacyStageToS5Axes({ profile_type: "cobbles", finale_type: "breakaway" }).finish, "flat_sprint");
  assert.equal(legacyStageToS5Axes({ profile_type: "classic", finale_type: "breakaway" }).finish, "descent");
});

test("legacy: tidskoersler afgoeres af profile_type, uanset finale_type", () => {
  for (const finale_type of [null, "solo_tt", "breakaway"]) {
    assert.equal(legacyStageToS5Axes({ profile_type: "itt", finale_type }).finish, "solo_tt");
    assert.equal(legacyStageToS5Axes({ profile_type: "itt_hilly", finale_type }).finish, "solo_tt");
    assert.equal(legacyStageToS5Axes({ profile_type: "ttt", finale_type }).finish, "ttt");
    assert.equal(legacyStageToS5Axes({ profile_type: "ttt", finale_type }).inferred.finish, false);
  }
});

test("legacy: ukendt eller manglende profile_type -> null (intet frem for noget forkert)", () => {
  for (const row of [{}, { profile_type: null }, { profile_type: "volcano", finale_type: "punch" }, null, undefined]) {
    assert.equal(legacyStageToS5Axes(row), null);
  }
});

test("underlag: sektorerne vinder over etiketten; flest km afgoer; ingen sektorer -> etiketten/asfalt", () => {
  assert.equal(surfaceOf({ profile_type: "flat" }), "asphalt");
  assert.equal(surfaceOf({ profile_type: "cobbles" }), "cobbles");
  assert.equal(surfaceOf({ profile_type: "gravel", sectors: [] }), "gravel");
  assert.equal(surfaceOf({ profile_type: "classic", sectors: [{ kind: "cobbles", start_km: 200, length_km: 2.1 }] }), "cobbles");
  assert.equal(surfaceOf({
    profile_type: "cobbles",
    sectors: [{ kind: "cobbles", length_km: 1.5 }, { kind: "gravel", length_km: 4 }],
  }), "gravel");
  assert.equal(surfaceOf({
    profile_type: "gravel",
    sectors: [{ kind: "cobbles", length_km: 5 }, { kind: "gravel", length_km: 2 }],
  }), "cobbles");
  assert.equal(surfaceOf({ profile_type: "flat", sectors: [{ kind: "sand", length_km: 3 }] }), "asphalt");
  // Sektorer uden gyldig laengde afgoer intet; etiketten gaelder (CodeRabbit-fund).
  assert.equal(surfaceOf({ profile_type: "cobbles", sectors: [{ kind: "gravel", length_km: "x" }] }), "cobbles");
  assert.equal(surfaceOf({ profile_type: "flat", sectors: [{ kind: "gravel", length_km: 0 }] }), "asphalt");
  // En kort, gyldig sektor forsvinder ikke i afrundingen.
  assert.equal(surfaceOf({ profile_type: "flat", sectors: [{ kind: "gravel", length_km: 0.04 }] }), "gravel");
  assert.equal(surfaceOf({
    profile_type: "flat",
    sectors: [{ kind: "cobbles", length_km: 0.04 }, { kind: "gravel", length_km: 0.03 }],
  }), "cobbles");
});

test("summarizeSectors: antal + km pr. underlag, robust mod snavs", () => {
  assert.deepEqual(summarizeSectors(null), { cobbles: { count: 0, km: 0 }, gravel: { count: 0, km: 0 } });
  assert.deepEqual(summarizeSectors([
    { kind: "cobbles", start_km: 10, length_km: 1.2 },
    { kind: "cobbles", start_km: 30, length_km: 2.3 },
    { kind: "gravel", start_km: 50, length_km: "x" },
    { kind: "asphalt", length_km: 9 },
    null,
  ]), { cobbles: { count: 2, km: 3.5 }, gravel: { count: 1, km: 0 } });
});

test("legacyStageToS5Axes er ren: input muteres ikke, samme input -> samme output", () => {
  const row = Object.freeze({ profile_type: "cobbles", finale_type: "reduced_sprint", sectors: Object.freeze([Object.freeze({ kind: "cobbles", length_km: 2 })]) });
  const a = legacyStageToS5Axes(row);
  assert.deepEqual(a, legacyStageToS5Axes(row));
  assert.deepEqual(a, {
    terrain: "flat", finish: "flat_sprint", surface: "cobbles",
    sectors: { cobbles: { count: 1, km: 2 }, gravel: { count: 0, km: 0 } },
    inferred: { terrain: true, finish: false },
  });
});
