// merge-queue-files.mjs: fil-klassifikation til scripts/merge-queue.ps1.
//
// Ejer 10/10 (valg B): kun aendret PRODUKTIONSKODE skal vente paa
// deploy-verifikation alene. Maalt 10/10: 6 af 9 backend-PR'er aendrede kun
// tests eller dev-scripts og ventede alligevel ca. 30 min hver.
//
// touchesBackend = koden der koerer i prod er aendret (backend/ uden tests,
//                  test-data og dev-scripts; database/-migrationer).
// touchesRailway = Railway bygger igen (alt undtagen backend/railway.json's
//                  watchPatterns-undtagelser, review #6357).
// Ukendt eller tom filliste = begge true (fail-safe: aldrig batch uden bevis).
//
// touchesVercel  = Vercel bygger igen (#6859; kanonisk regel i
//                  frontend/scripts/vercel-build-decision.ts). Bruges kun til at
//                  pege den skyldige PR i et merge-tog ud, aldrig til ventelogik.
//
// CLI: node scripts/merge-queue-files.mjs <json-array-af-stier>  -> JSON paa stdout.

import { needsFrontendBuild } from '../frontend/scripts/vercel-build-decision.ts';

const NON_PROD_BACKEND = [
  /\.test\.(?:[cm]?js|ts|tsx)$/,
  /^backend\/test\//,
  /^backend\/scripts\/dev\//,
  /\/test-data\//,
  /\/__fixtures__\//,
  /^backend\/.*\.md$/,
];
const NO_RAILWAY = [/^(?:docs|pr-screens|superpowers|\.claude)\//, /^[^/]+\.md$/];

export function classifyPrFiles(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return { touchesBackend: true, touchesRailway: true };
  let touchesBackend = false;
  let touchesRailway = false;
  for (const p of paths) {
    if (typeof p !== 'string') return { touchesBackend: true, touchesRailway: true };
    if (!NO_RAILWAY.some((re) => re.test(p))) touchesRailway = true;
    if (p.startsWith('database/')) touchesBackend = true;
    if (p.startsWith('backend/') && !NON_PROD_BACKEND.some((re) => re.test(p))) touchesBackend = true;
  }
  return { touchesBackend, touchesRailway };
}

// Ejer 23/10: deploy-PR'er maa koere i tog (op til -MaxDeployBatch), men migrationer
// og race-motoren koerer altid ALENE med deres egen deploy-verifikation.
// Ukendt filliste = alene (fail-safe).
const SOLO = [
  /^database\//,
  /^supabase\/migrations\//,
  /^backend\/lib\/engine\//,
  /^backend\/lib\/raceEngine/,
  /^backend\/lib\/raceRunner/,
];
export function mustRunAlone(paths) {
  if (!Array.isArray(paths) || paths.length === 0 || paths.some((p) => typeof p !== 'string')) return true;
  return paths.some((p) => SOLO.some((re) => re.test(p)) && !NON_PROD_BACKEND.some((re) => re.test(p)));
}

// Ukendt filliste = true (samme fail-safe som ovenfor).
export function touchesVercel(paths) {
  if (!Array.isArray(paths) || paths.length === 0 || paths.some((p) => typeof p !== 'string')) return true;
  return needsFrontendBuild(paths);
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll('\\', '/')}` || process.argv[1]?.endsWith('merge-queue-files.mjs')) {
  let paths = null;
  try { paths = JSON.parse(process.argv[2] ?? 'null'); } catch { paths = null; }
  process.stdout.write(JSON.stringify({ ...classifyPrFiles(paths), touchesVercel: touchesVercel(paths), solo: mustRunAlone(paths) }));
}
