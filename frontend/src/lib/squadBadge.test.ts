// #5763: senior = intet mærke, u23 = "U23", junior = "JR" (EN/DA identiske).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { squadBadgeKey } from "./squadBadge.ts";

const here = dirname(fileURLToPath(import.meta.url));
const readLocale = (locale: string) =>
  JSON.parse(readFileSync(join(here, `../../public/locales/${locale}/rider.json`), "utf8"));

test("squadBadgeKey: senior/ukendt/tomt giver intet mærke", () => {
  assert.equal(squadBadgeKey("senior"), null);
  assert.equal(squadBadgeKey(null), null);
  assert.equal(squadBadgeKey(undefined), null);
  assert.equal(squadBadgeKey("not-a-squad"), null);
});

test("squadBadgeKey: u23 og junior giver deres egen nøgle", () => {
  assert.equal(squadBadgeKey("u23"), "u23");
  assert.equal(squadBadgeKey("junior"), "junior");
});

test("badges.label.u23/junior er 'U23'/'JR' i både EN og DA", () => {
  for (const locale of ["en", "da"]) {
    const rider = readLocale(locale);
    assert.equal(rider.badges.label.u23, "U23", `${locale}: u23-label`);
    assert.equal(rider.badges.label.junior, "JR", `${locale}: junior-label`);
  }
});
