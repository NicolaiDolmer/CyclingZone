#!/usr/bin/env node
// Analyserer stage-races-<år>.md og udleder de tal #3326 skal kalibreres mod.
// Ren læsning — ingen netværk, ingen mutationer.
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

// Grand tours holdes uden for fordelingen (ejer-bekræftet: de beholder egen form).
const GRAND_TOURS = ['Giro', 'Tour de France', 'Vuelta'];
const isGT = (name) => GRAND_TOURS.some((g) => name.includes(g));

// Ikke-standard typer fra kilden. Beslutninger dokumenteret, ikke skjult:
//  - "Intermediate stage" (Giro/Tirreno, 6 forekomster) → hilly. Kildens ikon
//    antyder mellemsvær bjergetape; teksten siger det ikke. Sensitivitet vises.
//  - "Mountain time trial" (2 forekomster) → itt (det ER en enkeltstart, opad).
const REMAP = {
  'andet:Intermediate stage': 'hilly',
  'andet:Mountain time trial': 'itt',
};
const norm = (t) => REMAP[t] ?? t;

// Sværhedsgrad til "hvor falder den hårdeste etape".
const HARDNESS = { flat: 1, prologue: 1, itt: 2, ttt: 2, hilly: 3, mountain: 5 };
const hardness = (t) => HARDNESS[norm(t)] ?? 2;

function parseFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const races = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h && !/^#\s/.test(line)) {
      if (cur) races.push(cur);
      cur = { name: h[1], stages: [], source: null };
      continue;
    }
    if (!cur) continue;
    const src = line.match(/^kilde:\s*(\S+)/);
    if (src) { cur.source = src[1]; continue; }
    // | 1 | Flat stage | flat |
    const row = line.match(/^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/);
    if (row) cur.stages.push({ n: Number(row[1]), raw: row[2].trim(), norm: row[3].trim() });
  }
  if (cur) races.push(cur);
  return races.filter((r) => r.stages.length > 0);
}

const files = fs.readdirSync(DIR).filter((f) => /^stage-races-\d{4}\.md$/.test(f)).sort();
if (files.length === 0) { console.error('ingen datafiler fundet i', DIR); process.exit(1); }

// Kun løb hvor ALLE etaper har en genkendelig type tæller med. Et løb med
// UKENDT-rækker (fx Renewi Tour 2026, som Wikipedia endnu ikke dækker) ville
// ellers forurene fordelingen med ruteinfo i stedet for etapetype.
const KNOWN = new Set(['flat', 'hilly', 'mountain', 'itt', 'ttt', 'prologue']);
const isKnown = (t) => KNOWN.has(norm(t));

const all = [];
const dropped = [];
for (const f of files) {
  const races = parseFile(path.join(DIR, f));
  const ok = races.filter((r) => r.stages.every((s) => isKnown(s.norm)));
  for (const r of races) if (!ok.includes(r)) dropped.push(r.name);
  console.log(`${f}: ${ok.length}/${races.length} løb brugbare, ${ok.reduce((s, r) => s + r.stages.length, 0)} etaper`);
  all.push(...ok);
}
if (dropped.length) console.log(`\nUdeladt (ufuldstændig type-data): ${dropped.join(' · ')}`);
console.log(`\nI ALT: ${all.length} løb, ${all.reduce((s, r) => s + r.stages.length, 0)} etaper\n`);

function dist(races, pick, label) {
  const counts = {};
  for (const r of races) {
    const v = pick(r);
    counts[v] = (counts[v] || 0) + 1;
  }
  const total = races.length;
  console.log(`--- ${label} (n=${total}) ---`);
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(22)} ${String(v).padStart(3)}  ${(100 * v / total).toFixed(1)} %`);
  }
  console.log();
}

const oneWeek = all.filter((r) => !isGT(r.name));
const gts = all.filter((r) => isGT(r.name));

// CyclingZone-arketyperne i #3326, mappet fra kildens etapetyper.
const ARCHETYPE = { flat: 'sprint_finale', mountain: 'summit_finale', itt: 'tt_finale', ttt: 'tt_finale', hilly: 'circuit_finale', prologue: 'tt_finale' };

for (const [label, set] of [['ALLE', all], ['EN-UGES (ikke-GT)', oneWeek], ['GRAND TOURS', gts]]) {
  if (set.length === 0) continue;
  console.log(`\n========== ${label} ==========\n`);
  dist(set, (r) => norm(r.stages[r.stages.length - 1].norm), 'SIDSTE etapes type');
  dist(set, (r) => ARCHETYPE[norm(r.stages[r.stages.length - 1].norm)] ?? '?', 'SIDSTE etape → #3326-arketype');
  dist(set, (r) => norm(r.stages[0].norm), 'FØRSTE etapes type');

  // Hvor falder den hårdeste etape, målt fra slutningen? 0 = sidste dag.
  dist(set, (r) => {
    const maxH = Math.max(...r.stages.map((s) => hardness(s.norm)));
    // sidste forekomst af den hårdeste type
    let idx = -1;
    r.stages.forEach((s, i) => { if (hardness(s.norm) === maxH) idx = i; });
    const fromEnd = r.stages.length - 1 - idx;
    return fromEnd === 0 ? 'sidste dag' : fromEnd === 1 ? 'næstsidste' : fromEnd === 2 ? 'tredjesidste' : `${fromEnd} dage før slut`;
  }, 'HÅRDESTE etape — hvor mange dage før slut');
}

// Andel af en-uges-løb hvor sidste etape IKKE er den hårdeste
const notLast = oneWeek.filter((r) => {
  const maxH = Math.max(...r.stages.map((s) => hardness(s.norm)));
  return hardness(r.stages[r.stages.length - 1].norm) < maxH;
});
console.log(`\nEn-uges-løb hvor sidste etape IKKE er den hårdeste: ${notLast.length}/${oneWeek.length} = ${(100 * notLast.length / oneWeek.length).toFixed(1)} %`);

const flatOpen = all.filter((r) => r.stages[0].norm === 'flat').length;
console.log(`Løb der åbner fladt: ${flatOpen}/${all.length} = ${(100 * flatOpen / all.length).toFixed(1)} %  → varieret åbning = ${(100 - 100 * flatOpen / all.length).toFixed(1)} %`);
