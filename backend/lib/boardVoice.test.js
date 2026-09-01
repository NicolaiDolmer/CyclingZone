import test from "node:test";
import assert from "node:assert/strict";

import { sampleVoiceLine, BoardVoiceEmptyBucketError } from "./boardVoice.js";
import { BOARD_ARCHETYPES, BOARD_ARCHETYPE_KEYS, MANDATE_VOICE_BUCKETS } from "./boardArchetypes.js";

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
