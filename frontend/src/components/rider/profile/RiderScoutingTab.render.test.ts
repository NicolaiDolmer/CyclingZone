// #6110: prognosen pr. ryttertype står under potentiale-kortet igen.
//
// Siden potentialet blev ét tal returnerede scouting-fanen tidligt med kortet alene, så
// listen (nu-rating + prognose-bånd pr. type) aldrig blev vist. Testen renderer den rigtige
// EstimateReport med de rigtige tekster: egne og scoutede ryttere får listen under skønnet,
// skjulte rapporter og rapporter uden liste får den ikke.
//
// Repoet kører `node --test` uden JSX-loader; samme mønster som reportXp.render.test.ts:
// et load-hook oversætter JSX, og komponenten får en rigtig i18n-instans.
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

const ENV = '({ DEV: false, VITE_API_URL: "", VITE_SUPABASE_URL: "http://localhost:54321", VITE_SUPABASE_ANON_KEY: "test" })';
const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    // Vite resolver relative importer uden endelse; node gør ikke.
    if (/^\.\.?\//.test(specifier) && !/\.[a-z]+$/i.test(specifier)) {
      for (const ext of [".js", ".ts", ".jsx", ".tsx", "/index.js", "/index.ts", "/index.jsx", "/index.tsx"]) {
        try { return nextResolve(specifier + ext, context); } catch { /* prøv næste endelse */ }
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (/\.css(\?.*)?$/.test(url)) return { format: "module", shortCircuit: true, source: "export default {};" };
    if (url.startsWith("file:") && !url.includes("node_modules") && /\.(tsx|jsx|ts|js)$/.test(url) && url.includes("/frontend/src/")) {
      const lang = url.match(/\.(tsx|jsx|ts|js)$/)?.[1] as "js" | "jsx" | "ts" | "tsx";
      const source = readFileSync(new URL(url), "utf8").replaceAll("import.meta.env", ENV);
      return {
        format: "module",
        shortCircuit: true,
        source: transformSync(new URL(url).pathname, source, { lang, jsx: { runtime: "automatic" } }).code,
      };
    }
    return nextLoad(url, context);
  },
});
const { EstimateReport } = await import("./RiderScoutingTab.jsx");
loader.deregister();

const locale = (lang: string, ns: string) => JSON.parse(readFileSync(new URL(`../../../../public/locales/${lang}/${ns}.json`, import.meta.url), "utf8"));
const NAMESPACES = ["rider", "riders", "riderTypes", "scouting", "common"];

async function i18nFor(lng) {
  const i18n = createInstance();
  await i18n.use(ICU).init({
    lng,
    initAsync: false,
    fallbackLng: false,
    ns: NAMESPACES,
    resources: { [lng]: Object.fromEntries(NAMESPACES.map((ns) => [ns, locale(lng, ns)])) },
  });
  return i18n;
}

const TYPE_KEYS = ["sprinter", "puncheur", "brostensrytter", "baroudeur", "rouleur", "tt", "gc", "climber"];
const types = TYPE_KEYS.map((key, i) => ({ key, now: 40 + i, progLo: 50 + i, progHi: 58 + i }));
const potentialView = { hidden: false, value: 74, certainty: "fair", previousValue: null, previousCertainty: null, changedAt: null };
const scout = { isDefault: false, name: "Scout A", tier: 3, overall: 70 };

function render(i18n, over = {}, props = {}) {
  const report = {
    potentialView, level: 2, maxLevel: 3, own: false, looks: 2, primaryKey: "climber", scout, types, ...over,
  };
  const t = i18n.getFixedT(null, "rider");
  const element = createElement(EstimateReport, {
    view: potentialView, report, rider: { id: "r1", secondary_type: "gc" }, canLookAgain: !report.own, scoutAction: null, t, lang: "en", ...props,
  });
  return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, element));
}

test("#6110: egen rytter med skøn og typer får prognosen pr. ryttertype under skønnet", async () => {
  const html = render(await i18nFor("en"), { own: true });
  assert.match(html, /data-testid="scouting-estimate-card"/);
  assert.ok(html.includes(locale("en", "rider").profile.scouting.typesTitle), "overskriften står på siden");
  const card = html.indexOf('data-testid="scouting-estimate-card"');
  const list = html.indexOf('data-testid="scouting-natural-secondary"');
  assert.ok(card >= 0 && list > card, "listen står under skønnet");
  assert.doesNotMatch(html, /profile\.scouting\./, "alle nøgler har en tekst");
});

test("#6110: scoutet fremmed rytter får samme liste med spejderens bånd", async () => {
  const html = render(await i18nFor("en"), { own: false });
  assert.match(html, /data-testid="scouting-estimate-card"/);
  assert.match(html, /data-testid="scouting-natural-secondary"/);
  // alle otte typer er med: primær, naturlig sekundær og de seks andre
  for (const key of TYPE_KEYS) assert.ok(html.includes(`>${locale("en", "riderTypes").types[key]}<`), `${key} står i listen`);
});

test("#6110: dansk tekst bruger den danske overskrift", async () => {
  const html = render(await i18nFor("da"), { own: true }, { lang: "da" });
  const da = locale("da", "rider").profile.scouting.typesTitle;
  assert.ok(html.includes(da), "den danske overskrift står på siden");
});

test("#6110: uden typer i rapporten er der ingen liste (uscoutet, AI-hold, akademi uændret)", async () => {
  const noTypes = render(await i18nFor("en"), { types: undefined });
  assert.match(noTypes, /data-testid="scouting-estimate-card"/);
  assert.doesNotMatch(noTypes, /scouting-natural-secondary/);
  const empty = render(await i18nFor("en"), { types: [] });
  assert.doesNotMatch(empty, /scouting-natural-secondary/);
});
