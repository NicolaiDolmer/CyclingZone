import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Kildekode-struktur-guards (samme mønster som DashboardPage.errorState.test.js
// / DashboardPage.onboardingConsolidation.test.js) — repoet kører node --test
// uden DOM-renderer.

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "BoardroomPage.jsx"), "utf8");

test("#4557 BoardroomPage renderer alle kanoniske kort fordelt paa fanerne", () => {
  for (const tag of ["<ConfidenceCard", "<MandateSummaryCard", "<MandateCard", "<VisionCard", "<BoardCard"]) {
    assert.ok(source.includes(tag), `mangler ${tag}`);
  }
});

test("#4557 BoardroomPage tager den allerede-hentede payload som prop (ingen egen fetch)", () => {
  assert.doesNotMatch(source, /fetch\(/, "BoardroomPage må ikke selv fetche — data kommer fra BoardroomRoute");
  assert.match(source, /export default function BoardroomPage\(\{ data, onReload, dnaPreview = null, meetingPreview = null \}\)/);
});

test("#4557 (S-M2c) gold 'Enter annual meeting'-knappen vises KUN naar GET /board/meeting svarer available:true", () => {
  assert.match(source, /t\("boardroom\.header\.enterMeetingCta"\)/);
  assert.match(source, /actions=\{meetingAvailable \?/, "CTA skal vaere betinget af meetingAvailable, aldrig altid-vist eller deaktiveret");
  assert.match(source, /fetchBoardMeeting\(\)/);
});

test("#4557 header bruger t() for titel/undertitel — ingen hardcodede strenge", () => {
  assert.match(source, /t\("boardroom\.header\.title"\)/);
  assert.match(source, /t\("boardroom\.header\.subtitle"/);
});

test("#4570-afstemning: undertitlens DNA-label genbruger den EKSISTERENDE dna.<key>.label-nøgle, forfatter ikke ny copy", () => {
  assert.match(source, /t\(`dna\.\$\{dnaKey\}\.label`, \{ defaultValue: "" \}\)/);
  assert.match(source, /data\.team\?\.dnaKey/);
});

test("#4570-afstemning: undertitlen har 3 grene (chair+dna / chair alene / ingen chair) — aldrig et gættet felt", () => {
  assert.match(source, /t\("boardroom\.header\.subtitleNoChair"\)/);
  assert.match(source, /t\("boardroom\.header\.subtitle", \{ chair: chair\.name, dna: dnaLabel \}\)/);
  assert.match(source, /t\("boardroom\.header\.subtitleChairOnly", \{ chair: chair\.name \}\)/);
});

// ── #4557-rest · overblik foerst + faner ud (ejer-go 6/9) ────────────────────

test("#4557 fanerne bruger Tabs-primitivet, aldrig en haandrullet knap-raekke", () => {
  assert.match(source, /import \{[^}]*Tabs, TabList, Tab, TabPanel[^}]*\} from "\.\.\/\.\.\/components\/ui"/);
  assert.doesNotMatch(source, /role="tablist"/, "TabList ejer role/roving tabindex — siden maa ikke saette dem selv");
  for (const tab of ["overview", "mandate", "vision", "board"]) {
    assert.ok(source.includes(`<Tab value="${tab}">`), `mangler fanen ${tab}`);
    assert.ok(source.includes(`<TabPanel value="${tab}">`), `mangler panelet ${tab}`);
  }
});

test("#4557 fanen ligger i ?tab= (dyb-link + tilbage-knap), og default er overview", () => {
  assert.match(source, /useSearchParams/);
  assert.match(source, /searchParams\.get\("tab"\)/);
  assert.match(source, /TABS\.includes\(requestedTab\) \? requestedTab : "overview"/);
  assert.match(source, /const TABS = \["overview", "mandate", "vision", "board"\];/);
});

test("#4557 overblikket er ét skaermbillede: tillid + mandat-resumé + to resumé-linjer, intet tredje kort", () => {
  const overview = source.slice(
    source.indexOf('<TabPanel value="overview">'),
    source.indexOf('<TabPanel value="mandate">'),
  );
  assert.ok(overview.includes("<ConfidenceCard"));
  assert.ok(overview.includes("<MandateSummaryCard"));
  assert.ok(overview.includes("<OverviewSummaryRows"));
  // Det fulde mandatkort hoerer til Mandat-fanen, ikke overblikket.
  assert.ok(!/<MandateCard\b/.test(overview), "det fulde mandatkort maa ikke ligge paa overblikket");
  assert.ok(!/<VisionCard\b/.test(overview) && !/<BoardCard\b/.test(overview),
    "vision og bestyrelse er resumé-LINJER paa overblikket, ikke kort");
});

test("#4557 sidens ENESTE guld-knap er aarsmoedet (TASTE P3: guld er rationeret)", () => {
  const primaries = source.match(/variant="primary"/g) || [];
  assert.equal(primaries.length, 1, "praecis én primary/guld-knap pr. view");
  const idx = source.indexOf('variant="primary"');
  const header = source.slice(source.indexOf("<PageHeader"), source.indexOf("</Tabs>"));
  assert.ok(header.includes('variant="primary"'), "guld-knappen skal sidde i sidehovedets action-cluster");
  assert.ok(source.slice(idx, idx + 260).includes("boardroom.header.enterMeetingCta"));
});

test("#4557 hold uden klub-DNA faar valgkortet oeverst paa overblikket (BOARD_RULES §8)", () => {
  assert.match(source, /const showDnaChoice = !hasDna && dnaSuggestions\.length > 0;/);
  const overview = source.slice(
    source.indexOf('<TabPanel value="overview">'),
    source.indexOf('<TabPanel value="mandate">'),
  );
  assert.ok(overview.indexOf("showDnaChoice") < overview.indexOf("<ConfidenceCard"),
    "valgkortet tager den oeverste plads, tillidskortet rykker én ned");
});

test("#4557 DNA-forslag og -valg gaar til de EKSISTERENDE ruter (ingen ny mekanik)", () => {
  assert.match(source, /import \{ fetchDnaSuggestions, postDnaChoice \} from "\.\.\/\.\.\/components\/board\/dnaApi\.js"/);
  assert.doesNotMatch(source, /api\/board\/dna/, "selve kaldene bor i dnaApi.js, ikke i siden");
});

test("#4557 bonustilbuddet fodres fra payloadens ene felt, begge steder", () => {
  const stripeUses = source.match(/bonusOffer=\{data\.bonusOffer\}/g) || [];
  assert.equal(stripeUses.length, 2, "resumé-striben (overblik) og det fulde kort (Mandat-fane) laeser samme felt");
  assert.match(source, /onReload=\{onReload\}/);
});

test("#5632 Mandat-fanen faar bonusOfferProgress + passiveModifier fra payloaden (afstand til tilbud + sponsoreffekt)", () => {
  assert.match(source, /bonusOfferProgress=\{data\.bonusOfferProgress\}/);
  assert.match(source, /passiveModifier=\{data\.passiveModifier\}/);
});

// #5754 · [board] Mandat-launch C — GET /board/meeting's fulde payload gemmes
// (ikke kun `available`) og gaar til BAADE Mandat-fanens fulde kort og
// Overblikkets resumé, saa Mandat-fanen ikke laengere er et tomt rum mellem
// saesonskiftet og underskriften.
test("#5754 hele meeting-payloaden gemmes (ikke kun available) og sendes til MandateCard + MandateSummaryCard", () => {
  assert.match(source, /const \[proposedMeeting, setProposedMeeting\] = useState\(meetingPreview\);/);
  assert.match(source, /setProposedMeeting\(res\);/);
  assert.doesNotMatch(source, /setProposedMeeting\(\{\s*available/, "hele res skal gemmes, ikke et haandplukket delsaet af felterne");
  assert.match(source, /proposedMeeting=\{proposedMeeting\}/g);
  const stripeUses = source.match(/proposedMeeting=\{proposedMeeting\}/g) || [];
  assert.equal(stripeUses.length, 2, "baade MandateCard (Mandat-fanen) og MandateSummaryCard (Overblik) skal faa forslaget");
});

test("#5754 DEV-preview kan seede proposedMeeting UDEN netvaerkskald (samme moenster som dnaPreview)", () => {
  assert.match(source, /useState\(Boolean\(meetingPreview\?\.available\)\)/);
});

test("#5754 (CodeRabbit-runde) DEV-preview SYNKRONISERER tilstanden ved et variant-skift, ingen tidlig return uden at saette state", () => {
  assert.match(source, /if \(meetingPreview\) \{\s*setProposedMeeting\(meetingPreview\);\s*setMeetingAvailable\(Boolean\(meetingPreview\.available\)\);\s*return;\s*\}/);
});
