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

test("#4557/#4570 mandate: mål-titlen bruger den delte type-styrede resolver, ikke rå labelKey-interpolation", () => {
  assert.match(source, /import \{[^}]*resolveGoalTitle[^}]*\} from "\.\/boardroomFormat";/);
  assert.match(source, /\{resolveGoalTitle\(t, goal\)\}/);
  assert.doesNotMatch(source, /t\(goal\.labelKey/, "titlen må ikke længere kaldes direkte via t(goal.labelKey, ...) — det er nu KUN resolverens interne fallback-sti");
});

test("#4557 mandate: receipt-lines guardes, aldrig en rå i18n-nøgle på skærmen", () => {
  assert.match(source, /if \(!receipt\) return null;/, "GoalReceipt skal skippe hele blokken uden data");
  // countedKey og weightedByLineKey er altid til stede -> kaldes altid via t().
  for (const field of ["countedKey", "weightedByLineKey"]) {
    assert.match(source, new RegExp(`t\\(receipt\\.${field}`), `${field} skal kaldes via t()`);
  }
  // lastMovementKey optræder ÉT sted i et rent boolean-tjek (ingen t()-kald der)
  // og ÉT sted inde i det betingede t()-kald — begge er korrekte, forskellige formål.
  assert.match(source, /Boolean\(receipt\.lastMovementKey && receipt\.lastMovementAt\)/);
  assert.match(source, /t\(receipt\.lastMovementKey, receipt\.lastMovementParams \|\| \{\}\)/);
});

test("#4570-afstemning: 'Last movement'-linjen udelades HELT når backend ikke har data (aldrig en tom linje)", () => {
  assert.match(source, /const hasLastMovement = Boolean\(receipt\.lastMovementKey && receipt\.lastMovementAt\);/);
  assert.match(source, /if \(hasLastMovement\) \{/);
  // Counted + Weighted by pushes ligger UDENFOR if(hasLastMovement)-blokken, saa de
  // altid renderer uanset lastMovement-status.
  const hasLastMovementBlockStart = source.indexOf("if (hasLastMovement) {");
  const hasLastMovementBlockEnd = source.indexOf("}", source.indexOf("lines.push(", hasLastMovementBlockStart)) + 40;
  const countedIdx = source.indexOf('key="counted"');
  const weightedByIdx = source.indexOf('key="weightedBy"');
  assert.ok(countedIdx < hasLastMovementBlockStart, "counted-linjen skal pushes FØR det betingede lastMovement-blok");
  assert.ok(weightedByIdx > hasLastMovementBlockEnd, "weightedBy-linjen skal pushes EFTER det betingede lastMovement-blok (altid uafhængig af den)");
});

test("#4557 mandate: Stretch-badge og statuspil er begge betinget af data (ingen hardcoded skærm-strenge)", () => {
  assert.match(source, /goal\.isStretch &&/);
  assert.match(source, /t\("boardroom\.mandate\.stretch"\)/);
  // #4557 (overblik + faner): pillen er udtrukket til StatusPill.jsx, saa
  // overblikkets resumé-raekke og det fulde kort deler ANATOMI (TASTE P8).
  assert.match(source, /import StatusPill from "\.\/StatusPill\.jsx"/);
  assert.match(source, /<StatusPill status=\{goal\.status\} t=\{t\} \/>/);
});

test("#4557 mandate: bonus-maerkatet er sit eget signal, ikke genbrug af Stretch", () => {
  assert.match(source, /goal\.isBonus &&/);
  assert.match(source, /t\("boardroom\.mandate\.bonus"\)/);
});

test("#4557 mandate: bonustilbuddet i fuld laengde bor i Mandat-fanen, koblet til samme payload-felt", () => {
  assert.match(source, /import \{ BonusOfferBlock, BonusAcceptedLine \} from "\.\/BonusOffer\.jsx"/);
  assert.match(source, /<BonusOfferBlock offer=\{bonusOffer\}/);
  assert.match(source, /<BonusAcceptedLine offer=\{bonusOffer\}/);
  assert.match(source, /export default function MandateCard\(\{ mandate, bonusOffer = null, onReload \}\)/);
});

test("#4557 mandate: 'Discuss target' er eksplicit disabled (no-op, årsmødet er S-M2c)", () => {
  assert.match(source, /<button type="button" disabled aria-disabled="true"/);
});
