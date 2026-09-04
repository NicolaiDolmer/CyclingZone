import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluate,
  findEntryAsset,
  missResponseIsSafelyCacheable,
  parseArgs,
} from "./check-asset-miss-behaviour.mjs";

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
