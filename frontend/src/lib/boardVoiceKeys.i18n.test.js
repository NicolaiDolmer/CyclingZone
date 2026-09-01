import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #3514 S-M2a · i18n-nøgle-paritet for de 11 nye Mandat-beat-buckets
// (addendum "Stemme-kontrakten" punkt 4, docs/superpowers/specs/
// 2026-09-01-board-mandate-addendum-personer-med-stemme.md).
//
// Kun sponsoraten + ungdomsidealisten har reelt indhold i S-M2a (ejer-tone-
// prøve 1/9, se boardArchetypes.js). De 7 øvrige arketyper har bevidst
// TOMME arrays i backend (boardVoice.js kaster hvis de samples) og har
// derfor INGEN nøgler i board.json endnu, det er ikke en parity-fejl.
//
// Bucket-listen her er en bevidst kopi af backend/lib/boardArchetypes.js'
// MANDATE_VOICE_BUCKETS (frontend importerer ikke backend-kode). Et diff i
// backend-listen uden en tilsvarende opdatering her opdages IKKE af denne
// test, men key-parity mellem en/da for de eksisterende nøgler er stadig
// dækket.
const MANDATE_VOICE_BUCKETS = [
  "receipt_positive",
  "receipt_negative",
  "meeting_easier",
  "meeting_keep",
  "meeting_stretch",
  "midseason_status",
  "milestone_achieved",
  "milestone_missed",
  "extraordinary_meeting",
  "chairman_departure",
  "chairman_arrival",
];

const REFERENCE_ARCHETYPES = ["sponsoraten", "ungdomsidealisten"];

const __dirname = dirname(fileURLToPath(import.meta.url));
const localesDir = join(__dirname, "..", "..", "public", "locales");

function loadBoard(lng) {
  return JSON.parse(readFileSync(join(localesDir, lng, "board.json"), "utf8"));
}

const en = loadBoard("en");
const da = loadBoard("da");

test("board.json findes for baade en og da, og archetypes-sektionen er til stede", () => {
  assert.ok(en.archetypes, "en/board.json mangler archetypes");
  assert.ok(da.archetypes, "da/board.json mangler archetypes");
});

for (const archetypeKey of REFERENCE_ARCHETYPES) {
  test(`${archetypeKey}: alle 11 nye Mandat-buckets findes i baade en og da`, () => {
    const enReactions = en.archetypes[archetypeKey]?.reactions;
    const daReactions = da.archetypes[archetypeKey]?.reactions;
    assert.ok(enReactions, `en/board.json.archetypes.${archetypeKey}.reactions mangler`);
    assert.ok(daReactions, `da/board.json.archetypes.${archetypeKey}.reactions mangler`);

    for (const bucket of MANDATE_VOICE_BUCKETS) {
      assert.ok(Array.isArray(enReactions[bucket]), `en ${archetypeKey}.reactions.${bucket} mangler eller er ikke et array`);
      assert.ok(Array.isArray(daReactions[bucket]), `da ${archetypeKey}.reactions.${bucket} mangler eller er ikke et array`);
    }
  });

  test(`${archetypeKey}: mindst 4 varianter pr. ny bucket, samme antal i en og da`, () => {
    const enReactions = en.archetypes[archetypeKey].reactions;
    const daReactions = da.archetypes[archetypeKey].reactions;

    for (const bucket of MANDATE_VOICE_BUCKETS) {
      assert.ok(enReactions[bucket].length >= 4, `en ${archetypeKey}.reactions.${bucket} har under 4 varianter (#2484-baren)`);
      assert.equal(
        enReactions[bucket].length,
        daReactions[bucket].length,
        `${archetypeKey}.reactions.${bucket}: en/da har forskelligt antal varianter`,
      );
    }
  });

  test(`${archetypeKey}: ingen em-dash i de nye buckets (TONE_OF_VOICE.md)`, () => {
    for (const lngName of ["en", "da"]) {
      const reactions = (lngName === "en" ? en : da).archetypes[archetypeKey].reactions;
      for (const bucket of MANDATE_VOICE_BUCKETS) {
        for (const line of reactions[bucket]) {
          assert.doesNotMatch(
            line,
            /—/,
            `${lngName} ${archetypeKey}.reactions.${bucket} indeholder em-dash: "${line}"`,
          );
        }
      }
    }
  });
}

test("de 7 ikke-reference-arketyper har INGEN nye Mandat-bucket-nøgler i board.json endnu (bevidst, matcher backend TODO)", () => {
  const nonReference = Object.keys(en.archetypes).filter((key) => !REFERENCE_ARCHETYPES.includes(key));
  assert.ok(nonReference.length > 0, "forventede mindst én ikke-reference-arketype i board.json");

  for (const archetypeKey of nonReference) {
    const enReactions = en.archetypes[archetypeKey]?.reactions || {};
    for (const bucket of MANDATE_VOICE_BUCKETS) {
      assert.equal(
        bucket in enReactions,
        false,
        `en ${archetypeKey}.reactions.${bucket} findes uventet, backend har stadig en tom TODO-bucket for denne arketype`,
      );
    }
  }
});
