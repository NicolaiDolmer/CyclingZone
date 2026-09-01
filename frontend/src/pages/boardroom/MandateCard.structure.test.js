import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "MandateCard.jsx"), "utf8");

test("#4557 mandate: null renderer den kanoniske EmptyState (T1 canonical states)", () => {
  assert.match(source, /if \(!mandate\) \{/);
  const emptyBlock = source.slice(source.indexOf("if (!mandate)"), source.indexOf("if (!mandate)") + 400);
  assert.match(emptyBlock, /<EmptyState/);
  assert.match(emptyBlock, /icon=\{<ClipboardIcon/);
});

test("#4557 mandate: receipt-lines guardes — aldrig en rå i18n-nøgle på skærmen", () => {
  assert.match(source, /if \(!receipt\) return null;/, "GoalReceipt skal skippe hele blokken uden data");
  // Alle *Key-felter skal altid passere igennem t(...) — aldrig interpoleres raat.
  const keyFieldUses = source.match(/receipt\.(countedKey|lastMovementKey|weightedByLineKey)/g) || [];
  assert.ok(keyFieldUses.length >= 3);
  for (const use of keyFieldUses) {
    const idx = source.indexOf(use);
    const before = source.slice(Math.max(0, idx - 3), idx);
    assert.match(before, /t\($/, `${use} skal kaldes via t(), ikke interpoleres raat`);
  }
});

test("#4557 mandate: Stretch-badge og statuspil er begge betinget af data (ingen hardcoded skærm-strenge)", () => {
  assert.match(source, /goal\.isStretch &&/);
  assert.match(source, /t\("boardroom\.mandate\.stretch"\)/);
  assert.match(source, /t\(`boardroom\.status\.\$\{status\}`/);
});

test("#4557 mandate: 'Discuss target' er eksplicit disabled (no-op — årsmødet er S-M2c)", () => {
  assert.match(source, /<button type="button" disabled aria-disabled="true"/);
});
