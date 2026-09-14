// Tests for cz-i18n-lang-preload (#5177).
//
// De to rene funktioner er hele pluginets logik: hvilke chunks der er
// sprog-bundles, og hvordan hintet havner i HTML'en. Fejler en af dem, betaler
// en dansk besoegende en ekstra rundtur foer appen kan mounte — det er praecis
// den regression pluginet findes for at forhindre.

import test from "node:test";
import assert from "node:assert/strict";
import { collectLangChunks, injectLangPreload, I18N_LANG_ASSETS_ELEMENT_ID } from "./i18n-lang-preload.js";

const GUARD_TAG = '<script src="/chunk-selfheal.js"></script>';

function bundleOf(entries) {
  return Object.fromEntries(entries.map((e) => [e.fileName, e]));
}

test("collectLangChunks finder lazy sprog-chunks og springer den statiske en over", () => {
  const bundle = bundleOf([
    { type: "chunk", name: "index", fileName: "assets/index-a1.js" },
    { type: "chunk", name: "i18n-messages-en", fileName: "assets/i18n-messages-en-b2.js" },
    { type: "chunk", name: "i18n-messages-da", fileName: "assets/i18n-messages-da-c3.js" },
    { type: "asset", name: "index.css", fileName: "assets/index-d4.css" },
  ]);
  assert.deepEqual(collectLangChunks(bundle, "/"), {
    da: "/assets/i18n-messages-da-c3.js",
  });
});

test("collectLangChunks respekterer en base-sti", () => {
  const bundle = bundleOf([
    { type: "chunk", name: "i18n-messages-da", fileName: "assets/i18n-messages-da-c3.js" },
  ]);
  assert.deepEqual(collectLangChunks(bundle, "/app/"), {
    da: "/app/assets/i18n-messages-da-c3.js",
  });
});

test("collectLangChunks er tom naar der ikke er nogen lazy sprog-chunk", () => {
  const bundle = bundleOf([{ type: "chunk", name: "index", fileName: "assets/index-a1.js" }]);
  assert.deepEqual(collectLangChunks(bundle, "/"), {});
  assert.deepEqual(collectLangChunks(undefined, "/"), {});
});

test("injectLangPreload laegger datablok + script FOER boot-vagten", () => {
  const html = `<head>\n    ${GUARD_TAG}\n  </head>`;
  const out = injectLangPreload(html, { da: "/assets/i18n-messages-da-c3.js" });
  assert.ok(out.includes(`id="${I18N_LANG_ASSETS_ELEMENT_ID}"`));
  assert.ok(out.indexOf(I18N_LANG_ASSETS_ELEMENT_ID) < out.indexOf("/chunk-selfheal.js"));
  assert.ok(out.includes('"/assets/i18n-messages-da-c3.js"'));
  // Hintet maa kun fyre for et sprog der ER i kortet.
  assert.ok(out.includes('map[lng]'));
});

test("injectLangPreload escaper </ saa datablokken ikke kan lukke script-elementet", () => {
  const out = injectLangPreload(`<head>${GUARD_TAG}</head>`, {
    da: "/assets/</script><script>alert(1)</script>.js",
  });
  assert.ok(!out.includes("</script><script>alert(1)"));
  assert.ok(out.includes("\\u003c/script"));
});

test("injectLangPreload er en no-op uden sprog-chunks", () => {
  const html = `<head>${GUARD_TAG}</head>`;
  assert.equal(injectLangPreload(html, {}), html);
  assert.equal(injectLangPreload(html, null), html);
});

test("injectLangPreload fejler hoejlydt hvis ankeret er vaek", () => {
  assert.throws(
    () => injectLangPreload("<head></head>", { da: "/assets/x.js" }),
    /chunk-selfheal/
  );
});
