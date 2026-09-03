// Tests for i18n delta-oversætteren — Refs #4733.
// Kør: node --test scripts/i18n-translate-delta.test.mjs
//
// Ingen netværk: `translateBatch` injiceres, så API-stien aldrig rammes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_MODEL,
  PLACEHOLDER,
  buildSystemPrompt,
  computeNamespaceDelta,
  extractIcuArguments,
  extractSimplePlaceholders,
  flattenLocale,
  listNamespaces,
  listTargetLanguages,
  parseArgs,
  parseGlossary,
  parseModelJson,
  rebuildFromEn,
  runTranslateDelta,
  serializeLocale,
  shortHash,
  validateTranslation,
} from "./i18n-translate-delta.mjs";

// ---------------------------------------------------------------------------
// Fixture-hjælpere
// ---------------------------------------------------------------------------

const GLOSSARY_FIXTURE = `# i18n Glossary — Cycling Zone

## Konventioner

- Proper nouns oversættes ikke.

## Termer

| English | Dansk | Kontekst | Må IKKE oversættes? |
|---|---|---|---|
| Squad | Hold | Gruppen af rytterkontrakter | nej |
| CZ$ | CZ$ | Spil-valuta | ja |
| Deadline Day | Deadline Day | Marked-event | ja |

## Sprog-koder (BCP 47)

- \`da\` — dansk
`;

function makeRepo({ en = {}, targets = {}, state = null, glossary = GLOSSARY_FIXTURE } = {}) {
  const root = mkdtempSync(join(tmpdir(), "i18n-delta-"));
  const localesDir = join(root, "locales");
  mkdirSync(join(localesDir, "en"), { recursive: true });
  for (const [ns, data] of Object.entries(en)) {
    writeFileSync(join(localesDir, "en", `${ns}.json`), serializeLocale(data), "utf8");
  }
  for (const [lng, namespaces] of Object.entries(targets)) {
    mkdirSync(join(localesDir, lng), { recursive: true });
    for (const [ns, data] of Object.entries(namespaces)) {
      writeFileSync(join(localesDir, lng, `${ns}.json`), serializeLocale(data), "utf8");
    }
  }
  const glossaryPath = join(root, "GLOSSARY.md");
  writeFileSync(glossaryPath, glossary, "utf8");
  const statePath = join(localesDir, ".i18n-state.json");
  if (state) writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return { root, localesDir, glossaryPath, statePath };
}

const silent = () => {};

function echoTranslator(transform = (s) => `DA:${s}`) {
  const calls = [];
  const fn = async ({ entries, lng, ns, model, systemPrompt }) => {
    calls.push({ keys: entries.map((e) => e.key), lng, ns, model, systemPrompt });
    return Object.fromEntries(entries.map((e) => [e.key, transform(e.source, e.key)]));
  };
  fn.calls = calls;
  return fn;
}

function readState(statePath) {
  return JSON.parse(readFileSync(statePath, "utf8"));
}

// ---------------------------------------------------------------------------
// Flatten / rebuild / serialisering
// ---------------------------------------------------------------------------

test("flattenLocale: nested objekter og arrays flades til dot-paths, tal springes over", () => {
  const flat = flattenLocale({
    nav: { item: { dashboard: "Dashboard" } },
    reactions: { positive: ["Nice", "Great"] },
    limit: 42,
  });
  assert.deepEqual(
    [...flat.entries()].sort(),
    [
      ["nav.item.dashboard", "Dashboard"],
      ["reactions.positive.0", "Nice"],
      ["reactions.positive.1", "Great"],
    ],
  );
});

test("rebuildFromEn: bevarer EN's nøglerækkefølge og array-struktur", () => {
  const en = { z: "Z", a: { b: "B", c: "C" }, list: ["one", "two"] };
  const rebuilt = rebuildFromEn(en, (path, value) => `[${path}]${value}`);
  assert.deepEqual(Object.keys(rebuilt), ["z", "a", "list"]);
  assert.deepEqual(Object.keys(rebuilt.a), ["b", "c"]);
  assert.ok(Array.isArray(rebuilt.list));
  assert.equal(rebuilt.list[1], "[list.1]two");
});

test("serializeLocale: 2-space indent og trailing newline", () => {
  const out = serializeLocale({ a: { b: "c" } });
  assert.equal(out, '{\n  "a": {\n    "b": "c"\n  }\n}\n');
  assert.ok(!out.startsWith("﻿"), "ingen BOM");
});

// ---------------------------------------------------------------------------
// Hash-detektion
// ---------------------------------------------------------------------------

test("computeNamespaceDelta: ny nøgle, ændret kilde, uændret nøgle og fjernet nøgle", () => {
  const enFlat = flattenLocale({ a: "Alpha", b: "Bravo changed", c: "Charlie" });
  const targetFlat = flattenLocale({ b: "Bravo (da)", c: "Charlie (da)", gone: "Væk" });
  const nsState = {
    b: { srcHash: shortHash("Bravo"), status: "reviewed" },
    c: { srcHash: shortHash("Charlie"), status: "machine" },
    gone: { srcHash: shortHash("Gone"), status: "machine" },
  };

  const delta = computeNamespaceDelta({ enFlat, targetFlat, nsState });

  assert.deepEqual(delta.toTranslate.map((e) => [e.key, e.reason]), [
    ["a", "new"],
    ["b", "changed"],
  ]);
  assert.deepEqual(delta.unchanged, ["c"]);
  assert.deepEqual(delta.firstRun, []);
  assert.deepEqual(delta.removed, ["gone"]);
});

test("computeNamespaceDelta: `__MISSING__` tæller som manglende", () => {
  const enFlat = flattenLocale({ a: "Alpha" });
  const targetFlat = flattenLocale({ a: PLACEHOLDER });
  const nsState = { a: { srcHash: shortHash("Alpha"), status: "machine" } };
  const delta = computeNamespaceDelta({ enFlat, targetFlat, nsState });
  assert.deepEqual(delta.toTranslate.map((e) => e.reason), ["new"]);
});

test("computeNamespaceDelta: eksisterende oversættelse uden state-post = første kørsel (reviewed, ikke oversat)", () => {
  const enFlat = flattenLocale({ a: "Alpha" });
  const targetFlat = flattenLocale({ a: "Alfa" });
  const delta = computeNamespaceDelta({ enFlat, targetFlat, nsState: {} });
  assert.deepEqual(delta.toTranslate, []);
  assert.deepEqual(delta.firstRun.map((e) => e.key), ["a"]);
  assert.equal(delta.firstRun[0].hash, shortHash("Alpha"));
});

// ---------------------------------------------------------------------------
// ICU-validering
// ---------------------------------------------------------------------------

test("extractSimplePlaceholders / extractIcuArguments", () => {
  assert.deepEqual([...extractSimplePlaceholders("Hi {name}, you have {count} bids")].sort(), ["count", "name"]);
  assert.deepEqual([...extractIcuArguments("{count, plural, one {# rider} other {# riders}}")], ["count"]);
});

test("validateTranslation: godkender en korrekt oversættelse", () => {
  const check = validateTranslation("Hi {name}, {count} bids", "Hej {name}, {count} bud");
  assert.deepEqual(check.errors, []);
  assert.equal(check.ok, true);
});

test("validateTranslation: afviser en oversat placeholder", () => {
  const check = validateTranslation("Hi {name}", "Hej {navn}");
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((e) => e.includes("manglende placeholder")), check.errors.join("; "));
  assert.ok(check.errors.some((e) => e.includes("ukendt")), check.errors.join("; "));
});

test("validateTranslation: afviser en brudt plural-struktur (tabt klamme)", () => {
  const check = validateTranslation("{count, plural, one {# rider} other {# riders}}", "{count, plural, one {# rytter} other {# ryttere}");
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((e) => e.includes("ubalancerede klammer")), check.errors.join("; "));
});

test("validateTranslation: afviser tabt `#` i en plural-gren", () => {
  const check = validateTranslation("{count, plural, one {# rider} other {# riders}}", "{count, plural, one {en rytter} other {# ryttere}}");
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((e) => e.includes("antal `#`")), check.errors.join("; "));
});

test("validateTranslation: select-grene må oversættes uden at tælle som placeholders", () => {
  const src = "{kind, select, crash {crash} mechanical {mechanical problem} other {incident}}";
  const target = "{kind, select, crash {styrt} mechanical {mekanisk problem} other {uheld}}";
  assert.deepEqual(validateTranslation(src, target).errors, []);
});

test("validateTranslation: afviser em-dash og dobbelt-klamme", () => {
  assert.ok(validateTranslation("Season one", "Sæson et — det bedste").errors.some((e) => e.includes("em-dash")));
  assert.ok(validateTranslation("Hi {name}", "Hej {{name}}").errors.some((e) => e.includes("{{ident}}")));
});

// ---------------------------------------------------------------------------
// Glossar-parsing
// ---------------------------------------------------------------------------

test("parseGlossary: læser Termer-tabellen fra en markdown-fil og markerer 'må ikke oversættes'", () => {
  const terms = parseGlossary(GLOSSARY_FIXTURE);
  assert.deepEqual(terms.map((t) => t.english), ["Squad", "CZ$", "Deadline Day"]);
  assert.equal(terms[0].danish, "Hold");
  assert.equal(terms[0].doNotTranslate, false);
  assert.equal(terms[1].doNotTranslate, true);
  assert.equal(terms[2].doNotTranslate, true);
});

test("parseGlossary: ignorerer tabeller uden for Termer-sektionen", () => {
  const md = `## Andet\n\n| A | B | C | D |\n|---|---|---|---|\n| x | y | z | ja |\n\n## Termer\n\n| English | Dansk | Kontekst | Må IKKE oversættes? |\n|---|---|---|---|\n| Squad | Hold | ctx | nej |\n`;
  assert.deepEqual(parseGlossary(md).map((t) => t.english), ["Squad"]);
});

test("buildSystemPrompt: injicerer glossaret, tone-, ICU- og kontekst-reglerne", () => {
  const prompt = buildSystemPrompt({ lng: "da", ns: "common", terms: parseGlossary(GLOSSARY_FIXTURE) });
  assert.ok(prompt.includes("Never translate these terms"));
  assert.ok(prompt.includes("CZ$"));
  assert.ok(prompt.includes("Deadline Day"));
  assert.ok(prompt.includes('Squad -> use "Hold"'));
  assert.ok(prompt.includes("em-dash"));
  assert.ok(prompt.includes("æ, ø and å"));
  assert.ok(prompt.includes("i18next-icu"));
  assert.ok(prompt.includes("Namespace: common"));
});

// ---------------------------------------------------------------------------
// Modelsvar-parsing
// ---------------------------------------------------------------------------

test("parseModelJson: tolererer markdown-fence, afviser ikke-objekter", () => {
  assert.deepEqual(parseModelJson('```json\n{"a": "b"}\n```'), { a: "b" });
  assert.deepEqual(parseModelJson('{"a": "b"}'), { a: "b" });
  assert.throws(() => parseModelJson("[1,2]"), /ikke et JSON-objekt/);
  assert.throws(() => parseModelJson("nope"));
});

// ---------------------------------------------------------------------------
// End-to-end (med injiceret translateBatch)
// ---------------------------------------------------------------------------

test("runTranslateDelta: første kørsel registrerer eksisterende DA som reviewed uden at oversætte", async () => {
  const repo = makeRepo({
    en: { common: { greeting: "Hello", bye: "Bye" } },
    targets: { da: { common: { greeting: "Hej", bye: "Farvel" } } },
  });
  const translate = echoTranslator();

  const result = await runTranslateDelta({ ...repo, translateBatch: translate, log: silent });

  assert.equal(result.exitCode, 0);
  assert.equal(translate.calls.length, 0, "ingen API-kald på en ren første kørsel");
  const state = readState(repo.statePath);
  assert.deepEqual(state.languages.da.common, {
    greeting: { srcHash: shortHash("Hello"), status: "reviewed" },
    bye: { srcHash: shortHash("Bye"), status: "reviewed" },
  });
  // Filen er urørt.
  assert.deepEqual(JSON.parse(readFileSync(join(repo.localesDir, "da", "common.json"), "utf8")), {
    greeting: "Hej",
    bye: "Farvel",
  });
});

test("runTranslateDelta: oversætter kun nye og ændrede nøgler, rører aldrig en kaptajn-rettelse", async () => {
  const repo = makeRepo({
    en: { common: { kept: "Kept", changed: "Changed now", fresh: "Fresh" } },
    targets: { da: { common: { kept: "Kaptajnens ord", changed: "Gammel" } } },
    state: {
      version: 1,
      languages: {
        da: {
          common: {
            kept: { srcHash: shortHash("Kept"), status: "reviewed" },
            changed: { srcHash: shortHash("Changed before"), status: "reviewed" },
          },
        },
      },
    },
  });
  const translate = echoTranslator();

  const result = await runTranslateDelta({ ...repo, translateBatch: translate, log: silent });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(translate.calls[0].keys.sort(), ["changed", "fresh"]);
  const da = JSON.parse(readFileSync(join(repo.localesDir, "da", "common.json"), "utf8"));
  assert.equal(da.kept, "Kaptajnens ord", "uændret EN-kilde => kaptajn-rettelsen overlever");
  assert.equal(da.changed, "DA:Changed now");
  assert.equal(da.fresh, "DA:Fresh");

  const state = readState(repo.statePath);
  assert.equal(state.languages.da.common.kept.status, "reviewed");
  assert.equal(state.languages.da.common.changed.status, "machine");
  assert.equal(state.languages.da.common.fresh.status, "machine");
});

test("runTranslateDelta: nøgler fjernet fra EN forsvinder fra målsprog og state", async () => {
  const repo = makeRepo({
    en: { common: { keep: "Keep" } },
    targets: { da: { common: { keep: "Behold", dropped: "Slettes" } } },
    state: {
      version: 1,
      languages: {
        da: { common: { keep: { srcHash: shortHash("Keep"), status: "reviewed" }, dropped: { srcHash: "abc", status: "machine" } } },
      },
    },
  });

  const result = await runTranslateDelta({ ...repo, translateBatch: echoTranslator(), log: silent });

  assert.equal(result.exitCode, 0);
  assert.equal(result.rows[0].removed, 1);
  const da = JSON.parse(readFileSync(join(repo.localesDir, "da", "common.json"), "utf8"));
  assert.deepEqual(Object.keys(da), ["keep"]);
  assert.deepEqual(Object.keys(readState(repo.statePath).languages.da.common), ["keep"]);
});

test("runTranslateDelta: nøglerækkefølgen følger EN-filen, ikke målsprogets", async () => {
  const repo = makeRepo({
    en: { common: { first: "First", second: "Second", third: "Third" } },
    targets: { da: { common: { third: "Tredje", first: "Første" } } },
    state: {
      version: 1,
      languages: { da: { common: { third: { srcHash: shortHash("Third"), status: "reviewed" }, first: { srcHash: shortHash("First"), status: "reviewed" } } } },
    },
  });

  await runTranslateDelta({ ...repo, translateBatch: echoTranslator(), log: silent });

  const raw = readFileSync(join(repo.localesDir, "da", "common.json"), "utf8");
  assert.deepEqual(Object.keys(JSON.parse(raw)), ["first", "second", "third"]);
  assert.ok(raw.endsWith("}\n"));
});

test("runTranslateDelta: en nøgle der fejler ICU-valideringen skrives ikke, men de gode skrives", async () => {
  const repo = makeRepo({
    en: { common: { ok: "Hi {name}", broken: "You have {count} bids" } },
    targets: { da: {} },
  });
  const translate = async ({ entries }) =>
    Object.fromEntries(entries.map((e) => [e.key, e.key === "broken" ? "Du har {antal} bud" : "Hej {name}"]));

  const result = await runTranslateDelta({ ...repo, translateBatch: translate, log: silent });

  assert.equal(result.exitCode, 1);
  assert.equal(result.failures.length, 1);
  assert.ok(result.failures[0].includes("broken"));
  const da = JSON.parse(readFileSync(join(repo.localesDir, "da", "common.json"), "utf8"));
  assert.equal(da.ok, "Hej {name}");
  assert.equal(da.broken, PLACEHOLDER, "fejlet nøgle skrives som placeholder, ikke som gæt");
  assert.equal(readState(repo.statePath).languages.da.common.broken, undefined);
});

test("runTranslateDelta: --dry-run skriver intet og kalder ikke modellen", async () => {
  const repo = makeRepo({ en: { common: { fresh: "Fresh" } }, targets: { da: {} } });
  const translate = echoTranslator();

  const result = await runTranslateDelta({ ...repo, dryRun: true, translateBatch: translate, log: silent });

  assert.equal(translate.calls.length, 0);
  assert.equal(result.rows[0].new, 1);
  assert.equal(existsSync(repo.statePath), false, "ingen state-fil skrevet");
  assert.equal(existsSync(join(repo.localesDir, "da", "common.json")), false, "ingen locale-fil skrevet");
});

test("runTranslateDelta: --max-keys er et loft der stopper kørslen før ethvert API-kald", async () => {
  const repo = makeRepo({ en: { common: { a: "A", b: "B", c: "C" } }, targets: { da: {} } });
  const translate = echoTranslator();
  await assert.rejects(
    () => runTranslateDelta({ ...repo, maxKeys: 2, translateBatch: translate, log: silent }),
    /sikkerhedsloftet er ramt/,
  );
  assert.equal(translate.calls.length, 0);
});

test("runTranslateDelta: --mark-reviewed flipper machine -> reviewed når hashen matcher", async () => {
  const repo = makeRepo({
    en: { common: { synced: "Synced", stale: "New english" } },
    targets: { da: { common: { synced: "Synkroniseret", stale: "Gammel dansk" } } },
    state: {
      version: 1,
      languages: {
        da: {
          common: {
            synced: { srcHash: shortHash("Synced"), status: "machine" },
            stale: { srcHash: shortHash("Old english"), status: "machine" },
          },
        },
      },
    },
  });

  const result = await runTranslateDelta({ ...repo, markReviewed: true, lng: "da", ns: "common", log: silent });

  assert.equal(result.exitCode, 0);
  const state = readState(repo.statePath).languages.da.common;
  assert.equal(state.synced.status, "reviewed");
  assert.equal(state.stale.status, "machine", "ændret EN-kilde flippes ikke");
});

test("runTranslateDelta: et nyt sprog er bare en ny (tom) mappe", async () => {
  const repo = makeRepo({
    en: { common: { hello: "Hello" } },
    targets: { fr: {} },
  });

  const result = await runTranslateDelta({ ...repo, translateBatch: echoTranslator((s) => `FR:${s}`), log: silent });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.rows.map((r) => r.lng), ["fr"]);
  assert.deepEqual(JSON.parse(readFileSync(join(repo.localesDir, "fr", "common.json"), "utf8")), { hello: "FR:Hello" });
});

test("listTargetLanguages: springer en og en-XA over", () => {
  const repo = makeRepo({ en: { common: { a: "A" } }, targets: { da: {}, fr: {}, "en-XA": {} } });
  assert.deepEqual(listTargetLanguages(repo.localesDir), ["da", "fr"]);
  assert.deepEqual(listNamespaces(repo.localesDir), ["common"]);
});

test("runTranslateDelta: ukendt sprog eller namespace fejler tydeligt", async () => {
  const repo = makeRepo({ en: { common: { a: "A" } }, targets: { da: {} } });
  await assert.rejects(() => runTranslateDelta({ ...repo, lng: "xx", log: silent }), /ukendt målsprog/);
  await assert.rejects(() => runTranslateDelta({ ...repo, ns: "nope", log: silent }), /ukendt namespace/);
});

test("runTranslateDelta: uden ANTHROPIC_API_KEY fejler kørslen med en henvisning til Infisical", async () => {
  const repo = makeRepo({ en: { common: { fresh: "Fresh" } }, targets: { da: {} } });
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    await assert.rejects(() => runTranslateDelta({ ...repo, log: silent }), /infisical run --env=dev -- npm run i18n:translate/);
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
});

// ---------------------------------------------------------------------------
// CLI-parsing
// ---------------------------------------------------------------------------

test("parseArgs: flag-parsing og defaults", () => {
  assert.deepEqual(parseArgs([]), { dryRun: false, markReviewed: false, lng: null, ns: null, model: DEFAULT_MODEL, maxKeys: 500 });
  assert.deepEqual(parseArgs(["--dry-run", "--lng", "da", "--ns", "common", "--model", "x", "--max-keys", "10"]), {
    dryRun: true,
    markReviewed: false,
    lng: "da",
    ns: "common",
    model: "x",
    maxKeys: 10,
  });
  assert.throws(() => parseArgs(["--nope"]), /ukendt flag/);
});

test("DEFAULT_MODEL er eksplicit og pinned", () => {
  assert.equal(DEFAULT_MODEL, "claude-sonnet-5");
});
