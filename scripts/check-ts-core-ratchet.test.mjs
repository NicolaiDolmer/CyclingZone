// #5158 — selftest for TypeScript-skralde-gaten.
//
// Gaten er kun noget vaerd hvis den faktisk bliver ROED paa de tre ting den
// lover at fange: nye .js-filer i kernen, stigende fejltal, og en kerne-liste
// der er draevet fra hinanden mellem baseline og tsconfig. Alle tests herunder
// koerer paa fixtures — ingen tsc-koersel, saa suiten er millisekunder.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assignArea,
  diffGlobs,
  evaluateRatchet,
  findFatalDiagnostics,
  globToRegExp,
  isAdopting,
  isJsFile,
  isTestFile,
  listCoreFiles,
  parseJsonc,
  parseTscErrors,
} from "./check-ts-core-ratchet.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");

/** Lille, selvstaendig baseline — bevidst ikke den rigtige, saa testene ikke
 *  skal redigeres hver gang nogen konverterer en fil. */
function fixtureBaseline() {
  return {
    generatedAt: "2026-09-11",
    areas: {
      auction: {
        title: "Auktion",
        globs: ["lib/auction*"],
        jsFileCount: 2,
        tsErrorCount: 30,
        files: {
          "lib/auctionEngine.js": 10,
          "lib/auctionFinalization.js": 20,
        },
      },
      finalization: {
        title: "Finalisering",
        globs: ["lib/raceFinalize*"],
        jsFileCount: 1,
        tsErrorCount: 5,
        files: { "lib/raceFinalizeState.js": 5 },
      },
    },
    totals: { jsFileCount: 3, tsErrorCount: 35 },
  };
}

function fixtureFiles() {
  return [
    "lib/auctionEngine.js",
    "lib/auctionFinalization.js",
    "lib/raceFinalizeState.js",
  ];
}

function fixtureErrors(overrides = {}) {
  return new Map(
    Object.entries({
      "lib/auctionEngine.js": 10,
      "lib/auctionFinalization.js": 20,
      "lib/raceFinalizeState.js": 5,
      ...overrides,
    }),
  );
}

test("globToRegExp: * stopper ved mappeskel, ** kryder det", () => {
  assert.ok(globToRegExp("lib/auction*").test("lib/auctionEngine.js"));
  assert.ok(globToRegExp("lib/auction*").test("lib/auctionEngine.ts"));
  assert.ok(!globToRegExp("lib/auction*").test("lib/sub/auctionEngine.js"));
  assert.ok(globToRegExp("lib/**").test("lib/sub/auctionEngine.js"));
  assert.ok(!globToRegExp("lib/auction*").test("lib/economyEngine.js"));
});

test("globs uden filendelse daekker .ts efter konvertering", () => {
  // Regressionsvagt: en `lib/economy*.js`-glob ville tavst tabe filen i samme
  // sekund den blev konverteret til .ts — praecis den fil vi lige gjorde strict.
  const re = globToRegExp("lib/economy*");
  assert.ok(re.test("lib/economyEngine.js"));
  assert.ok(re.test("lib/economyEngine.ts"));
});

test("isTestFile/isJsFile skelner test-, js- og ts-filer", () => {
  assert.ok(isTestFile("lib/auctionEngine.test.js"));
  assert.ok(isTestFile("lib/auctionEngine.test.ts"));
  assert.ok(!isTestFile("lib/auctionEngine.js"));
  assert.ok(isJsFile("lib/auctionEngine.js"));
  assert.ok(isJsFile("lib/auctionEngine.mjs"));
  assert.ok(!isJsFile("lib/auctionEngine.ts"));
});

test("parseTscErrors taeller fejl-linjer og ignorerer fortsaettelser", () => {
  const out = [
    "lib/economyEngine.js(12,3): error TS7006: Parameter 'x' implicitly has an 'any' type.",
    "lib/economyEngine.js(18,9): error TS2339: Property 'foo' does not exist on type '{}'.",
    "  No index signature with a parameter of type 'string' was found.",
    "lib/auctionRules.js(4,1): error TS2345: Argument of type 'string'.",
    "",
    "Found 3 errors in 2 files.",
  ].join("\r\n");
  const counts = parseTscErrors(out);
  assert.equal(counts.get("lib/economyEngine.js"), 2);
  assert.equal(counts.get("lib/auctionRules.js"), 1);
  assert.equal(counts.size, 2);
});

test("parseTscErrors normaliserer Windows-separatorer", () => {
  const counts = parseTscErrors(
    "lib\\economyEngine.js(1,1): error TS1005: ';' expected.",
  );
  assert.equal(counts.get("lib/economyEngine.js"), 1);
});

test("findFatalDiagnostics fanger fejl uden fil-placering", () => {
  // Den farligste fejlklasse for en skralde-gate: en knaekket tsconfig giver
  // TS18003 UDEN fil og linje. parseTscErrors ser nul kerne-fejl, og gaten
  // ville melde "baseline kan saenkes" i stedet for at stoppe.
  const out = [
    "error TS18003: No inputs were found in config file 'tsconfig.core.json'.",
    "lib/economyEngine.js(1,1): error TS1005: ';' expected.",
  ].join("\n");
  assert.equal(parseTscErrors(out).size, 1);
  const fatal = findFatalDiagnostics(out);
  assert.equal(fatal.length, 1);
  assert.match(fatal[0], /TS18003/);
});

test("findFatalDiagnostics fanger fejl placeret i selve tsconfig'en", () => {
  // Verificeret 11/9 med en rigtig koersel: saetter man moduleResolution til
  // 'bundler', klager tsc paa tsconfig.core.json(19,25) — MED fil-placering.
  // Resultatet er nul fejl i alle 35 kerne-filer, altsaa 34 falske
  // "forbedringer" og en baseline der kunne nulstilles.
  const out = [
    "tsconfig.core.json(19,25): error TS5095: Option 'bundler' can only be used when 'module' is set to 'preserve'.",
    "tsconfig.core.json(19,25): error TS5109: Option 'moduleResolution' must be set to 'NodeNext'.",
  ].join("\n");
  const fatal = findFatalDiagnostics(out);
  assert.equal(fatal.length, 2);
  assert.match(fatal[0], /TS5095/);
});

test("findFatalDiagnostics forveksler ikke kilde-fejl med config-fejl", () => {
  const out = [
    "lib/economyEngine.js(12,3): error TS7006: Parameter 'x' implicitly has an 'any' type.",
    "lib/engine/v4/types.ts(4,1): error TS1005: ';' expected.",
    "  Fortsaettelseslinje der naevner error TS7006 igen.",
    "Found 2 errors in 2 files.",
  ].join("\n");
  assert.deepEqual(findFatalDiagnostics(out), []);
});

test("assignArea: foerste match vinder, saa tallene er disjunkte", () => {
  const areas = fixtureBaseline().areas;
  // auctionFinalization.js matcher bade "lib/auction*" og kunne matche en
  // finaliserings-glob; auktion staar foerst og ejer filen.
  assert.equal(assignArea("lib/auctionFinalization.js", areas), "auction");
  assert.equal(assignArea("lib/raceFinalizeState.js", areas), "finalization");
  assert.equal(assignArea("lib/riderProgression.js", areas), null);
});

test("groen naar intet har flyttet sig", () => {
  const result = evaluateRatchet({
    baseline: fixtureBaseline(),
    files: fixtureFiles(),
    errors: fixtureErrors(),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.improvements, []);
  assert.equal(result.next.totals.tsErrorCount, 35);
  assert.equal(result.next.totals.jsFileCount, 3);
});

test("ROED: ny .js-fil i en kerne-mappe siger 'skriv den i TypeScript'", () => {
  const result = evaluateRatchet({
    baseline: fixtureBaseline(),
    files: [...fixtureFiles(), "lib/auctionProxyBidding.js"],
    errors: fixtureErrors({ "lib/auctionProxyBidding.js": 7 }),
  });
  assert.equal(result.ok, false);
  const message = result.failures.join("\n");
  assert.match(message, /lib\/auctionProxyBidding\.js/);
  assert.match(message, /skriv den i TypeScript/);
  // Filtaellingen for omraadet stiger ogsaa — begge regler skal bide.
  assert.match(message, /2 -> 3 \.js-filer/);
});

test("ROED: en fejlfri ny .js-fil er stadig en fejl", () => {
  const result = evaluateRatchet({
    baseline: fixtureBaseline(),
    files: [...fixtureFiles(), "lib/auctionProxyBidding.js"],
    errors: fixtureErrors(),
  });
  assert.equal(result.ok, false);
  assert.match(result.failures.join("\n"), /skriv den i TypeScript/);
});

test("ROED: flere tsc-fejl i en eksisterende kerne-fil", () => {
  const result = evaluateRatchet({
    baseline: fixtureBaseline(),
    files: fixtureFiles(),
    errors: fixtureErrors({ "lib/auctionEngine.js": 11 }),
  });
  assert.equal(result.ok, false);
  assert.match(result.failures.join("\n"), /10 -> 11 tsc-fejl \(\+1\)/);
});

test("GROEN: faerre fejl giver 'baseline kan saenkes', ikke en fejl", () => {
  const result = evaluateRatchet({
    baseline: fixtureBaseline(),
    files: fixtureFiles(),
    errors: fixtureErrors({ "lib/auctionEngine.js": 3 }),
  });
  assert.equal(result.ok, true);
  assert.match(result.improvements.join("\n"), /10 -> 3 tsc-fejl/);
  assert.equal(result.next.areas.auction.tsErrorCount, 23);
});

test("GROEN: .js -> .ts-konvertering taeller som forbedring", () => {
  const result = evaluateRatchet({
    baseline: fixtureBaseline(),
    files: [
      "lib/auctionEngine.ts",
      "lib/auctionFinalization.js",
      "lib/raceFinalizeState.js",
    ],
    errors: new Map([
      ["lib/auctionFinalization.js", 20],
      ["lib/raceFinalizeState.js", 5],
    ]),
  });
  assert.equal(result.ok, true);
  assert.equal(result.next.areas.auction.jsFileCount, 1);
  const improvements = result.improvements.join("\n");
  assert.match(improvements, /lib\/auctionEngine\.ts/);
  assert.match(improvements, /lib\/auctionEngine\.js: ude af kernen/);
});

test("ROED: en ny .ts-fil i kernen skal vaere fejlfri", () => {
  const result = evaluateRatchet({
    baseline: fixtureBaseline(),
    files: [...fixtureFiles(), "lib/auctionProxyBidding.ts"],
    errors: fixtureErrors({ "lib/auctionProxyBidding.ts": 2 }),
  });
  assert.equal(result.ok, false);
  assert.match(result.failures.join("\n"), /skal vaere fejlfri/);
});

test("fejl uden for kerne-globs ignoreres", () => {
  // tsc checker hele programmet, inkl. importerede ikke-kerne-filer. De maa
  // aldrig kunne faelde gaten i en PR der slet ikke roerer kernen.
  const result = evaluateRatchet({
    baseline: fixtureBaseline(),
    files: fixtureFiles(),
    errors: fixtureErrors({ "lib/riderProgression.js": 9999 }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.next.totals.tsErrorCount, 35);
});

test("et HELT NYT omraade (uden files) adopteres uden at blive kaldt regression", () => {
  // Eneste maade at udvide kerne-listen paa: tilfoej omraadet uden `files`,
  // koer --update-baseline, commit. Der er intet at regressere fra endnu.
  const baseline = fixtureBaseline();
  baseline.areas.economy = { title: "Oekonomi", globs: ["lib/economy*"] };
  const result = evaluateRatchet({
    baseline,
    files: [...fixtureFiles(), "lib/economyEngine.js"],
    errors: fixtureErrors({ "lib/economyEngine.js": 221 }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.next.areas.economy.jsFileCount, 1);
  assert.equal(result.next.areas.economy.tsErrorCount, 221);
  assert.match(result.improvements.join("\n"), /maalt foerste gang/);
});

test("adoption kan IKKE bruges til at haeve et allerede maalt omraade", () => {
  // `files: {}` er ikke det samme som "manglende files": et omraade der én
  // gang er maalt, er maalt — og saa gaelder skralden fuldt ud.
  const baseline = fixtureBaseline();
  baseline.areas.economy = { title: "Oekonomi", globs: ["lib/economy*"], files: {} };
  const result = evaluateRatchet({
    baseline,
    files: [...fixtureFiles(), "lib/economyEngine.js"],
    errors: fixtureErrors({ "lib/economyEngine.js": 221 }),
  });
  assert.equal(result.ok, false);
  assert.match(result.failures.join("\n"), /skriv den i TypeScript/);
  assert.equal(isAdopting(baseline.areas.economy), false);
  assert.equal(isAdopting({ globs: [] }), true);
});

test("diffGlobs fanger divergens mellem baseline og tsconfig", () => {
  const areas = fixtureBaseline().areas;
  const diff = diffGlobs(areas, ["lib/auction*", "lib/economy*"]);
  assert.deepEqual(diff.missingInTsconfig, ["lib/raceFinalize*"]);
  assert.deepEqual(diff.missingInBaseline, ["lib/economy*"]);
});

test("listCoreFiles matcher globs og springer tests over", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-core-ratchet-"));
  try {
    fs.mkdirSync(path.join(dir, "lib"));
    for (const name of [
      "auctionEngine.js",
      "auctionEngine.test.js",
      "auctionRules.ts",
      "riderProgression.js",
      "notes.md",
    ]) {
      fs.writeFileSync(path.join(dir, "lib", name), "", "utf8");
    }
    const files = listCoreFiles(dir, { auction: { globs: ["lib/auction*"] } });
    assert.deepEqual(files, ["lib/auctionEngine.js", "lib/auctionRules.ts"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("den RIGTIGE kerne-liste og tsconfig.core.json er i sync", () => {
  // Runtime-checket i gaten daekker det samme, men dette fejler paa
  // millisekunder uden at vente paa en tsc-koersel.
  const baseline = JSON.parse(
    fs.readFileSync(path.join(HERE, "ts-core-ratchet-baseline.json"), "utf8"),
  );
  const tsconfig = parseJsonc(
    fs.readFileSync(path.join(REPO_ROOT, "backend", "tsconfig.core.json"), "utf8"),
  );
  const diff = diffGlobs(baseline.areas, tsconfig.include);
  assert.deepEqual(diff.missingInTsconfig, []);
  assert.deepEqual(diff.missingInBaseline, []);
});

test("den RIGTIGE baseline har konsistente totaler", () => {
  const baseline = JSON.parse(
    fs.readFileSync(path.join(HERE, "ts-core-ratchet-baseline.json"), "utf8"),
  );
  let jsFileCount = 0;
  let tsErrorCount = 0;
  for (const area of Object.values(baseline.areas)) {
    const files = Object.entries(area.files);
    assert.equal(
      area.tsErrorCount,
      files.reduce((sum, [, n]) => sum + n, 0),
      `${area.title}: tsErrorCount matcher ikke summen af files`,
    );
    assert.equal(
      area.jsFileCount,
      files.filter(([rel]) => isJsFile(rel)).length,
      `${area.title}: jsFileCount matcher ikke antallet af .js-filer`,
    );
    jsFileCount += area.jsFileCount;
    tsErrorCount += area.tsErrorCount;
  }
  assert.equal(baseline.totals.jsFileCount, jsFileCount);
  assert.equal(baseline.totals.tsErrorCount, tsErrorCount);
});
