// #8045 · Angrebets forløb i løbsfilmens referat: tekster i alle fem sprog, navnelister,
// afstand i fulde ord og en tegnet linje (samme harness som V6TacticsAfter.spoiler.test.ts:
// node --test uden jsdom, tsx oversat med rolldown, netværket stubbet).
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

const STUB_PREFIX = "cz-stub:";
const STUBS: Array<{ name: string; match: RegExp; source: string }> = [
  { name: "flags", match: /\/playerFeatureFlags(\.[jt]s)?$/, source: "export const fetchPlayerFeatureFlags = () => new Promise(() => {});" },
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
const mod = await import("./AttackStory8045.tsx");
loader.deregister();
const { default: AttackStoryReportLine, attackStoryCopyKey, attackStoryFilmLines, attackStoryText, gapWords, riderNames, reportLinesWithAttackStory } = mod;

const LANGS = ["en", "da", "fr", "es", "nl"] as const;
const locale = (lng: string, ns: string) => JSON.parse(readFileSync(new URL(`../../../public/locales/${lng}/${ns}.json`, import.meta.url), "utf8"));

async function i18nFor(lng: string) {
  const i18n = createInstance();
  await i18n.use(ICU).init({
    lng, initAsync: false, fallbackLng: false, interpolation: { escapeValue: false },
    resources: { [lng]: { races: locale(lng, "races"), raceFilm: locale(lng, "raceFilm") } },
  });
  return i18n;
}

const PHASES: Array<Record<string, unknown>> = [
  { phase: "started" }, { phase: "away" }, { phase: "bridged" }, { phase: "caught" },
  ...["first", "growing", "shrinking", "steady"].map((trend) => ({ phase: "checkpoint", trend: trend === "first" ? null : trend })),
  ...["cracked", "out_of_strength", "outpaced"].map((cause) => ({ phase: "dropped", cause })),
  ...["top", "finish"].flatMap((at) => [{ phase: "held", at }, { phase: "level", at }]),
];
const GROUPS = ["peloton", "breakaway", "group", "chasers"];

test("#8045: hver tekstnøgle findes i alle fem sprog, for én og for flere ryttere", async () => {
  for (const lng of LANGS) {
    const i18n = await i18nFor(lng);
    for (const p of PHASES) {
      for (const ids of [["a"], ["a", "b"]]) {
        const key = attackStoryCopyKey({ phase: p.phase, cause: p.cause ?? null, at: p.at ?? null, trend: p.trend ?? null, rider_ids: ids } as never);
        assert.ok(i18n.exists(key), `${lng}: ${key}`);
        const text = i18n.t(key, { rider: "Lozano", riders: "Lozano og Brivio", climb: "Côte", group: "X", gap: "45" });
        assert.doesNotMatch(text, /\{|\}/, `${lng}: ${key} er udfyldt`);
      }
    }
    for (const g of GROUPS) for (const n of ["one", "many"]) assert.ok(i18n.exists(`raceFilm:attackStory.group.${g}.${n}`), `${lng}: gruppe ${g}.${n}`);
    for (const k of ["second", "seconds", "minute", "minutes", "join"]) assert.ok(i18n.exists(`raceFilm:attackStory.gap.${k}`), `${lng}: gap.${k}`);
  }
});

test("#8045: afstand i fulde ord, aldrig forkortet", async () => {
  const en = (await i18nFor("en")).getFixedT("en");
  const da = (await i18nFor("da")).getFixedT("da");
  assert.equal(gapWords(1, en), "1 second");
  assert.equal(gapWords(48, en), "48 seconds");
  assert.equal(gapWords(60, en), "1 minute");
  assert.equal(gapWords(724, en), "12 minutes 4 seconds");
  assert.equal(gapWords(61, da), "1 minut og 1 sekund");
  assert.equal(gapWords(705, da), "11 minutter og 45 sekunder");
});

const cast = {
  nameOf: (id: string) => ({ a: "Whitfield", b: "Ramírez", c: "Pereira", d: "Roussel", e: "Lozano", m: "Maes" } as Record<string, string>)[id] ?? null,
  rankOf: (id: string) => ({ a: 1, b: 2, c: 3, d: 4, e: 5, m: 14 } as Record<string, number>)[id] ?? null,
  mine: new Set(["m"]),
};

test("#8045: navnelisten har egne ryttere først, ellers bedst placerede, og tæller resten", async () => {
  const da = (await i18nFor("da")).getFixedT("da");
  assert.equal(riderNames(["b", "a"], cast, da), "Whitfield og Ramírez");
  assert.equal(riderNames(["c", "b", "a"], cast, da), "Whitfield, Ramírez og Pereira");
  assert.equal(riderNames(["e", "d", "c", "b", "a", "m"], cast, da), "Maes, Whitfield, Ramírez og 3 andre");
  assert.equal(riderNames(["x"], cast, da), "En rytter");
});

test("#8045: en tegnet linje har km, løbstid, hele sætningen og ingen små versaler", async () => {
  const i18n = await i18nFor("da");
  const line = {
    id: "x", kind: "attackStory", phase: "held", km: 180, kmTo: null, span: false, time: 19064.81, rider_ids: ["a"], mineIds: ["a"],
    climb_name: "Alto de Covadonga", group: "peloton", cause: null, at: "finish", gap_seconds: 724, trend: null,
  } as const;
  const html = renderToStaticMarkup(createElement(I18nextProvider, { i18n },
    createElement(AttackStoryReportLine, { line: line as never, current: true, cast, kmLabel: "km 180", onJump: () => {} })));
  assert.match(html, /data-film-line="attack-story-held"/);
  assert.match(html, /km 180/);
  assert.match(html, /5:17:45/);
  assert.match(html, /Whitfield holder hele vejen til mål, 12 minutter og 4 sekunder foran feltet!/);
  assert.match(html, /aria-current="step"/);
  assert.doesNotMatch(html, /uppercase|tracking-\[/, "TASTE: ingen små versaler");
  assert.equal(attackStoryText(line as never, cast, i18n.getFixedT("da")), "Whitfield holder hele vejen til mål, 12 minutter og 4 sekunder foran feltet!");
});

test("#8045: filmens linjer fra en afviklet etape, flettet ind i referatet efter km", () => {
  const fx = JSON.parse(readFileSync(new URL("../../../../backend/lib/raceAttackStory8045.fixture.json", import.meta.url), "utf8"))["summit-shattered-field"];
  const lines = attackStoryFilmLines(fx.events, { timelineVersion: fx.timeline_version, climbs: fx.climbs, distanceKm: fx.distance_km, mine: new Set(["r34"]) });
  assert.ok(lines.length > 0);
  assert.ok(lines.some((l) => l.phase === "held" && l.mineIds.includes("r34")));
  const story = [{ kind: "formed", km: 12 }, { kind: "finish", km: 180 }];
  const merged = reportLinesWithAttackStory(story, lines);
  assert.equal(merged[0].kind, "formed");
  assert.equal(merged.at(-1)!.kind, "finish", "målet står sidst på samme km");
  for (let i = 1; i < merged.length; i += 1) assert.ok(merged[i].km >= merged[i - 1].km);
  assert.deepEqual(attackStoryFilmLines(fx.events, { timelineVersion: 1, climbs: fx.climbs }), []);
});
