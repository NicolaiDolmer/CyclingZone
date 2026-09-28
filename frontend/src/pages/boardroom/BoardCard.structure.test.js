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
  assert.match(source, /board\.chairmanQuote\.contextKey \? t\(board\.chairmanQuote\.contextKey\) : null/);
  // #5633 · navn og kontekst samles med filter(Boolean), saa et manglende navn
  // ikke efterlader " · kontekst" med et hul foran skilletegnet.
  assert.match(source, /\]\.filter\(Boolean\)\.join\(" · "\)/);
});

test("#4557 board: minute-feed rækker attribueres altid til memberName, aldrig anonymt", () => {
  assert.match(source, /\[minute\.memberName, formatWeekdayOnly\(minute\.occurredAt\)\]\.filter\(Boolean\)/);
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
  assert.match(memberPanelSource, /import \{ formatWeekdayShortDate, resolveGoalTitle, MOOD_DOT \} from "\.\/boardroomFormat(?:\.js)?";/);
  assert.match(memberPanelSource, /\{resolveGoalTitle\(t, g\)\}/);
  assert.doesNotMatch(memberPanelSource, /t\(g\.labelKey/, "skal ikke længere kalde t(g.labelKey, ...) direkte");
});

test("#4570-afstemning: 'on the board since S{n}' vises kun naar member.sinceSeason er sat (aldrig gættet)", () => {
  assert.match(memberPanelSource, /member\.sinceSeason != null \? t\("boardroom\.member\.sinceSeason", \{ season: member\.sinceSeason \}\) : null/);
});

test("#5633 board: synlig instruktion over medlems-gitteret (ikke kun en hover-only title-tooltip, usynlig paa mobil)", () => {
  assert.match(source, /t\("boardroom\.board\.memberGridHint"\)/);
});

test("#5633 board: medlems-tiles reserverer samme navne-hoejde uanset navnelaengde (ingen ujaevnt gitter)", () => {
  assert.match(source, /line-clamp-2 min-h-\[26px\] w-full break-words/);
  assert.match(source, /className="flex w-full min-w-0 flex-col items-center gap-0 text-center transition-opacity hover:opacity-80"/);
});
