import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #58 — de 6 sideordnede transfer-faner er grupperet i 3 handlingsorienterede modes
// (Skal handles / Forhandlinger / Marked). Modes er ren UI-gruppering ovenpå det
// eksisterende ?tab=-dataflow: de gamle tab-værdier (og deres deep-links) skal route
// uændret. Disse guards sikrer at grupperingen forbliver TOTAL og disjunkt — hver
// VALID_TAB hører til præcis ét mode, og intet ukendt tab sniger sig ind.
//
// node --test uden DOM → kildekode-strukturel guard (samme mønster som
// TransfersPage.defaultTab.test.js).

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "TransfersPage.jsx"), "utf8");

function extractStringArray(name) {
  const m = src.match(new RegExp(`const ${name}\\s*=\\s*\\[([^\\]]*)\\]`));
  assert.ok(m, `${name} skal være et array-literal i TransfersPage.jsx`);
  return [...m[1].matchAll(/["']([a-z_]+)["']/g)].map((x) => x[1]);
}

// TAB_MODES er en objekt-liste; træk hver `tabs: [...]` ud i rækkefølge.
function extractModeTabs() {
  const block = src.match(/const TAB_MODES\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(block, "TAB_MODES skal være defineret i TransfersPage.jsx");
  const modes = [...block[1].matchAll(/tabs:\s*\[([^\]]*)\]/g)]
    .map((m) => [...m[1].matchAll(/["']([a-z_]+)["']/g)].map((x) => x[1]));
  assert.ok(modes.length === 3, "der skal være præcis 3 modes (#58)");
  return modes;
}

test("#58 hvert VALID_TAB hører til præcis ét mode (total, disjunkt gruppering)", () => {
  const validTabs = extractStringArray("VALID_TABS");
  const modeTabs = extractModeTabs();
  const flat = modeTabs.flat();
  // Ingen dubletter → disjunkt.
  assert.equal(new Set(flat).size, flat.length, "en fane må ikke ligge i to modes");
  // Samme mængde → total dækning (ingen fane tabt, intet ukendt tab tilføjet).
  assert.deepEqual(
    [...flat].sort(),
    [...validTabs].sort(),
    "TAB_MODES skal dække præcis VALID_TABS (ingen tab tabt eller ukendt tilføjet)",
  );
});

test("#58 den gamle default-fane 'received' er stadig et gyldigt tab (deep-link bevaret)", () => {
  const validTabs = extractStringArray("VALID_TABS");
  assert.ok(validTabs.includes("received"), "'received' skal fortsat findes i VALID_TABS");
  assert.match(src, /const DEFAULT_TAB = "received"/, "DEFAULT_TAB skal fortsat være 'received'");
});

test("#58 mode-navigationen bruger stadig setTab (?tab= dataflow uændret)", () => {
  // selectMode delegerer til setTab, så deep-links og den eksisterende
  // empty-default-til-'market'-logik (#1569) rører ved samme URL-state.
  assert.match(src, /function selectMode\(/, "selectMode skal findes");
  assert.match(src, /setTab\(mode\.tabs\[0\]\)/, "selectMode skal åbne modets første fane via setTab");
});
