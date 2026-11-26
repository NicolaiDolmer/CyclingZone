// #8816 · Menuens grupper: aktiv gruppe altid åben, de andre husker valget.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isGroupOpen, parseOpenGroups, readOpenGroups, writeOpenGroups, NAV_OPEN_GROUPS_KEY } from "./navOpenGroups.ts";

test("aktiv gruppe er altid åben, når låsen er slået til", () => {
  assert.equal(isGroupOpen("marked", { marked: false }, "marked", true), true);
  assert.equal(isGroupOpen("marked", {}, "marked", true), true);
});

test("uden lås (kontakten slukket) gælder kun den gemte tilstand", () => {
  assert.equal(isGroupOpen("marked", { marked: false }, "marked", false), false);
  assert.equal(isGroupOpen("marked", { marked: true }, "marked", false), true);
});

test("de andre grupper følger spillerens valg", () => {
  const open = { klubhus: true, resultater: false };
  assert.equal(isGroupOpen("klubhus", open, "marked", true), true);
  assert.equal(isGroupOpen("resultater", open, "marked", true), false);
  assert.equal(isGroupOpen("planlaegning", open, "marked", true), false);
  assert.equal(isGroupOpen("klubhus", open, null, true), true);
});

test("parseOpenGroups er defensiv over for skrald i lageret", () => {
  assert.deepEqual(parseOpenGroups(null), {});
  assert.deepEqual(parseOpenGroups(""), {});
  assert.deepEqual(parseOpenGroups("{ikke json"), {});
  assert.deepEqual(parseOpenGroups("[true]"), {});
  assert.deepEqual(parseOpenGroups("null"), {});
  assert.deepEqual(parseOpenGroups('{"klubhus":true,"marked":"ja","resultater":false}'), { klubhus: true, resultater: false });
});

test("read/write går gennem samme nøgle og tåler et lager der kaster", () => {
  const mem = new Map<string, string>();
  const storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, v); },
  };
  writeOpenGroups({ klubhus: false, marked: true }, storage);
  assert.equal(mem.has(NAV_OPEN_GROUPS_KEY), true);
  assert.deepEqual(readOpenGroups(storage), { klubhus: false, marked: true });

  const broken = {
    getItem: () => { throw new Error("blokeret"); },
    setItem: () => { throw new Error("blokeret"); },
  };
  assert.deepEqual(readOpenGroups(broken), {});
  assert.doesNotThrow(() => writeOpenGroups({ klubhus: true }, broken));
  assert.deepEqual(readOpenGroups(null), {});
});
