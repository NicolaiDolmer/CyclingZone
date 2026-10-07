// #6271 — reads the Tailwind 4 `@theme` blocks out of src/index.css.
//
// Tailwind 4 has no tailwind.config.js: the design tokens (cz-* colours, the
// z-index scale, the radius/blur token-locks, fonts, micro type sizes) are CSS
// custom properties inside `@theme { … }` / `@theme inline { … }`. The guards
// that used to import or regex the JS config (tailwind.config.test.mjs,
// tokens.test.js, zIndexScale.test.js) read them through this one parser, so
// they all agree on what "the config" is.
//
// Only top-level declarations of a block count; nested at-rules (`@keyframes`
// inside @theme) are skipped. Comments are stripped first.

export type ThemeBlock = { params: string; tokens: Map<string, string> };

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Every `@theme …{}` block in source order, with its own declarations. */
export function readThemeBlocks(css: string): ThemeBlock[] {
  const src = stripComments(css);
  const blocks: ThemeBlock[] = [];
  const re = /@theme\b([^{;]*)\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = re.lastIndex;
    let body = "";
    for (; i < src.length && depth > 0; i += 1) {
      const c = src[i];
      if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      // Keep only depth-1 text: nested blocks (keyframes) are dropped.
      if (depth === 1 && c !== "}") body += c;
      else if (depth === 1 && c === "}") body += ";";
    }
    re.lastIndex = i;
    const tokens = new Map<string, string>();
    for (const [, name, value] of body.matchAll(/(--[\w*-]+)\s*:\s*([^;]+);/g)) {
      tokens.set(name, value.trim());
    }
    blocks.push({ params: m[1].trim(), tokens });
  }
  return blocks;
}

/** All theme tokens merged (later blocks win, like in Tailwind). */
export function readThemeTokens(css: string): Map<string, string> {
  const all = new Map<string, string>();
  for (const block of readThemeBlocks(css)) for (const [k, v] of block.tokens) all.set(k, v);
  return all;
}

/** Tokens of one namespace without the prefix: `--z-index-modal` → `modal`. */
export function themeNamespace(css: string, prefix: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of readThemeTokens(css)) {
    if (k.startsWith(prefix) && !k.endsWith("*")) out.set(k.slice(prefix.length), v);
  }
  return out;
}
