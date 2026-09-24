import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "BoardPage.jsx"), "utf8");
const localesDir = join(__dirname, "..", "..", "public", "locales");

// #5632 · Samme fund som MandateCard.jsx (PR #5679): locale-strengene for
// boost/strong_boost baerer allerede et bogstaveligt "+" foer {pct}, saa et
// ekstra fortegn fra JS gav "++10%" i det gamle bestyrelsesrum. penalty/
// strong_penalty har intet fortegn i strengen, og pct er allerede negativt.
test("#5632 board: passiveModifier sender IKKE et ekstra '+'-fortegn (locale-strengen har det allerede — undgår '++10%')", () => {
  assert.match(source, /t\(`transparency\.passiveModifier\.\$\{info\.band\}`, \{ pct: info\.pct \}\)/);
  assert.doesNotMatch(source, /const sign = info\.pct > 0/, "det dobbelte fortegn kom netop fra denne linje");
  assert.doesNotMatch(source, /\$\{sign\}\$\{info\.pct\}/, "pct må ikke praefikses med et JS-fortegn");
});

test("#5632 board: boost-strengene baerer selv '+', penalty-strengene ikke (begge sprog) — praemissen for at JS ikke maa tilfoeje fortegn", () => {
  for (const lang of ["en", "da"]) {
    const board = JSON.parse(readFileSync(join(localesDir, lang, "board.json"), "utf8"));
    const pm = board.transparency.passiveModifier;
    assert.match(pm.boost, /\+\{pct\}%/, `${lang}: boost skal have bogstaveligt '+' foer {pct}`);
    assert.match(pm.strong_boost, /\+\{pct\}%/, `${lang}: strong_boost skal have bogstaveligt '+' foer {pct}`);
    assert.doesNotMatch(pm.penalty, /[+-]\{pct\}/, `${lang}: penalty maa ikke have et fortegn foer {pct} (pct er allerede negativt)`);
    assert.doesNotMatch(pm.strong_penalty, /[+-]\{pct\}/, `${lang}: strong_penalty maa ikke have et fortegn foer {pct}`);
  }
});
