// #6271 — keeps Tailwind 3's opacity-modifier output after the move to v4.
//
// WHY THIS FILE EXISTS
//
// Every brand colour token here is a CSS variable (`--accent: 232 197 71`,
// `--bg-card: #fcfbf7`), because light/dark theming swaps them at runtime.
// Tailwind 4 writes an opacity modifier as
//
//     .bg-cz-accent\/10 {
//       background-color: rgb(var(--accent));                       <- fallback
//       @supports (color: color-mix(in lab, red, red)) {
//         background-color: color-mix(in oklab, rgb(var(--accent)) 10%, transparent);
//       }
//     }
//
// The fallback is meant for browsers without color-mix (Chrome < 111,
// Safari < 16.2). For a STATIC colour Tailwind computes the right translucent
// value, but it cannot see through a runtime variable, so the fallback is the
// colour at FULL opacity: a 10% gold row tint became a solid gold bar on those
// browsers (measured 6/10: about 2% of players). Tailwind 3 wrote
// `rgb(var(--accent) / 0.1)`, which every browser renders correctly.
//
// The same pass also hits the project's OWN color-mix rules in index.css
// (`.auction-bid-cell-winning` mixes gold into the card colour): v3 left them
// alone, so an old browser simply skipped the declaration and kept the card
// background, while v4's fallback painted the cell solid gold.
//
// WHAT IT DOES
//
// Runs right after Tailwind's own transform, on the raw (still nested) output,
// and only touches the `fallback; @supports (color-mix) { original }` pairs
// whose fallback depends on a runtime `var()`. Each pair collapses back to ONE
// declaration with exactly the v3 value:
//   color-mix(in oklab, rgb(var(--x)) N%, transparent) -> rgb(var(--x) / N%)
//   color-mix(in oklab, var(--x) N%, transparent)      -> color-mix(in srgb, var(--x) N%, transparent)
//     (#5150's alphaToken() form — v3 already needed color-mix there)
//   anything else (the project's own color-mix)        -> left exactly as written
// Pairs with a static fallback (`bg-black/60`, `border-blue-500/20`) are
// correct as Tailwind emits them and are not touched.
//
// Needs `tailwindcss({ optimize: false })`: Tailwind's own optimizer flattens
// the nesting and merges identical fallback rules across selectors
// (`.border-cz-border,.border-cz-border\/50{…}`), after which the pairs can no
// longer be matched safely. Vite's lightningcss minify does that work instead
// (lowering nesting for the build target).
import type { Plugin } from "vite";

const PAIR =
  /([ \t]*)([a-z-]+):[ \t]*([^;{}]*);[ \t]*\r?\n[ \t]*@supports \(color: color-mix\(in lab, red, red\)\) \{[ \t]*\r?\n[ \t]*\2:[ \t]*([^;{}]*);[ \t]*\r?\n[ \t]*\}/g;

const CHANNEL_MIX = /color-mix\(in oklab, rgb\(var\((--[\w-]+)\)\) ([\d.]+%), transparent\)/g;
const VAR_MIX = /color-mix\(in oklab, var\((--[\w-]+)\) ([\d.]+%), transparent\)/g;

/** Rewrites one compiled stylesheet. Exported for the unit test. */
export function restoreV3Alpha(css: string): string {
  return css.replace(PAIR, (whole, indent: string, prop: string, fallback: string, original: string) => {
    if (!fallback.includes("var(")) return whole;
    const value = original
      .replace(CHANNEL_MIX, (_m, name: string, pct: string) => `rgb(var(${name}) / ${pct})`)
      .replace(VAR_MIX, (_m, name: string, pct: string) => `color-mix(in srgb, var(${name}) ${pct}, transparent)`);
    return `${indent}${prop}: ${value};`;
  });
}

export function tailwindV3AlphaPlugin(): Plugin {
  return {
    name: "cz-tailwind-v3-alpha",
    // Same phase as @tailwindcss/vite's own transform and listed after it in
    // vite.config.js, so it sees Tailwind's output before vite:css does.
    enforce: "pre",
    transform(code, id) {
      if (!/\.css(?:\?|$)/.test(id) || !code.includes("color-mix(in lab, red, red)")) return null;
      const next = restoreV3Alpha(code);
      return next === code ? null : { code: next, map: null };
    },
  };
}

export default tailwindV3AlphaPlugin;
