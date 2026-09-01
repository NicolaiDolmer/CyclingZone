import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const localesRoot = join(__dirname, "..", "..", "..", "public", "locales");

const en = JSON.parse(readFileSync(join(localesRoot, "en", "board.json"), "utf8"));
const da = JSON.parse(readFileSync(join(localesRoot, "da", "board.json"), "utf8"));

function keyPaths(obj, prefix = "") {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) out.push(...keyPaths(v, path));
    else out.push(path);
  }
  return out;
}

function collectStrings(obj, out = []) {
  for (const v of Object.values(obj)) {
    if (typeof v === "string") out.push(v);
    else if (v && typeof v === "object") collectStrings(v, out);
  }
  return out;
}

test("#4557 en/board.json og da/board.json har en 'boardroom'-namespace", () => {
  assert.ok(en.boardroom, "en board.json mangler boardroom-blokken");
  assert.ok(da.boardroom, "da board.json mangler boardroom-blokken");
});

test("#4557 boardroom-namespace: nøgle-parallelitet mellem en og da (samme nøgler, forskellige værdier)", () => {
  const enKeys = keyPaths(en.boardroom).sort();
  const daKeys = keyPaths(da.boardroom).sort();
  assert.deepEqual(enKeys, daKeys);
});

test("#4557 boardroom-namespace: ingen em-dash i player-facing copy (tone-check-em-dash-reglen)", () => {
  const enStrings = collectStrings(en.boardroom);
  const daStrings = collectStrings(da.boardroom);
  for (const s of [...enStrings, ...daStrings]) {
    assert.doesNotMatch(s, /—/, `em-dash fundet i: "${s}"`);
  }
});

test("#4557 boardroom.status dækker alle 5 kontrakt-statusser (on_track/at_risk/behind/achieved/failed)", () => {
  const expected = ["on_track", "at_risk", "behind", "achieved", "failed"].sort();
  assert.deepEqual(Object.keys(en.boardroom.status).sort(), expected);
  assert.deepEqual(Object.keys(da.boardroom.status).sort(), expected);
});
