// #6271 — keeps Tailwind 3's browser reach after the move to Tailwind 4.
//
// Tailwind 4 targets Chrome 111 / Safari 16.4. When the owner decided to
// upgrade (issue #6271, 6/10), about 2% of players were on older browsers
// (Chrome 95-109, measured in Sentry + the Supabase edge log). With Tailwind 3
// they got exactly the same page as everyone else. Two things in Tailwind 4's
// output would have changed that, and this plugin undoes both:
//
// 1. CASCADE LAYERS (`flattenLayers`)
//    v4 wraps everything in `@layer theme/base/components/utilities`. A
//    browser without cascade layers (Chrome < 99, Safari < 15.4) drops every
//    rule inside an @layer block — the page renders with no Tailwind at all.
//    v3 emitted plain rules, so the cascade was specificity + source order.
//    The plugin writes the layers out as plain rules in layer order
//    (properties, theme, base, components, utilities), followed by the
//    stylesheet's own unlayered rules (which outrank every layer, so they go
//    last). That is precisely v3's cascade, in every browser — index.css is
//    laid out for it (its own rules sit in `@layer utilities` after Tailwind's,
//    exactly where v3 put them).
//
// 2. OPACITY MODIFIERS ON RUNTIME COLOURS (`restoreV3Alpha`)
//    Every brand colour token is a CSS variable (`--accent: 232 197 71`,
//    `--bg-card: #fcfbf7`), because light/dark theming swaps them at runtime.
//    v4 writes `bg-cz-accent/10` as
//
//      .bg-cz-accent\/10 {
//        background-color: rgb(var(--accent));                      <- fallback
//        @supports (color: color-mix(in lab, red, red)) {
//          background-color: color-mix(in oklab, rgb(var(--accent)) 10%, transparent);
//        }
//      }
//
//    The fallback is meant for browsers without color-mix (Chrome < 111,
//    Safari < 16.2). For a STATIC colour Tailwind computes the right
//    translucent value, but it cannot see through a runtime variable, so the
//    fallback is the colour at FULL opacity: a 10% gold row tint became a solid
//    gold bar. v3 wrote `rgb(var(--accent) / 0.1)`, which every browser
//    renders. The same pass also hit the project's OWN color-mix rules in
//    index.css (`.auction-bid-cell-winning`): v3 left them alone, so an old
//    browser skipped the declaration and kept the card colour, while v4's
//    fallback painted the cell solid gold.
//
//    Only `fallback; @supports (color-mix) { original }` pairs whose fallback
//    depends on a runtime `var()` are touched; each collapses back to ONE
//    declaration with exactly the v3 value:
//      color-mix(in oklab, rgb(var(--x)) N%, transparent) -> rgb(var(--x) / N%)
//      color-mix(in oklab, var(--x) N%, transparent)      -> color-mix(in srgb, var(--x) N%, transparent)
//        (#5150's alphaToken() form — v3 already needed color-mix there)
//      anything else (the project's own color-mix)        -> left exactly as written
//    Pairs with a static fallback (`bg-black/60`) are correct as emitted.
//
// Runs right after Tailwind's own transform, on its raw output. Needs
// `tailwindcss({ optimize: false })`: Tailwind's optimizer flattens nesting
// and merges identical fallback rules across selectors
// (`.border-cz-border,.border-cz-border\/50{…}`), after which the pairs can no
// longer be matched safely. Vite's lightningcss minify lowers the nesting and
// media-range syntax for `build.cssTarget` instead (vite.config.js).
//
// NOT covered (no CSS-only fix): v4 writes `translate-*`/`rotate-*`/`scale-*`
// as the individual `translate`/`rotate`/`scale` properties (Chrome 104+).
import type { Plugin } from "vite";

const PAIR =
  /([ \t]*)([a-z-]+):[ \t]*([^;{}]*);[ \t]*\r?\n[ \t]*@supports \(color: color-mix\(in lab, red, red\)\) \{[ \t]*\r?\n[ \t]*\2:[ \t]*([^;{}]*);[ \t]*\r?\n[ \t]*\}/g;

const CHANNEL_MIX = /color-mix\(in oklab, rgb\(var\((--[\w-]+)\)\) ([\d.]+%), transparent\)/g;
const VAR_MIX = /color-mix\(in oklab, var\((--[\w-]+)\) ([\d.]+%), transparent\)/g;

/** Opacity modifiers on var()-colours back to v3's output. */
export function restoreV3Alpha(css: string): string {
  return css.replace(PAIR, (whole, indent: string, prop: string, fallback: string, original: string) => {
    if (!fallback.includes("var(")) return whole;
    const value = original
      .replace(CHANNEL_MIX, (_m, name: string, pct: string) => `rgb(var(${name}) / ${pct})`)
      .replace(VAR_MIX, (_m, name: string, pct: string) => `color-mix(in srgb, var(${name}) ${pct}, transparent)`);
    return `${indent}${prop}: ${value};`;
  });
}

/**
 * Splits a stylesheet into its top-level items: `statement;`, `prelude { … }`
 * and comments. Aware of comments and quoted strings, so braces or
 * semicolons inside them never end an item.
 */
export function splitTopLevel(css: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  const flush = (end: number) => {
    const text = css.slice(start, end);
    if (text.trim()) items.push(text.trim());
    start = end;
  };
  while (i < css.length) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      const stop = end === -1 ? css.length : end + 2;
      if (depth === 0) {
        flush(i);
        i = stop;
        flush(i);
      } else {
        i = stop;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      i += 1;
      while (i < css.length && css[i] !== c) i += css[i] === "\\" ? 2 : 1;
      i += 1;
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        flush(i);
        continue;
      }
    } else if (c === ";" && depth === 0) {
      i += 1;
      flush(i);
      continue;
    }
    i += 1;
  }
  flush(css.length);
  return items;
}

const LAYER_STATEMENT = /^@layer\s+([\w-]+(?:\s*,\s*[\w-]+)*)\s*;$/;
const LAYER_BLOCK = /^@layer\s+([\w-]+)\s*\{([\s\S]*)\}$/;

/**
 * Writes cascade layers out as plain rules in layer order, unlayered rules
 * last (see the file header). Returns the input unchanged if it contains a
 * layer construct it does not understand (anonymous or nested layers), so it
 * can never silently reorder something it did not model.
 */
export function flattenLayers(css: string): string {
  if (!css.includes("@layer")) return css;
  const order: string[] = [];
  const bodies = new Map<string, string[]>();
  const head: string[] = [];
  const rest: string[] = [];
  const register = (name: string) => {
    if (!bodies.has(name)) {
      bodies.set(name, []);
      order.push(name);
    }
  };
  for (const item of splitTopLevel(css)) {
    const statement = LAYER_STATEMENT.exec(item);
    if (statement) {
      for (const name of statement[1].split(",")) register(name.trim());
      continue;
    }
    const block = LAYER_BLOCK.exec(item);
    if (block) {
      register(block[1]);
      bodies.get(block[1])!.push(block[2]);
      continue;
    }
    // The licence banner stays first; everything else unlayered goes last.
    if (item.startsWith("/*!") && !order.length && !rest.length) head.push(item);
    else rest.push(item);
  }
  const out = [...head, ...order.flatMap((name) => bodies.get(name)!), ...rest].join("\n");
  return /@layer\b/.test(out) ? css : out;
}

export function tailwindV3CompatPlugin(): Plugin {
  return {
    name: "cz-tailwind-v3-compat",
    // Same phase as @tailwindcss/vite's own transform and listed after it in
    // vite.config.js, so it sees Tailwind's output before vite:css does.
    enforce: "pre",
    transform(code, id) {
      if (!/\.css(?:\?|$)/.test(id) || !code.includes("@layer")) return null;
      const next = flattenLayers(restoreV3Alpha(code));
      return next === code ? null : { code: next, map: null };
    },
  };
}

export default tailwindV3CompatPlugin;
