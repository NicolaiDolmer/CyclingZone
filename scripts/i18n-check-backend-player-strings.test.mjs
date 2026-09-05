import test from "node:test";
import assert from "node:assert/strict";
import { findDanishLines, stripComments, stripOpsLogging, scan, SCANNED_FILES } from "./i18n-check-backend-player-strings.mjs";

// #4734 · Guarden er kun noget vaerd hvis den FANGER en bevidst leak og IKKE
// fanger de tre ting der lovligt er danske i backend: kommentarer, ops-logning
// og de dokumenterede undtagelser.

test("fanger en hardkodet dansk streng i spillervendt kode", () => {
  const src = 'const t = { title: "Auktion annulleret på grund af fuldt hold" };\n';
  assert.deepEqual(findDanishLines(src), [1]);
});

test("danske kommentarer taeller ikke", () => {
  const src = "// Vi annullerer auktionen her\nconst a = 1;\n/* flerlinjet\n   dansk forklaring */\nconst b = 2;\n";
  assert.deepEqual(findDanishLines(src), []);
});

test("linjenumre peger paa den rigtige kildelinje efter comment-stripping", () => {
  const src = "/* dansk\n   blok\n   over flere linjer */\nconst ok = 1;\nconst bad = \"forsøg\";\n";
  assert.deepEqual(findDanishLines(src), [5]);
});

test("ops-logning er lovligt dansk — ogsaa flerlinjet", () => {
  const src = [
    'console.error(',
    '  `  ⚠️  Notifikation fejlede for ${id} (ikke-fatal):`,',
    '  err.message',
    ');',
    'const x = 1;',
  ].join("\n");
  assert.deepEqual(findDanishLines(src), []);
});

test("en dansk streng LIGE efter et ops-log-kald fanges stadig", () => {
  const src = 'console.warn("dansk log");\nconst t = "Auktion udløb";\n';
  assert.deepEqual(findDanishLines(src), [2]);
});

test("de dokumenterede undtagelser bevogter stadig resten af filen", () => {
  const rel = "backend/lib/auctionFinalization.js";
  const src = '        description: `Købt på auktion`,\n        title: "Vundet på auktion",\n';
  // description-linjen er undtaget (finance-legacy), title-linjen er ikke.
  assert.deepEqual(findDanishLines(src, rel), [2]);
});

test("stripComments og stripOpsLogging bevarer linjeantallet", () => {
  const src = "/* a\nb */\nconsole.log(\n  1\n);\nx\n";
  assert.equal(stripOpsLogging(stripComments(src)).split("\n").length, src.split("\n").length);
});

test("repoet er groent, og guarden peger paa filer der findes", () => {
  const { leaks, missing } = scan();
  assert.deepEqual(missing, [], "SCANNED_FILES peger paa en fil der ikke findes");
  assert.deepEqual(leaks, [], `dansk prosa i ${leaks.map((l) => l.file).join(", ")}`);
  assert.ok(SCANNED_FILES.length >= 5);
});
