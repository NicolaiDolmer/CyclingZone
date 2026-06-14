import { test } from "node:test";
import assert from "node:assert/strict";
import { avatarClass, initialsFrom } from "./avatarStyles.js";

test("avatar er rund, neutral, med hairline-ring (ikke guld)", () => {
  const c = avatarClass();
  assert.ok(c.includes("rounded-cz-pill"));
  assert.ok(c.includes("ring-1"));
  assert.ok(c.includes("ring-cz-border"));
  assert.ok(c.includes("bg-cz-subtle"));
  assert.ok(!c.includes("cz-accent"), "avatar er neutral, aldrig guld");
});

test("size styrer dimension; ukendt falder tilbage til md", () => {
  assert.ok(avatarClass({ size: "sm" }).includes("h-7 w-7"));
  assert.ok(avatarClass({ size: "lg" }).includes("h-12 w-12"));
  assert.equal(avatarClass({ size: "zz" }), avatarClass({ size: "md" }));
});

test("initialsFrom tager foerste bogstav af de foerste to ord, uppercase", () => {
  assert.equal(initialsFrom("Ada Pedersen"), "AP");
  assert.equal(initialsFrom("ada van der poel"), "AV");
  assert.equal(initialsFrom("Bo"), "B");
  assert.equal(initialsFrom("  spaced   out  "), "SO");
});

test("initialsFrom haandterer tom/ugyldig input", () => {
  assert.equal(initialsFrom(""), "");
  assert.equal(initialsFrom(), "");
});
