import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import i18next from "i18next";
import ICU from "i18next-icu";

import { formatGoalValue, resolveGoalTitle } from "./boardroomFormat.js";

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

// #5472 (ejer-review 23/9) · Mål-titlen og målets tal, renderet gennem den ÆGTE
// board.json i en ægte i18next-icu-instans (samme mønster som
// lib/boardGoalLabel.test.js) og i PRÆCIS den form GET /api/board/room sender:
// `labelKey: "goalType.<type>"` og DB'ens rå danske label i `label`.
let tEn;
let tDa;

before(async () => {
  const instance = i18next.createInstance();
  await instance.use(ICU).init({
    lng: "en",
    fallbackLng: "en",
    ns: ["board"],
    defaultNS: "board",
    resources: { en: { board: en }, da: { board: da } },
    interpolation: { escapeValue: false },
  });
  tEn = instance.getFixedT("en");
  tDa = instance.getFixedT("da");
});

// formatNumber (lib/intl.js) læser sproget fra i18next-singletonen.
async function setNumberLanguage(language) {
  if (!i18next.isInitialized) {
    await i18next.init({ lng: language, fallbackLng: "en", resources: {}, initImmediate: false });
    return;
  }
  await i18next.changeLanguage(language);
}

const roomGoal = (type, target, extra = {}) => ({
  type,
  target,
  label: null,
  cumulative: false,
  race_scope: null,
  nationality_code: null,
  labelKey: `goalType.${type}`,
  ...extra,
});

test("#5472 top_n_finish viser 'Top 6' på både EN og DA, også når DB-labelen ER den danske titel", () => {
  // Backend buildGoalLabel gemmer "Top 6 i divisionen", ordret den danske
  // oversættelse. Den tidligere sammenligning med labelen byttede den ud med
  // korttitlen "Divisions-placering".
  const goal = roomGoal("top_n_finish", 6, { label: "Top 6 i divisionen" });
  assert.equal(resolveGoalTitle(tDa, goal), "Top 6 i divisionen");
  assert.equal(resolveGoalTitle(tEn, goal), "Top 6 in the division");
});

test("#5472 hver måltype backend evaluerer får sin hele titel med tal, uanset om DB-labelen er identisk med den danske titel", () => {
  const types = evaluatedGoalTypes();
  assert.ok(types.length >= 10, `forventede mindst 10 måltyper, fandt ${types.length}`);
  for (const type of types) {
    const goal = roomGoal(type, 3, type === "min_national_riders" ? { nationality_code: "DK" } : {});
    const daTitle = resolveGoalTitle(tDa, goal);
    const enTitle = resolveGoalTitle(tEn, goal);
    for (const [lang, title, shortTitle] of [["da", daTitle, da.goalType?.[type]], ["en", enTitle, en.goalType?.[type]]]) {
      assert.ok(title, `${type} (${lang}): tom titel`);
      assert.notEqual(title, shortTitle, `${type} (${lang}): viser korttitlen "${shortTitle}" i stedet for målet`);
      // no_outstanding_debt har intet tal i sin titel; alle andre skal bære målets tal.
      if (type !== "no_outstanding_debt") assert.match(title, /3/, `${type} (${lang}): titlen "${title}" mangler målets tal`);
    }
    // Prod-formen: DB-labelen er ordret den danske titel.
    assert.equal(resolveGoalTitle(tDa, { ...goal, label: daTitle }), daTitle, `${type} (da): skiftede titel da DB-labelen var identisk`);
    assert.equal(resolveGoalTitle(tEn, { ...goal, label: daTitle }), enTitle, `${type} (en): den danske DB-label lækkede ud på engelsk`);
  }
});

test("#5472 korttitlen er kun fallback når målet ikke kan type-oversættes (intet mål-tal at vise)", () => {
  const goal = roomGoal("top_n_finish", null, { label: "Top ? i divisionen" });
  assert.equal(resolveGoalTitle(tEn, goal), en.goalType.top_n_finish);
  assert.equal(resolveGoalTitle(tDa, goal), da.goalType.top_n_finish);
});

// Beløb og "CZ$" bindes med et hårdt mellemrum (formatGoalValue).
const NBSP = "\u00a0";

test("#5472 beløb formateres efter sprog: gældsmålet viser 1.074.082 CZ$ / 1,074,082 CZ$, ikke 1074082", async () => {
  await setNumberLanguage("da");
  assert.equal(formatGoalValue("1074082", "no_outstanding_debt"), `1.074.082${NBSP}CZ$`);
  assert.equal(formatGoalValue("106397", "no_outstanding_debt"), `106.397${NBSP}CZ$`);
  assert.equal(formatGoalValue("-250000", "profitable_transfers"), `-250.000${NBSP}CZ$`);
  assert.equal(formatGoalValue("2.5", "stage_wins"), "2,5");
  assert.match(formatGoalValue("12", "sponsor_growth"), /^12\s%$/u);

  await setNumberLanguage("en");
  assert.equal(formatGoalValue("1074082", "no_outstanding_debt"), `1,074,082${NBSP}CZ$`);
  assert.equal(formatGoalValue("2.5", "stage_wins"), "2.5");
  assert.equal(formatGoalValue("5.5", "sponsor_growth"), "5.5%");
  assert.equal(formatGoalValue("46", "top_n_finish"), "46");
  assert.equal(formatGoalValue("1500", "relative_rank"), "1,500");
});

test("#5472 formatGoalValue: allerede formateret tekst går uændret igennem, og null bliver tom", async () => {
  await setNumberLanguage("en");
  assert.equal(formatGoalValue("+412.000 CZ$", "no_outstanding_debt"), "+412.000 CZ$");
  assert.equal(formatGoalValue(null, "stage_wins"), "");
  assert.equal(formatGoalValue(undefined, "stage_wins"), "");
});
