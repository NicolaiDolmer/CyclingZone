import { test } from "node:test";
import assert from "node:assert/strict";
import { safeNextPath } from "./safeNextPath.js";

test("interne absolutte stier tillades", () => {
  assert.equal(safeNextPath("/riders"), "/riders");
  assert.equal(safeNextPath("/races?tab=library"), "/races?tab=library");
  assert.equal(safeNextPath("/riders/76630932"), "/riders/76630932");
});

test("protokol-relative + absolutte URL'er afvises (open-redirect-guard)", () => {
  assert.equal(safeNextPath("//evil.com"), null);
  assert.equal(safeNextPath("http://evil.com"), null);
  assert.equal(safeNextPath("https://evil.com"), null);
  assert.equal(safeNextPath("/\\evil.com"), null);
});

test("tom/ikke-string/relativ → null", () => {
  assert.equal(safeNextPath(""), null);
  assert.equal(safeNextPath(null), null);
  assert.equal(safeNextPath(undefined), null);
  assert.equal(safeNextPath("relativ"), null);
});
