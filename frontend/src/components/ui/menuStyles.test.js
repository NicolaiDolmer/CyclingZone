import { test } from "node:test";
import assert from "node:assert/strict";
import { menuClass, menuItemClass } from "./menuStyles.js";

test("menu-panel er soft-lift hairline-kort", () => {
  const c = menuClass();
  assert.ok(c.includes("rounded-cz"));
  assert.ok(c.includes("border-cz-border"));
  assert.ok(c.includes("bg-cz-card"));
  assert.ok(c.includes("shadow-overlay"));
});

test("menu-item er fuld-bredde venstrestillet; danger faar danger-tone", () => {
  const item = menuItemClass();
  assert.ok(item.includes("w-full"));
  assert.ok(item.includes("text-left"));
  assert.ok(item.includes("text-cz-1"));
  const danger = menuItemClass({ danger: true });
  assert.ok(danger.includes("text-cz-danger"));
  assert.ok(!danger.includes("text-cz-1"));
});

test("active item faar standalone subtle highlight (ud over hover-klassen)", () => {
  // Skel standalone `bg-cz-subtle` fra `hover:bg-cz-subtle` (substring-kollision).
  assert.match(menuItemClass({ active: true }), /(^|\s)bg-cz-subtle(\s|$)/);
  assert.doesNotMatch(menuItemClass(), /(^|\s)bg-cz-subtle(\s|$)/);
});
