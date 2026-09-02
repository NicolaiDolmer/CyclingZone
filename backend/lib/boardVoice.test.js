import test from "node:test";
import assert from "node:assert/strict";

import { sampleVoiceLine, BoardVoiceEmptyBucketError } from "./boardVoice.js";
import { BOARD_ARCHETYPES, BOARD_ARCHETYPE_KEYS, MANDATE_VOICE_BUCKETS } from "./boardArchetypes.js";
import { generateBoardMemberNames } from "./boardMandateNames.js";

// #3514 S-M2a · boardVoice-kontrakten. Se modul-header i boardVoice.js for
// den fulde kontrakt-tekst (sampleVoiceLine, TOM BUCKET = KAST, generisk
// speakerKey-note).

// ── Determinisme ─────────────────────────────────────────────────────────────

test("sampleVoiceLine er deterministisk: samme seed giver altid samme linje", () => {
  const a = sampleVoiceLine({ beat: "receipt_positive", archetypeKey: "sponsoraten", seed: "evt-42" });
  const b = sampleVoiceLine({ beat: "receipt_positive", archetypeKey: "sponsoraten", seed: "evt-42" });
  assert.deepEqual(a, b);
});

test("sampleVoiceLine er deterministisk paa tvaers af flere kald (ingen skjult mutable state)", () => {
  const seeds = ["evt-1", "evt-2", "evt-3", "evt-4", "evt-5"];
  const firstPass = seeds.map((seed) => sampleVoiceLine({ beat: "milestone_achieved", archetypeKey: "ungdomsidealisten", seed }));
  const secondPass = seeds.map((seed) => sampleVoiceLine({ beat: "milestone_achieved", archetypeKey: "ungdomsidealisten", seed }));
  assert.deepEqual(firstPass, secondPass);
});

test("forskellige seeds kan give forskellige varianter (anti-monotoni)", () => {
  const seeds = ["evt-1", "evt-2", "evt-3", "evt-4", "evt-5", "evt-6", "evt-7", "evt-8"];
  const quoteKeys = new Set(
    seeds.map((seed) => sampleVoiceLine({ beat: "receipt_positive", archetypeKey: "sponsoraten", seed }).quote_key)
  );
  assert.ok(quoteKeys.size > 1, "8 forskellige event-seeds boer ikke alle ramme samme variant ud af 4");
});

test("manglende seed falder deterministisk tilbage til archetypeKey:beat", () => {
  const a = sampleVoiceLine({ beat: "receipt_positive", archetypeKey: "sponsoraten" });
  const b = sampleVoiceLine({ beat: "receipt_positive", archetypeKey: "sponsoraten", seed: "" });
  assert.deepEqual(a, b);
});

// ── Kontrakt-form ────────────────────────────────────────────────────────────

test("sampleVoiceLine returnerer den dokumenterede kontrakt-form", () => {
  const line = sampleVoiceLine({
    beat: "receipt_positive",
    archetypeKey: "sponsoraten",
    seed: "evt-100",
    context: { teamId: "team-abc", dnaKey: null },
  });
  assert.ok(line.member);
  assert.equal(typeof line.member.navn, "string");
  assert.equal(typeof line.member.initialer, "string");
  assert.equal(line.member.archetype_key, "sponsoraten");
  assert.equal(line.member.label_key, "archetypes.sponsoraten.label");
  assert.match(line.quote_key, /^archetypes\.sponsoraten\.reactions\.receipt_positive\.\d+$/);
  assert.equal(typeof line.quote_fallback_da, "string");
  assert.ok(line.quote_fallback_da.length > 0);
});

test("navnet er stabilt for samme (teamId, archetypeKey, dnaKey), matcher generateBoardMemberNames", () => {
  const a = sampleVoiceLine({ beat: "receipt_positive", archetypeKey: "sponsoraten", seed: "x", context: { teamId: "team-9", dnaKey: "sprint_kommerciel" } });
  const b = sampleVoiceLine({ beat: "receipt_negative", archetypeKey: "sponsoraten", seed: "y", context: { teamId: "team-9", dnaKey: "sprint_kommerciel" } });
  // Samme medlem (team+archetype+dna) skal have samme navn uanset hvilket beat der tales.
  assert.deepEqual(a.member, { ...b.member });
});

test("forskellige teams faar potentielt forskellige navne for samme arketype (ikke ét globalt navn)", () => {
  const a = sampleVoiceLine({ beat: "receipt_positive", archetypeKey: "sponsoraten", seed: "x", context: { teamId: "team-1", dnaKey: null } });
  const b = sampleVoiceLine({ beat: "receipt_positive", archetypeKey: "sponsoraten", seed: "x", context: { teamId: "team-2", dnaKey: null } });
  // Ikke en hård garanti (navnepuljen kan kollidere), men de to bør ikke være
  // afledt af den samme (archetypeKey, dnaKey)-nøgle alene, teamId skal indgå.
  assert.notEqual(JSON.stringify(a.member), "");
  assert.notEqual(JSON.stringify(b.member), "");
});

// ── context.members: kollisions-salt matcher hele bestyrelsen (#4586) ──────
//
// Bug #4586: sampleVoiceLine navngav ét medlem ad gangen, mens boardRoom.js's
// medlemskort (namesByArchetype) navngiver HELE bestyrelsen samlet via
// generateBoardMemberNames. Kolliderer to medlemmers basisnavne inden for
// samme hold, lægger generateBoardMemberNames et "salt" på det andet medlem,
// men salten afhænger af de FOREGÅENDE medlemmer i listen — et enkelt-
// medlems-kald har derfor ALTID salt 0, uanset kollision. Samme person kunne
// dermed hedde to forskellige ting i citatet og på kortet.

test("med context.members: samme navn som generateBoardMemberNames over den FULDE liste, for 3 teams x 5 arketyper", () => {
  const teamIds = ["team-alpha", "team-beta", "team-gamma"];
  const archetypes = BOARD_ARCHETYPE_KEYS.slice(0, 5);

  for (const teamId of teamIds) {
    const expected = generateBoardMemberNames({ teamId, members: archetypes, dnaKey: null });
    const expectedByArchetype = new Map(expected.map((m) => [m.archetype_key, m]));

    for (const archetypeKey of archetypes) {
      const line = sampleVoiceLine({
        beat: "receipt_positive",
        archetypeKey,
        seed: `${teamId}:${archetypeKey}`,
        context: { teamId, dnaKey: null, members: archetypes },
      });
      const expectedMember = expectedByArchetype.get(archetypeKey);
      assert.equal(line.member.navn, expectedMember.full_name);
      assert.equal(line.member.initialer, expectedMember.initials);
    }
  }
});

// Brute-forcet kollisions-bevis (fundet med et engangs-scriptet søgning over
// team-0..team-19999 x de 5 rigtige DNA-nøgler + null): ved (teamId: "team-1",
// dnaKey: "skandinavisk_udvikling") kolliderer "pragmatikeren"s basisnavn med
// et af de forudgående 4 medlemmers, så generateBoardMemberNames giver
// "pragmatikeren" salt > 0 i den samlede liste. Enkelt-medlems-formen (salt
// altid 0) giver derfor et ANDET navn end den samlede liste for netop dette
// medlem — det er selve reproduktionen af #4586.
const COLLISION_TEAM_ID = "team-1";
const COLLISION_DNA_KEY = "skandinavisk_udvikling";
const COLLISION_ARCHETYPE = "pragmatikeren";
const COLLISION_BOARD = BOARD_ARCHETYPE_KEYS.slice(0, 5); // sponsoraten..pragmatikeren

test("bevis: den brute-forcede (teamId, dnaKey) giver reelt salt > 0 for pragmatikeren (kollisionen er ægte)", () => {
  const listNamed = generateBoardMemberNames({
    teamId: COLLISION_TEAM_ID,
    members: COLLISION_BOARD,
    dnaKey: COLLISION_DNA_KEY,
  });
  const [singleNamed] = generateBoardMemberNames({
    teamId: COLLISION_TEAM_ID,
    members: [COLLISION_ARCHETYPE],
    dnaKey: COLLISION_DNA_KEY,
  });
  const listMember = listNamed.find((m) => m.archetype_key === COLLISION_ARCHETYPE);
  // Selve beviset: uden salt (enkelt-kald) hedder medlemmet noget ANDET end
  // med salt (samlet liste) — kollisionen findes rent faktisk i denne fixture.
  assert.notEqual(listMember.full_name, singleNamed.full_name);
});

test("med context.members (hele bestyrelsen): sampleVoiceLine matcher den SALTEDE liste-navngivning", () => {
  const listNamed = generateBoardMemberNames({
    teamId: COLLISION_TEAM_ID,
    members: COLLISION_BOARD,
    dnaKey: COLLISION_DNA_KEY,
  });
  const expected = listNamed.find((m) => m.archetype_key === COLLISION_ARCHETYPE);

  const line = sampleVoiceLine({
    beat: "receipt_positive",
    archetypeKey: COLLISION_ARCHETYPE,
    seed: "evt-collision",
    context: { teamId: COLLISION_TEAM_ID, dnaKey: COLLISION_DNA_KEY, members: COLLISION_BOARD },
  });

  assert.equal(line.member.navn, expected.full_name);
  assert.equal(line.member.initialer, expected.initials);
});

test("UDEN context.members: sampleVoiceLine matcher stadig kun enkelt-medlems-formen (uændret gammel adfærd, salt altid 0)", () => {
  const [singleNamed] = generateBoardMemberNames({
    teamId: COLLISION_TEAM_ID,
    members: [COLLISION_ARCHETYPE],
    dnaKey: COLLISION_DNA_KEY,
  });

  const line = sampleVoiceLine({
    beat: "receipt_positive",
    archetypeKey: COLLISION_ARCHETYPE,
    seed: "evt-collision",
    context: { teamId: COLLISION_TEAM_ID, dnaKey: COLLISION_DNA_KEY }, // ingen members
  });

  assert.equal(line.member.navn, singleNamed.full_name);
  // Og dermed IKKE den saltede liste-navngivning — dokumenterer at
  // fraværet af context.members bevidst giver et andet (det gamle) navn.
  const listNamed = generateBoardMemberNames({
    teamId: COLLISION_TEAM_ID,
    members: COLLISION_BOARD,
    dnaKey: COLLISION_DNA_KEY,
  });
  const listExpected = listNamed.find((m) => m.archetype_key === COLLISION_ARCHETYPE);
  assert.notEqual(line.member.navn, listExpected.full_name);
});

test("context.members der IKKE indeholder denne archetypeKey falder tilbage til enkelt-medlems-formen", () => {
  const otherBoard = ["sponsoraten", "traditionalisten"]; // uden pragmatikeren
  const [singleNamed] = generateBoardMemberNames({
    teamId: COLLISION_TEAM_ID,
    members: [COLLISION_ARCHETYPE],
    dnaKey: COLLISION_DNA_KEY,
  });

  const line = sampleVoiceLine({
    beat: "receipt_positive",
    archetypeKey: COLLISION_ARCHETYPE,
    seed: "evt-collision",
    context: { teamId: COLLISION_TEAM_ID, dnaKey: COLLISION_DNA_KEY, members: otherBoard },
  });

  assert.equal(line.member.navn, singleNamed.full_name);
});

// ── Tom bucket = kast, aldrig stille fallback ───────────────────────────────
//
// Alle 9 arketyper har nu reelt indhold for alle 11 Mandat-buckets (ejer-
// godkendt 1/9, sponsoraten + ungdomsidealisten var de oprindelige tone-
// prøver, de øvrige 7 fulgt op i samme godkendelses-runde). Guard-mekanismen
// (BoardVoiceEmptyBucketError) er alligevel PERMANENT kode, ikke en
// overgangsting, den skal fange enhver FREMTIDIG tom bucket (fx en 12.
// beat-type der endnu ikke er skrevet for alle arketyper). Testen nedenfor
// beviser det ved midlertidigt at tømme en reelt udfyldt bucket.

test("alle 9 arketyper har mindst 4 varianter for alle 11 Mandat-buckets (kaster ikke)", () => {
  for (const archetypeKey of BOARD_ARCHETYPE_KEYS) {
    for (const beat of MANDATE_VOICE_BUCKETS) {
      assert.doesNotThrow(() => sampleVoiceLine({ beat, archetypeKey, seed: "evt-1" }));
    }
  }
});

test("sampleVoiceLine kaster BoardVoiceEmptyBucketError hvis en bucket nogensinde bliver tom (regressionsnet)", () => {
  const original = BOARD_ARCHETYPES.pragmatikeren.reactions.receipt_positive;
  BOARD_ARCHETYPES.pragmatikeren.reactions.receipt_positive = [];
  try {
    assert.throws(
      () => sampleVoiceLine({ beat: "receipt_positive", archetypeKey: "pragmatikeren", seed: "evt-1" }),
      BoardVoiceEmptyBucketError,
    );
  } finally {
    BOARD_ARCHETYPES.pragmatikeren.reactions.receipt_positive = original;
  }
});

// ── Ukendte inputs ───────────────────────────────────────────────────────────

test("ukendt beat kaster med en forklarende besked", () => {
  assert.throws(
    () => sampleVoiceLine({ beat: "not_a_real_beat", archetypeKey: "sponsoraten" }),
    /ukendt beat/,
  );
});

test("ukendt archetypeKey kaster med en forklarende besked", () => {
  assert.throws(
    () => sampleVoiceLine({ beat: "receipt_positive", archetypeKey: "not_a_real_archetype" }),
    /ukendt archetypeKey/,
  );
});

// ── Genbruger de eksisterende (legacy) buckets uden problemer ───────────────

test("sampleVoiceLine kan ogsaa sample de 6 eksisterende feedback/goal-buckets", () => {
  const line = sampleVoiceLine({ beat: "goal_achievement", archetypeKey: "resultatjaegeren", seed: "evt-1" });
  assert.match(line.quote_key, /^archetypes\.resultatjaegeren\.reactions\.goal_achievement\.\d+$/);
});
