// #6110 F1, kalderne: dommerens proever doemmer buildTypePrognosisBands; her
// proeves, at fladerne faktisk sender XP-params med (profil, scouting, akademi),
// og at "slukket" (null) giver praecis det samme svar som foer.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildIntake2View, rosterPrognosis } from "./academyIntake2View.ts";
import { KNOWLEDGE_DAYS } from "./academyProspectKnowledge.ts";
import { REGISTRY_ABILITY_KEYS } from "./abilityRegistry.js";
import { createFakeSupabase } from "./testUtils/fakeSupabase.js";
import { loadScout } from "./scoutAssignmentService.js";
import { xpParams, RIGELIG_XP_RAA, DOMMER_XP_RAA } from "./dommer6110.fixtures.mjs";

const P = await xpParams();
const RIGELIG = await xpParams(RIGELIG_XP_RAA);

const abilities = {
  rider_id: "r1",
  ...Object.fromEntries(REGISTRY_ABILITY_KEYS.map((k, i) => [k, 30 + (i % 5) * 3])),
  climbing: 45,
};
const base = {
  rider: { id: "r1", birthdate: "2006-06-15" },
  abilities,
  potRow: { id: "r1", potentiale: 5, birthdate: "2006-06-15", primary_type: "climber", secondary_type: "gc" },
  speed: 1,
  seasonNumber: 4,
  teamId: "t1",
  scout: null,
  daysOnTeam: KNOWLEDGE_DAYS.final,
};

test("F1 rosterPrognosis: null og udeladt developmentXp er praecis som foer", () => {
  assert.deepEqual(rosterPrognosis({ ...base, developmentXp: null }), rosterPrognosis(base));
});

test("F1 rosterPrognosis: XP-params sendes videre til type-prognosen", () => {
  const slukket = rosterPrognosis(base);
  const fattig = rosterPrognosis({ ...base, developmentXp: P });
  const rig = rosterPrognosis({ ...base, developmentXp: RIGELIG });
  assert.ok(slukket.band && fattig.band && rig.band);
  assert.notDeepEqual(rig.band, fattig.band, "to XP-modeller giver samme akademi-prognose: developmentXp sendes ikke med");
  assert.ok(rig.band.hi >= fattig.band.hi);
});

const db = (app) => createFakeSupabase({
  app_config: app,
  private_config: [{ key: "development_xp_params", value: DOMMER_XP_RAA }],
  riders: [{ ...base.potRow }],
  rider_derived_abilities: [abilities],
  team_staff: [], team_facilities: [], scout_actions: [], scout_assignments: [], academy_intake_profiles: [],
  rider_training_days: [], academy_intake: [], training_date_rider_days: [],
});
const NU = new Date("2026-11-20T12:00:00Z");
const view = (app) => buildIntake2View(db(app), {
  teamId: "t1", roster: [{ id: "r1", birthdate: "2006-06-15" }], intake: [], seasonNumber: 4, now: NU,
});
const stille = async (fn) => {
  const original = console.warn;
  console.warn = () => {};
  try { return await fn(); } finally { console.warn = original; }
};

test("F1 buildIntake2View: kontakten slukket giver akademi-prognosen som foer; on giver XP-prognosen", async () => {
  const slukket = await stille(() => view([{ key: "development_xp_model", value: "off" }, { key: "development_xp_from_date", value: "2026-11-15" }]));
  const taendt = await stille(() => view([{ key: "development_xp_model", value: "on" }, { key: "development_xp_from_date", value: "2026-11-15" }]));
  const forTidligt = await stille(() => view([{ key: "development_xp_model", value: "on" }, { key: "development_xp_from_date", value: "2026-12-01" }]));
  const scout = await loadScout("t1", db([]));
  const facitSlukket = rosterPrognosis({ ...base, scout });
  assert.ok(slukket.roster[0].prognosis.band, "rytteren skal have et baand");
  assert.deepEqual(slukket.roster[0].prognosis.band, facitSlukket.band, "slukket: samme baand som uden XP");
  assert.deepEqual(forTidligt.roster[0].prognosis.band, facitSlukket.band, "foer startdatoen: samme baand som uden XP");
  const facitTaendt = rosterPrognosis({ ...base, scout, developmentXp: P });
  assert.notDeepEqual(facitTaendt.band, facitSlukket.band, "scenariet skal kunne skelne de to modeller");
  assert.deepEqual(taendt.roster[0].prognosis.band, facitTaendt.band, "on: XP-prognosen");
});

// Kildeproeve: hver prognose-flade i API'et sender XP-params med. En ny kalder uden
// developmentXp ville vise den gamle models prognose, naar XP er taendt.
function kald(src, navn) {
  const ud = [];
  let i = src.indexOf(`${navn}(`);
  while (i !== -1) {
    let dybde = 0;
    let j = i + navn.length;
    for (; j < src.length; j++) {
      if (src[j] === "(") dybde += 1;
      else if (src[j] === ")" && --dybde === 0) break;
    }
    ud.push(src.slice(i, j + 1));
    i = src.indexOf(`${navn}(`, j);
  }
  return ud;
}

test("F1 kilde: alle prognose-kald i API'et og akademiet sender developmentXp med", () => {
  const api = readFileSync(new URL("../routes/api.js", import.meta.url), "utf8");
  const typer = kald(api, "buildTypePrognosisBands").filter((k) => k.includes("nowAbilities"));
  const akademi = kald(api, "loadAcademyPrognoses").filter((k) => k.includes("teamId"));
  assert.equal(typer.length, 4, "antallet af type-prognose-kald i api.js har aendret sig; tjek den nye kalder");
  assert.ok(akademi.length >= 2);
  for (const k of [...typer, ...akademi]) assert.match(k, /developmentXp:/, k.slice(0, 120));
  const view2 = readFileSync(new URL("./academyIntake2View.ts", import.meta.url), "utf8");
  for (const k of kald(view2, "buildTypePrognosisBands").filter((x) => x.includes("nowAbilities"))) assert.match(k, /developmentXp/);
  const disclosure = readFileSync(new URL("./academyDisclosure.ts", import.meta.url), "utf8");
  for (const k of kald(disclosure, "rosterPrognosis").filter((x) => x.includes("daysOnTeam"))) assert.match(k, /developmentXp/);
});
