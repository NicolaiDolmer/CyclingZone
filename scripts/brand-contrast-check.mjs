#!/usr/bin/env node
/**
 * WCAG 2.1 contrast gate for the Cycling Zone brand palette.
 *
 *   node scripts/brand-contrast-check.mjs
 *
 * Computes contrast ratios for the locked + candidate color pairings and flags
 * anything below WCAG AA. Run it before locking any color decision (#481 P2/P3).
 * Pure JS, no dependencies. Thresholds (WCAG 2.1):
 *   text normal AA 4.5 / AAA 7.0   ·   text large AA 3.0 / AAA 4.5   ·   UI/graphic 3.0
 */

const hexToRgb = (h) => {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (fg, bg) => {
  const a = lum(hexToRgb(fg)), b = lum(hexToRgb(bg));
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
};

// kind: 'text' (4.5/3.0), 'large' (3.0/4.5), 'ui' (3.0)
const PAIRS = [
  // --- DARK MODE (canvas #0e0f15 locked, sidebar #1a1f38) ---
  ['DARK', 'Body text on canvas', '#ededf2', '#0e0f15', 'text'],
  ['DARK', 'Muted text-2 on canvas', '#9da0b3', '#0e0f15', 'text'],
  ['DARK', 'Faint text-3 on canvas', '#6b6d7e', '#0e0f15', 'text'],
  ['DARK', 'Gold accent on canvas', '#e8c547', '#0e0f15', 'large'],
  ['DARK', 'Gold-bright on canvas', '#ffd966', '#0e0f15', 'large'],
  ['DARK', 'Navy on gold (button label)', '#1a1f38', '#e8c547', 'text'],
  ['DARK', 'White on sidebar', '#ffffff', '#1a1f38', 'text'],
  ['DARK', 'Gold on sidebar', '#e8c547', '#1a1f38', 'large'],

  // --- LIGHT MODE (live cream #f0ede6) ---
  ['LIGHT', 'Body text on cream', '#1c1b26', '#f0ede6', 'text'],
  ['LIGHT', 'Muted text-2 on cream', '#66637a', '#f0ede6', 'text'],
  ['LIGHT', 'Gold accent on cream', '#e8c547', '#f0ede6', 'large'],
  ['LIGHT', 'Deep gold accent on cream', '#a07800', '#f0ede6', 'large'],
  ['LIGHT', 'Navy on cream', '#1a1f38', '#f0ede6', 'text'],

  // --- LIGHT CANVAS CANDIDATES (P2): navy text + gold accent ---
  ['CAND A · Newsprint', 'Navy text', '#0e0f15', '#f5edcf', 'text'],
  ['CAND A · Newsprint', 'Gold accent (note: low)', '#e8c547', '#f5edcf', 'large'],
  ['CAND B · Velodrome', 'Navy text', '#0e0f15', '#f0e6cf', 'text'],
  ['CAND B · Velodrome', 'Gold accent', '#e8c547', '#f0e6cf', 'large'],
  ['CAND C · Race-bib', 'Navy text', '#0e0f15', '#faf8ee', 'text'],
  ['CAND C · Race-bib', 'Gold accent', '#e8c547', '#faf8ee', 'large'],
  ['CAND D · Cobblestone', 'Navy text', '#0e0f15', '#e8e7e3', 'text'],
  ['CAND D · Cobblestone', 'Gold accent', '#e8c547', '#e8e7e3', 'large'],
];

const THRESH = { text: [4.5, 7.0], large: [3.0, 4.5], ui: [3.0, 3.0] };

let fails = 0;
let group = '';
console.log('\nWCAG 2.1 contrast gate — Cycling Zone brand palette\n' + '='.repeat(64));
for (const [grp, label, fg, bg, kind] of PAIRS) {
  if (grp !== group) { console.log(`\n${grp}`); group = grp; }
  const r = ratio(fg, bg);
  const [aa, aaa] = THRESH[kind];
  const passAA = r >= aa;
  const verdict = !passAA ? 'FAIL AA' : r >= aaa ? 'AAA' : 'AA';
  if (!passAA) fails++;
  const mark = !passAA ? 'x' : 'ok';
  console.log(
    `  [${mark}] ${label.padEnd(30)} ${fg} on ${bg}  ` +
    `${r.toFixed(2).padStart(5)}:1  (${kind}, need ${aa})  ${verdict}`
  );
}
console.log('\n' + '='.repeat(64));
console.log(fails === 0
  ? 'PASS — every pairing meets WCAG AA.'
  : `${fails} pairing(s) below AA. Review before locking (a low gold-on-light is expected; use deep gold or navy for accents on light canvases).`);
process.exit(0);
