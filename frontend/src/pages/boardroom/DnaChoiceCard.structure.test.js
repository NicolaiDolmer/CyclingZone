import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #4557 (overblik + faner) · Klub-DNA-valget flyttet ind fra den gamle
// BoardPage. Guards: samme copy-noegler som foer (ingen ny tekst), ingen emoji
// (TASTE §3 / PAGE_TEMPLATES "no emoji"), ingen guld-knap.

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "DnaChoiceCard.jsx"), "utf8");
const boardCardSource = readFileSync(join(__dirname, "BoardCard.jsx"), "utf8");
const legacySource = readFileSync(
  join(__dirname, "..", "..", "components", "board", "ClubDnaSelectionCard.jsx"), "utf8",
);

test("#4557 dna: copy-resolverne deles med den gamle side (ingen duplikeret dna-copy-logik)", () => {
  assert.match(source, /from "\.\.\/\.\.\/components\/board\/dnaCopy\.js"/);
  assert.match(legacySource, /from "\.\/dnaCopy\.js"/);
});

test("#4557 dna: kortet forfatter ingen ny copy — alle strenge er de eksisterende dna.*-noegler", () => {
  for (const key of ["dna.selectHeading", "dna.sectionLabel", "dna.selectIntro", "dna.choose", "dna.current"]) {
    assert.ok(source.includes(`"${key}"`), `mangler genbrug af ${key}`);
  }
});

test("#4557 dna: ingen emoji-cirkel paa den nye flade (TASTE §3 forbudsliste)", () => {
  assert.doesNotMatch(source, /suggestion\.emoji/, "den gamle emoji-cirkel foelger IKKE med ind i Boardroom");
  assert.match(legacySource, /suggestion\.emoji/, "guarden er kun meningsfuld saa laenge den gamle side FAKTISK har emoji-cirklen");
  assert.doesNotMatch(source, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
});

test("#4557 dna: knappen er secondary (sidens ene guld er aarsmoedet)", () => {
  assert.doesNotMatch(source, /variant="primary"/);
  assert.match(source, /variant="secondary"/);
});

test("#4557 dna: Board-fanens DNA-linje viser 'Change club DNA' i foerste saeson og 'Locked' derefter", () => {
  assert.match(boardCardSource, /canRechoose \?/);
  assert.match(boardCardSource, /t\("dna\.rechoose\.toggle"\)/);
  assert.match(boardCardSource, /t\("dna\.locked\.heading"\)/);
  assert.match(boardCardSource, /t\("boardroom\.board\.dnaExplainer"\)/);
  // Linjen ligger efter en hairline nederst i kortet, som mockup'en.
  assert.match(boardCardSource, /border-t border-cz-border pt-3/);
});
