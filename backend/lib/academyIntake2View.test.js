import test from "node:test";
import assert from "node:assert/strict";

import { buildIntake2View, displaySafeAbilities, maskPullCandidate, rosterPrognosis } from "./academyIntake2View.ts";
import { KNOWLEDGE_DAYS } from "./academyProspectKnowledge.ts";
import { REGISTRY_ABILITY_KEYS } from "./abilityRegistry.js";

test("maskPullCandidate: intet potentiale forlader serveren for en hentet kandidat (punkt 1)", () => {
  const item = { source: "pull", is_serious: true, potentialEstimate: { lo: 2, hi: 3 }, potentialBand: { prog: { lo: 40, hi: 60 } } };
  const masked = maskPullCandidate(item);
  assert.equal(masked.potentialEstimate, null);
  assert.equal(masked.potentialBand, null);
  assert.equal(masked.potentialLearned, true);
  // "Seriøs"-maerket er en potentiale-klassifikation og maa heller ikke laekke.
  assert.equal(masked.is_serious, false);
  // Bestyrelsens gave og gamle tilbud er uroerte.
  const gift = { source: "board_gift", is_serious: true, potentialBand: { prog: { lo: 1, hi: 2 } } };
  assert.equal(maskPullCandidate(gift), gift);
  assert.equal(maskPullCandidate(gift).is_serious, true);
});

test("maskPullCandidate: kandidatens nuvaerende evner sendes med, men aldrig potentiale-felterne", () => {
  const row = {
    rider_id: "r9",
    ...Object.fromEntries(REGISTRY_ABILITY_KEYS.map((k) => [k, 41])),
    hidden_potential: 99,
    ability_caps: { climbing: 80 },
    ability_progress: { climbing: 0.4 },
    formula_version: 7,
  };
  const masked = maskPullCandidate({ source: "pull", riderId: "r9", potentialBand: { prog: { lo: 1, hi: 2 } } }, row);
  assert.ok(masked.rider_derived_abilities, "evnerne er med paa kortet (SSOT: navn, alder, nationalitet, type, evner)");
  assert.deepEqual(Object.keys(masked.rider_derived_abilities).sort(), [...REGISTRY_ABILITY_KEYS].sort());
  assert.equal(masked.rider_derived_abilities.climbing, 41);
  for (const leak of ["hidden_potential", "ability_caps", "ability_progress", "formula_version", "rider_id"]) {
    assert.equal(leak in masked.rider_derived_abilities, false, `${leak} maa ikke forlade serveren`);
  }
  assert.equal(masked.potentialBand, null);
  // Mangler evne-raekken endnu (afledning ikke koert), staar feltet som null.
  assert.equal(maskPullCandidate({ source: "pull", riderId: "r0" }).rider_derived_abilities, null);
});

test("displaySafeAbilities: kun registrets evne-noegler", () => {
  assert.equal(displaySafeAbilities(null), null);
  const safe = displaySafeAbilities({ climbing: 50, hidden_potential: 3 });
  assert.equal(safe.climbing, 50);
  assert.equal("hidden_potential" in safe, false);
});

test("buildIntake2View: pull-kandidaten faar sine evner fra samme evne-opslag som rosteret", async () => {
  const queried = [];
  const evneRow = { rider_id: "cand-1", ...Object.fromEntries(REGISTRY_ABILITY_KEYS.map((k) => [k, 33])), hidden_potential: 5 };
  const supabase = {
    from(table) {
      const api = {
        _ids: null,
        select() { return api; },
        eq() { return api; },
        order() { return api; },
        in(_col, ids) { api._ids = ids; if (table === "rider_derived_abilities") queried.push(...ids); return api; },
        limit() {
          if (table === "rider_derived_abilities") return Promise.resolve({ data: [evneRow], error: null });
          return Promise.resolve({ data: [], error: null });
        },
        maybeSingle: async () => ({ data: null, error: null }),
        then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); },
      };
      return api;
    },
  };
  const view = await buildIntake2View(supabase, {
    teamId: "t1",
    roster: [],
    intake: [{ source: "pull", riderId: "cand-1", rider: { id: "cand-1" } }, { source: "board_gift", riderId: "gift-1", rider: { id: "gift-1" } }],
    seasonNumber: 4,
    now: new Date("2026-10-15T12:00:00Z"),
  });
  assert.deepEqual(queried, ["cand-1"], "kun pull-kandidaten slaas op (rosteret er tomt, gaven er uroert)");
  assert.equal(view.intake[0].rider_derived_abilities.climbing, 33);
  assert.equal("hidden_potential" in view.intake[0].rider_derived_abilities, false);
  assert.equal("rider_derived_abilities" in view.intake[1], false);
});

const abilities = {
  rider_id: "r1",
  ...Object.fromEntries(REGISTRY_ABILITY_KEYS.map((k, i) => [k, 30 + (i % 5) * 3])),
  climbing: 45,
};
const base = {
  rider: { id: "r1", birthdate: "2010-06-15" },
  abilities,
  potRow: { potentiale: 4, birthdate: "2010-06-15", primary_type: "climber", secondary_type: "gc" },
  speed: 1,
  seasonNumber: 4,
  teamId: "t1",
  scout: null,
};

test("rosterPrognosis: intet baand foer de foerste traeningsloebsdage", () => {
  const p = rosterPrognosis({ ...base, daysOnTeam: 3 });
  assert.equal(p.stage, "learning");
  assert.equal(p.band, null);
  assert.equal(p.daysOnTeam, 3);
});

test("rosterPrognosis: baandet snaevrer ind med traeningsloebsdage paa holdet", () => {
  const broad = rosterPrognosis({ ...base, daysOnTeam: KNOWLEDGE_DAYS.broad });
  const final = rosterPrognosis({ ...base, daysOnTeam: KNOWLEDGE_DAYS.final });
  assert.equal(broad.stage, "broad");
  assert.equal(final.stage, "final");
  assert.ok(broad.band && final.band, "baandet beregnes fra de afledte evner");
  assert.equal(final.band.role, "climber");
  assert.ok(final.band.hi - final.band.lo <= broad.band.hi - broad.band.lo, "endeligt baand er aldrig bredere end det brede");
});

test("#6853 rosterPrognosis: viser rollen med hoejest potentiale og maerker baandet", () => {
  const p = rosterPrognosis({ ...base, daysOnTeam: KNOWLEDGE_DAYS.final });
  assert.equal(p.band.bestRole, true);
});
