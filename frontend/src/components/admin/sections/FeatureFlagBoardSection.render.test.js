// #6181 · Rendering-proeve for stadie-tavlen: de rae svar fra GET /api/admin/feature-flags
// (bygget af den rigtige adminFlagView) renderes af den rigtige FeatureFlagBoardView.
//
// En binaer noegle (sale_escrow_enabled) maa aldrig vise eller tilbyde "Beta", og en skrevet
// "beta" vises som slukket med en advarsel. Andre noegler vises som foer.
//
// Repoet koerer `node --test` uden JSX-loader; samme moenster som
// DailyTrainingReceipt.test.ts: et load-hook oversaetter JSX, og et resolve-hook
// saetter de to moduler, der kun bruges af hentning og skrivning (adgangs-hook og
// apiFetch), ud af spillet.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { transformSync } from "rolldown/utils";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { adminFlagView } from "../../../../../backend/lib/adminFlagView6181.js";
import { PLAYER_VISIBLE_BINARY_FLAG_KEYS, STAGE_FLAGS } from "../../../../../backend/lib/stageFlagCatalog.js";

const STUB_PREFIX = "cz-stub:";
const STUBS = {
  useAdminAuth: "export const adminErrorMessage = () => '';",
  apiFetch: "export const apiFetch = async () => ({ ok: true, data: {} });",
};

const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    const stub = Object.keys(STUBS).find((name) => new RegExp(`/${name}(\\.[jt]s)?$`).test(specifier));
    if (stub) return { url: `${STUB_PREFIX}${stub}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(STUB_PREFIX)) {
      return { format: "module", shortCircuit: true, source: STUBS[url.slice(STUB_PREFIX.length)] };
    }
    if (url.startsWith("file:") && /\.(tsx|jsx)$/.test(url)) {
      return {
        format: "module",
        shortCircuit: true,
        source: transformSync(new URL(url).pathname, readFileSync(new URL(url), "utf8"), {
          lang: url.endsWith(".tsx") ? "tsx" : "jsx",
          jsx: { runtime: "automatic" },
          define: { "import.meta.env.VITE_API_URL": '""', "import.meta.env.DEV": "false" },
        }).code,
      };
    }
    return nextLoad(url, context);
  },
});
const { FeatureFlagBoardView } = await import("./FeatureFlagBoardSection.jsx");
loader.deregister();

const ESCROW_KEY = "sale_escrow_enabled";
const NON_BINARY_KEY = STAGE_FLAGS.find((f) => !PLAYER_VISIBLE_BINARY_FLAG_KEYS.includes(f.key)).key;

/** Svaret endpointet ville give, naar app_config har disse raekker (undefined = ingen raekke). */
function payload(rows) {
  return STAGE_FLAGS.map((flag) => adminFlagView(flag, rows[flag.key] === undefined ? null : { value: rows[flag.key], updated_at: null }));
}
function render(rows, props = {}) {
  return renderToStaticMarkup(createElement(FeatureFlagBoardView, { flags: payload(rows), ...props }));
}
/** Knapperne (og deres tekst) i gruppen for et flag. */
function buttonsFor(html, flagKey) {
  const label = STAGE_FLAGS.find((f) => f.key === flagKey)?.label ?? "Gammelt flag";
  const start = html.indexOf(`aria-label="Stadie for ${label}"`);
  assert.ok(start >= 0, `gruppen for ${flagKey} mangler`);
  const group = html.slice(start, html.indexOf("</div>", start));
  return [...group.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*>([^<]*)<\/button>/g)]
    .map((m) => ({ pressed: m[1] === "true", text: m[2] }));
}
function rowFor(html, flagKey) {
  const at = html.indexOf(`>${flagKey}</p>`);
  assert.ok(at >= 0, `rækken for ${flagKey} mangler`);
  return html.slice(at, html.indexOf("</button></div></div>", at));
}

test("binaer noegle uden raekke: Fra valgt, kun Fra og Til tilbydes, aldrig Beta", () => {
  const buttons = buttonsFor(render({}), ESCROW_KEY);
  assert.deepEqual(buttons.map((b) => b.text), ["Fra", "Til"]);
  assert.deepEqual(buttons.map((b) => b.pressed), [true, false]);
});

test("binaer noegle: 'on' og true vises som Til, 'off' og false som Fra", () => {
  for (const [raw, pressed] of [["on", [false, true]], [true, [false, true]], ["off", [true, false]], [false, [true, false]]]) {
    const buttons = buttonsFor(render({ [ESCROW_KEY]: raw }), ESCROW_KEY);
    assert.deepEqual(buttons.map((b) => b.text), ["Fra", "Til"], String(raw));
    assert.deepEqual(buttons.map((b) => b.pressed), pressed, String(raw));
  }
});

test("binaer noegle med skrevet 'beta': vises som Fra med advarsel, og Beta tilbydes stadig ikke", () => {
  const html = render({ [ESCROW_KEY]: "beta" });
  const buttons = buttonsFor(html, ESCROW_KEY);
  assert.deepEqual(buttons.map((b) => b.text), ["Fra", "Til"]);
  assert.deepEqual(buttons.map((b) => b.pressed), [true, false], "beta vises som slukket");
  const row = rowFor(html, ESCROW_KEY);
  assert.match(row, /Der står &quot;beta&quot; i app_config/);
  assert.match(row, /læses som Fra for alle/);
  assert.match(row, /Kun til\/fra/);
});

test("ingen advarsel naar binaer noegle ikke staar paa beta", () => {
  for (const raw of [undefined, "off", "on", true, false]) {
    assert.doesNotMatch(rowFor(render({ [ESCROW_KEY]: raw }), ESCROW_KEY), /Der står/, String(raw));
  }
});

test("ukendt vaerdi i binaer noegle maerkes som drift, ikke som et valg", () => {
  const row = rowFor(render({ [ESCROW_KEY]: "ON" }), ESCROW_KEY);
  assert.match(row, /Ukendt værdi i app_config/);
  assert.match(row, /læses som Fra/);
  assert.deepEqual(buttonsFor(render({ [ESCROW_KEY]: "ON" }), ESCROW_KEY).map((b) => b.pressed), [true, false]);
});

test("en almindelig noegle vises uaendret: Fra, Beta og Til, og beta er et ægte stadie", () => {
  const html = render({ [NON_BINARY_KEY]: "beta" });
  const buttons = buttonsFor(html, NON_BINARY_KEY);
  assert.deepEqual(buttons.map((b) => b.text), ["Fra", "Beta", "Til"]);
  assert.deepEqual(buttons.map((b) => b.pressed), [false, true, false]);
  assert.doesNotMatch(rowFor(html, NON_BINARY_KEY), /Kun til\/fra/);
});

test("en boolean-raekke i en almindelig noegle faar ingen Beta-knap og den gamle forklaring", () => {
  const html = render({ [NON_BINARY_KEY]: true });
  assert.deepEqual(buttonsFor(html, NON_BINARY_KEY).map((b) => b.text), ["Fra", "Til"]);
  assert.match(rowFor(html, NON_BINARY_KEY), /Boolean-flag \(gammelt skema\)/);
});

test("et svar uden de nye felter (aeldre server) vises som foer, med alle tre stadier", () => {
  const legacy = [{ key: "legacy_flag", area: "ops", label: "Gammelt flag", stage: "beta", raw_value: "beta", boolean_only: false, configured: true, unknown_value: false }];
  const html = renderToStaticMarkup(createElement(FeatureFlagBoardView, { flags: legacy }));
  assert.deepEqual(buttonsFor(html, "legacy_flag").map((b) => b.text), ["Fra", "Beta", "Til"]);
});

test("antal flag i beta taeller kun ægte beta: en skrevet beta i en binaer noegle taeller ikke", () => {
  assert.match(render({ [ESCROW_KEY]: "beta" }), /Ingen flag står i beta lige nu/);
  assert.match(render({ [NON_BINARY_KEY]: "beta" }), /Lige nu står <span class="tabular-nums">1<\/span> flag i beta/);
});
