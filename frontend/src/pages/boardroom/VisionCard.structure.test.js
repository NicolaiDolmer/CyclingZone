import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "VisionCard.jsx"), "utf8");

test("#4557 vision: null renderer den kanoniske EmptyState (T1 canonical states)", () => {
  assert.match(source, /if \(!vision\) \{/);
  const emptyBlock = source.slice(source.indexOf("if (!vision)"), source.indexOf("if (!vision)") + 300);
  assert.match(emptyBlock, /<EmptyState/);
});

test("#4570-afstemning: kort-titlen bruger vision.titleKey (backend-leveret narrativt klub-navn) med generisk fallback", () => {
  assert.match(source, /const title = vision\.titleKey/);
  assert.match(source, /t\(vision\.titleKey, \{ defaultValue: t\("boardroom\.vision\.cardTitle"\) \}\)/);
  assert.match(source, /: t\("boardroom\.vision\.cardTitle"\);/, "uden titleKey falder titlen til den generiske 'Club vision'");
});

test("#4557 vision: meta-linjen bruger sæson-numre (S{start} to S{end}), ikke fiktive kalenderår", () => {
  assert.match(source, /t\("boardroom\.vision\.meta", \{ start: vision\.startSeason, end: vision\.endSeason \}\)/);
});

test("#4557 vision: milepæl-status styrer prikken (current/achieved/missed/upcoming), aldrig en hardcoded farve", () => {
  assert.match(source, /status === "current"/);
  assert.match(source, /status === "achieved"/);
  assert.match(source, /status === "missed"/);
});
