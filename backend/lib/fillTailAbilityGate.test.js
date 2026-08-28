// #4311-gate: fyld-ryttere (buildWeakStarterPool) skal have ALLE seksten afledte
// evner klemt, ikke kun stats. Rod-aarsagen var at tactics (alder-drevet) og
// hidden_potential (potentiale-drevet) sprang stat-klemmen over — en 32-aarig
// fyld-rytter fik tactics 57 og laeste som en normal senior (populationens bedste
// evne-snit 41, fyldets bedste evne UDEN tactics kun 7).
//
// Spejler moensteret fra archetypeGenerationGates.test.js's G5/G6/G7: maaler paa
// AFLEDNINGEN (deriveAbilities' output), ikke paa de rå stats — praecis der hvor
// hullet var, jf. .claude/learnings/2026-08-09-gates-der-maaler-relativt-fanger-ikke-absolutte-niveauer.md.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWeakStarterPool,
  STARTER_POOL_STAT_WINDOW,
  STARTER_TAIL_STAT_WINDOW,
} from "./starterSquadAllocator.js";
import { seedPhysiologyFromLegacy } from "./physiologySeeding.js";
import {
  deriveAbilities,
  ALL_ABILITY_KEYS,
  FILL_TAIL_ABILITY_CAP,
  FILL_TAIL_MAX_POTENTIALE,
  FILL_TAIL_GENERATION_TAG,
} from "./abilityDerivation.js";

const N = 300;
const SEED = 20260828;
const REFERENCE_YEAR = 2026;

// Deriverer en fuld pulje via PRODUKTIONS-fallback-stien (relaunch/single-team
// seeder physiology UDEN `aero` → deriveAbilities falder til PCM-fallback, se
// starterSquadAllocator.js's topkommentar) — den samme kaede
// insertWeakSquadForTeam/insertDeriveAndReadPool rent faktisk kører.
function deriveCohort(window) {
  const pool = buildWeakStarterPool({ count: N, seed: SEED, referenceYear: REFERENCE_YEAR, window });
  return pool.map((riderRow) => ({
    riderRow,
    abilities: deriveAbilities(seedPhysiologyFromLegacy(riderRow), riderRow),
  }));
}

test("#4311 GATE: buildWeakStarterPool + derive (kerne-vindue) — bedste afledte evne <= loft, potentiale <= 2,5", () => {
  const cohort = deriveCohort(STARTER_POOL_STAT_WINDOW);
  for (const { riderRow, abilities } of cohort) {
    assert.equal(riderRow.generation_tag, FILL_TAIL_GENERATION_TAG, "rytter mangler fill_tail-taggen");
    assert.ok(
      Number(riderRow.potentiale) <= FILL_TAIL_MAX_POTENTIALE,
      `potentiale ${riderRow.potentiale} over loftet ${FILL_TAIL_MAX_POTENTIALE}`
    );
    for (const k of ALL_ABILITY_KEYS) {
      assert.ok(
        Number(abilities[k]) <= FILL_TAIL_ABILITY_CAP,
        `${k}=${abilities[k]} over evne-loftet ${FILL_TAIL_ABILITY_CAP} (kerne-vindue) — se #4311`
      );
    }
  }
});

test("#4311 GATE: buildWeakStarterPool + derive (hale-vindue [50,52]) — bedste afledte evne <= loft, potentiale <= 2,5", () => {
  const cohort = deriveCohort(STARTER_TAIL_STAT_WINDOW);
  for (const { riderRow, abilities } of cohort) {
    assert.ok(Number(riderRow.potentiale) <= FILL_TAIL_MAX_POTENTIALE);
    for (const k of ALL_ABILITY_KEYS) {
      assert.ok(
        Number(abilities[k]) <= FILL_TAIL_ABILITY_CAP,
        `${k}=${abilities[k]} over evne-loftet ${FILL_TAIL_ABILITY_CAP} (hale-vindue) — se #4311`
      );
    }
  }
});

// Bekraeft at gaten rent faktisk maaler paa AFLEDNINGEN, ikke stats: tactics og
// hidden_potential er IKKE i STAT_KEYS (de udledes af alder/potentiale) og skal
// alligevel vaere klemt.
test("#4311: tactics og hidden_potential (ikke stat-drevne) er klemt ligesom de fjorten koere-evner", () => {
  const cohort = deriveCohort(STARTER_TAIL_STAT_WINDOW);
  const maxTactics = Math.max(...cohort.map((c) => c.abilities.tactics));
  const maxHidden = Math.max(...cohort.map((c) => c.abilities.hidden_potential));
  assert.ok(maxTactics <= FILL_TAIL_ABILITY_CAP, `tactics-max ${maxTactics} over loftet ${FILL_TAIL_ABILITY_CAP}`);
  assert.ok(maxHidden <= FILL_TAIL_ABILITY_CAP, `hidden_potential-max ${maxHidden} over loftet ${FILL_TAIL_ABILITY_CAP}`);
});

// NEGATIV-TEST (designprincip: en gate skal fejle paa KENDT defekt kode, jf.
// #3570-negativ-testene i archetypeGenerationGates.test.js). Fjern taggen fra
// rider-raekken (simulerer koden FOER #4311, hvor deriveAbilities ikke saa nogen
// tag) og bevis at DEN samme kohorte saa bryder loftet — ellers maaler denne
// gate ikke laengere den oprindelige defekt.
test("#4311 NEGATIV-TEST: uden generation_tag springer tactics/hidden_potential loftet over (reproducerer den originale defekt)", () => {
  const pool = buildWeakStarterPool({ count: N, seed: SEED, referenceYear: REFERENCE_YEAR, window: STARTER_TAIL_STAT_WINDOW });
  const untaggedAbilities = pool.map((r) => {
    const untagged = { ...r, generation_tag: null };
    return deriveAbilities(seedPhysiologyFromLegacy(untagged), untagged);
  });
  const overCap = untaggedAbilities.filter((a) => a.tactics > FILL_TAIL_ABILITY_CAP);
  assert.ok(
    overCap.length > 0,
    "forventede mindst én rytter med tactics over loftet UDEN taggen — hvis 0, maaler negativ-testen ikke laengere den oprindelige defekt"
  );
});

// DURABILITET (issuets kernekrav): en re-derive af den SAMME rytter-raekke (som
// deriveForRiderIds/riderDeriveHealSweep udfoerer, saa laenge generation_tag er
// med i deres select — se backfillCores.js) skal give PRAECIS samme klemte
// output igen. Loftet maa ikke kunne "glemmes" ved en senere afledning.
test("#4311: klemmen er DURABEL — en re-derive af samme rider_row giver identisk klemt output", () => {
  const pool = buildWeakStarterPool({ count: 20, seed: SEED, referenceYear: REFERENCE_YEAR, window: STARTER_TAIL_STAT_WINDOW });
  for (const riderRow of pool) {
    const first = deriveAbilities(seedPhysiologyFromLegacy(riderRow), riderRow);
    const rederived = deriveAbilities(seedPhysiologyFromLegacy(riderRow), riderRow);
    assert.deepEqual(rederived, first, "re-derive af samme fill_tail-rytter gav et andet resultat");
    for (const k of ALL_ABILITY_KEYS) {
      assert.ok(rederived[k] <= FILL_TAIL_ABILITY_CAP, `${k} genopstod over loftet ved re-derive`);
    }
  }
});
