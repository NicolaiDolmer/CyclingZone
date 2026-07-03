import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ABILITY_KEYS } from "../lib/abilities.js";

// #2002 — forward-guard: TransfersPage's SwapCard-preview er en KURATERET delmængde
// af de 15 evner, men rækkefølgen SKAL følge SSOT (abilities.js → ABILITY_KEYS), og
// labels SKAL komme fra ABILITY_SHORT (ikke hardcodede strenge). Denne test fejler
// hvis en fremtidig redigering genindfører et lokalt order-array eller vender
// SWAP_PREVIEW_KEYS ud af SSOT-rækkefølge — så alle evne-flader forbliver ensrettede.
//
// node --test uden DOM → kildekode-strukturel guard (samme mønster som
// TransfersPage.defaultTab.test.js).

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "TransfersPage.jsx"), "utf8");

// Uddrag nøgle-listen fra `const SWAP_PREVIEW_KEYS = [...]`.
function extractKeys() {
  const m = src.match(/const SWAP_PREVIEW_KEYS\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, "SWAP_PREVIEW_KEYS skal være et array-literal i TransfersPage.jsx");
  return [...m[1].matchAll(/["']([a-z_]+)["']/g)].map((x) => x[1]);
}

test("#2002 SWAP_PREVIEW_KEYS er en delmængde af ABILITY_KEYS (kun kendte evner)", () => {
  const keys = extractKeys();
  assert.ok(keys.length > 0, "SWAP_PREVIEW_KEYS må ikke være tom");
  for (const k of keys) {
    assert.ok(ABILITY_KEYS.includes(k), `ukendt evne-nøgle i SWAP_PREVIEW_KEYS: ${k}`);
  }
});

test("#2002 SWAP_PREVIEW_KEYS følger SSOT-rækkefølgen (ABILITY_KEYS)", () => {
  const keys = extractKeys();
  const canonical = ABILITY_KEYS.filter((k) => keys.includes(k));
  assert.deepEqual(
    keys,
    canonical,
    "SWAP_PREVIEW_KEYS skal stå i samme indbyrdes rækkefølge som ABILITY_KEYS (SSOT)",
  );
});

test("#2002 SwapCard-labels udledes af ABILITY_SHORT (ingen hardcodede label-strenge)", () => {
  // Preview'et bygges via ABILITY_SHORT[key] — ikke via en hardcodet [label, key]-liste.
  assert.match(
    src,
    /SWAP_PREVIEW_KEYS\.map\(\s*\(key\)\s*=>\s*\[ABILITY_SHORT\[key\]/,
    "SWAP_PREVIEW skal udlede labelen fra ABILITY_SHORT (SSOT), ikke en hardcodet streng",
  );
});
