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

test("#4570-afstemning: top-level 'vision.title' dækker ALLE 5 klub-DNA-nøgler i begge sprog", () => {
  const dnaKeys = Object.keys(en.dna).filter((k) => en.dna[k]?.label && en.dna[k]?.shortDescription);
  assert.ok(dnaKeys.length >= 5, "forventede mindst 5 DNA-nøgler i board.json's dna-sektion");
  assert.ok(en.vision, "en board.json mangler top-level vision-blokken");
  assert.ok(da.vision, "da board.json mangler top-level vision-blokken");
  assert.deepEqual(Object.keys(en.vision.title).sort(), dnaKeys.sort());
  assert.deepEqual(Object.keys(da.vision.title).sort(), dnaKeys.sort());
});

// #5472 · GET /api/board/room (backend/lib/boardRoom.js) bygger to nøgle-
// familier uden for boardroom-blokken: kvitteringens "Counted" som
// `goalReceipt.counted.<type>` og formandscitatets kontekst som
// `chairmanBeat.<beat>`. Ingen af dem fandtes i locale-filerne, så beta viste
// rå nøgler ("Counted: goalReceipt.counted.stage_wins"). Fixturen brugte egne
// fixture-nøgler og kunne ikke se hullet; derfor pinnes dækningen her mod
// backendens EGEN kilde (samme kilde-parity-mønster som academyDemoteContract).
const repoRoot = join(__dirname, "..", "..", "..", "..");
const readBackend = (p) => readFileSync(join(repoRoot, "backend", "lib", p), "utf8");

function evaluatedGoalTypes() {
  const src = readBackend("boardGoals.js");
  const start = src.indexOf("export function evaluateGoalProgress");
  const end = src.indexOf("export function addGoalMetadata");
  assert.ok(start >= 0 && end > start, "evaluateGoalProgress blev ikke fundet i boardGoals.js");
  return [...new Set([...src.slice(start, end).matchAll(/case "([a-z0-9_]+)":/g)].map((m) => m[1]))];
}

function chairmanBeats() {
  const src = readBackend("boardRoom.js");
  const block = src.match(/const CHAIRMAN_BEAT_BY_REASON = \{([\s\S]*?)\};/);
  assert.ok(block, "CHAIRMAN_BEAT_BY_REASON blev ikke fundet i boardRoom.js");
  return [...new Set([...block[1].matchAll(/:\s*"([a-z_]+)"/g)].map((m) => m[1]))];
}

test("#5472 goalReceipt.counted dækker hver måltype backend evaluerer, plus 'unknown', i begge sprog", () => {
  const types = evaluatedGoalTypes();
  assert.ok(types.length >= 10, `forventede mindst 10 måltyper, fandt ${types.length}`);
  for (const type of [...types, "unknown"]) {
    assert.equal(typeof en.goalReceipt?.counted?.[type], "string", `en mangler goalReceipt.counted.${type}`);
    assert.equal(typeof da.goalReceipt?.counted?.[type], "string", `da mangler goalReceipt.counted.${type}`);
  }
  assert.deepEqual(Object.keys(en.goalReceipt.counted).sort(), Object.keys(da.goalReceipt.counted).sort());
});

test("#5472 chairmanBeat dækker hvert beat formandscitatet kan få, i begge sprog", () => {
  const beats = chairmanBeats();
  assert.ok(beats.length >= 1, "ingen beats fundet i CHAIRMAN_BEAT_BY_REASON");
  for (const beat of beats) {
    assert.equal(typeof en.chairmanBeat?.[beat], "string", `en mangler chairmanBeat.${beat}`);
    assert.equal(typeof da.chairmanBeat?.[beat], "string", `da mangler chairmanBeat.${beat}`);
  }
});

test("#5472 goalReceipt og chairmanBeat: ingen em-dash og ingen ICU-klammer (teksten har ingen parametre)", () => {
  const strings = [en.goalReceipt, da.goalReceipt, en.chairmanBeat, da.chairmanBeat].flatMap((o) => collectStrings(o));
  for (const s of strings) {
    assert.doesNotMatch(s, /—/, `em-dash fundet i: "${s}"`);
    assert.doesNotMatch(s, /[{}]/, `uventet ICU-parameter i: "${s}"`);
  }
});

test("#4570-afstemning: vision.title-namespace har ingen em-dash og ingen invented gameplay-løfter (kun narrativt navn)", () => {
  const enStrings = Object.values(en.vision.title);
  const daStrings = Object.values(da.vision.title);
  for (const s of [...enStrings, ...daStrings]) {
    assert.doesNotMatch(s, /—/, `em-dash fundet i: "${s}"`);
    // "narrativt klub-navn" = kort, ingen tal/procenter der lover en konkret spilmekanik.
    assert.doesNotMatch(s, /\d/, `vision-titel skal være et navn, ikke et tal-løfte: "${s}"`);
  }
});
