import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #5753 · "The board's verdict" i sæsonrecappen er en VISNINGS-BONUS oven på
// recappen. Siden rammes af alle managere i minutterne efter sæsonskiftet, og
// dommen kommer fra et nyt endpoint bag board_mandate_model_enabled — et
// slukket flag, en 429 eller en 500 derfra må aldrig kunne vælte recappen.
//
// node --test uden DOM → kildekode-strukturel guard, samme mønster som
// SeasonEndPage.honours.test.js.

const __dirname = dirname(fileURLToPath(import.meta.url));
const strip = (raw) => raw
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");
const page = strip(readFileSync(join(__dirname, "SeasonEndPage.jsx"), "utf8"));
const card = strip(readFileSync(join(__dirname, "..", "components", "BoardVerdictCard.tsx"), "utf8"));

function bodyOf(src, name) {
  const start = src.indexOf(`const ${name} = async`);
  assert.ok(start >= 0, `${name} findes`);
  const next = src.indexOf("\n  const ", start + 10);
  return src.slice(start, next < 0 ? undefined : next);
}

test("#5753 dommen hentes via apiFetch (Retry-After/401-kæden), ikke et bart fetch", () => {
  const body = bodyOf(page, "loadBoardVerdict");
  assert.match(body, /apiFetch\(`\/api\/board\/verdict\/\$\{season\.id\}`/);
  assert.doesNotMatch(body, /(?<![A-Za-z])fetch\(/);
});

test("#5753 en fejlet dom går ALDRIG i sidens fælles error-state", () => {
  const body = bodyOf(page, "loadBoardVerdict");
  assert.doesNotMatch(body, /setError\(/);
  assert.match(body, /catch \(e\)/, "egen catch, så en kastet fejl ikke bobler op");
});

test("#5753 et sent svar fra en tidligere valgt sæson kasseres", () => {
  const body = bodyOf(page, "loadBoardVerdict");
  assert.match(body, /boardVerdictSeasonRef\.current !== season\.id/);
});

test("#5753 dommen sendes ind i pickRecapHighlights (så den står først i listen)", () => {
  assert.match(page, /pickRecapHighlights\(\{[\s\S]*?boardVerdict,[\s\S]*?\}\)/);
});

test("#5753 kortets knap er secondary — heroens download er sidens ene guld-CTA", () => {
  assert.match(card, /variant="secondary"/);
  assert.doesNotMatch(card, /variant="primary"/);
  assert.match(card, /"\/board\/meeting"/);
  assert.match(card, /"\/board"/);
});
