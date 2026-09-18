// #5389 — dashboardet hoppede fordi TodayStagesStrip renderede INTET mens
// dens egen (uafhængige) fetch var i gang, og først bagefter poppede en hel
// stribe med kort ind — resten af siden var allerede malet og flyttede sig.
// Fix: reserver PRÆCIS kort-rammens højde med et skelet mens `loading` er
// sat; en ægte "ingen løb i dag" (hentet OG bekræftet tom) skjuler stadig
// sig selv HELT (#3915, uændret).
//
// Kildekode-struktur-guard (samme mønster som MyLatestResultCard.
// seenServerFlag.test.js/NotificationsPage.stageResultLink.test.js) —
// repoet kører node --test uden DOM-renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "TodayStagesStrip.jsx"), "utf8");

test("#5389 TodayStagesStrip renderer IKKE længere null under selve hentningen (den gamle 'loading || !cards.length'-gate)", () => {
  assert.doesNotMatch(
    source,
    /if \(loading \|\| !cards\.length\) return null;/,
    "loading-fasen må ikke længere kollapse til 0 højde — det var selve #5389-hoppet",
  );
});

test("#5389 en ægte 'ingen løb i dag' (færdig-hentet OG tom) renderer stadig intet (#3915 uændret)", () => {
  assert.match(
    source,
    /if \(!loading && !cards\.length\) return null;/,
    "kun den FÆRDIGE tomme tilstand må kollapse til 0 højde — 18/8-beslutningen om mindst støj skal stå",
  );
});

test("#5389 loading-tilstanden bruger den kanoniske SkeletonLines (opfinder ikke eget loading-markup, PAGE_TEMPLATES.md)", () => {
  assert.match(
    source,
    /import\s*\{[^}]*SkeletonLines[^}]*\}\s*from\s*"\.\/ui\/index\.js"/,
    "skelettet skal komme fra components/ui's SkeletonLines (eksplicit .js-import, .coderabbit.yaml), ikke et håndrullet loading-markup",
  );
  assert.match(
    source,
    /loading\s*\n?\s*\?\s*<TodayStageSkeletonCard \/>/,
    "stribens body skal skifte til skelet-kortet mens loading er sat",
  );
});

// CodeRabbit-fund (#5389): `h-full` på et kort inde i en `<Link>`/`<div>`
// UDEN defineret højde er en no-op — det garanterer INTET fælles mål mellem
// skelet og rigtigt kort. Fix: begge bruger nu SAMME eksplicitte
// TODAY_STAGE_CARD_HEIGHT-konstant, målt på det rigtige korts faktiske
// indhold (172px, se kommentaren ved konstanten).
test("#5389 skelet-kortet og det rigtige kort deler SAMME eksplicitte højde-konstant (CodeRabbit-fund: h-full uden en højde-forælder er en no-op)", () => {
  const constMatch = source.match(/const TODAY_STAGE_CARD_HEIGHT = (\d+);/);
  assert.ok(constMatch, "kunne ikke finde TODAY_STAGE_CARD_HEIGHT-konstanten i kilden");

  const skeletonMatch = source.match(/function TodayStageSkeletonCard\(\) \{[\s\S]*?\n\}/);
  assert.ok(skeletonMatch, "kunne ikke finde TodayStageSkeletonCard i kilden");
  assert.match(skeletonMatch[0], /w-\[248px\]/, "skelettets bredde skal matche TodayStageCard's w-[248px]");
  assert.match(
    skeletonMatch[0],
    /style=\{\{ height: TODAY_STAGE_CARD_HEIGHT \}\}/,
    "skelettets Card skal bruge den delte højde-konstant, ikke h-full",
  );

  assert.doesNotMatch(
    source,
    /className="flex h-full flex-col p-4"/,
    "h-full er en no-op uden en højde-forælder — begge kort skal bruge den eksplicitte konstant i stedet",
  );
  // Begge callsites (skelet + rigtigt kort) skal bruge PRÆCIS samme konstant.
  const heightUsages = source.match(/style=\{\{ height: TODAY_STAGE_CARD_HEIGHT \}\}/g) ?? [];
  assert.equal(heightUsages.length, 2, "både skelet-kortet og TodayStageCard skal sætte height via TODAY_STAGE_CARD_HEIGHT");
});
