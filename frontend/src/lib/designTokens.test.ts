import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { updateDesignTokenCss } from "../../../scripts/generate-design-tokens.mjs";

const palette = (red = 1) => ({
  light: {
    $extensions: { "org.cyclingzone.css": { marker: ":root {\n  color-scheme: light;" } },
    accent: { $type: "color", $value: { colorSpace: "srgb", components: [red, 0, 0], alpha: 1 },
      $extensions: { "org.cyclingzone.css": { format: "channels", tailwind: "cz-accent" } } },
  },
});
const css = '@theme inline {\n  --color-cz-accent: rgb(var(--accent));\n}\n:root {\n  color-scheme: light;\n  --accent:  255  0 0; /* preserve rationale and --example: #ffffff; */\n  --radius-sm: 5px;\n}\n';

test("DTCG palette changes only the selected CSS color values and preserves layout and comments", () => {
  const output = updateDesignTokenCss(css, palette(0.5));
  assert.equal(output, css.replace("255  0 0", "128  0 0"));
  assert.equal(updateDesignTokenCss(output, palette(0.5)), output);
});

test("DTCG palette rejects missing, extra and invalid color definitions", () => {
  assert.throws(() => updateDesignTokenCss(css.replace("--accent:", "--missing:"), palette()), /missing/);
  assert.throws(() => updateDesignTokenCss(css.replace("--radius-sm:", "--unknown: #ffffff; --radius-sm:"), palette()), /unknown/);
  assert.throws(() => updateDesignTokenCss(css, palette(2)), /component/);
  const alpha = palette();
  alpha.light.accent.$value.alpha = 0.5;
  assert.throws(() => updateDesignTokenCss(css, alpha), /opaque/);
  assert.throws(() => updateDesignTokenCss(css.replace("--radius-sm:", "--accent: 1 2 3; --radius-sm:"), palette()), /duplicate/);
  assert.equal(updateDesignTokenCss(css.replace("rgb(var(--accent))", "var(--accent)"), palette()), css);
});

test("the managed palette rejects unregistered modern and named CSS colors", () => {
  for (const color of ["hsl(30 60% 50%)", "oklch(50% 0.12 30)", "color(display-p3 1 0 0)", "rebeccapurple"]) {
    const changed = css.replace("--radius-sm:", `--other-color: ${color}; --radius-sm:`);
    assert.throws(() => updateDesignTokenCss(changed, palette()), /other-color: CSS color has no token/);
  }
});

test("committed light and dark CSS and Tailwind aliases match the DTCG token source", () => {
  const source = readFileSync(new URL("../index.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const tokens = JSON.parse(readFileSync(new URL("../theme/tokens.json", import.meta.url), "utf8"));
  assert.equal(updateDesignTokenCss(source, tokens), source);
  assert.ok(Object.keys(tokens.light).length > 50);
  assert.ok(Object.keys(tokens.dark).length > 35);
});
