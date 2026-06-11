// node --test — tests for #669 rename-generatoren.
// Kør: node --test scripts/lib/fictional-rename-generator.test.mjs
//
// OBSERVED_DISTRIBUTION er den ægte nationalitets-fordeling fra PCM-dumpen
// (scripts/WORLD DB 2026 Dyn_Cyclist.xlsx, 8.699 ryttere, 2026-06-10) — kun
// antal pr. ISO2, ingen navne. Den gør kapacitets- og dæknings-testene ægte:
// ændrer nogen pool-størrelser eller ISO-mapping, fanger testen regression
// mod den faktiske produktions-load.

import { test } from "node:test";
import assert from "node:assert/strict";
import { foldNameNordic } from "../../backend/lib/pcmRiderMatcher.js";
import {
  generateRenameMapping,
  selectReviewSample,
  sqlString,
} from "./fictional-rename-generator.mjs";
import {
  EXTENDED_CLUSTERS,
  extendedClusterForNationality,
  clusterCapacities,
} from "./fictional-name-pools-extended.mjs";

const OBSERVED_DISTRIBUTION = {
  FR: 536, IT: 530, BE: 499, ES: 373, NL: 361, CO: 296, CN: 274, GB: 268,
  US: 231, DE: 221, DK: 219, AU: 190, JP: 172, NO: 150, PT: 139, PL: 132,
  AR: 130, CZ: 119, KR: 115, NZ: 113, CA: 107, TR: 106, CH: 103, AT: 98,
  RU: 90, PH: 86, MX: 82, VE: 81, SE: 81, EC: 75, SI: 73, IR: 72, DZ: 71,
  ID: 69, TH: 66, KZ: 65, BR: 64, GT: 64, MY: 63, CL: 63, CR: 61, IE: 57,
  ZA: 57, HU: 56, MA: 53, RO: 53, SK: 46, EE: 45, ER: 45, GR: 44, BG: 44,
  RW: 42, UA: 42, HK: 37, AE: 36, TW: 33, VN: 32, SA: 31, IL: 30, UZ: 30,
  MK: 30, LT: 29, DO: 29, LU: 28, LV: 27, MN: 27, OM: 27, EG: 27, UY: 27,
  FI: 26, PA: 26, BO: 25, PE: 25, AO: 24, AZ: 24, IN: 24, KG: 24, BY: 23,
  BJ: 23, BF: 22, ET: 22, CM: 22, RS: 21, MU: 21, ML: 21, GH: 20, IQ: 20,
  AL: 19, SN: 18, SG: 17, NA: 17, CI: 17, BZ: 16, CY: 16, NG: 16, PY: 15,
  KE: 15, XK: 15, LK: 15, CU: 13, HR: 13, HN: 13, GE: 12, TN: 12, ME: 12,
  PR: 11, CD: 11, ZW: 11, JM: 11, MT: 10, GU: 10, SY: 10, UG: 10, KH: 10,
  PK: 10, IS: 10, BH: 9, QA: 9, TT: 9, KW: 8, GA: 8, GY: 8, LI: 7, GD: 7,
  MD: 7, LA: 7, CW: 6, AD: 6, BM: 6, LS: 6, BA: 6, AM: 4, BS: 4, PS: 4,
  MC: 2, SM: 2, BN: 2, TL: 2,
};

function syntheticRiders() {
  // Syntetiske "nuværende navne" — distinkte, så korpus matcher virkeligheden
  // i størrelse. Ægte navne behøves ikke for logik-testene.
  const riders = [];
  let id = 1;
  for (const [iso, count] of Object.entries(OBSERVED_DISTRIBUTION)) {
    for (let i = 0; i < count; i++) {
      riders.push({
        pcm_id: id,
        nationality_code: iso,
        firstname: `Pcmfirst${id}`,
        lastname: `Pcmlast${id}`,
      });
      id++;
    }
  }
  return riders;
}

test("alle observerede nationaliteter rammer en dedikeret pool (ingen generic)", () => {
  for (const iso of Object.keys(OBSERVED_DISTRIBUTION)) {
    const cluster = extendedClusterForNationality(iso);
    assert.notEqual(cluster, "generic", `${iso} faldt til generic`);
    assert.ok(EXTENDED_CLUSTERS[cluster], `${iso} → ukendt cluster ${cluster}`);
  }
});

test("pool-kapacitet holder ≤60% utilization mod den ægte fordeling", () => {
  const load = {};
  for (const [iso, count] of Object.entries(OBSERVED_DISTRIBUTION)) {
    const cluster = extendedClusterForNationality(iso);
    load[cluster] = (load[cluster] || 0) + count;
  }
  const capacities = clusterCapacities();
  for (const [cluster, n] of Object.entries(load)) {
    const pct = n / capacities[cluster];
    assert.ok(
      pct <= 0.6,
      `${cluster}: ${n}/${capacities[cluster]} = ${Math.round(pct * 100)}% — udvid poolen`,
    );
  }
});

test("fuld generering: deterministisk, unik, nationalitet bevaret, ingen korpus-kollision", () => {
  const riders = syntheticRiders();
  const a = generateRenameMapping(riders, { seed: 669 });
  const b = generateRenameMapping(riders, { seed: 669 });
  assert.deepEqual(a.mapping, b.mapping, "samme seed skal give identisk mapping");

  const c = generateRenameMapping(riders, { seed: 670 });
  assert.notDeepEqual(a.mapping, c.mapping, "andet seed skal give anden mapping");

  assert.equal(a.mapping.length, riders.length);

  const byId = new Map(riders.map((r) => [r.pcm_id, r]));
  const corpus = new Set(riders.map((r) => foldNameNordic(`${r.firstname} ${r.lastname}`)));
  const seenFolded = new Set();
  for (const m of a.mapping) {
    assert.equal(m.nationality_code, byId.get(m.pcm_id).nationality_code, "nationalitet skal bevares");
    const folded = foldNameNordic(`${m.new_firstname} ${m.new_lastname}`);
    assert.ok(!corpus.has(folded), `kollision med eksisterende navn: ${m.new_firstname} ${m.new_lastname}`);
    assert.ok(!seenFolded.has(folded), `duplikeret nyt navn: ${m.new_firstname} ${m.new_lastname}`);
    seenFolded.add(folded);
  }
});

test("extraFoldedNames respekteres (fx allerede-indsatte fiktive ryttere)", () => {
  const riders = syntheticRiders().slice(0, 200);
  const first = generateRenameMapping(riders, { seed: 669 });
  // Bloker de første 50 genererede navne → ny kørsel må ikke genbruge dem.
  const blocked = first.mapping
    .slice(0, 50)
    .map((m) => foldNameNordic(`${m.new_firstname} ${m.new_lastname}`));
  const second = generateRenameMapping(riders, { seed: 669, extraFoldedNames: blocked });
  for (const m of second.mapping) {
    const folded = foldNameNordic(`${m.new_firstname} ${m.new_lastname}`);
    assert.ok(!blocked.includes(folded), `genbrugte blokeret navn: ${m.new_firstname} ${m.new_lastname}`);
  }
});

test("input-rækkefølge er ligegyldig (sorteres på pcm_id)", () => {
  const riders = syntheticRiders().slice(0, 300);
  const shuffled = [...riders].reverse();
  const a = generateRenameMapping(riders, { seed: 669 });
  const b = generateRenameMapping(shuffled, { seed: 669 });
  assert.deepEqual(a.mapping, b.mapping);
});

test("duplikeret pcm_id afvises", () => {
  const riders = [
    { pcm_id: 1, nationality_code: "DK", firstname: "A", lastname: "B" },
    { pcm_id: 1, nationality_code: "DK", firstname: "C", lastname: "D" },
  ];
  assert.throws(() => generateRenameMapping(riders, { seed: 669 }), /Duplikeret pcm_id/);
});

test("selectReviewSample: ~size rækker, alle clusters repræsenteret", () => {
  const riders = syntheticRiders();
  const { mapping } = generateRenameMapping(riders, { seed: 669 });
  const sample = selectReviewSample(mapping, { size: 100 });
  assert.equal(sample.length, 100);
  const sampleClusters = new Set(sample.map((m) => m.cluster));
  const allClusters = new Set(mapping.map((m) => m.cluster));
  assert.deepEqual([...sampleClusters].sort(), [...allClusters].sort(), "alle clusters skal med i sample");
  // Determinisme
  assert.deepEqual(sample, selectReviewSample(mapping, { size: 100 }));
});

test("sqlString escaper enkelt-anførselstegn (O'Brien, D'Amico)", () => {
  assert.equal(sqlString("O'Brien"), "'O''Brien'");
  assert.equal(sqlString("D'Amico"), "'D''Amico'");
  assert.equal(sqlString("García"), "'García'");
});
