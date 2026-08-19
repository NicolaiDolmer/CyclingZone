// developmentGlyph.js — #3721: rene beregninger for DevelopmentGlyph
// (components/development/DevelopmentGlyph.jsx). Adskilt fra .jsx-filen fordi
// `node --test` (frontend/src) ikke har en JSX-loader — samme mønster som
// resten af repoet (visning i .jsx, testbar logik i .js, jf.
// lib/trainingReport.js ↔ AbilityReceiptRow.jsx).
//
// pct: FAST 0-max-skala → procent [0,100], klampet. Returnerer null for
// ikke-endelige input (og for max<=0), så en glyf kan skelne "intet tal" fra
// et reelt 0-punkt i stedet for at tegne et 0%-segment for manglende data.
export function pct(value, max) {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return null;
  return Math.max(0, Math.min(100, (value / max) * 100));
}
