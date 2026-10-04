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

test("RoadmapPage's item-query bruger den delte kolonneliste (#5673)", () => {
  assert.match(source, /\.select\(ROADMAP_ITEM_COLUMNS\)/);
});
