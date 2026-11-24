// #7947 (ejer 23/11) · I dag R5 tegnet: een linje pr. rytter. Navnecellen er kun flag + navn,
// status staar fuldt skrevet i sin egen kolonne, traening og indsats har hver sin kolonne
// (Hvile · Let · Mellem · Haard), "Din dag ..."" er en hover/fokus-linje, menuen staar yderst,
// og assistentens dom er tilbage i raekken. Telefonen faar et kort med etiketter.
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
  if (/^\.\.?\//.test(specifier) && !/\.[a-z]+$/i.test(specifier)) {
    for (const ext of [".js", ".ts", ".jsx", ".tsx", "/index.js", "/index.ts", "/index.jsx", "/index.tsx"]) {
      try { return nextResolve(specifier + ext, context); } catch { /* try the next extension */ }
    }
  }
  // Vite also maps a ".js" import onto its ".ts"/".jsx"/".tsx" source (lib/supabase.js -> supabase.ts).
  if (/^\.\.?\//.test(specifier) && /\.js$/.test(specifier)) {
    try { return nextResolve(specifier, context); } catch {
      for (const ext of [".ts", ".jsx", ".tsx"]) {
        try { return nextResolve(specifier.replace(/\.js$/, ext), context); } catch { /* try the next extension */ }
      }
    }
  }
  return nextResolve(specifier, context);
}, load(url, context, nextLoad) {
  if (url.startsWith("file:") || url.includes("node_modules")) {
    if (/\.css(\?.*)?$/.test(url)) return { format: "module", shortCircuit: true, source: "export default {};" };
  }
  if (url.startsWith("file:") && !url.includes("node_modules") && /\.(tsx|jsx|ts|js)$/.test(url) && url.includes("/frontend/src/")) {
    const lang = (url.match(/\.(tsx|jsx|ts|js)$/)![1]) as "tsx" | "jsx" | "ts" | "js";
    const source = readFileSync(new URL(url), "utf8").replaceAll("import.meta.env", ENV);
    return { format: "module", shortCircuit: true,
      source: transformSync(new URL(url).pathname, source, { lang, jsx: { runtime: "automatic" } }).code };
  }
  return nextLoad(url, context);
} });
const { default: TodayR5 } = await import("./TodayR5.tsx");
loader.deregister();

const locale = (lang: string, ns: string) => JSON.parse(readFileSync(new URL(`../../../../public/locales/${lang}/${ns}.json`, import.meta.url), "utf8"));
async function i18nFor(lng: string) {
  const i18n = createInstance();
  await i18n.use(ICU).init({
    lng, initAsync: false, fallbackLng: false,
    resources: { [lng]: { training: locale(lng, "training"), trainingR5: locale(lng, "trainingR5"), riderTypes: locale(lng, "riderTypes"), rider: locale(lng, "rider") } },
  });
  return i18n;
}

const today = new Date("2026-11-23T10:00:00Z");
const riders = [
  { id: "a", firstname: "Ada", lastname: "Pedersen", nationality_code: "dk", birthdate: "2002-01-01", primary_type: "sprinter", secondary_type: "rouleur", squad: "u23" },
  { id: "b", firstname: "Pieter", lastname: "Claes", nationality_code: "be", birthdate: "1997-01-01", primary_type: "cobbles", secondary_type: "rouleur" },
  { id: "c", firstname: "Marco", lastname: "Bellini", nationality_code: "it", birthdate: "1999-01-01", primary_type: "puncheur", secondary_type: null },
];
function props(over: Record<string, unknown> = {}) {
  return {
    riders, loading: false, phone: false, seasonYear: 2026, activeSeasonNumber: 3, today, todayWeekday: "mon",
    condition: { a: { form: 60, fatigue: 30, risk: 0.01 }, b: { form: 58, fatigue: 74, risk: 0.2 }, c: { form: 66, fatigue: 34, risk: 0 } },
    planFor: (id: string) => (id === "a" ? { focus: "sprint", intensity: "hard" } : null),
    settledToday: null, settledGameDays: null, riderWeekPlans: {}, racingToday: { c: { race: "Ronde van Preview" } },
    forecast: null, programAssigned: {}, programCatalog: [], groups: [], fatigueDays70: { b: 2 },
    smartDefaultFocus: { a: "sprint", b: "cobbled_sectors" }, trainedToday: false, savingId: null, bulkApplying: false,
    justSaved: new Set<string>(), planError: null, runError: null, decisionRows: [], fatigueRules: null, assistantPanel: null,
    bulkMessage: null, effortLevels: false,
    onPlan: async () => true, onBulk: async () => true, onPickSession: () => {}, onReset: async () => null, onClearPlan: async () => true,
    onOpenPlan: () => {}, onOpenPrograms: () => {}, onEditFatigueRule: () => {}, onOpenAssistant: () => {}, renderCard: () => null,
    ...over,
  };
}
const render = async (lng: string, over: Record<string, unknown> = {}) => {
  const i18n = await i18nFor(lng);
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(I18nextProvider, { i18n }, createElement(TodayR5, { r5: props(over) as never }))));
};
const rowsOf = (html: string) => html.split('data-testid="r5-row"').slice(1);

test("computer: navnecellen er kun flag + navn, status staar fuldt skrevet i sin egen kolonne", async () => {
  const html = await render("da");
  const rows = rowsOf(html);
  assert.equal(rows.length, 3);
  for (const row of rows) {
    const name = row.slice(row.indexOf('data-testid="r5-name-cell"'), row.indexOf("</td>", row.indexOf('data-testid="r5-name-cell"')));
    assert.match(name, /class="fi fi-/, "flaget");
    assert.doesNotMatch(name, /r5-row-status|Høj skaderisiko|U23/, "intet andet end navnet");
  }
  assert.match(rows[0], /data-status="u23"[^>]*>U23</);
  assert.match(rows[1], /data-status="injuryRisk"[^>]*>Høj skaderisiko</);
  assert.match(rows[1], /data-status="days70"[^>]*>2 dage på 70\+</);
  assert.doesNotMatch(html, />(JR|AKAD|UDLØB|SKD)</, "andre statusmaerker forkortes ikke");
  assert.doesNotMatch(html, /\{[a-z]+\}|\{\{/i, "ICU-pladsholdere udfyldt");
});

test("computer: Traening og Indsats i hver sin kolonne; indsatsen er ordene Hvile · Let · Mellem · Haard", async () => {
  const html = await render("da");
  const head = html.slice(html.indexOf("<thead"), html.indexOf("</thead>"));
  for (const word of ["Status", "Træning", "Indsats"]) assert.match(head, new RegExp(`>${word}<`), word);
  const [first] = rowsOf(html);
  assert.equal(first.split('data-testid="r5-row-training"').length - 1, 1, "een vaelger");
  const effort = first.slice(first.indexOf('data-testid="r5-row-effort"'));
  const words = [...effort.matchAll(/aria-pressed="(?:true|false)"[^>]*>([^<]+)</g)].map((m) => m[1]).slice(0, 4);
  assert.deepEqual(words, ["Hvile", "Let", "Mellem", "Hård"]);
  assert.match(effort, /aria-pressed="true"[^>]*>Hård</, "rytterens egen dag er trykket");
  // "Din dag ..." er hverken en fast linje eller en boble oven paa naeste raekke: skjult for skaermlaeseren i raekken, synlig i den udfoldede raekke.
  const note = first.indexOf('data-testid="r5-row-note"');
  assert.ok(note > -1);
  assert.match(first.slice(Math.max(0, note - 200), note), /sr-only/);
  assert.doesNotMatch(first, /group-hover\/row:flex|top-full/, "ingen hover-boble");
  assert.match(first, /data-testid="r5-row-menu"/, "menuen yderst i raekken");
  assert.doesNotMatch(first, /Tilbage til programmet<\/button>/, "vejen tilbage bor i menuen");
});

test("assistentens dom i raekken: enig som stille ikon, forslag som eet tryk, intet paa loebsdage", async () => {
  const html = await render("da");
  const [a, b, c] = rowsOf(html);
  assert.match(a, /data-verdict="agrees"/);
  assert.match(a, /Assistenten er enig/);
  assert.match(b, /data-verdict="suggests"/);
  assert.match(b, /<button[^>]*aria-label="Assistenten foreslår [^"]+\. Tryk for at bruge det\."/);
  assert.doesNotMatch(c, /data-testid="r5-assistant"/, "loeb vinder");
  // Slukket beslutning (eller koert dag): ingen dom.
  assert.doesNotMatch(await render("da", { decisionRows: null }), /data-testid="r5-assistant"/);
});

test("telefon: kompakt kort med etiketter, ingen kolonne-overskrift, 44 px tryk", async () => {
  const html = await render("da", { phone: true });
  assert.doesNotMatch(html, /<table/, "ingen tabel paa telefonen");
  assert.match(html, /class="@container"/, "kortet bruger container query");
  const [a, b] = rowsOf(html);
  assert.match(a, /<dt[^>]*>Form<\/dt>/);
  assert.match(a, /<dt[^>]*>Træthed nu<\/dt>/);
  assert.match(b, /<dt[^>]*>Status<\/dt>/);
  assert.match(b, /Høj skaderisiko/);
  assert.match(a, /data-testid="r5-row-menu"[^>]*class="[^"]*h-11 w-11/);
  assert.match(a, /data-testid="r5-row-training"/);
  assert.match(a, /data-testid="r5-row-effort"/);
});

test("engelsk: de samme ord fuldt ud", async () => {
  const html = await render("en");
  const [first] = rowsOf(html);
  const effort = first.slice(first.indexOf('data-testid="r5-row-effort"'));
  const words = [...effort.matchAll(/aria-pressed="(?:true|false)"[^>]*>([^<]+)</g)].map((m) => m[1]).slice(0, 4);
  assert.deepEqual(words, ["Rest", "Easy", "Medium", "Hard"]);
  assert.match(html, />High injury risk</);
});

test("I dag shows the forecast rotation session without the pass number", async () => {
  const [row] = rowsOf(await render("en", {
    effortLevels: true,
    planFor: (id: string) => id === "a" ? { focus: "sprint", intensity: "easy" } : null,
    forecast: {
      available: true, riders: { a: { fatigue: 30, band: "ok", rotationSlots: [
        { session: "endurance", intensity: "hard", index: 6, length: 10 },
      ] } },
    },
  }));
  const training = row.slice(row.indexOf('data-testid="r5-row-training"'), row.indexOf('data-testid="r5-row-effort"'));
  assert.match(training, /<option[^>]*selected=""[^>]*>Long ride<\/option>/);
  assert.doesNotMatch(row, /7\/10/);
  assert.match(row, /data-testid="r5-hard-risk"/);
});
