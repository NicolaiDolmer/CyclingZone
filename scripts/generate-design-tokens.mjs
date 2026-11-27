#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const EXTENSION = "org.cyclingzone.css";
const declaration = /\/\*[\s\S]*?\*\/|(--[\w-]+)(\s*:\s*)([^;]+)(;)/g;
const colorFunction = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark|contrast-color|device-cmyk)\(/i;

function isColor(value) {
  const literal = value.trim();
  // A standalone keyword in the palette can be a named or system color.
  return /^(?:#[\da-f]{3,8}|[a-z]+|\d+\s+\d+\s+\d+)$/i.test(literal) || colorFunction.test(literal);
}

function colorBytes(token, name) {
  const { colorSpace, components, alpha = 1 } = token.$value ?? {};
  if (token.$type !== "color" || colorSpace !== "srgb" || !Array.isArray(components) || components.length !== 3 ||
      components.some((component) => !Number.isFinite(component) || component < 0 || component > 1) ||
      !Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
    throw new Error(`${name}: expected a DTCG sRGB color with three components and alpha in [0, 1]`);
  }
  return { channels: components.map((component) => Math.round(component * 255)), alpha };
}

function colorValue(token, oldValue, name) {
  const { channels, alpha } = colorBytes(token, name);
  const format = token.$extensions?.[EXTENSION]?.format;
  if (format === "hex") {
    if (alpha !== 1) throw new Error(`${name}: hex output must be opaque`);
    return "#" + channels.map((channel) => channel.toString(16).padStart(2, "0")).join("");
  }
  const values = format === "rgba" ? [...channels, alpha] : channels;
  if (format !== "rgba" && format !== "channels") throw new Error(`${name}: unsupported CSS format`);
  if (format === "channels" && alpha !== 1) throw new Error(`${name}: channel output must be opaque`);
  const pattern = format === "rgba" ? /^rgba\(\s*\d+,\s*\d+,\s*\d+,\s*[\d.]+\)$/ : /^\d+\s+\d+\s+\d+$/;
  if (!pattern.test(oldValue)) throw new Error(`${name}: CSS must retain its ${format} format`);
  let index = 0;
  return oldValue.replace(/\d+(?:\.\d+)?/g, () => String(values[index++]));
}

/** Generate values in their existing declarations so cascade order and source contracts stay intact. */
export function updateDesignTokenCss(css, palette) {
  let output = css;
  const aliases = new Map();
  for (const [groupName, group] of Object.entries(palette)) {
    if (groupName.startsWith("$")) continue;
    const marker = group.$extensions?.[EXTENSION]?.marker;
    if (typeof marker !== "string" || !marker.includes("{")) throw new Error(`${groupName}: missing CSS block marker`);
    const start = output.indexOf(marker);
    if (start < 0 || output.indexOf(marker, start + marker.length) >= 0) throw new Error(`${groupName}: CSS block marker must match once`);
    const opening = output.indexOf("{", start);
    const end = output.indexOf("\n}", opening);
    if (end < 0) throw new Error(`${groupName}: unterminated CSS block`);
    const entries = new Map(Object.entries(group).filter(([name]) => !name.startsWith("$")));
    const seen = new Set();
    const block = output.slice(opening + 1, end).replace(declaration, (whole, property, separator, rawValue, terminator) => {
      if (!property) return whole; // Retain comments containing example declarations.
      const name = property.slice(2);
      const token = entries.get(name);
      if (!token) {
        if (isColor(rawValue)) throw new Error(`${groupName}.${name}: CSS color has no token`);
        return whole;
      }
      if (seen.has(name)) throw new Error(`${groupName}.${name}: duplicate CSS declaration`);
      seen.add(name);
      const oldValue = rawValue.trim();
      const value = colorValue(token, oldValue, `${groupName}.${name}`);
      const alias = token.$extensions?.[EXTENSION]?.tailwind;
      if (alias) {
        if (aliases.has(alias)) throw new Error(`${alias}: duplicate Tailwind alias`);
        aliases.set(alias, token.$extensions[EXTENSION].format === "channels" ? `rgb(var(${property}))` : `var(${property})`);
      }
      return property + separator + rawValue.replace(oldValue, value) + terminator;
    });
    for (const name of entries.keys()) if (!seen.has(name)) throw new Error(`${groupName}.${name}: missing CSS declaration`);
    output = output.slice(0, opening + 1) + block + output.slice(end);
  }
  for (const [alias, value] of aliases) {
    let count = 0;
    output = output.replace(new RegExp(`(--color-${alias}\\s*:\\s*)([^;]+)(;)`, "g"), (_, prefix, oldValue, suffix) => {
      count += 1;
      return prefix + oldValue.replace(oldValue.trim(), value) + suffix;
    });
    if (count !== 1) throw new Error(`${alias}: Tailwind alias must have one declaration`);
  }
  return output;
}

async function main() {
  const cssFile = new URL("../frontend/src/index.css", import.meta.url);
  const tokensFile = new URL("../frontend/src/theme/tokens.json", import.meta.url);
  const css = await readFile(cssFile, "utf8");
  const palette = JSON.parse(await readFile(tokensFile, "utf8"));
  const normalized = css.replace(/\r\n/g, "\n");
  const generated = updateDesignTokenCss(normalized, palette);
  if (process.argv.includes("--check")) {
    if (generated !== normalized) throw new Error("Design token CSS is stale. Run node scripts/generate-design-tokens.mjs and commit index.css.");
    console.log("Design token CSS and Tailwind aliases match the DTCG palette.");
  } else if (generated !== normalized) {
    await writeFile(cssFile, css.includes("\r\n") ? generated.replace(/\n/g, "\r\n") : generated);
    console.log("Updated design token CSS and Tailwind aliases.");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
