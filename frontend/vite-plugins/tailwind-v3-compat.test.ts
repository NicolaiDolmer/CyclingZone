// #6271 — see tailwind-v3-compat.ts for why the plugin exists.
import { test } from "node:test";
import assert from "node:assert/strict";

import { flattenLayers, restoreV3Alpha, restoreV3Space, splitTopLevel, tailwindV3CompatPlugin } from "./tailwind-v3-compat.ts";

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
  const plugin = tailwindV3CompatPlugin();
  assert.equal(plugin.enforce, "pre");
  const transform = plugin.transform as (code: string, id: string) => unknown;
  assert.equal(transform.call(plugin, "const a = 1;", "/src/a.js"), null);
  assert.equal(transform.call(plugin, ".a { color: red; }", "/src/index.css"), null);
  const css = `@layer utilities {\n${pair("color", "rgb(var(--info))", "color-mix(in oklab, rgb(var(--info)) 50%, transparent)")}}\n`;
  const res = transform.call(plugin, css, "/src/index.css") as { code: string };
  assert.match(res.code, /color: rgb\(var\(--info\) \/ 50%\);/);
  assert.doesNotMatch(res.code, /@layer/);
});

test("splitTopLevel: kommentarer og strenge med { } ; afslutter ikke et element", () => {
  const items = splitTopLevel(`/*! banner { ; */\n.a { content: "}"; }\n@layer x;\n@media (x) { .b { c: d; } }`);
  assert.deepEqual(items, ["/*! banner { ; */", '.a { content: "}"; }', "@layer x;", "@media (x) { .b { c: d; } }"]);
});

test("flattenLayers: lag i erklæret rækkefølge, ulagdelte regler sidst (= v3-kaskaden)", () => {
  const css = [
    "/*! tailwindcss */",
    "@layer properties;",
    "@layer theme, base, components, utilities;",
    "@layer theme { :root { --t: 1; } }",
    "@layer utilities { .u { color: red; } }",
    "@layer base { button { cursor: pointer; } }",
    ":root { --own: 1; }",
    "@layer utilities { .own-rule { color: blue; } }",
    "@layer properties { * { --tw-x: 0; } }",
    "@property --tw-x { syntax: \"*\"; inherits: false; }",
  ].join("\n");
  const out = flattenLayers(css);
  assert.doesNotMatch(out, /@layer/);
  const at = (needle: string) => out.indexOf(needle);
  // properties < theme < base < utilities (Tailwind's) < utilities (own) < unlayered.
  assert.ok(at("/*! tailwindcss */") === 0);
  assert.ok(at("--tw-x: 0") < at("--t: 1"));
  assert.ok(at("--t: 1") < at("cursor: pointer"));
  assert.ok(at("cursor: pointer") < at(".u {"));
  assert.ok(at(".u {") < at(".own-rule"));
  assert.ok(at(".own-rule") < at("--own: 1"));
  assert.ok(at("--own: 1") < at("@property --tw-x"));
});

test("flattenLayers: ukendte lag-konstruktioner → input returneres uændret", () => {
  const anonymous = "@layer { .a { color: red; } }";
  assert.equal(flattenLayers(anonymous), anonymous);
  const nested = "@layer a { @layer b { .x { y: z; } } }";
  assert.equal(flattenLayers(nested), nested);
});

// Codex review 7/10 (PR #6289): v4 puts the gap on the PREVIOUS sibling's
// margin-bottom with zero specificity, so a child's own `mb-1` won and the
// filter -> table gap on the trades tab shrank from 16 to 4 px.
const V4_SPACE_Y = `  :where(.space-y-4 > :not(:last-child)) {
    --tw-space-y-reverse: 0;
    margin-block-start: calc(calc(0.25rem * 4) * var(--tw-space-y-reverse));
    margin-block-end: calc(calc(0.25rem * 4) * calc(1 - var(--tw-space-y-reverse)));
  }
`;

test("space-y: v3's next-sibling selector and margin-top, so a child's mb-* cannot shrink the gap", () => {
  const out = restoreV3Space(V4_SPACE_Y);
  assert.ok(!out.includes(":where("), "zero-specificity :where() must be gone");
  assert.match(out, /\.space-y-4 > :not\(\[hidden\]\) ~ :not\(\[hidden\]\) \{/);
  assert.match(out, /margin-block-start: calc\(calc\(0\.25rem \* 4\) \* calc\(1 - var\(--tw-space-y-reverse\)\)\);/);
  assert.match(out, /margin-block-end: calc\(calc\(0\.25rem \* 4\) \* var\(--tw-space-y-reverse\)\);/);
});

test("space-x, negative, responsive and reverse variants are rewritten the same way", () => {
  const css = `  :where(.space-x-2 > :not(:last-child)) {
    --tw-space-x-reverse: 0;
    margin-inline-start: calc(calc(0.25rem * 2) * var(--tw-space-x-reverse));
    margin-inline-end: calc(calc(0.25rem * 2) * calc(1 - var(--tw-space-x-reverse)));
  }
  :where(.-space-y-px > :not(:last-child)) {
    --tw-space-y-reverse: 0;
    margin-block-start: calc(-1px * var(--tw-space-y-reverse));
    margin-block-end: calc(-1px * calc(1 - var(--tw-space-y-reverse)));
  }
  @media (width >= 40rem) {
    :where(.sm\:space-y-0 > :not(:last-child)) {
      --tw-space-y-reverse: 0;
      margin-block-start: 0;
      margin-block-end: 0;
    }
  }
  :where(.space-y-reverse > :not(:last-child)) {
    --tw-space-y-reverse: 1;
  }
`;
  const out = restoreV3Space(css);
  assert.ok(!out.includes(":where("));
  assert.match(out, /\.space-x-2 > :not\(\[hidden\]\) ~ :not\(\[hidden\]\) \{[^}]*margin-inline-start: calc\(calc\(0\.25rem \* 2\) \* calc\(1 - var\(--tw-space-x-reverse\)\)\);/);
  assert.match(out, /\.-space-y-px > :not\(\[hidden\]\) ~ :not\(\[hidden\]\) \{[^}]*margin-block-start: calc\(-1px \* calc\(1 - var\(--tw-space-y-reverse\)\)\);/);
  assert.match(out, /\.sm\:space-y-0 > :not\(\[hidden\]\) ~ :not\(\[hidden\]\) \{/);
  assert.match(out, /\.space-y-reverse > :not\(\[hidden\]\) ~ :not\(\[hidden\]\) \{\s*--tw-space-y-reverse: 1;/);
});

test("divide-* and other :where() rules are left exactly as v4 wrote them", () => {
  const css = `  :where(.divide-y > :not(:last-child)) {
    border-bottom-width: 1px;
  }
`;
  assert.equal(restoreV3Space(css), css);
});

test("the plugin applies the space rewrite", () => {
  const plugin = tailwindV3CompatPlugin();
  const transform = plugin.transform as (code: string, id: string) => { code: string } | null;
  const res = transform(`@layer utilities {
${V4_SPACE_Y}}
`, "/src/index.css");
  assert.ok(res && res.code.includes(".space-y-4 > :not([hidden]) ~ :not([hidden])"));
});
