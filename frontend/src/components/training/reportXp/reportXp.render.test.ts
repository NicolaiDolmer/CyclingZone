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
const { xpReportMode, previewXpReport } = await import("./XpReportSwitch.tsx");
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

test("#7947 a folded rider shows 'Rating x > y' only when his rating moved", () => {
  const withAbilities = { ...options, abilities: fx.abilities };
  // The first fixture date (newest first) where some rider's rating moved.
  const date = fx.receipts.map(r => r.tick_date).find(d => buildTodayView(fx.receipts, d, withAbilities)!.riders.some(r => r.rating));
  assert.ok(date, "the fixture has a date where a rider's rating moved");
  const view = buildTodayView(fx.receipts, date!, withAbilities)!;
  const moved = view.riders.filter(r => r.rating);
  assert.ok(moved.length < view.riders.filter(r => r.points > 0).length, "a point does not always move the rating; then nothing shows");
  for (const r of moved) assert.notEqual(r.rating!.from, r.rating!.to);
  const html = wrap(createElement(XpToday, { view, onPickDate: () => {}, switcher: null }));
  assert.equal(html.split('data-testid="xp-rating"').length - 1, moved.length, "one line per moved rider, none for the rest");
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
  assert.equal(xpReportMode({ preview: false, flagOn: true, runs: [] }), "off", "switch on without XP in the payload keeps today's report");
  assert.equal(xpReportMode({ preview: false, flagOn: true, runs: fx.receipts as never }), "live");
  assert.equal(xpReportMode({ preview: true, flagOn: false, runs: [] }), "fixture");
});

test("phones use the owner's short name form (18/9)", () => {
  assert.equal(shortName("Iker Zubeldia Arregi"), "I. Zubeldia Arregi");
  assert.equal(shortName("Aksel Brandvig"), "A. Brandvig");
  assert.equal(shortName("Mononym"), "Mononym");
  // The full name stays the link's accessible name when the short form shows (#5383).
  assert.deepEqual(nameParts("Iker Zubeldia Arregi"), { firstname: "Iker", lastname: "Zubeldia Arregi" });
});
