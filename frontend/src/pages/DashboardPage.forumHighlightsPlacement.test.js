import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Forum-synlighed (#3199, variant B) + dashboard-omlægningen 25/8 (docs/
// DASHBOARD_RULES.md §4, PR #4249): "From the forum"-kortet står i dag i
// to-kolonne-hovedgridet, parret med "Løb" — ikke længere fuldbredde i den
// øvre stak. Denne fil dækker BÅDE forum-kortets placering og de øvrige tre
// omlægnings-krav (advarsler øverst, de fire par, ingen forsvundne moduler),
// da de deler samme kilde-fil-parsing-tilgang.

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "DashboardPage.jsx"), "utf8");

test("ForumHighlightsCard importeres som selv-hentende komponent", () => {
  assert.match(src, /import ForumHighlightsCard from "\.\.\/components\/ForumHighlightsCard";/);
});

test("kortet er gated bag isVisible(\"forumHighlights\") (customize-menu-mønster)", () => {
  assert.match(src, /\{isVisible\("forumHighlights"\) && <ForumHighlightsCard \/>\}/);
});

test("kortet står i hovedgridet, parret med \"Løb\" (docs/DASHBOARD_RULES.md §4)", () => {
  const mainGridIdx = src.indexOf("Main grid");
  const racesIdx = src.indexOf('isVisible("races")');
  const forumCardIdx = src.indexOf('isVisible("forumHighlights")');
  const divStandingsIdx = src.indexOf('isVisible("divStandings")');
  assert.ok(mainGridIdx !== -1 && racesIdx !== -1 && forumCardIdx !== -1 && divStandingsIdx !== -1);
  assert.ok(mainGridIdx < racesIdx, "hovedgridet skal starte FØR Løb-sektionen");
  assert.ok(racesIdx < forumCardIdx, "forum-kortet skal stå EFTER Løb-sektionen");
  assert.ok(forumCardIdx < divStandingsIdx, "forum-kortet skal stå FØR Stilling/pulje-sektionen (ingen andet modul imellem — parret)");
});

// #dashboard-layout-25/8 — advarsler (trup + kontrakt-fornyelse) flyttet til
// ALLERØVERST i indholdsflowet, over TodayStagesStrip (ejer-go 25/8, #3915
// justeret). Trup- og kontraktadvarsler er de eneste ting på dashboardet der
// koster point hvis de overses (Clarity 94,65% scroll-dybde).
test("advarsler (trup + kontrakt-fornyelse) står FØR TodayStagesStrip", () => {
  const squadWarningIdx = src.indexOf("squadWarning &&");
  const contractWarningIdx = src.indexOf("expiringContractCount > 0 &&");
  const todayStagesIdx = src.indexOf("<TodayStagesStrip");
  assert.ok(squadWarningIdx !== -1 && contractWarningIdx !== -1 && todayStagesIdx !== -1);
  assert.ok(squadWarningIdx < todayStagesIdx, "trup-advarslen skal stå FØR TodayStagesStrip");
  assert.ok(contractWarningIdx < todayStagesIdx, "kontrakt-advarslen skal stå FØR TodayStagesStrip");
});

// #3915s oprindelige kommentar må ikke lyve bagefter — ejer besluttede 25/8 at
// KUN advarsler må stå over dagens etaper (se docs/DASHBOARD_RULES.md §2).
test("#3915-kommentaren ved TodayStagesStrip nævner ejerens 25/8-beslutning", () => {
  const todayStagesIdx = src.indexOf("<TodayStagesStrip");
  const precedingComment = src.slice(Math.max(0, todayStagesIdx - 600), todayStagesIdx);
  assert.match(precedingComment, /25\/8/);
});

// #dashboard-layout-25/8 — de to øvre kollaps-bevidste par (docs/
// DASHBOARD_RULES.md §4): [MyLatestResultCard|NextActionsCard] og
// [TeamSelectionCtaCard|Sæsonstatus-banneret], begge FØR DevTransitionCard.
test("[MyLatestResultCard|NextActionsCard]-parret står FØR DevTransitionCard, og MyLatestResultCard renderer KUN i normaltilstand der", () => {
  const pairedIdx = src.indexOf("myLatestResultPaired &&");
  const nextActionsCardIdx = src.indexOf("<NextActionsCard");
  const devTransitionIdx = src.lastIndexOf("<DevTransitionCard");
  assert.ok(pairedIdx !== -1 && nextActionsCardIdx !== -1 && devTransitionIdx !== -1);
  assert.ok(pairedIdx < devTransitionIdx, "parret skal stå FØR DevTransitionCard");
  assert.ok(nextActionsCardIdx < devTransitionIdx, "NextActionsCard skal stå FØR DevTransitionCard");
  // myLatestResultPaired er defineret som !firstRaceMomentActive && ..., dvs.
  // udelukker sig selv fra parringen under #3310s første-løbs-øjeblik.
  assert.match(src, /const myLatestResultPaired = !firstRaceMomentActive && myLatestResultVisible;/);
});

test("[TeamSelectionCtaCard|Sæsonstatus]-parret står FØR DevTransitionCard og kollapser til fuld bredde når ét kort er skjult", () => {
  const teamSelectionCtaIdx = src.indexOf("<TeamSelectionCtaCard");
  const devTransitionIdx = src.lastIndexOf("<DevTransitionCard");
  assert.ok(teamSelectionCtaIdx !== -1 && devTransitionIdx !== -1);
  assert.ok(teamSelectionCtaIdx < devTransitionIdx, "TeamSelectionCtaCard skal stå FØR DevTransitionCard");
  // Kollaps-mønster: hver halvdel af parret får lg:col-span-2 når partneren mangler.
  assert.match(src, /className=\{nextActionsVisible \? undefined : "lg:col-span-2"\}/);
  assert.match(src, /className=\{myLatestResultPaired \? undefined : "lg:col-span-2"\}/);
  assert.match(src, /className=\{seasonInfo \? undefined : "lg:col-span-2"\}/);
  assert.match(src, /className=\{showTeamSelectionCta \? undefined : "lg:col-span-2"\}/);
});

// #3310 — første-løbs-øjeblikket ejer toppen ALENE og deltager ikke i parringen.
test("MyLatestResultCards første-løbs-variant (#3310) renderer alene, ikke parret", () => {
  const firstRaceBlockIdx = src.indexOf("{firstRaceMomentActive && (");
  const pairedBlockIdx = src.indexOf("myLatestResultPaired ||");
  assert.ok(firstRaceBlockIdx !== -1 && pairedBlockIdx !== -1);
  assert.ok(firstRaceBlockIdx < pairedBlockIdx, "første-løbs-varianten skal stå FØR det parrede blok");
  const firstRaceBlock = src.slice(firstRaceBlockIdx, pairedBlockIdx);
  // Den betingede gren for første-løbs-momentet må ikke selv indeholde NextActionsCard.
  assert.ok(!firstRaceBlock.includes("<NextActionsCard"), "NextActionsCard må ikke stå i første-løbs-grenen");
});

// #dashboard-layout-25/8 — hovedgridets dokumenterede rækkefølge (docs/
// DASHBOARD_RULES.md §4): [Auktioner|Transfers] · [Løb|From the forum] ·
// [Stilling/pulje|Økonomi-prognose] · [Seneste resultater|Rytter-rangliste] ·
// [Bestyrelse|Global Rank]. Board mistede sin lg:col-span-2.
test("hovedgridets rækkefølge matcher docs/DASHBOARD_RULES.md §4", () => {
  // Søger fremad fra "Main grid"-markøren (progressivt cursor), så variabel-
  // deklarationer længere oppe i filen (fx `const recentResultsVisible =
  // isVisible("recentResults")` nær toppen) ikke fejlagtigt matcher FØR den
  // rigtige JSX-brug i selve gridet.
  const order = [
    'isVisible("auctions")',
    'isVisible("transfers")',
    'isVisible("races")',
    'isVisible("forumHighlights")',
    'isVisible("divStandings")',
    'isVisible("forecast")',
    'isVisible("recentResults")',
    'isVisible("riderRanking")',
    'isVisible("board")',
    'isVisible("globalRank")',
  ];
  let cursor = src.indexOf("Main grid");
  assert.ok(cursor !== -1, "Main grid-markøren mangler");
  for (const marker of order) {
    const idx = src.indexOf(marker, cursor);
    assert.ok(idx !== -1, `marker mangler EFTER forrige i rækkefølgen: ${marker}`);
    cursor = idx + marker.length;
  }
});

test("Bestyrelses-sektionen har ikke længere lg:col-span-2 (halv bredde, #4249)", () => {
  const boardIdx = src.indexOf('isVisible("board") && board && (');
  const snippet = src.slice(boardIdx, boardIdx + 200);
  assert.ok(!snippet.includes("lg:col-span-2"), "Board-sektionen skal være halv bredde, ikke fuld");
});

// Ingen af de 23 moduler må være forsvundet fra render-træet under
// omlægningen — kun placering/bredde måtte ændres (opgave-krav).
test("ingen modul-komponent er forsvundet fra render-træet", () => {
  const mustContain = [
    "<TodayStagesStrip",
    "<DevTransitionCard",
    "<MyLatestResultCard",
    "<OnboardingProgressCard",
    "<SeasonWrapNudgeCard",
    "<SeasonStartGuideCard",
    "<OnboardingCompletionCard",
    "<NextActionsCard",
    "<TeamSelectionCtaCard",
    "<ForumHighlightsCard",
    "<MaidenWinMomentCard",
    "<HeroAgonyCard",
    "<GlobalRankWidget",
    'isVisible("auctions")',
    'isVisible("transfers")',
    'isVisible("races")',
    'isVisible("divStandings")',
    'isVisible("board")',
    'isVisible("recentResults")',
    'isVisible("riderRanking")',
    'isVisible("forecast")',
    "squadWarning &&",
    "expiringContractCount > 0 &&",
    "seasonInfo.number", // sæsonstatus-banneret
    "showDiscordNudgeBanner &&",
  ];
  for (const marker of mustContain) {
    assert.ok(src.includes(marker), `modul-markør mangler fra render-træet: ${marker}`);
  }
});
