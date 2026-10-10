import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  evaluate,
  evaluateCarriedAsset,
  evaluateCarryForward,
  findEntryAsset,
  missResponseIsSafelyCacheable,
  openReleaseStore,
  parseArgs,
  runCarryForwardProbe,
  selectCarryForwardCandidates,
} from "./check-asset-miss-behaviour.mjs";
import { createDirStore } from "./lib/releaseAssetsStore.mjs";

const OK_ENTRY = {
  found: true,
  url: "https://cyclingzone.org/assets/index-abc123.js",
  status: 200,
  contentType: "application/javascript; charset=utf-8",
};

test("findEntryAsset finder entry-bundlen i app-shellen", () => {
  const html = '<script type="module" crossorigin src="/assets/index-IQ99eXuj.js"></script>';
  assert.equal(findEntryAsset(html), "/assets/index-IQ99eXuj.js");
  assert.equal(findEntryAsset("<html></html>"), null);
});

test("parseArgs laeser --base og flag", () => {
  const args = parseArgs(["node", "probe", "--base=https://x.dev", "--require-fresh-miss"]);
  assert.equal(args.base, "https://x.dev");
  assert.equal(args["require-fresh-miss"], true);
});

test("miss-svar med lang cache er ikke sikkert", () => {
  assert.equal(missResponseIsSafelyCacheable("public, max-age=31536000, immutable"), false);
  assert.equal(missResponseIsSafelyCacheable("public, max-age=31536000"), false);
  assert.equal(missResponseIsSafelyCacheable("no-store"), true);
  assert.equal(missResponseIsSafelyCacheable("public, max-age=60"), true);
  assert.equal(missResponseIsSafelyCacheable(null), true);
});

// Det praecise prod-svar der laaste en spiller ude 1/9. Proben SKAL fejle paa det.
test("200 + HTML paa en manglende asset er en hard fejl (#4545)", () => {
  const { failures } = evaluate({
    entry: OK_ENTRY,
    miss: {
      status: 200,
      contentType: "text/html; charset=utf-8",
      cacheControl: "public, max-age=31536000, immutable",
    },
  });
  assert.ok(failures.length >= 2, "baade 200-status og HTML-typen skal fanges");
  assert.ok(failures.some((f) => f.includes("svarede 200")));
  assert.ok(failures.some((f) => f.includes("HTML")));
});

test("404 uden HTML passerer, men lang cache giver advarsel", () => {
  const { failures, warnings } = evaluate({
    entry: OK_ENTRY,
    miss: {
      status: 404,
      contentType: "text/plain; charset=utf-8",
      cacheControl: "public, max-age=31536000, immutable",
    },
  });
  assert.deepEqual(failures, []);
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes("caches laenge"));
});

test("404 uden cache-header er den rene tilstand", () => {
  const { failures, warnings } = evaluate({
    entry: OK_ENTRY,
    miss: { status: 404, contentType: "text/plain", cacheControl: "no-store" },
  });
  assert.deepEqual(failures, []);
  assert.deepEqual(warnings, []);
});

// Uden dette ville proben kunne staa groen paa et deploy hvor assets slet ikke
// serveres — praecis den "vagt der gaar groen uden at maale"-klasse vi allerede
// er brandt af (#4463).
test("en oedelagt rigtig asset er en hard fejl", () => {
  const broken = evaluate({
    entry: { ...OK_ENTRY, status: 404 },
    miss: { status: 404, contentType: "text/plain", cacheControl: "no-store" },
  });
  assert.ok(broken.failures.some((f) => f.includes("rigtig asset svarede 404")));

  const wrongType = evaluate({
    entry: { ...OK_ENTRY, contentType: "text/html" },
    miss: { status: 404, contentType: "text/plain", cacheControl: "no-store" },
  });
  assert.ok(wrongType.failures.some((f) => f.includes("content-type")));

  const noEntry = evaluate({
    entry: { found: false, status: 0, contentType: null },
    miss: { status: 404, contentType: "text/plain", cacheControl: "no-store" },
  });
  assert.ok(noEntry.failures.some((f) => f.includes("kan ikke maale")));
});

// ── #5162 K4: carry-forward-proben ────────────────────────────────────────────

const SHA = "a".repeat(64);
const file = (name) => ({ name, sha256: SHA, bytes: 10 });
const manifest = (frontend, names) => ({ schema: 1, frontend, release: "", built_at: "2026-10-10T00:00:00Z", files: names.map(file) });

test("carry-forward: kandidater er JS/CSS i forrige men ikke i nuvaerende release", () => {
  const previous = manifest("relA", ["assets/index-A.js", "assets/shared-S.js", "assets/page-A.css", "assets/logo-A.png", "assets/old-A.js"]);
  const current = manifest("relB", ["assets/index-B.js", "assets/shared-S.js"]);
  const picked = selectCarryForwardCandidates(previous, current, { limit: 10, random: () => 0 });
  assert.deepEqual([...picked].sort(), ["assets/index-A.js", "assets/old-A.js", "assets/page-A.css"]);
  assert.ok(!picked.includes("assets/shared-S.js"), "delt chunk beviser intet om carry-forward");
  assert.ok(!picked.includes("assets/logo-A.png"), "billeder har ikke JS/CSS-typen proben maaler");
});

test("carry-forward: hoejst limit kandidater, og ingen ved identiske releases", () => {
  const names = Array.from({ length: 12 }, (_, i) => `assets/chunk-${i}.js`);
  assert.equal(selectCarryForwardCandidates(manifest("a", names), manifest("b", []), { limit: 5 }).length, 5);
  assert.deepEqual(selectCarryForwardCandidates(manifest("a", names), manifest("b", names)), []);
});

// Det centrale fund fra spec'en: SPA-rewriten svarer 200 + HTML paa en ukendt
// /assets-sti hvis rewrite-reglen nogensinde aendres. Det maa aldrig regnes som OK.
test("carry-forward: 200 + text/html er FEJL, 200 + javascript/css er OK", () => {
  assert.match(evaluateCarriedAsset({ name: "assets/x.js", status: 200, contentType: "text/html; charset=utf-8" }), /text\/html/);
  assert.equal(evaluateCarriedAsset({ name: "assets/x.js", status: 200, contentType: "text/javascript; charset=utf-8" }), null);
  assert.equal(evaluateCarriedAsset({ name: "assets/x.js", status: 200, contentType: "application/javascript" }), null);
  assert.equal(evaluateCarriedAsset({ name: "assets/x.css", status: 200, contentType: "text/css; charset=utf-8" }), null);
  assert.match(evaluateCarriedAsset({ name: "assets/x.js", status: 404, contentType: "text/plain" }), /404/);
  assert.match(evaluateCarriedAsset({ name: "assets/x.css", status: 200, contentType: "text/javascript" }), /text\/css/);
  const { failures } = evaluateCarryForward([
    { name: "assets/a.js", status: 200, contentType: "text/javascript" },
    { name: "assets/b.js", status: 200, contentType: "text/html" },
  ]);
  assert.equal(failures.length, 1);
});

test("carry-forward: uden lager-secrets springes over", async () => {
  assert.ok(openReleaseStore({}).skip);
  const lines = [];
  const result = await runCarryForwardProbe({ base: "https://x.dev", env: {}, log: (l) => lines.push(l), fetchImpl: () => assert.fail("ingen netvaerk uden secrets") });
  assert.equal(result.status, "skipped");
  assert.ok(lines.some((l) => l.includes("SPRUNGET OVER")));
});

function tempStore(manifests) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cz-cf-probe-"));
  fs.mkdirSync(path.join(dir, "manifests"));
  manifests.forEach((m, i) => {
    const target = path.join(dir, "manifests", `${m.frontend}.json`);
    fs.writeFileSync(target, JSON.stringify(m));
    const t = new Date(Date.UTC(2026, 9, 1, 0, i));
    fs.utimesSync(target, t, t);
  });
  return { dir, store: createDirStore(dir) };
}

function fakeFetch(responses) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    const hit = responses[url] ?? { status: 404, type: "text/plain" };
    return {
      ok: hit.status === 200,
      status: hit.status,
      headers: { get: (h) => (h.toLowerCase() === "content-type" ? hit.type : null) },
      json: async () => hit.json,
    };
  };
  return { impl, calls };
}

test("carry-forward: et manifest giver spring over (foerste deploy baerer intet)", async () => {
  const { dir, store } = tempStore([manifest("relA", ["assets/a.js"])]);
  try {
    const result = await runCarryForwardProbe({ base: "https://x.dev", store, log: () => {}, fetchImpl: fakeFetch({}).impl });
    assert.equal(result.status, "skipped");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("carry-forward: henter forrige releases filer fra origin og fejler paa SPA-HTML", async () => {
  const { dir, store } = tempStore([
    manifest("relA", ["assets/index-A.js", "assets/page-A.css", "assets/shared.js"]),
    manifest("relB", ["assets/index-B.js", "assets/shared.js"]),
  ]);
  try {
    const ok = fakeFetch({
      "https://x.dev/version.json": { status: 200, type: "application/json", json: { frontend: "relB" } },
      "https://x.dev/assets/index-A.js": { status: 200, type: "text/javascript; charset=utf-8" },
      "https://x.dev/assets/page-A.css": { status: 200, type: "text/css; charset=utf-8" },
    });
    const good = await runCarryForwardProbe({ base: "https://x.dev", store, log: () => {}, fetchImpl: ok.impl });
    assert.equal(good.status, "ok");
    assert.deepEqual(good.warnings, []);
    assert.ok(!ok.calls.includes("https://x.dev/assets/shared.js"));
    assert.ok(!ok.calls.includes("https://x.dev/assets/index-B.js"), "kun den forrige releases egne filer maales");

    const rewritten = fakeFetch({
      "https://x.dev/version.json": { status: 200, type: "application/json", json: { frontend: "relB" } },
      "https://x.dev/assets/index-A.js": { status: 200, type: "text/html; charset=utf-8" },
      "https://x.dev/assets/page-A.css": { status: 200, type: "text/css" },
    });
    const bad = await runCarryForwardProbe({ base: "https://x.dev", store, log: () => {}, fetchImpl: rewritten.impl });
    assert.equal(bad.status, "failed");
    assert.equal(bad.failures.length, 1);
    assert.match(bad.failures[0], /index-A\.js.*text\/html/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("carry-forward: advarer naar live frontend-id ikke er nyeste manifest", async () => {
  const { dir, store } = tempStore([manifest("relA", ["assets/a.js"]), manifest("relB", ["assets/b.js"])]);
  try {
    const { impl } = fakeFetch({
      "https://x.dev/version.json": { status: 200, type: "application/json", json: { frontend: "relZ" } },
      "https://x.dev/assets/a.js": { status: 200, type: "text/javascript" },
    });
    const result = await runCarryForwardProbe({ base: "https://x.dev", store, log: () => {}, fetchImpl: impl });
    assert.equal(result.status, "ok");
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /relZ/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("parseArgs laeser --carry-forward og --sample", () => {
  const args = parseArgs(["node", "probe", "--carry-forward", "--sample=3"]);
  assert.equal(args["carry-forward"], true);
  assert.equal(args.sample, "3");
});
