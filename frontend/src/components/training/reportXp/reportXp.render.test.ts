import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { transformSync } from "rolldown/utils";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import ICU from "i18next-icu";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";

const ENV = '({ DEV: false, VITE_SUPABASE_URL: "http://localhost:54321", VITE_SUPABASE_ANON_KEY: "test" })';
const loader = registerHooks({ resolve(specifier, context, nextResolve) {
  // Vite resolves extensionless relative imports (Flag.jsx -> ../lib/countryUtils); node does not.
  if (/^\.\.?\//.test(specifier) && !/\.[a-z]+$/i.test(specifier)) {
    // The name cell's marks import directory indexes (../ui); try those too.
    for (const ext of [".js", ".ts", ".jsx", ".tsx", "/index.js", "/index.ts", "/index.jsx", "/index.tsx"]) {
      try { return nextResolve(specifier + ext, context); } catch { /* try the next extension */ }
    }
  }
  return nextResolve(specifier, context);
}, load(url, context, nextLoad) {
  if (url.startsWith("file:") || url.includes("node_modules")) {
    if (/\.css(\?.*)?$/.test(url)) return { format: "module", shortCircuit: true, source: "export default {};" };
  }
  // App source sees a fake Vite env (the supabase client needs a URL to construct; it is never called).
  if (url.startsWith("file:") && !url.includes("node_modules") && /\.(tsx|jsx|ts|js)$/.test(url) && url.includes("/frontend/src/")) {
    const lang = (url.match(/\.(tsx|jsx|ts|js)$/)![1]) as "tsx" | "jsx" | "ts" | "js";
    const source = readFileSync(new URL(url), "utf8").replaceAll("import.meta.env", ENV);
    return { format: "module", shortCircuit: true,
      source: transformSync(new URL(url).pathname, source, { lang, jsx: { runtime: "automatic" } }).code };
  }
  return nextLoad(url, context);
} });
const { default: XpToday, shortName, nameParts } = await import("./XpToday.tsx");
const { default: XpMonth } = await import("./XpMonth.tsx");
const { xpReportMode, previewXpReport, previewXpReportState } = await import("./XpReportSwitch.tsx");
const { default: TrainingReportXp } = await import("./TrainingReportXp.tsx");
loader.deregister();
const { buildXpReportFixture } = await import("./xpReportFixture.ts");
const { buildMonthView, buildTodayView } = await import("../../../lib/trainingReportXp.ts");

const locale = (lang: string, ns: string) => JSON.parse(readFileSync(new URL(`../../../../public/locales/${lang}/${ns}.json`, import.meta.url), "utf8"));
const LANGS = ["en", "da", "es", "fr", "nl"];
const en = locale("en", "trainingXp");
const i18n = createInstance();
await i18n.use(ICU).init({ lng: "en", initAsync: false, resources: { en: { trainingXp: en, training: locale("en", "training"), rider: {}, riderTypes: locale("en", "riderTypes") } }, fallbackLng: false });

// Allowed: the Segmented active text, and the game's one name-link hover (RiderNameCell, TASTE P12).
const noSegmentGold = (html: string) => html.replaceAll("cursor-default bg-cz-accent/10 text-cz-accent-t", "").replaceAll("hover:text-cz-accent-t", "");
const fx = buildXpReportFixture();
const options = { nations: fx.nations, types: fx.types };
const wrap = (el: unknown) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(I18nextProvider, { i18n }, el as never)));

test("Today renders every rider, the panel and the hatched race part, without gold", () => {
  const view = buildTodayView(fx.receipts, null, options)!;
  const html = wrap(createElement(XpToday, { view, onPickDate: () => {}, switcher: null }));
  assert.equal(html.split('data-testid="xp-row"').length - 1, view.riders.length);
  assert.match(html, /data-testid="xp-rider-panel"/);
  assert.match(html, /data-part="race"/);
  assert.match(html, /fill="url\(#/);
  // Gold only as the canonical Segmented active text (TASTE fork 3, slot 3); never on bars, marks or buttons (#7988).
  assert.doesNotMatch(noSegmentGold(html), /cz-accent/, "no gold on this surface (#7988)");
  assert.doesNotMatch(html, /xpReport\./, "every key has an English text");
  assert.doesNotMatch(html, /\{[a-z]+\}|\{\{/i, "ICU placeholders are filled");
  assert.match(html, />\d+ riders?<\/div>/, "ICU plural renders");
  assert.equal(html.split('aria-pressed="true"').length - 1, 2, "the picked day and the active filter");
  // Earned today and paid out from the bar, apart: in the totals, per row and in the note (Fable point 5).
  assert.match(html, />Points earned today</);
  assert.match(html, />Paid out from the bar</);
  assert.match(html, /data-testid="xp-paid-mark"/);
  assert.match(html, /data-testid="xp-paid-note"/);
  assert.match(html, /data-testid="xp-rider-split"/);
  // One line per rider: flag, the canonical name cell, type in its own column.
  assert.equal(html.split('data-testid="xp-name-cell"').length - 1, view.riders.length);
  assert.equal(html.split('data-testid="xp-type"').length - 1, view.riders.length);
  assert.match(html, /class="fi fi-[a-z]{2}/);
  // Form on the rating plate (#8364); no typed arrows, long dashes, gold buttons or emoji.
  assert.match(html, /data-testid="xp-form-plate"[^>]*|style="background-color/);
  assert.doesNotMatch(html, /\u2192|\u2014|\u2013/u, "no typed arrow or long dash");
  assert.doesNotMatch(html, /\p{Extended_Pictographic}/u, "no emoji");
  assert.doesNotMatch(html, /bg-cz-accent(?!\/10)/, "no gold button");
});

test("#7947 the Rating column shows 'x > y' only when his rating moved", () => {
  const withAbilities = { ...options, abilities: fx.abilities };
  // The first fixture date (newest first) where some rider's rating moved.
  const date = fx.receipts.map(r => r.tick_date).find(d => buildTodayView(fx.receipts, d, withAbilities)!.riders.some(r => r.rating));
  assert.ok(date, "the fixture has a date where a rider's rating moved");
  const view = buildTodayView(fx.receipts, date!, withAbilities)!;
  const moved = view.riders.filter(r => r.rating);
  assert.ok(moved.length < view.riders.filter(r => r.points > 0).length, "a point does not always move the rating; then nothing shows");
  for (const r of moved) assert.notEqual(r.rating!.from, r.rating!.to);
  const html = wrap(createElement(XpToday, { view, onPickDate: () => {}, switcher: null }));
  assert.equal(html.split('data-testid="xp-rating"').length - 1, moved.length, "one cell per moved rider, none for the rest");
  // Owner 20/11: its own column after Form and Fatigue, never inline under the name.
  assert.match(html, /data-testid="xp-head"[\s\S]*?>Fatigue<\/span><span class="hidden text-right lg:block">header\.overall<\/span>/);
  for (const row of html.split('data-testid="xp-row"').slice(1).filter(r => r.includes('data-testid="xp-rating"'))) {
    assert.ok(row.indexOf('data-testid="xp-rating"') > row.indexOf('data-testid="xp-form-plate"'), "the rating cell comes after Form, not under the name");
  }
  const { from, to } = moved[0].rating!;
  assert.match(html, new RegExp(`aria-label="${from} to ${to}"`));
  assert.doesNotMatch(noSegmentGold(html), /cz-accent/, "no gold on the rating line");
  // Without the roster's abilities nothing is shown.
  const bare = buildTodayView(fx.receipts, null, options)!;
  assert.ok(bare.riders.every(r => !r.rating));
  // The roster is the rider now: only the newest date can say it (Codex P2 on #8488).
  assert.equal(date, fx.receipts[0].tick_date);
  const older = buildTodayView(fx.receipts, fx.receipts[1].tick_date, withAbilities)!;
  assert.ok(older.riders.every(r => !r.rating), "an older date shows nothing");
});

test("#7947 the XP report shows no training score (owner 20/11)", () => {
  const view = buildTodayView(fx.receipts, null, options)!;
  const html = wrap(createElement(XpToday, { view, onPickDate: () => {}, switcher: null }));
  assert.doesNotMatch(html, new RegExp(`>${en.xpReport.sessionScore}<`), "no session score in the panel");
  assert.doesNotMatch(html, />Score \d+</, "no score under the sessions");
});

test("30 days renders one column per day and never a days-to-go estimate", () => {
  const view = buildMonthView(fx.receipts, options)!;
  const html = wrap(createElement(XpMonth, { view, onOpenDay: () => {}, switcher: null }));
  assert.equal(html.split('data-testid="xp-month-row"').length - 1, view.riders.length);
  assert.equal((html.match(/aria-label="Open /g) ?? []).length, view.days.length);
  assert.doesNotMatch(noSegmentGold(html), /cz-accent/);
  assert.doesNotMatch(html, /days to|days left|dage til/i);
  assert.equal(html.split('data-testid="xp-name-cell"').length - 1, view.riders.length);
  assert.match(html, />Paid out from the bar</);
  assert.doesNotMatch(html, /\u2192|\u2014|\u2013/u, "no typed arrow or long dash");
  assert.doesNotMatch(html, /\{[a-z]+\}|\{\{/i, "ICU placeholders are filled");
});

test("the trainingXp keys exist in every language, without em-dash", () => {
  const entries = (o: Record<string, unknown>, p = ""): Array<[string, string]> => Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === "object" ? entries(v as Record<string, unknown>, `${p}${k}.`) : [[`${p}${k}`, String(v)]]);
  const want = entries(en).map(([k]) => k).sort();
  for (const lang of LANGS) {
    const got = entries(locale(lang, "trainingXp"));
    assert.deepEqual(got.map(([k]) => k).sort(), want, lang);
    for (const [key, text] of got) assert.doesNotMatch(text, /[\u2014\u2013\u2192]/u, `${lang} ${key}: no long dash or typed arrow`);
  }
});

test("the surface waits for its lazy namespace behind the skeleton", () => {
  const src = readFileSync(new URL("./TrainingReportXp.tsx", import.meta.url), "utf8");
  assert.match(src, /const \{ t, ready \} = useTranslation\("trainingXp"\)/);
  assert.match(src, /if \(!ready\) return <Section[^>]*><SkeletonLines/);
  const guard = readFileSync(new URL("../../../../../scripts/i18n-check-namespace-inline.mjs", import.meta.url), "utf8");
  assert.match(guard, /"trainingXp", \/\/ #7627/);
});

test("the switch: off by default, preview only on the preview build with ?xpreport=on", () => {
  assert.equal(previewXpReport(false, "?xpreport=on"), false);
  assert.equal(previewXpReport(true, "?xpreport=off"), false);
  assert.equal(previewXpReport(true, "?xpreport=on"), true);
  assert.equal(xpReportMode({ preview: false, flagOn: false, runs: fx.receipts as never }), "off");
  // #8562: with the switch on and no receipts at all, the XP surface shows the loading, empty or error state.
  assert.equal(xpReportMode({ preview: false, flagOn: true, runs: [] }), "live");
  assert.equal(xpReportMode({ preview: false, flagOn: false, runs: [] }), "off", "switch off keeps today's report, also when empty");
  const withoutXp = fx.receipts.map(r => ({ ...r, report: { ...r.report, riders: r.report.riders.map(row => ({ ...row, activities: row.activities?.map(a => ({ ...a, xp: undefined })) })) } }));
  assert.equal(xpReportMode({ preview: false, flagOn: true, runs: withoutXp as never }), "off", "switch on with receipts but without XP keeps today's report");
  assert.equal(xpReportMode({ preview: false, flagOn: true, runs: fx.receipts as never }), "live");
  assert.equal(xpReportMode({ preview: true, flagOn: false, runs: [] }), "fixture");
});

test("#8562 the preview's report states: ?xpreport=on, empty and error", () => {
  assert.equal(previewXpReportState("?xpreport=on"), "data");
  assert.equal(previewXpReportState("?xpreport=empty"), "empty");
  assert.equal(previewXpReportState("?xpreport=error"), "error");
  assert.equal(previewXpReportState("?xpreport=nonsense"), null);
  assert.equal(previewXpReport(true, "?xpreport=empty"), true);
  assert.equal(previewXpReport(false, "?xpreport=empty"), false);
});

test("#8562 Show older days widens the seven-day strip to the whole window, and Show fewer days is its way back", () => {
  const days = new Set(fx.receipts.map(r => r.tick_date)).size;
  assert.ok(days > 7, "the fixture has more than seven dates");
  const narrow = buildTodayView(fx.receipts, null, options)!;
  assert.equal(narrow.strip.length, 7);
  assert.equal(narrow.olderDays, days - 7, "the dates before the strip");
  const wide = buildTodayView(fx.receipts, null, options, true)!;
  assert.equal(wide.strip.length, Math.min(days, 30));
  assert.equal(wide.olderDays, 0);
  const html = (view: typeof narrow, showAll: boolean) => wrap(createElement(XpToday, { view, onPickDate: () => {}, switcher: null, showAll, onToggleDays: () => {} }));
  const closed = html(narrow, false);
  assert.match(closed, /data-testid="xp-older-days"[^>]*aria-expanded="false"|aria-expanded="false"[^>]*data-testid="xp-older-days"/);
  assert.match(closed, />Show older days</);
  assert.match(closed, /aria-label="Last seven days"/);
  const open = html(wide, true);
  assert.match(open, />Show fewer days</);
  assert.match(open, /aria-label="All days"/);
  assert.equal(open.split("aria-pressed=").length - 1 > closed.split("aria-pressed=").length - 1, true, "more days in the strip");
  // No button without something older, and none without a handler.
  const few = buildTodayView(fx.receipts.slice(0, 3), null, options)!;
  assert.doesNotMatch(html(few, false), /xp-older-days/);
  assert.doesNotMatch(wrap(createElement(XpToday, { view: narrow, onPickDate: () => {}, switcher: null })), /xp-older-days/);
  assert.doesNotMatch(noSegmentGold(closed + open), /cz-accent/, "the button is secondary, never gold");
});

test("#8562 the report's empty state: the kit's EmptyState with one sentence and one way on", () => {
  const html = wrap(createElement(TrainingReportXp, { runs: [], roster: [] }));
  assert.match(html, /data-testid="training-report-xp-state"/);
  assert.match(html, />No training yet this season\.</);
  assert.match(html, /border-dashed/, "the kit's dashed state frame");
  assert.match(html, />Go to today&#x27;s training<|>Go to today's training</);
  assert.doesNotMatch(html, /role="alert"/);
  assert.doesNotMatch(html, /xpReport\./, "every key has an English text");
  assert.doesNotMatch(noSegmentGold(html), /cz-accent/);
});

test("#8562 the report's error state: the kit's ErrorState with Try again, and no empty text", () => {
  let tries = 0;
  const html = wrap(createElement(TrainingReportXp, { runs: [], roster: [], error: true, onRetry: () => { tries += 1; } }));
  assert.match(html, /role="alert"/);
  assert.match(html, />The report could not be loaded</);
  assert.match(html, />Try again</);
  assert.doesNotMatch(html, /No training yet this season/, "a failed fetch is never shown as an empty season");
  assert.equal(tries, 0);
  assert.doesNotMatch(noSegmentGold(html), /cz-accent/);
  // Still loading: the skeleton, neither of the two.
  const loading = wrap(createElement(TrainingReportXp, { runs: [], roster: [], loading: true }));
  assert.match(loading, /data-testid="training-report-xp-state"/);
  assert.doesNotMatch(loading, /No training yet|could not be loaded/);
  // The preview's states carry the same markup.
  assert.match(wrap(createElement(TrainingReportXp, { runs: [], fixture: true, fixtureState: "error" })), /role="alert"/);
  assert.match(wrap(createElement(TrainingReportXp, { runs: [], fixture: true, fixtureState: "empty" })), />No training yet this season\.</);
});

test("#8562 the new texts exist in Danish as the owner worded them", () => {
  const da = locale("da", "trainingXp");
  assert.equal(da.xpReport.empty, "Ingen træning endnu i denne sæson.");
  assert.equal(da.xpReport.loadError, "Rapporten kunne ikke hentes");
  assert.equal(da.xpReport.retry, "Prøv igen");
  assert.equal(da.xpReport.showOlderDays, "Vis ældre dage");
  assert.equal(da.devFocus.change, "Skift fokus");
});

test("phones use the owner's short name form (18/9)", () => {
  assert.equal(shortName("Iker Zubeldia Arregi"), "I. Zubeldia Arregi");
  assert.equal(shortName("Aksel Brandvig"), "A. Brandvig");
  assert.equal(shortName("Mononym"), "Mononym");
  // The full name stays the link's accessible name when the short form shows (#5383).
  assert.deepEqual(nameParts("Iker Zubeldia Arregi"), { firstname: "Iker", lastname: "Zubeldia Arregi" });
});
