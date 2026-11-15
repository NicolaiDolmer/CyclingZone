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

const loader = registerHooks({ load(url, context, nextLoad) {
  if (url.startsWith("file:") && /\.(tsx|jsx)$/.test(url)) return {
    format: "module", shortCircuit: true,
    source: transformSync(new URL(url).pathname, readFileSync(new URL(url), "utf8"), {
      lang: url.endsWith(".tsx") ? "tsx" : "jsx", jsx: { runtime: "automatic" }, define: { "import.meta.env.DEV": "false" },
    }).code,
  };
  return nextLoad(url, context);
} });
const { default: DailyTrainingReceipt } = await import("../DailyTrainingReceipt.tsx");
const { default: RaceSourceTable } = await import("./RaceSourceTable.tsx");
const { raceSourceBreakdown } = await import("./raceContributionModel.ts");
loader.deregister();

const en = JSON.parse(readFileSync(new URL("../../../../public/locales/en/training.json", import.meta.url), "utf8"));
const i18n = createInstance();
await i18n.use(ICU).init({ lng: "en", initAsync: false, resources: { en: { training: en, rider: {} } }, fallbackLng: false });

// #7627: invented riders, no game balance.
type Slot = Record<string, unknown>;
const slot = (day: number, race: boolean, before: Record<string, number>, after: Record<string, number>, gains: Record<string, number> = {}): Slot => ({
  rider_id: "x", game_day: day, race_day: race, intensity: race ? null : "normal", focus: race ? null : "climbing",
  progress_before: before, progress_after: after, gains,
});
const rider = (rider_id: string, name: string, activities: Slot[], gains: Record<string, number> = {}) => ({
  rider_id, name, activities, receipt_status: "complete", gains, gains_detail: {}, gain_percent: {},
  fatigue_before: 10, fatigue: 12, form_before: 50, form: 51, progress_before: {}, trained_now: null,
});
const run = (riders: unknown[]) => ({
  tick_date: "2026-11-14", receipt_status: "complete", game_days: [0, 1, 2], expected_game_days: [0, 1, 2],
  trained_now_slots: [], report: { riders, condition_settled: true },
});
const render = (r: unknown) =>
  renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(DailyTrainingReceipt, { run: r as never })));
// The rider fold-out is client state, so the table is rendered on its own.
const table = (r: ReturnType<typeof rider>) => renderToStaticMarkup(createElement(I18nextProvider, { i18n },
  createElement(RaceSourceTable, { breakdown: raceSourceBreakdown(r.activities as never, r)!, abilityName: (key: string) => key,
    wholeChange: () => createElement("span", { "aria-label": "71 to 72" }, "71 > 72") })));

const raced = rider("a", "Rider A", [
  slot(0, false, { climbing: 0.6 }, { climbing: 0.9 }),
  slot(1, true, { climbing: 0.9 }, { climbing: 0.1 }, { climbing: 1 }),
  slot(2, true, { climbing: 0.1, punch: 0 }, { climbing: 0.1, punch: 0.26 }),
], { climbing: 1 });
const trainedOnly = rider("c", "Rider C", [
  slot(0, false, { recovery: 0.3 }, { recovery: 0.42 }),
  slot(1, false, { recovery: 0.42 }, { recovery: 0.53 }),
]);

test("#7627 a rider who raced gets training, race and total per ability, and +1 whole where a point landed", () => {
  const html = table(raced);
  assert.match(html, /Where the progress came from/);
  assert.match(html, />Training<\/span><span class="text-right">Race<\/span><span class="text-right">Total</);
  const rows = html.split('data-testid="daily-receipt-race-source-row"').slice(1);
  assert.equal(rows.length, 2);
  assert.match(rows[0], /data-ability="climbing"/);
  assert.match(rows[0], /\+1 whole/);
  assert.match(rows[0], /aria-label="71 to 72"/);
  assert.match(rows[0], /aria-label="Training \+30%, race \+20%"/);
  assert.match(rows[0], />\+50%</);
  assert.match(rows[1], /data-ability="punch"/);
  assert.match(rows[1], />0<.*>\+26%<.*>\+26%</);
  assert.match(html, /Race progress is already part of the day&#x27;s total/);
});

test("#7627 a rider without a race shows training only, with no empty race column", () => {
  const html = table(trainedOnly);
  assert.doesNotMatch(html, />Race</);
  assert.doesNotMatch(html, />Total</);
  assert.doesNotMatch(html, /daily-receipt-race-source-key/);
  assert.doesNotMatch(html, /Race progress is already/);
  assert.match(html, />Training</);
  assert.match(html, />\+23%</);
});

test("#7627 the day strip says how much of the squad's progress came from races", () => {
  const html = render(run([raced, trainedOnly]));
  assert.match(html, /data-testid="daily-receipt-race-share"/);
  // race 0.2 + 0.26 of 0.3 + 0.46 + 0.23
  assert.match(html, /Races gave 46% of the squad&#x27;s progress on this date/);
});

test("#7627 no race on the date: no day strip", () => {
  const html = render(run([trainedOnly]));
  assert.doesNotMatch(html, /daily-receipt-race-share/);
});

test("#7627 the receipt never speaks of a bonus or a penalty", () => {
  const html = render(run([raced, trainedOnly])) + table(raced) + table(trainedOnly);
  assert.doesNotMatch(html, /bonus|penalt/i);
  for (const lang of ["en", "da", "es", "fr", "nl"]) {
    const block = JSON.parse(readFileSync(new URL(`../../../../public/locales/${lang}/training.json`, import.meta.url), "utf8")).raceSource;
    const text = JSON.stringify(block);
    assert.doesNotMatch(text, /bonus|penalt|straf|castigo|pénalit|penalis|strafpunt/i, lang);
    assert.doesNotMatch(text, /—|–/, `${lang}: no dashes`);
  }
});

test("#7627 every new string parses through ICU in all five languages", async () => {
  const langs = ["en", "da", "es", "fr", "nl"];
  const resources = Object.fromEntries(langs.map(lang => [lang, { training:
    JSON.parse(readFileSync(new URL(`../../../../public/locales/${lang}/training.json`, import.meta.url), "utf8")) }]));
  const icu = createInstance();
  await icu.use(ICU).init({ lng: "en", initAsync: false, resources, fallbackLng: false });
  const keys = Object.keys(resources.en.training.raceSource);
  for (const lang of langs) {
    assert.deepEqual(Object.keys(resources[lang].training.raceSource), keys, `${lang}: same keys`);
    for (const key of keys) {
      const out = icu.getFixedT(lang, "training")(`raceSource.${key}`, { count: 1, percent: "47", training: "53", race: "47" });
      assert.doesNotMatch(out, /[{}]/, `${lang}.${key}`);
      assert.notEqual(out, `raceSource.${key}`, `${lang}.${key} missing`);
    }
  }
});
