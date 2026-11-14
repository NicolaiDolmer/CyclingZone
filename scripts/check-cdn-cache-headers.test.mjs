// check-cdn-cache-headers.test.mjs — unit-test af den rene HTML-parsing-funktion
// (#5251) og retry-logikken for hashede assets ved Vercel-alias-skift (#5253).
// Ingen netværkskald: check-cdn-cache-headers.mjs kører kun main() ved direkte
// invokation, så import her trigger ikke prod-kald; fetch/wait er injicerbare.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assetLinksFingerprintStatus,
  assetLinksProblem,
  checkHashedAssetWithRetry,
  extractHashedAssetPath,
} from "./check-cdn-cache-headers.mjs";
import { readFileSync } from "node:fs";

test("finder et hashet /assets/*.js|css i SPA-HTML", () => {
  const html = `<!doctype html><html><head>
    <link rel="stylesheet" href="/assets/index-a1b2c3d4.css">
  </head><body>
    <script type="module" src="/assets/index-e5f6g7h8.js"></script>
  </body></html>`;
  assert.equal(extractHashedAssetPath(html), "/assets/index-a1b2c3d4.css");
});

test("kaster fejl for marketing-HTML uden /assets/*.js|css (#5251)", () => {
  const html = `<!doctype html><html><head>
    <link rel="stylesheet" href="/_next/static/css/marketing-abc123.css">
  </head><body>
    <script src="/_next/static/chunks/main-xyz789.js"></script>
  </body></html>`;
  assert.throws(() => extractHashedAssetPath(html), /fandt ingen \/assets/);
});

const htmlWithAsset = (hash) =>
  `<!doctype html><html><body><script type="module" src="/assets/index-${hash}.js"></script></body></html>`;

test("#5253: 404 paa foerste forsoeg, 200 paa anden HTML-hentning => groent efter retry", async () => {
  const htmls = [htmlWithAsset("old111"), htmlWithAsset("new222")];
  const waits = [];
  let fetchHtmlCalls = 0;
  let headCalls = [];

  const result = await checkHashedAssetWithRetry({
    fetchHtml: async () => htmls[fetchHtmlCalls++],
    headAsset: async (path) => {
      headCalls.push(path);
      const status = path.includes("old111") ? 404 : 200;
      return { status, cc: status === 200 ? "public, max-age=31536000, immutable" : "", ct: "application/javascript" };
    },
    wait: async (ms) => {
      waits.push(ms);
    },
    delayMs: 10000,
    maxAttempts: 3,
  });

  assert.equal(result.attempts, 2);
  assert.equal(result.path, "/assets/index-new222.js");
  assert.equal(result.result.status, 200);
  assert.deepEqual(headCalls, ["/assets/index-old111.js", "/assets/index-new222.js"]);
  assert.deepEqual(waits, [10000], "skal vente praecis 1 gang mellem forsoeg 1 og 2");
});

test("#5253: 3x 404 => roedt (ingen flere forsoeg, ingen sidste ventetid)", async () => {
  const waits = [];
  let attemptCount = 0;

  const result = await checkHashedAssetWithRetry({
    fetchHtml: async () => htmlWithAsset(`hash${attemptCount}`),
    headAsset: async () => {
      attemptCount++;
      return { status: 404, cc: "", ct: "text/plain" };
    },
    wait: async (ms) => {
      waits.push(ms);
    },
    delayMs: 10000,
    maxAttempts: 3,
  });

  assert.equal(result.attempts, 3);
  assert.equal(result.result.status, 404);
  assert.equal(attemptCount, 3, "skal proeve praecis maxAttempts gange, ikke mere");
  assert.deepEqual(waits, [10000, 10000], "kun 2 ventetider mellem 3 forsoeg, ingen ventetid efter sidste");
});

test("#5253: succes paa foerste forsoeg venter slet ikke", async () => {
  const waits = [];
  const result = await checkHashedAssetWithRetry({
    fetchHtml: async () => htmlWithAsset("abc123"),
    headAsset: async () => ({ status: 200, cc: "public, max-age=31536000, immutable", ct: "application/javascript" }),
    wait: async (ms) => waits.push(ms),
  });
  assert.equal(result.attempts, 1);
  assert.deepEqual(waits, []);
});

// #6584: assetlinks.json for Google Play (TWA).
const goodLinks = JSON.stringify([
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: { namespace: "android_app", package_name: "org.cyclingzone.app", sha256_cert_fingerprints: ["X"] },
  },
]);

test("#6584: gyldig assetlinks.json som JSON er groen", () => {
  assert.equal(assetLinksProblem({ status: 200, ct: "application/json", body: goodLinks }), null);
});

test("#6584: assetlinks.json der er omskrevet til app-skallen eller 404 fejler", () => {
  assert.match(assetLinksProblem({ status: 200, ct: "text/html; charset=utf-8", body: "<!doctype html>" }), /HTML/);
  assert.match(assetLinksProblem({ status: 404, ct: "text/html", body: "" }), /404/);
});

test("#6584: assetlinks.json med forkert content-type eller indhold fejler", () => {
  assert.match(assetLinksProblem({ status: 200, ct: "text/plain", body: goodLinks }), /content-type/);
  assert.match(assetLinksProblem({ status: 200, ct: "application/json", body: "{nope" }), /JSON/);
  assert.match(assetLinksProblem({ status: 200, ct: "application/json", body: "[]" }), /android_app/);
});

// #6584 (dom 13/11 paa #8059): en glemt pladsholder maa ikke give groent uden at blive set.
const fpLinks = (fps) =>
  JSON.stringify([
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: "org.cyclingzone.app", sha256_cert_fingerprints: fps },
    },
  ]);
const REAL_A = Array(32).fill("AB").join(":");
const REAL_B = Array(32).fill("0F").join(":");

test("#6584: kun pladsholdere giver en navngiven advarsel, ikke groent og ikke roedt", () => {
  const status = assetLinksFingerprintStatus(fpLinks(["REPLACE_WITH_A_1", "REPLACE_WITH_A_2", "REPLACE_WITH_A_3"]));
  assert.equal(status.failure, null, "skal ikke goere main roed foer ejeren har fingeraftrykkene");
  assert.match(status.warning, /^ASSETLINKS_PLACEHOLDER:/);
});

// Repoets fil maa enten vaere skabelonen (advarsel) eller have aegte aftryk (groent), aldrig roed.
// Codex P2 (#8059): testen maa ikke kraeve, at pladsholderne bliver staaende.
test("#6584: repoets assetlinks.json goer aldrig tjekket roedt", () => {
  const body = readFileSync(new URL("../frontend/public/.well-known/assetlinks.json", import.meta.url), "utf8");
  const status = assetLinksFingerprintStatus(body);
  assert.equal(status.failure, null);
  assert.ok(status.warning === null || /^ASSETLINKS_PLACEHOLDER:/.test(status.warning));
});

test("#6584: pladsholder bliver roed, naar ASSETLINKS_REQUIRE_FINGERPRINT er sat", () => {
  const status = assetLinksFingerprintStatus(fpLinks(["REPLACE_WITH_X"]), { requireReal: true });
  assert.match(status.failure, /ASSETLINKS_PLACEHOLDER/);
  assert.equal(status.warning, null);
});

test("#6584: aegte fingeraftryk (op til tre) er groent uden advarsel", () => {
  assert.deepEqual(assetLinksFingerprintStatus(fpLinks([REAL_A, REAL_B])), { failure: null, warning: null });
  assert.deepEqual(assetLinksFingerprintStatus(fpLinks([REAL_A]), { requireReal: true }), { failure: null, warning: null });
});

test("#6584: halvt rettet fil eller ugyldigt aftryk er roedt", () => {
  assert.match(assetLinksFingerprintStatus(fpLinks([REAL_A, "REPLACE_WITH_X"])).failure, /halvt rettet/);
  assert.match(assetLinksFingerprintStatus(fpLinks(["ab:cd"])).failure, /ugyldigt fingeraftryk/);
  assert.match(assetLinksFingerprintStatus(fpLinks([])).failure, /ingen sha256/);
  assert.match(assetLinksFingerprintStatus("{nope").failure, /JSON/);
});
