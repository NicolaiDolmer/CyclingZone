import test from "node:test";
import assert from "node:assert/strict";

import {
  SUPPORTED_DNA_KEYS,
  clusterForDna,
  generateBoardMemberNames,
  generateMemberName,
} from "./boardMandateNames.js";
import { NAME_CLUSTERS } from "./fictionalRiderNames.js";

test("navnepuljen følger klub-DNA (ejer-beslutning 8)", () => {
  assert.equal(clusterForDna("italiensk_klassiker"), "italian");
  assert.equal(clusterForDna("skandinavisk_udvikling"), "nordic");
  assert.equal(clusterForDna("fransk_klatrer"), "french");
  assert.equal(clusterForDna("britisk_allrounder"), "anglo");
});

test("hver understøttet DNA rammer en pulje der faktisk findes", () => {
  for (const key of SUPPORTED_DNA_KEYS) {
    const cluster = clusterForDna(key);
    assert.ok(NAME_CLUSTERS[cluster], `${key} → ${cluster} mangler i NAME_CLUSTERS`);
  }
});

test("ukendt eller manglende DNA giver stadig et navn i stedet for at kaste", () => {
  assert.ok(generateMemberName({ teamId: "t", archetypeKey: "a", dnaKey: "findes_ikke" }).full_name);
  assert.ok(generateMemberName({}).full_name);
});

test("samme hold + samme arketype giver ALTID samme navn", () => {
  const args = { teamId: "team-abc", archetypeKey: "talentspejderen", dnaKey: "italiensk_klassiker" };
  assert.deepEqual(generateMemberName(args), generateMemberName(args));
});

test("navnet kommer fra DNA'ets pulje, ikke fra en tilfældig", () => {
  const name = generateMemberName({ teamId: "t1", archetypeKey: "sponsoraten", dnaKey: "italiensk_klassiker" });
  assert.ok(NAME_CLUSTERS.italian.first.includes(name.first_name));
  assert.ok(NAME_CLUSTERS.italian.last.includes(name.last_name));
});

test("to forskellige hold får ikke samme bestyrelse", () => {
  const members = ["talentspejderen", "sponsoraten", "resultatjaegeren"];
  const a = generateBoardMemberNames({ teamId: "team-a", members, dnaKey: "fransk_klatrer" });
  const b = generateBoardMemberNames({ teamId: "team-b", members, dnaKey: "fransk_klatrer" });
  assert.notDeepEqual(a.map((m) => m.full_name), b.map((m) => m.full_name));
});

test("ingen to medlemmer i SAMME bestyrelse deler fuldt navn", () => {
  // Kørt bredt: 300 hold × 5 pladser i hver DNA-pulje. Ét sammenfald ville læse
  // som en bug for spilleren, ikke som en tilfældighed.
  const members = ["talentspejderen", "sponsoraten", "resultatjaegeren", "ungdomsidealisten", "traditionalisten"];
  for (const dnaKey of SUPPORTED_DNA_KEYS) {
    for (let i = 0; i < 300; i += 1) {
      const names = generateBoardMemberNames({ teamId: `team-${dnaKey}-${i}`, members, dnaKey });
      assert.equal(new Set(names.map((m) => m.full_name)).size, members.length,
        `dublet i ${dnaKey} hold ${i}: ${names.map((m) => m.full_name).join(", ")}`);
    }
  }
});

test("medlemmet beholder sine eksisterende felter og får navn oveni", () => {
  const [member] = generateBoardMemberNames({
    teamId: "t1",
    members: [{ archetype_key: "sponsoraten", is_chairman: true, alignment_score: 4 }],
    dnaKey: "sprint_kommerciel",
  });
  assert.equal(member.is_chairman, true);
  assert.equal(member.alignment_score, 4);
  assert.ok(member.full_name);
});

test("initialer er to bogstaver til initial-avataren (emoji-portrætter udgår)", () => {
  const name = generateMemberName({ teamId: "t", archetypeKey: "a", dnaKey: "britisk_allrounder" });
  assert.equal(name.initials.length, 2);
  assert.equal(name.initials, `${name.first_name[0]}${name.last_name[0]}`);
});

test("navne-fordelingen er ikke degenereret - puljen bruges bredt", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) {
    seen.add(generateMemberName({ teamId: `t${i}`, archetypeKey: "sponsoraten", dnaKey: "italiensk_klassiker" }).full_name);
  }
  assert.ok(seen.size > 120, `kun ${seen.size} unikke navne over 200 hold - hash'en klumper`);
});
