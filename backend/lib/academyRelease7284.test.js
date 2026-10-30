import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// #7284: en rytter der forlod holdet via akademi-fyring stod stadig paa
// transferlisten. Samme statiske source-contract-stil som academyRelease.routes.test.js:
// POST /riders/:id/academy-release skal lukke rytterens aabne transfer_listings
// (status 'withdrawn') EFTER at rytteren er frigivet, via den delte helper.
// Lib-stierne (resolveGraduation release + releaseUnsoldGraduate) er testet
// adfaerdsmaessigt i academyGraduation.test.js.

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

function routeBlock(method, routePath) {
  const marker = `router.${method}("${routePath}"`;
  const start = apiSource.indexOf(marker);
  assert.notEqual(start, -1, `route ${method.toUpperCase()} ${routePath} findes ikke i api.js`);
  const end = apiSource.indexOf("\nrouter.", start + marker.length);
  return apiSource.slice(start, end === -1 ? start + 8000 : end);
}

test("#7284 api.js importerer closeTransferListingsForRiders fra marketUtils", () => {
  assert.match(apiSource, /closeTransferListingsForRiders,[\s\S]{0,200}from "\.\.\/lib\/marketUtils\.js"/);
});

test("#7284 POST /riders/:id/academy-release lukker aabne transfer_listings som withdrawn efter frigivelsen", () => {
  const block = routeBlock("post", "/riders/:id/academy-release");
  assert.match(block, /closeTransferListingsForRiders\(supabase, \[rider\.id\], "withdrawn"\)/);
  assert.ok(
    block.indexOf("closeTransferListingsForRiders") > block.indexOf("is_academy: false"),
    "listings skal lukkes efter at rytteren er frigivet",
  );
});

test("#7284 en fejl ved lukning af listings giver ikke 500 efter at pengene er taget", () => {
  const block = routeBlock("post", "/riders/:id/academy-release");
  const i = block.indexOf("closeTransferListingsForRiders");
  const window = block.slice(Math.max(0, i - 40), i + 300);
  assert.match(window, /try \{/);
  assert.match(window, /captureException/);
});
