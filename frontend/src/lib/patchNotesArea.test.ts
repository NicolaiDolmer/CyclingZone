// #8049: område pr. patch note. Ingen notetekst ændres; området er en etiket.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PATCHES } from "../data/patchNotes.js";
import { resolveArea, resolveImage, isArea, ALL_AREAS, AREAS, OTHER_AREA, TOPIC_AREA, IMAGE_BY_KEY } from "./patchNotesArea.ts";
import { AREA_BY_KEY } from "./patchNotesAreaData.ts";
import { PATCH_NOTE_AREAS } from "./patchNotes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

type Note = {
  p: { version: string; date: string };
  c: { audience?: string; area?: unknown; topic?: string; image?: unknown };
  key: string;
};
function playerNotes(): Note[] {
  const out: Note[] = [];
  for (const p of PATCHES) p.changes.forEach((c, i) => { if (c.audience === "player") out.push({ p, c, key: `${p.version}#${i}` }); });
  return out;
}

test("rækkefølge: notens eget area > AREA_BY_KEY > topic > other", () => {
  const overrides = { "9.9#0": "board" };
  assert.equal(resolveArea({ area: "training", topic: "Races" }, "9.9#0", overrides), "training");
  assert.equal(resolveArea({ topic: "Races" }, "9.9#0", overrides), "board");
  assert.equal(resolveArea({ topic: "Races" }, "9.9#1", overrides), "races");
  assert.equal(resolveArea({ topic: "Noget helt andet" }, "9.9#1", overrides), OTHER_AREA);
  // "other" kan ikke skrives af en redaktør: et ugyldigt area falder igennem til opslaget.
  assert.equal(resolveArea({ area: "other", topic: "Help" }, "9.9#1", overrides), "help");
});

test("alle spillervendte noter får et gyldigt område", () => {
  for (const { c, key } of playerNotes()) assert.ok(isArea(resolveArea(c, key)), key);
});

test("alle noter fra november har et eksplicit område (ejer 16/11, valg 5)", () => {
  for (const { p, c, key } of playerNotes()) {
    if (p.date < "2026-11-01") continue;
    assert.ok(c.area || AREA_BY_KEY[key], `${key} mangler område`);
    assert.notEqual(resolveArea(c, key), OTHER_AREA, `${key} må ikke ende i Andet`);
  }
});

test("AREA_BY_KEY peger kun på spillervendte noter der findes, med gyldigt område", () => {
  const keys = new Set(playerNotes().map((n) => n.key));
  for (const [key, area] of Object.entries(AREA_BY_KEY)) {
    assert.ok(keys.has(key), `${key} findes ikke som spillervendt note`);
    assert.ok(ALL_AREAS.includes(area), `${key}: ${area}`);
  }
});

test("TOPIC_AREA bruger kun skrivbare områder", () => {
  for (const [topic, area] of Object.entries(TOPIC_AREA)) assert.ok(AREAS.includes(area), `${topic}: ${area}`);
});

test("kun et lille mindretal ender i Andet (kun usikre, ejer 16/11)", () => {
  const notes = playerNotes();
  const other = notes.filter(({ c, key }) => resolveArea(c, key) === OTHER_AREA).length;
  assert.ok(other / notes.length < 0.05, `${other} af ${notes.length} i Andet`);
});

test("CI-vagtens områdeliste er den samme som sidens", () => {
  const require = createRequire(import.meta.url);
  const guard = require("../../../scripts/check-patch-notes-version.js");
  assert.deepEqual([...guard.PATCH_NOTE_AREAS], [...PATCH_NOTE_AREAS]);
});

test("billeder: findes, er under ca. 60 KB og hører til en note der findes", () => {
  const keys = new Set(playerNotes().map((n) => n.key));
  for (const [key, src] of Object.entries(IMAGE_BY_KEY)) {
    assert.ok(keys.has(key), key);
    assert.match(src, /^\/patch-notes-images\/[a-z0-9-]+\.webp$/);
    const size = statSync(join(__dirname, "../../public", src)).size;
    assert.ok(size <= 61440, `${src} er ${size} bytes`);
    assert.equal(resolveImage({}, key), src);
  }
  assert.equal(resolveImage({ image: "https://example.com/x.png" }, "nope"), null);
  assert.equal(resolveImage({ image: "/patch-notes-images/a.webp" }, "nope"), "/patch-notes-images/a.webp");
});
