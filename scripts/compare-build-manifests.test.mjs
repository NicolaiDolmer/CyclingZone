// Tests for manifest-sammenligneren (#5160).
//
// To slags tests her:
//
//   1. Unit-tests af de rene funktioner (navne-splitting, parring, byte-diff,
//      klassifikation, tillad-listen).
//   2. GATE-TESTEN: en bevidst genindført kendt fejl — et deploy-unikt
//      release-sha skrevet ind i en bundle — SKAL gøre sammenligningen rød.
//      Det er den test der beviser at gaten kan fejle; en gate der ikke kan
//      blive rød beviser ingenting (audit 11/9, afsnit C: "Tests har flere
//      gange bevist tilstedeværelsen af kode frem for dens virkning").
//
// Gate-testen kører som standard på et syntetisk dist-træ, så den er hurtig og
// kan køre uden et build. Sættes `CZ_DETERMINISM_FIXTURE_DIST` til en RIGTIG
// dist-mappe (CI gør det med build B's output), kører samme test på de faktiske
// build-bytes i stedet.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  VARIABLE_PATH_RULES,
  buildManifest,
  compareManifests,
  firstByteDifference,
  formatReport,
  isVariablePath,
  listFiles,
  pairKey,
  splitHashedName,
} from "./compare-build-manifests.mjs";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "compare-build-manifests.mjs");

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `cz-${prefix}-`));
}

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

/** Et minimalt, men realistisk dist-træ: hashede assets, HTML og en public-fil. */
function makeDist(root, { release, entryHash = "aaaa1111", extraChunk = null } = {}) {
  write(root, "index.html", `<!doctype html><meta name="cz-release" content="${release}">`);
  write(root, "app.html", `<!doctype html><meta name="cz-release" content="${release}"><div id="root"></div>`);
  write(root, "version.json", JSON.stringify({ release }));
  write(root, "chunk-selfheal.js", "// boot guard, ikke hashet\n");
  write(root, `assets/index-${entryHash}.js`, "var a=1;console.log(a);\n");
  write(root, `assets/index-${entryHash}.js.map`, '{"version":3,"sources":["../src/main.jsx"]}');
  write(root, "assets/style-bbbb2222.css", ":root{color:#000}\n");
  if (extraChunk) write(root, extraChunk.rel, extraChunk.content);
  return root;
}

test("splitHashedName deler Vite-assets i stamme, hash og endelse", () => {
  assert.deepEqual(splitHashedName("assets/AuctionsPage-Goxz2GED.js"), {
    dir: "assets",
    stem: "AuctionsPage",
    hash: "Goxz2GED",
    ext: ".js",
  });
  assert.deepEqual(splitHashedName("assets/index-CIoYOQts.js.map"), {
    dir: "assets",
    stem: "index",
    hash: "CIoYOQts",
    ext: ".js.map",
  });
  assert.deepEqual(splitHashedName("patch-notes.json"), {
    dir: "",
    stem: "patch-notes",
    hash: null,
    ext: ".json",
  });
});

test("splitHashedName laeser ikke et rent smaa-bogstavs-navneled som hash", () => {
  // `chunk-selfheal.js` er en public-fil uden indholds-hash. Ville heuristikken
  // kalde "selfheal" en hash, kunne to URELATEREDE filer blive parret som
  // "udskiftet" og skjule at den ene forsvandt.
  assert.equal(splitHashedName("chunk-selfheal.js").hash, null);
  assert.equal(splitHashedName("chunk-selfheal.js").stem, "chunk-selfheal");
});

test("pairKey parrer samme modul paa tvaers af to indholds-hashes", () => {
  assert.equal(
    pairKey("assets/AuctionsPage-Goxz2GED.js"),
    pairKey("assets/AuctionsPage-C_27Jy7j.js")
  );
  assert.notEqual(
    pairKey("assets/AuctionsPage-Goxz2GED.js"),
    pairKey("assets/AcademyPage-Goxz2GED.js")
  );
  // Samme stamme, men .js vs .js.map maa ikke parres med hinanden.
  assert.notEqual(
    pairKey("assets/index-CIoYOQts.js"),
    pairKey("assets/index-CIoYOQts.js.map")
  );
});

test("tillad-listen daekker HTML og release-metadata, og kun det", () => {
  assert.deepEqual(
    VARIABLE_PATH_RULES.map((rule) => rule.path).sort(),
    ["app.html", "index.html", "version.json"]
  );
  assert.equal(isVariablePath("index.html"), true);
  assert.equal(isVariablePath("app.html"), true);
  assert.equal(isVariablePath("version.json"), true);
  assert.equal(isVariablePath("assets/index-aaaa1111.js"), false);
  assert.equal(isVariablePath("assets/index-aaaa1111.js.map"), false);
  assert.equal(isVariablePath("patch-notes.json"), false);
  // Ikke et praefiks-match: en hashet fil i assets/ maa ikke slippe igennem
  // fordi den tilfaeldigvis hedder noget med index.html.
  assert.equal(isVariablePath("assets/index.html"), false);
});

test("listFiles og buildManifest daekker HELE traeet, ikke kun assets/", () => {
  const root = makeDist(tmpdir("manifest"), { release: "a".repeat(40) });
  const files = listFiles(root);
  assert.ok(files.includes("index.html"));
  assert.ok(files.includes("chunk-selfheal.js"));
  assert.ok(files.includes("assets/index-aaaa1111.js"));
  assert.ok(files.includes("assets/index-aaaa1111.js.map"));

  const manifest = buildManifest(root, "A");
  assert.equal(manifest.fileCount, files.length);
  assert.equal(manifest.label, "A");
  const expected = crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(root, "chunk-selfheal.js")))
    .digest("hex");
  assert.equal(manifest.files["chunk-selfheal.js"].sha256, expected);
  assert.equal(typeof manifest.files["chunk-selfheal.js"].bytes, "number");
});

test("to builds der kun varierer i HTML og version.json er groenne", () => {
  const a = makeDist(tmpdir("ok-a"), { release: "a".repeat(40) });
  const b = makeDist(tmpdir("ok-b"), { release: "b".repeat(40) });
  const diff = compareManifests(buildManifest(a, "A"), buildManifest(b, "B"));

  assert.equal(diff.ok, true);
  assert.equal(diff.runtimeDifferences.length, 0);
  // De tre tilladte forskelle skal stadig RAPPORTERES, ikke skjules.
  assert.deepEqual(
    diff.allowedDifferences.map((d) => d.a).sort(),
    ["app.html", "index.html", "version.json"]
  );
  assert.ok(diff.identical.includes("assets/index-aaaa1111.js"));
  assert.ok(formatReport(diff).includes("byte-identiske"));
});

test("en udskiftet chunk klassificeres som replaced og gør gaten roed", () => {
  const a = makeDist(tmpdir("rep-a"), { release: "a".repeat(40), entryHash: "aaaa1111" });
  const b = makeDist(tmpdir("rep-b"), { release: "b".repeat(40), entryHash: "bbbb2233" });
  const diff = compareManifests(buildManifest(a, "A"), buildManifest(b, "B"));

  assert.equal(diff.ok, false);
  assert.deepEqual(
    diff.replaced.map((pair) => [pair.a, pair.b]).sort(),
    [
      ["assets/index-aaaa1111.js", "assets/index-bbbb2233.js"],
      ["assets/index-aaaa1111.js.map", "assets/index-bbbb2233.js.map"],
    ]
  );
  assert.equal(diff.onlyInA.length, 0);
  assert.equal(diff.onlyInB.length, 0);
  assert.equal(diff.runtimeDifferences.length, 2);
});

test("en chunk der kun findes i eet build rapporteres som onlyInA/onlyInB", () => {
  const a = makeDist(tmpdir("only-a"), {
    release: "a".repeat(40),
    extraChunk: { rel: "assets/LegacyPage-ccc33333.js", content: "var legacy=1;\n" },
  });
  const b = makeDist(tmpdir("only-b"), { release: "a".repeat(40) });
  const diff = compareManifests(buildManifest(a, "A"), buildManifest(b, "B"));

  assert.equal(diff.ok, false);
  assert.deepEqual(diff.onlyInA, ["assets/LegacyPage-ccc33333.js"]);
  assert.deepEqual(diff.onlyInB, []);
});

test("firstByteDifference peger paa den foerste forskellige byte", () => {
  const delta = firstByteDifference(Buffer.from("abcXdef"), Buffer.from("abcYdef"), 2);
  assert.equal(delta.offset, 3);
  assert.equal(delta.excerptA, "bcXde");
  assert.equal(delta.excerptB, "bcYde");
  assert.equal(firstByteDifference(Buffer.from("abc"), Buffer.from("abc")), null);
  // Forskellig laengde med faelles praefiks: offset = laengden af det korteste.
  assert.equal(firstByteDifference(Buffer.from("abc"), Buffer.from("abcd")).offset, 3);
});

test("firstByteDifference gengiver ikke-printbare bytes uden at oedelaegge loggen", () => {
  const delta = firstByteDifference(
    Buffer.from([0x61, 0x00, 0x0a, 0x62]),
    Buffer.from([0x61, 0x00, 0x0a, 0x63]),
    4
  );
  assert.equal(delta.offset, 3);
  assert.equal(delta.excerptA, "a..b");
  assert.equal(delta.excerptB, "a..c");
});

// --- GATE-TESTEN ------------------------------------------------------------
// Den kendte fejl, genindført med vilje: et deploy-unikt release-sha bagt ind i
// en JS-bundle (præcis hvad `define`/`import.meta.env`-vejen gjorde i #4595 og
// hvad `@sentry/vite-plugin`s `release.inject: true` gør). Sammenligningen SKAL
// blive rød, og CI-loggen skal pege på sha'en.

function poisonFirstJsAsset(distRoot, sha) {
  const target = listFiles(distRoot).find(
    (rel) => rel.startsWith("assets/") && rel.endsWith(".js")
  );
  assert.ok(target, `fandt ingen assets/*.js i ${distRoot}`);
  const full = path.join(distRoot, target);
  // Tilføj til sidst, så første forskellige byte ligger INDE i bundlen og
  // byte-uddraget faktisk viser sha'en.
  fs.appendFileSync(full, `\nwindow.SENTRY_RELEASE={id:"${sha}"};\n`);
  return target;
}

function copyTree(from, to) {
  fs.cpSync(from, to, { recursive: true });
  return to;
}

test("GATE: et release-sha baget ind i en bundle gør sammenligningen roed", () => {
  const sha = "dead" + "beef".repeat(9);
  const fixture = process.env.CZ_DETERMINISM_FIXTURE_DIST;

  let cleanDist;
  if (fixture) {
    assert.ok(
      fs.existsSync(fixture),
      `CZ_DETERMINISM_FIXTURE_DIST=${fixture} findes ikke — saet den til en rigtig dist-mappe eller lad den vaere tom.`
    );
    cleanDist = copyTree(fixture, path.join(tmpdir("gate-clean"), "dist"));
  } else {
    cleanDist = makeDist(tmpdir("gate-clean"), { release: sha });
  }
  const poisonedDist = copyTree(cleanDist, path.join(tmpdir("gate-poisoned"), "dist"));
  const poisoned = poisonFirstJsAsset(poisonedDist, sha);

  const diff = compareManifests(buildManifest(cleanDist, "clean"), buildManifest(poisonedDist, "poisoned"));

  assert.equal(diff.ok, false, "gaten gik groen paa et build med et release-sha i en bundle");
  assert.equal(diff.runtimeDifferences.length, 1);
  assert.equal(diff.runtimeDifferences[0].kind, "changed");
  assert.equal(diff.runtimeDifferences[0].a, poisoned);

  // Rapporten skal pege paa rod-aarsagen, ikke kun paa at "noget" er forskelligt.
  const report = formatReport(diff, { rootA: cleanDist, rootB: poisonedDist, context: 80 });
  assert.match(report, /runtime-asset\(s\) afviger/);
  assert.ok(report.includes(poisoned), "rapporten navngiver ikke den afvigende fil");
  assert.ok(report.includes(sha), "rapporten viser ikke det sha der er rod-aarsagen");
});

test("GATE: scriptet exit'er 1 paa forskel og 0 paa identiske builds", () => {
  const clean = makeDist(tmpdir("exit-clean"), { release: "a".repeat(40) });
  const sameButNewRelease = makeDist(tmpdir("exit-same"), { release: "b".repeat(40) });
  const poisoned = copyTree(clean, path.join(tmpdir("exit-poisoned"), "dist"));
  poisonFirstJsAsset(poisoned, "c".repeat(40));

  const green = spawnSync(process.execPath, [SCRIPT, clean, sameButNewRelease], { encoding: "utf-8" });
  assert.equal(green.status, 0, green.stdout + green.stderr);

  const red = spawnSync(process.execPath, [SCRIPT, clean, poisoned], { encoding: "utf-8" });
  assert.equal(red.status, 1, red.stdout + red.stderr);
  assert.match(red.stdout, /Foerste forskellige byte|Første forskellige byte/);
});

test("scriptet skriver manifest + diff som JSON og tekst til --out", () => {
  const a = makeDist(tmpdir("out-a"), { release: "a".repeat(40) });
  const b = makeDist(tmpdir("out-b"), { release: "b".repeat(40) });
  const out = path.join(tmpdir("out-dir"), "report");

  const result = spawnSync(process.execPath, [SCRIPT, a, b, "--out", out], { encoding: "utf-8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  for (const name of ["manifest-a.json", "manifest-b.json", "diff.json", "diff.txt"]) {
    assert.ok(fs.existsSync(path.join(out, name)), `${name} blev ikke skrevet`);
  }
  const diff = JSON.parse(fs.readFileSync(path.join(out, "diff.json"), "utf-8"));
  assert.equal(diff.ok, true);
  assert.ok(diff.identical.length > 0);
  const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest-a.json"), "utf-8"));
  assert.equal(typeof manifest.files["assets/index-aaaa1111.js"].sha256, "string");
});

test("scriptet exit'er 1 paa manglende mappe i stedet for at kaste", () => {
  const a = makeDist(tmpdir("missing-a"), { release: "a".repeat(40) });
  const result = spawnSync(process.execPath, [SCRIPT, a, path.join(a, "findes-ikke")], {
    encoding: "utf-8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /findes ikke som mappe/);
});
