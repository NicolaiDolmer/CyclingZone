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
  ['DARK', 'Faint text-3 on canvas (incumbent FAILS)', '#6b6d7e', '#0e0f15', 'text'],
  ['DARK', 'Gold accent on canvas', '#e8c547', '#0e0f15', 'large'],
  ['DARK', 'Gold-bright on canvas', '#ffd966', '#0e0f15', 'large'],
  ['DARK', 'Navy on gold (button label)', '#1a1f38', '#e8c547', 'text'],
  ['DARK', 'White on sidebar', '#ffffff', '#1a1f38', 'text'],
  ['DARK', 'Gold on sidebar', '#e8c547', '#1a1f38', 'large'],

  // --- LIGHT MODE (LOCKED P2 = E "Chalk" #f4f2ec; card #fcfbf7, elevated #ffffff) ---
  ['LIGHT CHALK', 'Body text-1 on canvas', '#1c1b26', '#f4f2ec', 'text'],
  ['LIGHT CHALK', 'Body text-1 on card', '#1c1b26', '#fcfbf7', 'text'],
  ['LIGHT CHALK', 'Muted text-2 on canvas', '#66637a', '#f4f2ec', 'text'],
  ['LIGHT CHALK', 'Gold accent on canvas (expected FAIL)', '#e8c547', '#f4f2ec', 'large'],
  ['LIGHT CHALK', 'Deep-gold accent on canvas', '#a07800', '#f4f2ec', 'large'],
  ['LIGHT CHALK', 'Navy foreground on canvas', '#0e0f15', '#f4f2ec', 'text'],

  // --- D-SURF · Surface ladder (steps verified as UI/graphic separation, 3.0) ---
  // DARK incumbent ladder: canvas->card->elevated->overlay
  ['D-SURF DARK', 'Body text on card #161824', '#ededf2', '#161824', 'text'],
  ['D-SURF DARK', 'Body text on elevated #1f2233', '#ededf2', '#1f2233', 'text'],
  ['D-SURF DARK', 'Body text on overlay #272a3d', '#ededf2', '#272a3d', 'text'],
  // DARK candidate 2 (wider steps)
  ['D-SURF DARK alt', 'Body text on card #1a1d2b', '#ededf2', '#1a1d2b', 'text'],
  ['D-SURF DARK alt', 'Body text on elevated #242838', '#ededf2', '#242838', 'text'],
  ['D-SURF DARK alt', 'Body text on overlay #2e3346', '#ededf2', '#2e3346', 'text'],
  // LIGHT Chalk incumbent ladder
  ['D-SURF CHALK', 'Navy text on card #fcfbf7', '#0e0f15', '#fcfbf7', 'text'],
  ['D-SURF CHALK', 'Navy text on elevated #ffffff', '#0e0f15', '#ffffff', 'text'],
  // LIGHT Chalk candidate 2 (more saturated steps)
  ['D-SURF CHALK alt', 'Navy text on card #faf7ef', '#0e0f15', '#faf7ef', 'text'],
  ['D-SURF CHALK alt', 'Navy text on elevated #fffdf8', '#0e0f15', '#fffdf8', 'text'],

  // --- D-SEM · Semantic colors (as text/UI, AA 4.5) ---
  // LIGHT Chalk · Set 1 (corrected current)
  ['D-SEM CHALK set1', 'success #15772f', '#15772f', '#f4f2ec', 'text'],
  ['D-SEM CHALK set1', 'error #b91c1c', '#b91c1c', '#f4f2ec', 'text'],
  ['D-SEM CHALK set1', 'warning #a14e08', '#a14e08', '#f4f2ec', 'text'],
  ['D-SEM CHALK set1', 'info #1d4ed8', '#1d4ed8', '#f4f2ec', 'text'],
  // LIGHT Chalk · Set 2 (deeper)
  ['D-SEM CHALK set2', 'success #15722f', '#15722f', '#f4f2ec', 'text'],
  ['D-SEM CHALK set2', 'error #a81e1e', '#a81e1e', '#f4f2ec', 'text'],
  ['D-SEM CHALK set2', 'warning #9a5b00', '#9a5b00', '#f4f2ec', 'text'],
  ['D-SEM CHALK set2', 'info #1a47c0', '#1a47c0', '#f4f2ec', 'text'],
  // DARK · Set 1 (current)
  ['D-SEM DARK set1', 'success #4ade80', '#4ade80', '#0e0f15', 'text'],
  ['D-SEM DARK set1', 'error #f87171', '#f87171', '#0e0f15', 'text'],
  ['D-SEM DARK set1', 'warning #fbbf24 (collides w/ gold)', '#fbbf24', '#0e0f15', 'text'],
  ['D-SEM DARK set1', 'info #60a5fa', '#60a5fa', '#0e0f15', 'text'],
  // DARK · Set 2 (warning shifted orange, off gold)
  ['D-SEM DARK set2', 'success #5fd98a', '#5fd98a', '#0e0f15', 'text'],
  ['D-SEM DARK set2', 'error #fb8484', '#fb8484', '#0e0f15', 'text'],
  ['D-SEM DARK set2', 'warning #f0a830', '#f0a830', '#0e0f15', 'text'],
  ['D-SEM DARK set2', 'info #7ab0fb', '#7ab0fb', '#0e0f15', 'text'],

  // --- D-TEXT3 · Dark tertiary text AA fix (need 4.5, stay < text-2 7.39) ---
  ['D-TEXT3 DARK', 'incumbent #6b6d7e (FAILS)', '#6b6d7e', '#0e0f15', 'text'],
  ['D-TEXT3 DARK', 'cand 1 #7e8194', '#7e8194', '#0e0f15', 'text'],
  ['D-TEXT3 DARK', 'cand 2 #888ba0', '#888ba0', '#0e0f15', 'text'],
  ['D-TEXT3 DARK', 'cand 3 #9396ab', '#9396ab', '#0e0f15', 'text'],

  // --- D-P3B · Race-night navy as light-mode foreground on Chalk (need 4.5) ---
  ['D-P3B CHALK', 'locked navy #0e0f15 as fg', '#0e0f15', '#f4f2ec', 'text'],
  ['D-P3B CHALK', 'race-night #0a1024 as fg', '#0a1024', '#f4f2ec', 'text'],
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
