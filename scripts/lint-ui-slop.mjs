#!/usr/bin/env node
// scripts/lint-ui-slop.mjs
// ============================================================
// UI anti-drift forward-guard — #671 Plan 3 (spec DEL-C C1).
//
// REGEL (dokumenteret her som single source of truth):
//   Ny UI bruger ui/-primitiver + design-tokens. INGEN raa hex-farver i
//   frontend/src (kun index.css token-definitioner), INGEN slop-tells
//   (rounded-xl/2xl/3xl, glow `shadow-[0_0...]`, backdrop-blur, blob-blur
//   `blur-2xl/3xl`), INGEN emoji som ikon i JSX (brug ui/icons/).
//
// FORWARD-GUARD, ikke retroaktivt brud: de ~366 eksisterende callsites + al
// nuvaerende emoji er Plan 4's job. Kendte overtraedelser ligger i
// scripts/ui-slop-baseline.json (per-fil/per-kategori count-ratchet — maa kun
// skrumpe). Guarden fejler KUN paa NYE overtraedelser (flere i en fil end
// baseline, eller en ny fil). Praecis samme form som i18n-check-leaks.mjs.
//
// Brug:
//   node scripts/lint-ui-slop.mjs                    # check (CI + pre-commit)
//   node scripts/lint-ui-slop.mjs --update-baseline  # regenerér baseline
//
// Evt. fil-sti-args fra lint-staged ignoreres — scannen er altid fuld-repo
// (frontend/src) saa resultatet er deterministisk uanset hvad der er staged.
//
// Refs #671.

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const BASELINE_PATH = join(ROOT, "scripts", "ui-slop-baseline.json");
const SRC_DIR = join(ROOT, "frontend", "src");

// index.css er token-definitions-filen: raa hex er LEGITIMT der (det er hele
// pointen — tokens defineres ét sted). Helt undtaget fra scannen.
export const EXEMPT_FILES = new Set(["frontend/src/index.css"]);

// --- Detektorer (rene funktioner paa kildestrenge) ------------------------

// Raa hex: #RGB / #RGBA / #RRGGBB / #RRGGBBAA, ikke efterfulgt af endnu et
// hex-tegn (saa #ffff0 / #section ikke fejl-matcher).
const HEX_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g;

// Slop-tells (navngivne saa fejlbeskeden er handlingsbar).
export const SLOP_PATTERNS = [
  ["rounded-xl", /\brounded-xl\b/g],
  ["rounded-2xl", /\brounded-2xl\b/g],
  ["rounded-3xl", /\brounded-3xl\b/g],
  ["glow-shadow", /shadow-\[0_0/g],
  ["backdrop-blur", /\bbackdrop-blur\b/g],
  ["blob-blur", /\bblur-(?:2xl|3xl)\b/g],
];

// Emoji-som-ikon: Extended_Pictographic minus tekst-symboler (©®™) der teknisk
// er pictographic men legitime i copy.
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const EMOJI_TEXT_EXEMPT = new Set(["©", "®", "™"]); // © ® ™

export function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

export function countHex(src) {
  return (stripComments(src).match(HEX_RE) ?? []).length;
}

export function countSlop(src) {
  const clean = stripComments(src);
  let n = 0;
  for (const [, re] of SLOP_PATTERNS) n += (clean.match(re) ?? []).length;
  return n;
}

export function countEmoji(src) {
  const matches = stripComments(src).match(EMOJI_RE) ?? [];
  return matches.filter((ch) => !EMOJI_TEXT_EXEMPT.has(ch)).length;
}

export function scanSource(src) {
  return { hex: countHex(src), slop: countSlop(src), emoji: countEmoji(src) };
}
