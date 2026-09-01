import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #3514 S-M2a · i18n-nøgle-paritet for de 11 nye Mandat-beat-buckets
// (addendum "Stemme-kontrakten" punkt 4, docs/superpowers/specs/
// 2026-09-01-board-mandate-addendum-personer-med-stemme.md).
//
// Alle 9 arketyper har nu reelt indhold (ejer-godkendte tone-prøver 1/9:
// sponsoraten + ungdomsidealisten skrevet først som reference, de øvrige 7
// fulgt op i samme godkendelses-runde, se boardArchetypes.js).
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const localesDir = join(__dirname, "..", "..", "public", "locales");

function loadBoard(lng) {
  return JSON.parse(readFileSync(join(localesDir, lng, "board.json"), "utf8"));
}

const en = loadBoard("en");
const da = loadBoard("da");
const ARCHETYPE_KEYS = Object.keys(en.archetypes);

test("board.json findes for baade en og da, og archetypes-sektionen er til stede", () => {
  assert.ok(en.archetypes, "en/board.json mangler archetypes");
  assert.ok(da.archetypes, "da/board.json mangler archetypes");
  assert.equal(ARCHETYPE_KEYS.length, 9, "forventede 9 arketyper i board.json");
});

for (const archetypeKey of ARCHETYPE_KEYS) {
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

// Karakter-adskillelse (koordinator-krav 1/9): ingen to arketyper må dele en
// ORDRET identisk linje i en given sprogversion. Grov, automatiserbar proxy
// for at hver arketype har sin egen stemme, en generisk linje der "kunne
// komme fra hvem som helst" ville typisk optræde identisk to steder.
for (const lngName of ["en", "da"]) {
  test(`${lngName}: ingen to arketyper deler en ordret identisk linje på tværs af de nye buckets`, () => {
    const tree = lngName === "en" ? en : da;
    const seen = new Map(); // linje → arketype der først brugte den
    for (const archetypeKey of ARCHETYPE_KEYS) {
      const reactions = tree.archetypes[archetypeKey].reactions;
      for (const bucket of MANDATE_VOICE_BUCKETS) {
        for (const line of reactions[bucket]) {
          const existing = seen.get(line);
          assert.ok(
            !existing || existing === archetypeKey,
            `${lngName}: linjen "${line}" bruges ordret af både ${existing} og ${archetypeKey}`,
          );
          seen.set(line, archetypeKey);
        }
      }
    }
  });
}
