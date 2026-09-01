import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "BoardCard.jsx"), "utf8");
const memberPanelSource = readFileSync(join(__dirname, "MemberPanel.jsx"), "utf8");

test("#4557 board: chairmanQuote null → hele citat-boksen udelades (aldrig en rå nøgle)", () => {
  assert.match(source, /\{board\?\.chairmanQuote && \(/);
  const idx = source.indexOf("board?.chairmanQuote && (");
  const block = source.slice(idx, idx + 400);
  assert.match(block, /t\(board\.chairmanQuote\.textKey, board\.chairmanQuote\.textParams \|\| \{\}\)/);
});

test("#4557 board: contextKey er selv betinget (citat-nøgler kan mangle pr. arketype)", () => {
  assert.match(source, /board\.chairmanQuote\.contextKey \? ` · \$\{t\(board\.chairmanQuote\.contextKey\)\}` : ""/);
});

test("#4557 board: minute-feed rækker attribueres altid til memberName, aldrig anonymt", () => {
  assert.match(source, /\{minute\.memberName\}/);
  assert.match(source, /t\(minute\.textKey, minute\.textParams \|\| \{\}\)/);
});

test("#4557 board: 'Meeting minutes' er en meta-label, ikke en dead-link (ingen destination i denne slice)", () => {
  assert.doesNotMatch(source, /<a\s+href="#"/, "et href=\"#\"-link ville genindføre dead-click-tætheden redesignet skal fjerne");
});

test("#4557 medlems-panel: mood/personlighed/citater er alle betinget af data", () => {
  assert.match(memberPanelSource, /if \(!member\) return null;/);
  assert.match(memberPanelSource, /\{personality && \(/);
  assert.match(memberPanelSource, /\{ownedGoals\.length > 0 && \(/);
  assert.match(memberPanelSource, /\{ownWords\.length > 0 && \(/);
});

test("#4557 medlems-panel: 'in his own words' render altid via t(), aldrig en rå textKey-streng", () => {
  assert.match(memberPanelSource, /t\(m\.textKey, m\.textParams \|\| \{\}\)/);
});

test("#4570-afstemning: ejede-mål-titlen i medlems-panelet bruger samme delte resolver som mandatkortet", () => {
  assert.match(memberPanelSource, /import \{ formatWeekdayShortDate, resolveGoalTitle, MOOD_DOT \} from "\.\/boardroomFormat";/);
  assert.match(memberPanelSource, /\{resolveGoalTitle\(t, g\)\}/);
  assert.doesNotMatch(memberPanelSource, /t\(g\.labelKey/, "skal ikke længere kalde t(g.labelKey, ...) direkte");
});

test("#4570-afstemning: 'on the board since S{n}' vises kun naar member.sinceSeason er sat (aldrig gættet)", () => {
  assert.match(memberPanelSource, /member\.sinceSeason != null \? t\("boardroom\.member\.sinceSeason", \{ season: member\.sinceSeason \}\) : null/);
});
