// Tests for scripts/check-patch-notes-version.js hardening (#2535).
// 1) Opt-out token skal stå ALENE på sin egen linje — en besked der blot
//    CITERER token'en (fx i en anden fejlbesked/postmortem-tekst) må ikke opte ud.
// 2) patchNotes.js-ændringer der ikke rører den PARSEDE versionsliste (samme
//    versioner, samme rækkefølge) skal ikke kræve version-bump.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  parseVersions,
  hasOptOutToken,
  arraysEqual,
  importCheck,
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

// #3773 — dato-guarden. Fire noter (7.117, 7.121, 7.126, 7.127) gik live med en
// dato én dag ude i fremtiden, fordi datoen blev udledt af et dokument i stedet
// for målt. Guarden skal fange præcis dét mønster.
const {
  parseDatedVersions,
  todayInCopenhagen,
} = require("./check-patch-notes-version.js");

test("parseDatedVersions læser version og dato som par", () => {
  const content = `
    { "version": "7.129", "date": "2026-08-14", "label": "Beta" },
    { "version": "7.128", "date": "2026-08-14", "label": "Beta" }
  `;
  assert.deepEqual(parseDatedVersions(content), [
    { version: "7.129", date: "2026-08-14" },
    { version: "7.128", date: "2026-08-14" },
  ]);
});

test("en note dateret i morgen fanges som fremtidig", () => {
  const today = todayInCopenhagen();
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const stamp = tomorrow.toISOString().slice(0, 10);
  const entries = parseDatedVersions(`{ "version": "9.99", "date": "${stamp}" }`);
  assert.equal(entries.filter((entry) => entry.date > today).length, 1);
});

test("en note dateret i dag eller tidligere er i orden", () => {
  const today = todayInCopenhagen();
  const entries = parseDatedVersions(
    `{ "version": "9.98", "date": "${today}" }, { "version": "9.97", "date": "2026-01-01" }`
  );
  assert.equal(entries.filter((entry) => entry.date > today).length, 0);
});

test("todayInCopenhagen giver en ISO-dato, ikke UTC-formatteret tekst", () => {
  assert.match(todayInCopenhagen(), /^\d{4}-\d{2}-\d{2}$/);
});

// #4308: importCheck fanger syntaksfejl i patchNotes.js som regex-parsingen
// ovenfor ikke kan se (den læser rå tekst, ikke gyldig JS). .mjs-extension
// bruges så fixturen altid importeres som ESM, uanset ambient package.json
// "type" i den mappe testen kører fra.
test("importCheck: gyldig ESM-data-fil giver ok:true", async () => {
  const tmpFile = path.join(os.tmpdir(), `patch-notes-import-check-valid-${process.pid}-${Date.now()}.mjs`);
  fs.writeFileSync(tmpFile, `export const PATCHES = [{ version: "1.0.0", date: "2026-01-01" }];\n`, "utf8");
  try {
    const result = await importCheck(tmpFile);
    assert.equal(result.ok, true);
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test("importCheck: fil med uafsluttet klamme giver ok:false og SyntaxError", async () => {
  const tmpFile = path.join(os.tmpdir(), `patch-notes-import-check-broken-${process.pid}-${Date.now()}.mjs`);
  fs.writeFileSync(tmpFile, `export const PATCHES = [{ version: "1.0.0", date: "2026-01-01" };\n`, "utf8");
  try {
    const result = await importCheck(tmpFile);
    assert.equal(result.ok, false);
    assert.ok(result.error instanceof SyntaxError, `expected SyntaxError, got ${result.error && result.error.constructor.name}`);
  } finally {
    fs.unlinkSync(tmpFile);
  }
});
