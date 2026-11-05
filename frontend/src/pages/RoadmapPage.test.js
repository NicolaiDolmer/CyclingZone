import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Roadmap-hub (#5387, spor 2 #6150): kilde-vagter for skallen. Testen holder
// os ærlige på det der let regredierer:
//   1. Privacy-fix'et (#1599): egne stemmer hentes med .eq("user_id", uid) OG
//      votesByItemId(...) som forsvars-lag 2; egne reports ligeså.
//   2. Item-querien henter de fire synlige statusser (ellers forsvinder Plan,
//      Beta eller Done).
//   3. Den offentlige side bærer ingen admin-kode og kalder aldrig is_admin().

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "RoadmapPage.jsx"), "utf8");
const tabSource = (name) => readFileSync(join(__dirname, "..", "components", "roadmap", `${name}.tsx`), "utf8");

test("RoadmapPage bevarer privacy-fix: egne stemmer + votesByItemId-lag (#1599)", () => {
  assert.match(
    source,
    /from\("roadmap_votes"\)[\s\S]*?\.eq\("user_id", uid\)/,
    "votes-querien skal filtrere til egen bruger med .eq(\"user_id\", uid)",
  );
  assert.match(
    source,
    /votesByItemId\(voteData, uid\)/,
    "votesByItemId(voteData, uid) er forsvars-lag 2 og må ikke fjernes",
  );
});

test("RoadmapPage henter kun egne known_issue_reports (#6150)", () => {
  assert.match(
    source,
    /from\("known_issue_reports"\)\.select\([^)]*\)\.eq\("user_id", uid\)/,
    "reports-querien skal filtrere til egen bruger",
  );
});

test("RoadmapPage henter active, planned, in_progress og shipped (#6150)", () => {
  assert.match(
    source,
    /\.in\("status", \["active", "planned", "in_progress", "shipped"\]\)/,
  );
});

test("RoadmapPage henter kun publicerede kendte fejl (#6150)", () => {
  assert.match(source, /from\("known_issues"\)[\s\S]*?\.eq\("published", true\)/);
});

test("RoadmapPage bærer ingen admin-kode og kalder ikke is_admin (#6150, #5153)", () => {
  assert.doesNotMatch(source, /RoadmapAdminCreateForm/);
  assert.doesNotMatch(source, /rpc\("is_admin"\)/);
  assert.equal(
    existsSync(join(__dirname, "..", "components", "RoadmapAdminCreateForm.jsx")),
    false,
    "admin-formularen er flyttet til admin-fanen (spor 3)",
  );
});

test("RoadmapPage læser fanen fra URL'en via parseTab og skifter med replace (#6150)", () => {
  assert.match(source, /parseTab\(searchParams\.get\("tab"\)\)/);
  assert.match(source, /setSearchParams\(\{ tab: next \}, \{ replace: true \}\)/);
  for (const tab of ["plan", "beta", "vote", "issues", "done"]) {
    assert.match(source, new RegExp(`<TabPanel value="${tab}">`), `mangler TabPanel for ${tab}`);
  }
});

test("Plan-fanen gemmer kun importance_score; Vote-fanen gemmer begge (#6150)", () => {
  assert.match(source, /buildImportancePayload\(\{ itemId: item\.id, userId, importanceScore: value \}\)/);
  assert.match(source, /buildVotePayload\(\{ itemId: item\.id, userId, ideaScore: draft\.idea, importanceScore: draft\.importance \}\)/);
});

test("Filteret huskes i localStorage med try/catch (#6150)", () => {
  assert.match(source, /ONLY_UNRATED_KEY = "cz_roadmap_only_unrated"/);
  assert.match(source, /try \{\s*return localStorage\.getItem\(ONLY_UNRATED_KEY\)/);
});

// #5673: gul ulæst-prik ved nye roadmap-punkter.
test("RoadmapPage bruger roadmapUnread.ts til prikken på det enkelte punkt (#5673)", () => {
  assert.match(source, /from "\.\.\/lib\/roadmapUnread\.ts"/);
  assert.match(source, /isRoadmapItemNew\(item\.created_at, lastSeenBeforeVisit\)/);
});

test("RoadmapPage fanger lastSeen ÉN gang ved mount, FØR den overskrives (#5673)", () => {
  assert.match(source, /useState\(\(\) => readLastSeenRoadmap\(\)\)/);
});

test("RoadmapPage nulstiller lastSeen ved besøg, også med kendte fejl i regnestykket (#5673, #6150)", () => {
  assert.match(source, /const all = \[\.\.\.\(itemData \?\? \[\]\), \.\.\.\(issueData \?\? \[\]\)\]/);
  assert.match(source, /writeLastSeenRoadmap\(latestRoadmapCreatedAt\(all\)\)/);
});

test("RoadmapPage's item-query bruger den delte kolonneliste + issue_ref (#5673, #7666)", () => {
  assert.match(source, /const ITEM_COLUMNS = `\$\{ROADMAP_ITEM_COLUMNS\}, issue_ref`/);
  assert.match(source, /from\("roadmap_items"\)\.select\(ITEM_COLUMNS\)/);
});

// #7666: de nye tidslinje-kolonner findes først når migrationen er applied.
test("RoadmapPage falder tilbage til kendte fejl uden tidslinje-kolonner (#7666)", () => {
  assert.match(source, /KNOWN_ISSUE_COLUMNS = `\$\{KNOWN_ISSUE_BASE_COLUMNS\}, confirmed_at, fixing_at`/);
  assert.match(source, /result\.error \? await query\(KNOWN_ISSUE_BASE_COLUMNS\) : result/);
});

test("RoadmapPage henter patch notes først når Done åbnes (#7666)", () => {
  assert.match(source, /if \(tab !== "done" \|\| patchIndex\) return;/);
  assert.match(source, /patchNotesByIssue\(data\)/);
});

test("RoadmapPage søger på tværs af faner og gemmer fanerne mens der søges (#6203)", () => {
  assert.match(source, /searchRoadmap\(query, items, issues\)/);
  assert.match(source, /<div className=\{searching \? "hidden" : undefined\}>/);
  // Codex-fund: et bedømt punkt må ikke være filtreret væk, når et hit åbnes.
  assert.match(source, /if \(hit\.where === "planned" \|\| hit\.where === "idea"\) markRated\(hit\.id\);/);
});

// Codex-fund på #7668: repoet har ingen DOM-renderer i node --test, så
// ledningerne vagtes her; selve udregningen testes i roadmapModel.test.ts.
test("Et søgehit når frem til punktet: id til fanen, fold åben, scroll (#7668)", () => {
  assert.match(source, /setReveal\(\(prev\) => \(\{ id: hit\.id, tab: hit\.tab, nonce: \(prev\?\.nonce \?\? 0\) \+ 1 \}\)\)/);
  assert.match(source, /getElementById\(roadmapRowId\(reveal\.id\)\)\?\.scrollIntoView\(\{ block: "center" \}\)/);
  // Ny key pr. tryk: områdefilteret nulstilles, og folden åbner også anden gang.
  for (const [tag, panel] of [["PlanTab", "plan"], ["VoteTab", "vote"], ["KnownIssuesTab", "issues"], ["DoneTab", "done"]]) {
    assert.match(source, new RegExp(`<${tag}\\s+key=\\{revealKey\\("${panel}"\\)\\}`), `${tag} mangler revealKey`);
  }
  for (const [tag, panel] of [["PlanTab", "plan"], ["KnownIssuesTab", "issues"], ["DoneTab", "done"]]) {
    assert.match(source, new RegExp(`<${tag}[^>]*?revealId=\\{revealId\\("${panel}"\\)\\}`), `${tag} får ikke id'et`);
  }

  assert.match(tabSource("PlanTab"), /defaultOpen=\{holdsItem\(g\.items, props\.revealId\)\}/);
  assert.match(tabSource("KnownIssuesTab"), /defaultOpen=\{holdsItem\(checkingFolded, props\.revealId\)\}/);
  assert.match(tabSource("DoneTab"), /useState\(\(\) => doneLimitFor\(splitRecentDone\(entries, now \?\? new Date\(\)\)\.earlier, revealId\)\)/);
  for (const tab of ["PlanTab", "BetaTab", "VoteTab", "KnownIssuesTab", "DoneTab"]) {
    assert.match(tabSource(tab), /<li key=[^>]*id=\{roadmapRowId\(/, `${tab}: rækken mangler sit id`);
  }
});
