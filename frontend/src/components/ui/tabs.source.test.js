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
