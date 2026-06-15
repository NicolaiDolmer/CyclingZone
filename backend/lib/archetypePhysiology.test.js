import test from "node:test";
import assert from "node:assert/strict";

import { makeRng } from "./fictionalRiderGenerator.js";
import { seedArchetypePhysiology, PHYSIOLOGY_ARCHETYPES } from "./archetypePhysiology.js";

const ctx = (archetype, over = {}) => ({
  archetype, tierLevel: 0.6, height_cm: 178, weight_kg: 68, rng: makeRng(123), ...over,
});

test("determinisme: samme arketype+tier+krop+seed → identisk profil", () => {
  const a = seedArchetypePhysiology(ctx("climber"));
  const b = seedArchetypePhysiology(ctx("climber"));
  assert.deepEqual(a, b);
});

test("alle 9 arketyper har en skew-profil", () => {
  for (const a of ["sprinter","leadout","tt","climber","puncheur","brostensrytter","baroudeur","rouleur","gc"]) {
    assert.ok(PHYSIOLOGY_ARCHETYPES[a], `mangler ${a}`);
  }
});

test("+3 nye metrics produceres (power_2m_wkg, power_10m_wkg, aero)", () => {
  const p = seedArchetypePhysiology(ctx("tt"));
  for (const k of ["power_2m_wkg","power_10m_wkg","aero"]) {
    assert.ok(Number.isFinite(p[k]), `${k} mangler/ikke-finit: ${p[k]}`);
  }
});

test("arketype-skew: climber har højere ftp_wkg + lavere pmax_watts end sprinter (samme krop+tier)", () => {
  const body = { height_cm: 178, weight_kg: 68, tierLevel: 0.6, rng: makeRng(7) };
  const climber = seedArchetypePhysiology({ archetype: "climber", ...body, rng: makeRng(7) });
  const sprinter = seedArchetypePhysiology({ archetype: "sprinter", ...body, rng: makeRng(7) });
  assert.ok(climber.ftp_wkg > sprinter.ftp_wkg, `climber ftp_wkg ${climber.ftp_wkg} ikke > sprinter ${sprinter.ftp_wkg}`);
  assert.ok(sprinter.pmax_watts > climber.pmax_watts, `sprinter pmax ${sprinter.pmax_watts} ikke > climber ${climber.pmax_watts}`);
});

test("monoton power-kurve: 5s ≥ 15s ≥ 1m ≥ 2m ≥ 5m ≥ 10m, og 5m ≥ ftp", () => {
  const p = seedArchetypePhysiology(ctx("puncheur"));
  assert.ok(p.power_5s_wkg >= p.power_15s_wkg - 1e-9);
  assert.ok(p.power_15s_wkg >= p.power_1m_wkg - 1e-9);
  assert.ok(p.power_1m_wkg >= p.power_2m_wkg - 1e-9);
  assert.ok(p.power_2m_wkg >= p.power_5m_wkg - 1e-9);
  assert.ok(p.power_5m_wkg >= p.power_10m_wkg - 1e-9);
  assert.ok(p.power_10m_wkg >= p.ftp_wkg - 1e-9);
});

test("tier-monotoni: højere tier → ikke-lavere ftp_wkg (alt andet lige)", () => {
  const lo = seedArchetypePhysiology(ctx("gc", { tierLevel: 0.2, rng: makeRng(9) }));
  const hi = seedArchetypePhysiology(ctx("gc", { tierLevel: 0.95, rng: makeRng(9) }));
  assert.ok(hi.ftp_wkg >= lo.ftp_wkg, `hi ${hi.ftp_wkg} < lo ${lo.ftp_wkg}`);
});
