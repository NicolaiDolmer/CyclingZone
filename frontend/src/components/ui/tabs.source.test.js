import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "Tabs.jsx"), "utf8");

test("Tabs deler value/onChange via context", () => {
  assert.match(src, /createContext/);
  assert.match(src, /TabsContext\.Provider/);
});

test("TabList er role=tablist med pil-navigation", () => {
  assert.match(src, /role="tablist"/);
  assert.match(src, /ArrowRight/);
  assert.match(src, /ArrowLeft/);
  assert.match(src, /tabListClass\(/);
});

// #4625 (slice 3 af #4622) — fuldt WAI-ARIA tabs-mønster (Home/End + orientation).
test("TabList understoetter Home/End og saetter aria-orientation", () => {
  assert.match(src, /"Home"/);
  assert.match(src, /"End"/);
  assert.match(src, /aria-orientation="horizontal"/);
});

// Tabs tegnes som en underline (border-b-2 + aktiv border-cz-accent), aldrig
// som kantede knapper — det praecis /team-fundet fra audit 2026-09 (fanerne
// tegnet som fire kantede knapper, ikke skabelonens underline-tabs).
test("Tab er en underline-tab, ikke en knap-flade", () => {
  const styles = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "tabsStyles.js"), "utf8");
  assert.match(styles, /border-b-2/);
  assert.match(styles, /border-cz-accent/);
  assert.doesNotMatch(styles, /bg-cz-(?:card|subtle|accent)\b/, "Tab maa ikke have en udfyldt knap-baggrund");
});

test("Tab er role=tab med aria-selected + roving tabindex + tabClass", () => {
  assert.match(src, /role="tab"/);
  assert.match(src, /aria-selected=\{active\}/);
  assert.match(src, /tabIndex=\{active \? 0 : -1\}/);
  assert.match(src, /tabClass\(/);
});

test("TabPanel er role=tabpanel og skjuler inaktive", () => {
  assert.match(src, /role="tabpanel"/);
  assert.match(src, /return null/);
});
