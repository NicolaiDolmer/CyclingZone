import test from "node:test";
import assert from "node:assert/strict";

import {
  computeGoalOwnerArchetypeKey,
  decorateReactionWithName,
  resolveGoalOwnerArchetypeKey,
  stampGoalOwner,
  stampGoalsOwners,
} from "./boardMembers.js";
import { generateBoardMemberNames } from "./boardMandateNames.js";

// #3514 S-M2a · Stabilt mål-ejerskab (addendum "Stemme-kontrakten" punkt 1).
// Se boardMembers.js for kontrakt-teksten. Disse tests dækker kun
// ejerskabs-mekanikken, ikke resten af boardMembers.js (dækket indirekte af
// boardEngine.test.js/boardMandate.test.js).

const SPONSOR_ECONOMY_MEMBERS = [
  { archetype_key: "sponsoraten", is_chairman: true },
  { archetype_key: "ungdomsidealisten", is_chairman: false },
  { archetype_key: "resultatjaegeren", is_chairman: false },
];

// ── computeGoalOwnerArchetypeKey ─────────────────────────────────────────────

test("computeGoalOwnerArchetypeKey vaelger arketypen med hoejest category_alignment", () => {
  const owner = computeGoalOwnerArchetypeKey({ assignedMembers: SPONSOR_ECONOMY_MEMBERS, category: "economy" });
  assert.equal(owner, "sponsoraten"); // sponsoraten.category_alignment.economy = 1.0, højest i settet
});

test("computeGoalOwnerArchetypeKey falder tilbage til chairman uden kategori", () => {
  const owner = computeGoalOwnerArchetypeKey({ assignedMembers: SPONSOR_ECONOMY_MEMBERS, category: null });
  assert.equal(owner, "sponsoraten"); // chairman i settet
});

test("computeGoalOwnerArchetypeKey er uafhaengig af input-raekkefoelgen (deterministisk)", () => {
  const shuffled = [...SPONSOR_ECONOMY_MEMBERS].reverse();
  const a = computeGoalOwnerArchetypeKey({ assignedMembers: SPONSOR_ECONOMY_MEMBERS, category: "identity" });
  const b = computeGoalOwnerArchetypeKey({ assignedMembers: shuffled, category: "identity" });
  assert.equal(a, b);
});

test("computeGoalOwnerArchetypeKey returnerer fallbackChairmanKey naar der ingen medlemmer er", () => {
  const owner = computeGoalOwnerArchetypeKey({ assignedMembers: [], category: "economy", fallbackChairmanKey: "pragmatikeren" });
  assert.equal(owner, "pragmatikeren");
});

// ── stampGoalOwner / stampGoalsOwners: sæt ÉN gang ──────────────────────────

test("stampGoalOwner saetter owner_archetype_key ud fra maalets kategori", () => {
  const goal = { type: "no_outstanding_debt", category: "economy", target: 0 };
  const stamped = stampGoalOwner(goal, { assignedMembers: SPONSOR_ECONOMY_MEMBERS });
  assert.equal(stamped.owner_archetype_key, "sponsoraten");
  // Originalen er ikke muteret.
  assert.equal("owner_archetype_key" in goal, false);
});

test("stampGoalOwner er en no-op naar owner_archetype_key allerede er sat (ejerskab skifter aldrig)", () => {
  const goal = { type: "no_outstanding_debt", category: "economy", target: 0, owner_archetype_key: "ungdomsidealisten" };
  const stamped = stampGoalOwner(goal, { assignedMembers: SPONSOR_ECONOMY_MEMBERS });
  assert.equal(stamped, goal); // samme reference, intet nyt objekt oprettet
  assert.equal(stamped.owner_archetype_key, "ungdomsidealisten");
});

test("ejerskabs-stabilitet: samme mål beholder samme ejer over flere evalueringer, selv når assignedMembers skifter", () => {
  const original = { type: "no_outstanding_debt", category: "economy", target: 0 };
  const evaluation1 = stampGoalOwner(original, { assignedMembers: SPONSOR_ECONOMY_MEMBERS });
  assert.equal(evaluation1.owner_archetype_key, "sponsoraten");

  // En senere evaluering (fx efter chairman-udskiftning) sender ANDRE assignedMembers ind,
  // men målet har allerede sin ejer persisteret, den må IKKE genberegnes.
  const laterMembers = [
    { archetype_key: "traditionalisten", is_chairman: true },
    { archetype_key: "klassiker_purist", is_chairman: false },
  ];
  const evaluation2 = stampGoalOwner(evaluation1, { assignedMembers: laterMembers });
  assert.equal(evaluation2.owner_archetype_key, "sponsoraten");
});

test("stampGoalsOwners stempler en hel maal-liste", () => {
  const goals = [
    { type: "no_outstanding_debt", category: "economy", target: 0 },
    { type: "min_u25_riders", category: "identity", target: 5 },
  ];
  const stamped = stampGoalsOwners(goals, { assignedMembers: SPONSOR_ECONOMY_MEMBERS });
  assert.equal(stamped[0].owner_archetype_key, "sponsoraten");
  assert.equal(stamped[1].owner_archetype_key, "ungdomsidealisten");
});

// ── resolveGoalOwnerArchetypeKey: læse-tids-afledning, skriver ALDRIG tilbage ─

test("resolveGoalOwnerArchetypeKey bruger det persisterede felt naar det findes", () => {
  const goal = { category: "economy", owner_archetype_key: "gc_elsker" };
  const resolved = resolveGoalOwnerArchetypeKey({ goal, assignedMembers: SPONSOR_ECONOMY_MEMBERS });
  assert.equal(resolved, "gc_elsker");
});

test("resolveGoalOwnerArchetypeKey afleder med samme regel for et historisk maal uden feltet", () => {
  const goal = { category: "economy" };
  const resolved = resolveGoalOwnerArchetypeKey({ goal, assignedMembers: SPONSOR_ECONOMY_MEMBERS });
  assert.equal(resolved, "sponsoraten");
  // Ren funktion: kaldet må ikke have muteret input-goal'et (ingen write-back).
  assert.equal("owner_archetype_key" in goal, false);
});

// ── decorateReactionWithName: collision-safe navngivning (review-fund, faldgrube 2) ─
//
// generateBoardMemberNames salter et navn ved kollision INDEN FOR samme kald
// (taken-set i boardMandateNames.js). decorateReactionWithName navngav
// tidligere ét medlem ad gangen (isoleret kald pr. reaction), så en kollision
// der ramte medlem #3 på Boardroom-siden (hele holdet navngivet i ét kald,
// boardRoom.js) aldrig blev opdaget her, medlem #3 fik salt 0 på begge flader
// isoleret, men et ANDET medlem i den fulde liste kunne kollidere med #3's
// USALTEDE navn og selv få salt 1, samme person, to navne. Fixet: send hele
// holdets archetype_keys med i `members`, så navnet slås op i ét samlet kald,
// identisk med hvad boardRoom.js/generateBoardMemberNames producerer over
// samme liste.
const FIVE_MEMBER_ARCHETYPES = [
  "sponsoraten",
  "traditionalisten",
  "talentspejderen",
  "resultatjaegeren",
  "pragmatikeren",
];

// Disse 3 teamId'er er verificeret (offline scan) til RENT FAKTISK at udløse en
// navne-kollision for FIVE_MEMBER_ARCHETYPES + dnaKey "italiensk_klassiker":
// generateBoardMemberNames salter det sidst-kolliderende medlem til et andet
// navn end dets usaltede base-navn. Med den gamle isoleret-pr-medlem-kode ville
// decorateReactionWithName derfor have returneret den USALTEDE (forkerte,
// dobbeltgænger-)version for dét medlem, mens boardRoom.js (fuld-liste-kald)
// viste den SALTEDE version, samme person, to navne. Testen fejler derfor
// reelt hvis fixet nogensinde regredierer til enkelt-medlems-kald.
test("#4556 review-fund: decorateReactionWithName med fuld members-liste matcher generateBoardMemberNames 1:1 over listen, for flere teamId'er", () => {
  const teamIds = ["collision-scan-64", "collision-scan-107", "collision-scan-802"];
  const dnaKey = "italiensk_klassiker";

  for (const teamId of teamIds) {
    // Boardroom-siden bygger navnene for hele holdet i ét kald (boardRoom.js).
    const namedFullList = generateBoardMemberNames({ teamId, members: FIVE_MEMBER_ARCHETYPES, dnaKey });

    // Sanity paa selve fixture'en: bevis at teamId'en RENT FAKTISK udløser en
    // salt-kollision, saa testen nedenfor ikke bare bestaar ved held (uden en
    // kollision ville selv den gamle, buggy enkelt-medlems-kode give samme
    // resultat). Isoleret enkelt-medlems-kald = den GAMLE (buggy) sti.
    const isolatedNames = FIVE_MEMBER_ARCHETYPES.map(
      (k) => generateBoardMemberNames({ teamId, members: [k], dnaKey })[0].full_name,
    );
    const fullListNames = namedFullList.map((m) => m.full_name);
    assert.notDeepEqual(
      isolatedNames,
      fullListNames,
      `sanity: ${teamId} skal rent faktisk udløse en salt-kollision (ellers beviser testen intet om fixet)`,
    );

    for (const archetypeKey of FIVE_MEMBER_ARCHETYPES) {
      const reaction = { archetype_key: archetypeKey, label: archetypeKey, quote: "test quote" };
      const decorated = decorateReactionWithName(reaction, { teamId, dnaKey, members: FIVE_MEMBER_ARCHETYPES });
      const expected = namedFullList.find((m) => m.archetype_key === archetypeKey);

      assert.ok(expected?.full_name, `sanity: generateBoardMemberNames skal navngive ${archetypeKey} for ${teamId}`);
      assert.equal(
        decorated.full_name,
        expected.full_name,
        `${teamId}/${archetypeKey}: decorateReactionWithName skal matche generateBoardMemberNames over den fulde liste (Boardroom-parity)`,
      );
      assert.equal(decorated.initials, expected.initials, `${teamId}/${archetypeKey}: initials skal ogsaa matche`);
    }
  }
});

test("#4556 review-fund: decorateReactionWithName uden members falder tilbage til enkelt-medlems-navngivning (bagudkompatibelt)", () => {
  const reaction = { archetype_key: "sponsoraten", label: "sponsoraten", quote: "test quote" };
  const decorated = decorateReactionWithName(reaction, { teamId: "team-4556-fallback", dnaKey: "fransk_klatrer" });
  const [expected] = generateBoardMemberNames({
    teamId: "team-4556-fallback",
    members: ["sponsoraten"],
    dnaKey: "fransk_klatrer",
  });
  assert.equal(decorated.full_name, expected.full_name);
});

test("#4556 review-fund: decorateReactionWithName ignorerer members der ikke indeholder reaction.archetype_key (falder tilbage til enkelt-medlem)", () => {
  const reaction = { archetype_key: "gc_elsker", label: "gc_elsker", quote: "test quote" };
  // members mangler "gc_elsker" -> archetypeKeys.includes(...) er false -> enkelt-medlems-sti.
  const decorated = decorateReactionWithName(reaction, {
    teamId: "team-4556-partial-list",
    dnaKey: "italiensk_klassiker",
    members: FIVE_MEMBER_ARCHETYPES,
  });
  const [expected] = generateBoardMemberNames({
    teamId: "team-4556-partial-list",
    members: ["gc_elsker"],
    dnaKey: "italiensk_klassiker",
  });
  assert.equal(decorated.full_name, expected.full_name);
});
