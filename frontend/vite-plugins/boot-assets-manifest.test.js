// Forward-guard for #5161: boot-listen skal vaere komplet OG staa foran guarden.
//
// Pluginet er det eneste sted der ved hvilke filer boot-vagten skal kunne
// genkende. To ting skal holde, ellers er vagten slukket i prod uden at nogen
// test bliver roed:
//   1. Udvalget af tags skal matche guardens CSS-selector praecis
//      (script[type=module][src], link[rel=modulepreload][href],
//       link[rel=stylesheet][href^="/assets/"]).
//   2. JSON-blokken skal staa FOER <script src="/chunk-selfheal.js">. Staar den
//      efter, er den ikke parset naar guarden installeres — praecis det hul
//      audit-fund H2 beskrev.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BOOT_ASSETS_ELEMENT_ID,
  bootAssetsManifestPlugin,
  collectBootAssets,
  injectBootAssets,
} from "./boot-assets-manifest.js";

const GUARD_TAG = '<script src="/chunk-selfheal.js"></script>';

// Uddrag af et rigtigt bygget index.html: Vite injicerer entry + modulepreloads
// + stylesheet EFTER guard-scriptet i <head>.
const BUILT_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    ${GUARD_TAG}
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="preload" href="/fonts/dm-sans-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin />
    <script type="application/ld+json">{"@type":"Organization"}</script>
    <script type="module" crossorigin src="/assets/index-BoC9CI7n.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/react-SIfiwpqq.js">
    <link rel="modulepreload" crossorigin href="/assets/react-dom-x9LNwWQc.js">
    <link rel="stylesheet" crossorigin href="/assets/index-C1L8hZ1R.css">
  </head>
  <body><div id="root"></div></body>
</html>`;

test("samler entry, modulepreloads og asset-stylesheet — og intet andet", () => {
  assert.deepEqual(collectBootAssets(BUILT_HTML), [
    "/assets/index-BoC9CI7n.js",
    "/assets/react-SIfiwpqq.js",
    "/assets/react-dom-x9LNwWQc.js",
    "/assets/index-C1L8hZ1R.css",
  ]);
});

test("font-preloads, favicons og ld+json er ikke boot-assets", () => {
  const urls = collectBootAssets(BUILT_HTML);
  assert.ok(!urls.some((u) => u.includes("fonts/")), "rel=preload as=font er ikke et modul");
  assert.ok(!urls.some((u) => u.includes("favicon")), "rel=icon er ikke et modul");
});

test("en stylesheet uden for /assets/ ignoreres (samme afgraensning som guardens selector)", () => {
  const html = `<head>${GUARD_TAG}<link rel="stylesheet" href="/theme.css"></head>`;
  assert.deepEqual(collectBootAssets(html), []);
});

test("Vites dev-klient er ikke et boot-asset", () => {
  const html = `<head><script type="module" src="/@vite/client"></script>${GUARD_TAG}<script type="module" src="/src/main.jsx"></script></head>`;
  assert.deepEqual(collectBootAssets(html), ["/src/main.jsx"]);
});

test("JSON-blokken indsaettes FOER guard-scriptet", () => {
  const html = injectBootAssets(BUILT_HTML, collectBootAssets(BUILT_HTML));
  const blockIndex = html.indexOf(`id="${BOOT_ASSETS_ELEMENT_ID}"`);
  const guardIndex = html.indexOf("/chunk-selfheal.js");
  assert.ok(blockIndex > -1, "blokken blev skrevet");
  assert.ok(
    blockIndex < guardIndex,
    "staar blokken efter guarden, er listen tom naar guarden installeres (#5161)",
  );
  assert.match(html, /id="cz-boot-assets">\["\/assets\/index-BoC9CI7n\.js"/);
});

test("mangler guard-scriptet, fejler injektionen hoejlydt", () => {
  assert.throws(
    () => injectBootAssets("<head><meta charset=\"UTF-8\"></head>", ["/assets/a.js"]),
    /chunk-selfheal\.js/,
  );
});

test("'<' i en URL escapes, saa JSON-blokken ikke kan lukke sit eget script-tag", () => {
  const html = injectBootAssets(`<head>${GUARD_TAG}</head>`, ["/assets/</script>-x.js"]);
  assert.ok(!html.includes("</script>-x.js"), "skal vaere escapet til \\u003c");
  assert.match(html, /\\u003c\/script>/);
});

test("buildet afbrydes hvis det byggede HTML ikke har et eneste boot-asset", async () => {
  const plugin = bootAssetsManifestPlugin();
  plugin.configResolved({ command: "build", base: "/", build: { assetsDir: "assets" } });
  await assert.rejects(
    async () => plugin.transformIndexHtml.handler(`<head>${GUARD_TAG}</head>`),
    /ingen boot-assets fundet/,
  );
});

test("dev-serveren afbrydes ikke af en tom liste (intet build at beskytte)", async () => {
  const plugin = bootAssetsManifestPlugin();
  plugin.configResolved({ command: "serve", base: "/", build: {} });
  const html = await plugin.transformIndexHtml.handler(`<head>${GUARD_TAG}</head>`);
  assert.match(html, /id="cz-boot-assets">\[\]/);
});

test("hooket koerer som 'post', ellers ser det HTML'en foer Vites asset-injektion", () => {
  const plugin = bootAssetsManifestPlugin();
  assert.equal(plugin.transformIndexHtml.order, "post");
});

// Kontrakten mellem de to filer: guarden laeser praecis det id pluginet skriver.
test("guarden og pluginet bruger samme element-id", () => {
  const guardSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "public", "chunk-selfheal.js"),
    "utf8",
  );
  assert.ok(
    guardSource.includes(`var BOOT_ASSETS_ELEMENT_ID = "${BOOT_ASSETS_ELEMENT_ID}"`),
    "chunk-selfheal.js skal laese samme id som pluginet skriver",
  );
});

// index.html er kilden pluginet transformerer — uden guard-tagget i netop den
// fil fejler hele buildet.
test("frontend/index.html indeholder guard-scriptet pluginet haenger listen paa", () => {
  const indexHtml = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"),
    "utf8",
  );
  assert.match(indexHtml, /<script src="\/chunk-selfheal\.js"><\/script>/);
});
