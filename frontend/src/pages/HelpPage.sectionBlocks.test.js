import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Forward-guard: hver sections.<key>.<block>-nøgle i help.json SKAL være
// registreret i SECTION_DEFS' blocks-array i HelpPage.jsx — og omvendt.
// Søster-guard til HelpPage.faqKeys.test.js (#2691-fælden): auctions.valuation
// og auctions.anonymityAndReveal lå fuldt oversat i help.json uden nogensinde
// at blive renderet, fordi registreringen i blocks-arrayet var glemt (#4064).

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "HelpPage.jsx"), "utf8");

// De 16 forældreløse entries fra #4064-sweepet er nu alle registreret (#4066),
// så allowlisten er tom og guarden er ren fremadrettet. Ny copy må ALDRIG
// tilføjes hertil: skriv den i help.json OG registrér den i blocks-arrayet.
const KNOWN_ORPHANS = {};

function extractSectionDefs(src) {
  const match = src.match(/const SECTION_DEFS = \[([\s\S]*?)\n\];/);
  assert.ok(match, "HelpPage.jsx mangler 'const SECTION_DEFS = [...]' — testen kan ikke parse listen");
  const defs = [...match[1].matchAll(/key: "(\w+)",[\s\S]*?blocks: \[([\s\S]*?)\]/g)].map((m) => ({
    key: m[1],
    blocks: [...m[2].matchAll(/id: "(\w+)"/g)].map((b) => b[1]),
  }));
  assert.ok(defs.length > 0, "Ingen sections parset fra SECTION_DEFS — regexet matcher ikke længere strukturen");
  return defs;
}

function loadSections(lng) {
  const localesDir = join(__dirname, "..", "..", "public", "locales");
  const json = JSON.parse(readFileSync(join(localesDir, lng, "help.json"), "utf8"));
  assert.ok(json.sections, `${lng}/help.json mangler sections-objektet`);
  return json.sections;
}

const defs = extractSectionDefs(source);
const enSections = loadSections("en");
const daSections = loadSections("da");

test("hver section i SECTION_DEFS findes i en/help.json og omvendt", () => {
  const defKeys = defs.map((d) => d.key);
  assert.deepEqual(
    Object.keys(enSections).filter((k) => !defKeys.includes(k)),
    [],
    "sections i en/help.json uden SECTION_DEFS-entry — de renderes aldrig",
  );
  assert.deepEqual(
    defKeys.filter((k) => !enSections[k]),
    [],
    "SECTION_DEFS-sections uden en/help.json-indhold — brugeren ser rå i18n-nøgler",
  );
});

test("ingen blocks-dubletter inden for en section", () => {
  for (const d of defs) {
    assert.equal(new Set(d.blocks).size, d.blocks.length, `${d.key}: blocks-arrayet indeholder dubletter`);
  }
});

test("hver registreret block har indhold i baade en og da help.json", () => {
  for (const d of defs) {
    for (const [lng, sections] of [["en", enSections], ["da", daSections]]) {
      for (const id of d.blocks) {
        assert.ok(
          sections[d.key]?.[id],
          `SECTION_DEFS registrerer ${d.key}.${id} men ${lng}/help.json mangler sections.${d.key}.${id} — brugeren ser rå i18n-nøgle`,
        );
      }
    }
  }
});

test("hver sections-nøgle i en/help.json er registreret i blocks (ellers renderes den aldrig)", () => {
  for (const d of defs) {
    const allowed = KNOWN_ORPHANS[d.key] || [];
    const orphans = Object.keys(enSections[d.key] || {}).filter(
      (k) => k !== "label" && !d.blocks.includes(k) && !allowed.includes(k),
    );
    assert.deepEqual(
      orphans,
      [],
      `Forældreløse entries i en/help.json sections.${d.key} — registrér dem i blocks-arrayet i HelpPage.jsx eller slet dem: ${orphans.join(", ")}`,
    );
  }
});

test("KNOWN_ORPHANS-allowlisten er ikke stale (entries skal fjernes når de registreres/slettes)", () => {
  for (const [key, ids] of Object.entries(KNOWN_ORPHANS)) {
    const def = defs.find((d) => d.key === key);
    assert.ok(def, `KNOWN_ORPHANS peger på ukendt section '${key}'`);
    for (const id of ids) {
      assert.ok(
        enSections[key]?.[id],
        `KNOWN_ORPHANS.${key} indeholder '${id}' som ikke længere findes i en/help.json — fjern den fra allowlisten`,
      );
      assert.ok(
        !def.blocks.includes(id),
        `KNOWN_ORPHANS.${key} indeholder '${id}' som nu ER registreret i blocks — fjern den fra allowlisten`,
      );
    }
  }
});

test("en og da sections har identisk nøglestruktur pr. section (key-parity, #410)", () => {
  assert.deepEqual(Object.keys(enSections).sort(), Object.keys(daSections).sort());
  for (const key of Object.keys(enSections)) {
    assert.deepEqual(
      Object.keys(enSections[key]).sort(),
      Object.keys(daSections[key]).sort(),
      `sections.${key}: en og da har forskellige nøgler`,
    );
  }
});
