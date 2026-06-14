import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "Menu.jsx"), "utf8");

test("Menu er role=menu med reveal + soft-lift via menuClass", () => {
  assert.match(src, /export function Menu\b/);
  assert.match(src, /role="menu"/);
  assert.match(src, /menuClass\(/);
  assert.match(src, /cz-menu-panel/);
});

test("MenuItem er en role=menuitem-knap med menuItemClass", () => {
  assert.match(src, /export function MenuItem\b/);
  assert.match(src, /role="menuitem"/);
  assert.match(src, /menuItemClass\(/);
});

test("Dropdown bruger useDismiss, z-dropdown, render-prop trigger + defaultOpen", () => {
  assert.match(src, /export function Dropdown\b/);
  assert.match(src, /useDismiss\(/);
  assert.match(src, /z-dropdown/);
  assert.match(src, /trigger\(\{/);
  assert.match(src, /defaultOpen/);
});
