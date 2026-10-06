// #6271 — see tailwind-v3-alpha.ts for why the plugin exists.
import { test } from "node:test";
import assert from "node:assert/strict";

import { restoreV3Alpha, tailwindV3AlphaPlugin } from "./tailwind-v3-alpha.ts";

const SUPPORTS = "@supports (color: color-mix(in lab, red, red))";

function pair(prop: string, fallback: string, original: string): string {
  return `  .x {\n    ${prop}: ${fallback};\n    ${SUPPORTS} {\n      ${prop}: ${original};\n    }\n  }\n`;
}

test("kanal-token: v3's rgb(var(--x) / a), ingen fuldt-dækkende fallback", () => {
  const out = restoreV3Alpha(
    pair("background-color", "rgb(var(--accent))", "color-mix(in oklab, rgb(var(--accent)) 10%, transparent)"),
  );
  assert.equal(out, "  .x {\n    background-color: rgb(var(--accent) / 10%);\n  }\n");
});

test("custom property (ring-farve) behandles som enhver anden deklaration", () => {
  const out = restoreV3Alpha(
    pair("--tw-ring-color", "rgb(var(--accent-t))", "color-mix(in oklab, rgb(var(--accent-t)) 40%, transparent)"),
  );
  assert.match(out, /--tw-ring-color: rgb\(var\(--accent-t\) \/ 40%\);/);
  assert.doesNotMatch(out, /@supports/);
});

test("var()-token: #5150's color-mix i srgb, ingen fallback", () => {
  const out = restoreV3Alpha(
    pair("border-color", "var(--bg-card)", "color-mix(in oklab, var(--bg-card) 40%, transparent)"),
  );
  assert.match(out, /border-color: color-mix\(in srgb, var\(--bg-card\) 40%, transparent\);/);
  assert.doesNotMatch(out, /@supports/);
});

test("projektets egen color-mix (auction-winning) bliver præcis som skrevet", () => {
  const original = "color-mix(in srgb, rgb(var(--accent)) 8%, var(--bg-card))";
  const out = restoreV3Alpha(pair("background-color", "rgb(var(--accent))", original));
  assert.equal(out, `  .x {\n    background-color: ${original};\n  }\n`);
});

test("statisk farve: Tailwinds egen fallback er korrekt og røres ikke", () => {
  const input = pair(
    "background-color",
    "color-mix(in srgb, #000 60%, transparent)",
    "color-mix(in oklab, var(--color-black) 60%, transparent)",
  );
  assert.equal(restoreV3Alpha(input), input);
});

test("CRLF-linjeskift matches også", () => {
  const input = pair("color", "rgb(var(--danger))", "color-mix(in oklab, rgb(var(--danger)) 60%, transparent)").replace(/\n/g, "\r\n");
  assert.match(restoreV3Alpha(input), /color: rgb\(var\(--danger\) \/ 60%\);/);
});

test("pluginet rører kun CSS-moduler der har en color-mix-fallback", () => {
  const plugin = tailwindV3AlphaPlugin();
  assert.equal(plugin.enforce, "pre");
  const transform = plugin.transform as (code: string, id: string) => unknown;
  assert.equal(transform.call(plugin, "const a = 1;", "/src/a.js"), null);
  assert.equal(transform.call(plugin, ".a { color: red; }", "/src/index.css"), null);
  const css = pair("color", "rgb(var(--info))", "color-mix(in oklab, rgb(var(--info)) 50%, transparent)");
  const res = transform.call(plugin, css, "/src/index.css") as { code: string };
  assert.match(res.code, /color: rgb\(var\(--info\) \/ 50%\);/);
});
