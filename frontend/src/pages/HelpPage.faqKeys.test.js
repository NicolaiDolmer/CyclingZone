import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Forward-guard: hver faq.*-nøgle i help.json SKAL være registreret i FAQ_KEYS i
// HelpPage.jsx — og omvendt. 18 entries lå forældreløse i help.json uden nogensinde
// at blive renderet, fordi feature-PR'er tilføjede copy men glemte registreringen
// (samme fælde som academyIntake-nøglerne i #2691).

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "HelpPage.jsx"), "utf8");

function extractFaqKeys(src) {
  const match = src.match(/const FAQ_KEYS = \[([\s\S]*?)\];/);
  assert.ok(match, "HelpPage.jsx mangler 'const FAQ_KEYS = [...]' — testen kan ikke parse listen");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function loadFaq(lng) {
  const localesDir = join(__dirname, "..", "..", "public", "locales");
  const json = JSON.parse(readFileSync(join(localesDir, lng, "help.json"), "utf8"));
  assert.ok(json.faq, `${lng}/help.json mangler faq-sektionen`);
  return json.faq;
}

const faqKeys = extractFaqKeys(source);
const enFaq = loadFaq("en");
const daFaq = loadFaq("da");

test("FAQ_KEYS har ingen dubletter", () => {
  assert.equal(new Set(faqKeys).size, faqKeys.length, "FAQ_KEYS indeholder dubletter");
});

test("hver faq.*-nøgle i en/help.json er registreret i FAQ_KEYS (ellers renderes den aldrig)", () => {
  const orphans = Object.keys(enFaq).filter((k) => !faqKeys.includes(k));
  assert.deepEqual(
    orphans,
    [],
    `Forældreløse faq-entries i en/help.json — tilføj dem til FAQ_KEYS i HelpPage.jsx eller slet dem: ${orphans.join(", ")}`,
  );
});

test("hver nøgle i FAQ_KEYS findes i både en og da help.json med q og a", () => {
  for (const key of faqKeys) {
    for (const [lng, faq] of [["en", enFaq], ["da", daFaq]]) {
      assert.ok(faq[key], `FAQ_KEYS indeholder '${key}' men ${lng}/help.json mangler faq.${key} — brugeren ser rå i18n-nøgle`);
      assert.ok(faq[key].q && faq[key].a, `${lng}/help.json faq.${key} mangler q eller a`);
    }
  }
});

test("en og da faq-sektioner har identisk nøglestruktur (key-parity, #410)", () => {
  assert.deepEqual(Object.keys(enFaq).sort(), Object.keys(daFaq).sort());
});
