// #8388 · Taktik på en kørt etape respekterer spoiler-skjoldet (#7859).
// Skjult etape: kun skjoldets egen tekst og knap, ingen placering, tider, km-skift
// eller "sat". Slukket skjold eller en vist etape: sammenligningen som før.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { transformSync } from "rolldown/utils";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { tacticsAfterView } from "./racePageV6Model.ts";

// Hentningerne (optegnelse, ordrer, spillerkontakter) og kit-primitiverne står uden for spillet:
// de er netværk, supabase og en Vite-mappeimport. Sektionen og skeletten tegnes simpelt.
const STUB_PREFIX = "cz-stub:";
(globalThis as Record<string, unknown>).__czH = createElement; // stubbene har ingen egne importer
const h = "const h = globalThis.__czH;";
const icon = "() => null";
const STUBS: Array<{ name: string; match: RegExp; source: string }> = [
  { name: "timeline", match: /\/useStageTimeline(\.[jt]s)?$/, source: "export const useStageTimeline = () => ({ timeline: null, loading: true, error: false });" },
  { name: "orders", match: /\/tacticsOrdersAdapter(\.[jt]s)?$/, source: "export const fetchTeamOrders = () => new Promise(() => {});" },
  { name: "flags", match: /\/playerFeatureFlags(\.[jt]s)?$/, source: "export const fetchPlayerFeatureFlags = () => new Promise(() => {});" },
  { name: "kit", match: /\/ui\/index\.js$/, source: `export const CheckIcon = ${icon}, InfoIcon = ${icon}, MinusIcon = ${icon}, XIcon = ${icon};` },
  { name: "v2ui", match: /\/stagePageV2\/ui\.ts$/, source: `${h} export const Section = (p) => h("section", null, p.children); export const SectionHeader = (p) => h("header", null, p.title, p.meta); export const SkeletonLines = () => h("div", { "data-skeleton": "" }); export const RiderLink = (p) => h("a", null, p.children);` },
];
const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    const stub = STUBS.find((s) => s.match.test(specifier));
    if (stub) return { url: `${STUB_PREFIX}${stub.name}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(STUB_PREFIX)) return { format: "module", shortCircuit: true, source: STUBS.find((s) => s.name === url.slice(STUB_PREFIX.length))!.source };
    if (url.startsWith("file:") && /\.(tsx|jsx)$/.test(url)) return {
      format: "module", shortCircuit: true,
      source: transformSync(new URL(url).pathname, readFileSync(new URL(url), "utf8"), {
        lang: url.endsWith(".tsx") ? "tsx" : "jsx", jsx: { runtime: "automatic" }, define: { "import.meta.env.DEV": "false" },
      }).code,
    };
    return nextLoad(url, context);
  },
});
const { default: V6TacticsAfter } = await import("./V6TacticsAfter.tsx");
loader.deregister();

const i18n = createInstance();
await i18n.init({ lng: "en", initAsync: false, fallbackLng: false, resources: { en: { races: {
  racePageV6: { tacticsAfter: { title: "Plan against the race", metaStage: "Stage {{number}}", metaRace: "Race", intro: "Your plan against what happened." } },
} } } });

const baseProps = {
  raceId: "race-a", stageNumber: 2, isStageRace: true, myTeamId: "team-a", stageRoles: null, profile: null,
  // En egen rytter der vandt etapen: ville afsløre en placering, hvis den blev tegnet.
  results: [{ rider_id: "rider-a", team_id: "team-a", result_type: "stage", stage_number: 2, rank: 1 }],
};
const render = (extra: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(I18nextProvider, { i18n },
  createElement(V6TacticsAfter, { ...baseProps, ...extra } as never)));
const SLOT_TEXT = "Results are hidden by your spoiler shield";
const slot = createElement("div", { "data-spoiler-section": "results-hidden" }, SLOT_TEXT);

test("#8388: skjult etape = kun skjoldets pladsholder, ingen sammenligning", () => {
  const html = render({ spoilerSlot: slot });
  assert.match(html, /data-race-section="tactics_after"/, "sektionen står, så siden ikke hopper");
  assert.ok(html.includes(SLOT_TEXT), "skjoldets tekst og knap tegnes");
  assert.doesNotMatch(html, /data-plan-rider|data-step-mark/, "ingen rytterkort eller trin");
  assert.doesNotMatch(html, /Your plan against what happened/, "ingen intro til en sammenligning");
});

test("#8388: en hentefejl afslører heller ikke noget, mens etapen er skjult", () => {
  const html = render({ spoilerSlot: slot, resultsState: "failed", resultsErrorSlot: createElement("p", null, "ERROR-SLOT") });
  assert.ok(html.includes(SLOT_TEXT));
  assert.ok(!html.includes("ERROR-SLOT"));
});

test("#8388: slukket skjold eller vist etape (ingen pladsholder) = som før", () => {
  const html = render({ resultsState: "loading" });
  assert.match(html, /data-race-section="tactics_after"/);
  assert.ok(!html.includes(SLOT_TEXT));
  assert.equal(render({ resultsState: "loading", spoilerSlot: null }), html, "null er det samme som uden prop");
  const failed = render({ resultsState: "failed", resultsErrorSlot: createElement("p", null, "ERROR-SLOT") });
  assert.ok(failed.includes("ERROR-SLOT"), "uden skjold vises fejlen som før");
});

test("#8388: modellen vælger pladsholder før hentetilstanden, men efter enkeltstart", () => {
  const base = { timeTrial: false, resultsState: "loaded" as const, timelineLoading: false, timelineMissing: false, ordersPending: false, ordersMissing: false, riderCount: 3 };
  assert.equal(tacticsAfterView({ ...base, spoilerHidden: true }), "spoiler");
  assert.equal(tacticsAfterView({ ...base, spoilerHidden: true, resultsState: "failed" }), "spoiler");
  assert.equal(tacticsAfterView({ ...base, spoilerHidden: true, resultsState: "loading", timelineLoading: true }), "spoiler");
  assert.equal(tacticsAfterView({ ...base, spoilerHidden: true, timeTrial: true }), "hidden");
  assert.equal(tacticsAfterView({ ...base, spoilerHidden: false }), "compare");
  assert.equal(tacticsAfterView(base), "compare", "uden parameteren som før");
});

test("#8388: siden giver skjoldets pladsholder for Taktik-etapen videre med én prop", () => {
  const page = readFileSync(new URL("./RacePageV6.tsx", import.meta.url), "utf8");
  assert.match(page, /spoilerSlot=\{spoiler\.hiddenSlotFor\(tacticsStage\)\}/);
  const hook = readFileSync(new URL("../../spoiler/useRacePageSpoiler.tsx", import.meta.url), "utf8");
  assert.match(hook, /if \(!hidden\(stage\)\) return null;/, "kun en skjult etape får en pladsholder");
});
