// #4501 forward-guard: hver notifikationstype backenden kan sende SKAL have en
// entry i NotificationsPage'ens TYPE_CONFIG.
//
// Uden entry falder kortet til DEFAULT_TYPE_CONFIG: generisk klokke, neutral
// baggrund og INTET link. Kortet ser ud som alle andre og reagerer ikke paa
// klik. Det er allerede rettet type-for-type to gange (#3505 board_critical,
// selection_warning i NotificationsPage.stageResultLink.test.js) og var stadig
// sandt for 19 typer da Clarity 25/8-5/9 maalte 118 doede klik paa
// /notifications. Denne guard maaler HELE listen i stedet for en type ad
// gangen, saa den fjerde gentagelse ikke kan naa prod.
//
// Kilde-regex-guard, samme moenster som de to naevnte tests: den laeser
// kildeteksten i stedet for at importere JSX (frontend-tests koerer paa
// `node --test` uden DOM/JSX-transform).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(join(here, "NotificationsPage.jsx"), "utf8");
const backendTypesSource = readFileSync(
  join(here, "..", "..", "..", "backend", "lib", "notificationTypes.js"),
  "utf8",
);

// NOTIFICATION_TYPES-arrayet i backend/lib/notificationTypes.js — en streng pr.
// linje, kommentarlinjer springes over af regexen.
function backendNotificationTypes(): string[] {
  const block = backendTypesSource.match(
    /export const NOTIFICATION_TYPES = \[([\s\S]*?)\n\];/,
  );
  assert.ok(block, "NOTIFICATION_TYPES-arrayet skal kunne laeses fra backend/lib/notificationTypes.js");
  return [...block[1].matchAll(/^\s*"([a-z_]+)",/gm)].map((m) => m[1]);
}

// TYPE_CONFIG-objektet i NotificationsPage.jsx — noeglerne, ikke vaerdierne.
function frontendConfiguredTypes(): string[] {
  const block = pageSource.match(/const TYPE_CONFIG = \{([\s\S]*?)\n\};/);
  assert.ok(block, "TYPE_CONFIG-objektet skal kunne laeses fra NotificationsPage.jsx");
  return [...block[1].matchAll(/^ {2}([a-z_]+):\s*\{/gm)].map((m) => m[1]);
}

test("#4501 hver backend-notifikationstype har en TYPE_CONFIG-entry", () => {
  const backend = backendNotificationTypes();
  assert.ok(backend.length > 40, `forventede hele NOTIFICATION_TYPES-listen, fik ${backend.length}`);
  const configured = new Set(frontendConfiguredTypes());
  const missing = backend.filter((type) => !configured.has(type));
  assert.deepEqual(
    missing,
    [],
    `Disse typer falder til DEFAULT_TYPE_CONFIG (generisk klokke, intet link) og giver doede klik i indbakken: ${missing.join(", ")}`,
  );
});

test("#4501 hver TYPE_CONFIG-entry har et link, eller er bevidst uden", () => {
  const block = pageSource.match(/const TYPE_CONFIG = \{([\s\S]*?)\n\};/);
  assert.ok(block);
  // admin_notice er den ENESTE bevidste undtagelse (#2842: beskeden ER
  // indholdet, der findes ingen side at sende spilleren hen til). Alt andet
  // uden link er en glemt destination.
  const LINKLESS_BY_DESIGN = new Set(["admin_notice"]);
  const entries = [...block[1].matchAll(/^ {2}([a-z_]+):\s*\{([^}]*)\}/gm)];
  const linkless = entries
    .filter(([, key, body]) => !LINKLESS_BY_DESIGN.has(key) && !/link:/.test(body))
    .map(([, key]) => key);
  assert.deepEqual(
    linkless,
    [],
    `TYPE_CONFIG-entries uden link (og uden at staa paa undtagelseslisten): ${linkless.join(", ")}`,
  );
});

test("#4501 kortets cursor-pointer er betinget af at klikket kan gøre noget", () => {
  assert.match(
    pageSource,
    /const isActionable = !n\.is_read \|\| Boolean\(link\);/,
    "et laest kort uden destination maa ikke baere pointer-cursor — det var kilden til rage clicks paa desktop",
  );
  assert.match(
    pageSource,
    /\$\{isActionable \? " cursor-pointer" : ""\}/,
    "cursor-pointer skal saettes betinget paa notifikationskortet",
  );
});
