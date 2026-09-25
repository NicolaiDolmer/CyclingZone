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
  assert.match(source, /import \{[^}]*resolveGoalTitle[^}]*\} from "\.\/boardroomFormat(?:\.js)?";/);
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

// #5754 · [board] Mandat-launch C (ejer-go 25/9 kl. 19:45) — intet aktivt
// mandat + et forslag fra GET /board/meeting skal vise "Proposed mandate",
// ikke det tomme rum. Aktivt mandat uaendret; ingen ny guld-knap i kortet
// (BoardroomPage.jsx's ENESTE guld-knap sidder i headeren).
test("#5754 proposed: vises FOER den kanoniske EmptyState, kun naar mandate mangler OG proposedMeeting.available er sandt", () => {
  const proposedIdx = source.indexOf("if (!mandate && proposedMandate)");
  const emptyIdx = source.indexOf("if (!mandate) {");
  assert.ok(proposedIdx > -1, "det foreslaaede mandat mangler sin egen gren");
  assert.ok(proposedIdx < emptyIdx, "det foreslaaede mandat skal tjekkes FOER den generiske EmptyState-fallback");
  assert.match(source, /const proposedMandate = proposedMeeting\?\.available \? proposedMeeting\.mandate : null;/);
});

test("#5754 proposed: overskrift + meta bruger de nye proposed.*-noegler, ikke det underskrevne mandats cardTitle/goalsMeta", () => {
  const block = source.slice(source.indexOf("if (!mandate && proposedMandate)"), source.indexOf("if (!mandate) {"));
  assert.match(block, /t\("boardroom\.mandate\.proposed\.cardTitle", \{ season: proposedMandate\.seasonNumber \}\)/);
  assert.match(block, /t\("boardroom\.mandate\.proposed\.meta"\)/);
});

test("#5754 proposed: maal-listen er skrivebeskyttet (ProposedGoalRow, ingen onClick/onToggle/receipt-chevron)", () => {
  const block = source.slice(source.indexOf("function ProposedGoalRow"), source.indexOf("export default function MandateCard"));
  assert.doesNotMatch(block, /onClick|onToggle|receipt|Chevron/i, "en foreslaaet raekke maa ikke tilbyde interaktion mandatet ikke har endnu");
  assert.match(block, /resolveGoalTitle\(t, titleSource\)/, "titlen skal genbruge den delte type-styrede resolver, ikke opfinde en ny");
  assert.match(block, /labelKey: goal\.labelKey \?\? goal\.label_key \?\? null/, "meeting-payloadens raa snake_case label_key skal broes til resolverens camelCase-felt");
});

test("#5754 proposed: neutral pil, IKKE StatusPill/STATUS_TONE (den fil ejes af en anden lane)", () => {
  const block = source.slice(source.indexOf("function ProposedPill"), source.indexOf("function ProposedGoalRow"));
  assert.match(block, /t\("boardroom\.mandate\.proposed\.pill"\)/);
  assert.doesNotMatch(block, /StatusPill|STATUS_TONE/);
});

test("#5754 proposed: EEN secondary-knap til aarsmoedet, ALDRIG variant=\"primary\" (siden har allerede sin guld-knap i headeren)", () => {
  const block = source.slice(source.indexOf("if (!mandate && proposedMandate)"), source.indexOf("if (!mandate) {"));
  assert.match(block, /<Button variant="secondary" size="sm" onClick=\{\(\) => navigate\("\/board\/meeting"\)\}>/);
  assert.doesNotMatch(block, /variant="primary"/, "kortet maa IKKE tilfoeje en ny guld-knap ved siden af headerens");
  assert.match(block, /t\("boardroom\.header\.enterMeetingCta"\)/, "genbruger headerens eksisterende CTA-tekst, opfinder ikke ny copy");
});

test("#5754 proposed: aktivt mandat er UAENDRET (proposedMandate-grenen paavirker ikke goals.map paa det underskrevne kort)", () => {
  assert.match(source, /const goals = mandate\.goals \|\| \[\];/);
  assert.match(source, /goals\.map\(\(goal\) => \(\s*<GoalRow/);
});

test("#4557 mandate: bonustilbuddet i fuld laengde bor i Mandat-fanen, koblet til samme payload-felt", () => {
  assert.match(source, /import \{ BonusOfferBlock, BonusAcceptedLine \} from "\.\/BonusOffer\.jsx"/);
  assert.match(source, /<BonusOfferBlock offer=\{bonusOffer\}/);
  assert.match(source, /<BonusAcceptedLine offer=\{bonusOffer\}/);
  assert.match(source, /export default function MandateCard\(\{ mandate, bonusOffer = null, bonusOfferProgress = null, passiveModifier = null, proposedMeeting = null, onReload \}\)/);
});

test("#4557 mandate: 'Discuss target' er eksplicit disabled (no-op, årsmødet er S-M2c)", () => {
  assert.match(source, /<button type="button" disabled aria-disabled="true"/);
});

test("#5633 mandate: flere maal kan foldes ud samtidig (Set, ikke et enkelt scalar-id)", () => {
  assert.match(source, /const \[expandedIds, setExpandedIds\] = useState\(\(\) => new Set\(\)\);/);
  assert.doesNotMatch(source, /useState\(null\)/, "et enkelt expandedId-scalar ville igen laase til ét maal ad gangen");
  assert.match(source, /expanded=\{expandedIds\.has\(goal\.id\)\}/);
});

test("#5633 mandate: 'Expand all'/'Collapse all' vises kun naar der er MERE end ét foldbart maal", () => {
  assert.match(source, /expandableGoalIds\.length > 1 &&/);
  assert.match(source, /"boardroom\.mandate\.expandAll"/);
  assert.match(source, /"boardroom\.mandate\.collapseAll"/);
  assert.match(source, /t\(allExpanded \? "boardroom\.mandate\.collapseAll" : "boardroom\.mandate\.expandAll"\)/);
});

test("#5632 mandate: passiveModifier sender IKKE et ekstra '+'-fortegn (locale-strengen har det allerede — undgår '++10%', samme fund som det gamle rum ikke rettede)", () => {
  assert.match(source, /t\(`transparency\.passiveModifier\.\$\{info\.band\}`, \{ pct: info\.pct \}\)/);
  assert.doesNotMatch(source, /const sign = info\.pct > 0/, "det dobbelte fortegn kom netop fra denne linje i det gamle rum");
});

test("#5632 mandate: afstand til bonustilbud + sponsoreffekt genbruger de EKSISTERENDE transparency.*-nøgler (samme copy som det gamle rum)", () => {
  assert.match(source, /t\(`transparency\.passiveModifier\.\$\{info\.band\}`/);
  assert.match(source, /t\("transparency\.bonusOfferEligible"\)/);
  assert.match(source, /t\("transparency\.bonusOfferSatisfactionGap"/);
  assert.match(source, /t\("transparency\.bonusOfferClose"/);
  assert.match(source, /<PassiveModifierLine info=\{passiveModifier\} t=\{t\} \/>/);
  assert.match(source, /<BonusOfferProgressLine progress=\{bonusOfferProgress\} t=\{t\} \/>/);
});

// #5472 (ejer-review 23/9) · Målets tal kommer som rå tal-strenge fra
// GET /api/board/room ("1074082"). Både mål-rækken her og resuméet på
// overblikket (tal-linjen og "står på X mod et mål på Y") skal formatere dem.
const summarySource = readFileSync(join(__dirname, "MandateSummaryCard.jsx"), "utf8");

test("#5472 mandate + resumé: achievedDisplay/targetDisplay vises kun gennem formatGoalValue", () => {
  for (const [name, src] of [["MandateCard", source], ["MandateSummaryCard", summarySource]]) {
    assert.match(src, /import \{[^}]*formatGoalValue[^}]*\} from "\.\/boardroomFormat\.js";/, `${name} skal importere formatGoalValue`);
    assert.doesNotMatch(src, /achieved: (?:goal|worst)\.achievedDisplay/, `${name} sender stadig et rå achievedDisplay til t()`);
    assert.doesNotMatch(src, /target: (?:goal|worst)\.targetDisplay/, `${name} sender stadig et rå targetDisplay til t()`);
  }
  assert.match(source, /achieved: formatGoalValue\(goal\.achievedDisplay, goal\.type\)/);
  assert.match(summarySource, /achieved: formatGoalValue\(goal\.achievedDisplay, goal\.type\)/);
  assert.match(summarySource, /achieved: formatGoalValue\(worst\.achievedDisplay, worst\.type\)/);
});
