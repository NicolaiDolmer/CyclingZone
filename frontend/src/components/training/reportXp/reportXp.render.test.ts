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
    for (const ext of [".js", ".ts", ".jsx", ".tsx"]) {
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
const { default: XpToday } = await import("./XpToday.tsx");
const { default: XpMonth } = await import("./XpMonth.tsx");
const { xpReportMode, previewXpReport } = await import("./XpReportSwitch.tsx");
loader.deregister();
const { buildXpReportFixture } = await import("./xpReportFixture.ts");
const { buildMonthView, buildTodayView } = await import("../../../lib/trainingReportXp.ts");

const locale = (lang: string, ns: string) => JSON.parse(readFileSync(new URL(`../../../../public/locales/${lang}/${ns}.json`, import.meta.url), "utf8"));
const LANGS = ["en", "da", "es", "fr", "nl"];
const en = locale("en", "trainingXp");
const i18n = createInstance();
await i18n.use(ICU).init({ lng: "en", initAsync: false, resources: { en: { trainingXp: en, training: locale("en", "training"), rider: {} } }, fallbackLng: false });

const noSegmentGold = (html: string) => html.replaceAll("cursor-default bg-cz-accent/10 text-cz-accent-t", "");
const fx = buildXpReportFixture();
const options = { nations: fx.nations };
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
  assert.match(html, /\+1 point|\+\d+ points/, "ICU plural renders");
  assert.equal(html.split('aria-pressed="true"').length - 1, 2, "the picked day and the active filter");
});

test("30 days renders one column per day and never a days-to-go estimate", () => {
  const view = buildMonthView(fx.receipts, options)!;
  const html = wrap(createElement(XpMonth, { view, onOpenDay: () => {}, switcher: null }));
  assert.equal(html.split('data-testid="xp-month-row"').length - 1, view.riders.length);
  assert.equal((html.match(/aria-label="Open /g) ?? []).length, view.days.length);
  assert.doesNotMatch(noSegmentGold(html), /cz-accent/);
  assert.doesNotMatch(html, /days to|days left|dage til/i);
  assert.doesNotMatch(html, /\{[a-z]+\}|\{\{/i, "ICU placeholders are filled");
});

test("the trainingXp keys exist in every language, without em-dash", () => {
  const entries = (o: Record<string, unknown>, p = ""): Array<[string, string]> => Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === "object" ? entries(v as Record<string, unknown>, `${p}${k}.`) : [[`${p}${k}`, String(v)]]);
  const want = entries(en).map(([k]) => k).sort();
  for (const lang of LANGS) {
    const got = entries(locale(lang, "trainingXp"));
    assert.deepEqual(got.map(([k]) => k).sort(), want, lang);
    for (const [key, text] of got) assert.doesNotMatch(text, /—/, `${lang} ${key}: no em-dash`);
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
