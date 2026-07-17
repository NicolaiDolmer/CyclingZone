// Tests for scripts/check-patch-notes-version.js hardening (#2535).
// 1) Opt-out token skal stå ALENE på sin egen linje — en besked der blot
//    CITERER token'en (fx i en anden fejlbesked/postmortem-tekst) må ikke opte ud.
// 2) patchNotes.js-ændringer der ikke rører den PARSEDE versionsliste (samme
//    versioner, samme rækkefølge) skal ikke kræve version-bump.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseVersions,
  hasOptOutToken,
  arraysEqual,
} = require("./check-patch-notes-version.js");

const TOKEN = "[patch-notes-snapshot-ok]";

test("opt-out token alene på sin egen linje tælles", () => {
  const messages = `fix(x): something\n\n${TOKEN}\n`;
  assert.equal(hasOptOutToken(messages, TOKEN), true);
});

test("opt-out token med omkringliggende whitespace på egen linje tælles", () => {
  const messages = `fix(x): something\n\n  ${TOKEN}  \n`;
  assert.equal(hasOptOutToken(messages, TOKEN), true);
});

test("token blot CITERET i en sætning opter IKKE ud", () => {
  const messages =
    `docs: forklar guard-historik\n\n` +
    `Escape-hatch er at tilføje ${TOKEN} til en commit-besked.\n`;
  assert.equal(hasOptOutToken(messages, TOKEN), false);
});

test("token som del af en længere linje (ingen egen linje) opter IKKE ud", () => {
  const messages = `see ${TOKEN} for details`;
  assert.equal(hasOptOutToken(messages, TOKEN), false);
});

test("ingen commit-beskeder → ikke opted out", () => {
  assert.equal(hasOptOutToken("", TOKEN), false);
});

test("parseVersions finder versioner i rækkefølge", () => {
  const content = `
    { version: "1.4.0", title: "x" },
    { version: "1.3.2", title: "y" },
  `;
  assert.deepEqual(parseVersions(content), ["1.4.0", "1.3.2"]);
});

test("arraysEqual: identiske lister af versioner", () => {
  assert.equal(arraysEqual(["1.4.0", "1.3.2"], ["1.4.0", "1.3.2"]), true);
});

test("arraysEqual: forskellig rækkefølge er IKKE identisk", () => {
  assert.equal(arraysEqual(["1.4.0", "1.3.2"], ["1.3.2", "1.4.0"]), false);
});

test("arraysEqual: ny version tilføjet er IKKE identisk", () => {
  assert.equal(arraysEqual(["1.5.0", "1.4.0", "1.3.2"], ["1.4.0", "1.3.2"]), false);
});

test("arraysEqual: tom mod tom er identisk", () => {
  assert.equal(arraysEqual([], []), true);
});

// End-to-end af "versionsliste-identisk"-reglen: en kommentar-/typo-rettelse i
// patchNotes.js (samme versioner, samme rækkefølge, andet indhold ændret)
// skal parse'e til identiske lister, selvom rå fil-indhold differs.
test("kommentar-only ændring i patchNotes.js giver identisk parsed versionsliste", () => {
  const before = `
    // Patch notes
    export const patchNotes = [
      { version: "1.4.0", title: "Feature X" },
      { version: "1.3.2", title: "Fix Y" },
    ];
  `;
  const after = `
    // Patch notes (typo fixed: Featurex -> Feature X)
    export const patchNotes = [
      { version: "1.4.0", title: "Feature X" },
      { version: "1.3.2", title: "Fix Y" },
    ];
  `;
  assert.deepEqual(parseVersions(before), parseVersions(after));
  assert.equal(arraysEqual(parseVersions(before), parseVersions(after)), true);
});

test("ny top-entry ændrer parsed versionsliste (bump stadig krævet)", () => {
  const before = `
    { version: "1.4.0", title: "Feature X" },
    { version: "1.3.2", title: "Fix Y" },
  `;
  const after = `
    { version: "1.5.0", title: "Feature Z" },
    { version: "1.4.0", title: "Feature X" },
    { version: "1.3.2", title: "Fix Y" },
  `;
  assert.equal(arraysEqual(parseVersions(before), parseVersions(after)), false);
});

test("re-ordering uden ny version ændrer parsed versionsliste (bump stadig krævet)", () => {
  const before = `
    { version: "1.4.0", title: "Feature X" },
    { version: "1.3.2", title: "Fix Y" },
  `;
  const after = `
    { version: "1.3.2", title: "Fix Y" },
    { version: "1.4.0", title: "Feature X" },
  `;
  assert.equal(arraysEqual(parseVersions(before), parseVersions(after)), false);
});
