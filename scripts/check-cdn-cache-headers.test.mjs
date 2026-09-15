// check-cdn-cache-headers.test.mjs — unit-test af den rene HTML-parsing-funktion
// (#5251). Ingen netværkskald: check-cdn-cache-headers.mjs kører kun main() ved
// direkte invokation, så import her trigger ikke prod-kald.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractHashedAssetPath } from "./check-cdn-cache-headers.mjs";

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
