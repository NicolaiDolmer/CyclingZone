import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectSeoScores, findDrops, renderDropReport, DROP_THRESHOLD } from "./seo-weekly-check.mjs";

test("findDrops: kun fald paa mindst taerskel, ignorerer nye sider", () => {
  const prev = { "https://a/": 100, "https://b/": 100, "https://c/": 90 };
  const curr = { "https://a/": 100 - DROP_THRESHOLD, "https://b/": 100 - DROP_THRESHOLD + 1, "https://d/": 10 };
  const drops = findDrops(prev, curr);
  assert.deepEqual(drops, [{ url: "https://a/", before: 100, now: 100 - DROP_THRESHOLD }]);
});

test("findDrops: ingen forrige scores giver ingen drops", () => {
  assert.deepEqual(findDrops({}, { "https://a/": 50 }), []);
});

test("collectSeoScores: laeser lhr-filer og springer korrupte over", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seo-"));
  fs.writeFileSync(path.join(dir, "lhr-1.json"), JSON.stringify({ finalUrl: "https://x/", categories: { seo: { score: 0.92 } } }));
  fs.writeFileSync(path.join(dir, "lhr-2.json"), "{not json");
  fs.writeFileSync(path.join(dir, "manifest.json"), "[]");
  assert.deepEqual(collectSeoScores(dir), { "https://x/": 92 });
  fs.rmSync(dir, { recursive: true });
});

test("renderDropReport: indeholder tabelraekke pr. side", () => {
  const md = renderDropReport([{ url: "https://a/", before: 100, now: 90 }]);
  assert.match(md, /\| https:\/\/a\/ \| 100 \| 90 \|/);
});
