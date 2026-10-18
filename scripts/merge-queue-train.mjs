// merge-queue-train.mjs: merge-tog-logik til scripts/merge-queue.ps1 (#6859).
//
// Ejer 18/10: flere groenne PR'er merges i eet tog -> eet deploy og een
// verifikation. Fejler verifikationen, skal koeen selv pege den skyldige PR
// ud og stoppe. Den goer det ud fra beviser, aldrig ved at deploye
// mellemtilstande eller revertere main (et prod-indgreb kraever ejer-go):
//   1. Kun een PR i toget -> den.
//   2. CI (main) roed: den FOERSTE merge-SHA med roed CI (CI koerer pr. SHA).
//   3. Deploy-fejl: de PR'er der udloeser det fejlende maal
//      (vercel / railway; smoke = begge). Er der praecis een, er den skyldig.
//   4. Ellers: en mistaenktliste i merge-raekkefoelge, og koeen stopper.
//
// CLI: node scripts/merge-queue-train.mjs culprit <json>  -> JSON paa stdout.
//   json = { failure: 'ci'|'vercel'|'railway'|'smoke'|'unknown',
//            prs: [{ number, ciOk, touchesBackend, touchesRailway, touchesVercel }] }

const FAILURES = new Set(['ci', 'vercel', 'railway', 'smoke', 'unknown']);

export function findTrainCulprit({ failure, prs } = {}) {
  const valid = Array.isArray(prs) && prs.length > 0 && prs.every((pr) => Number.isSafeInteger(pr?.number));
  if (!valid) return { culprit: null, suspects: [], reason: 'ukendt tog' };
  const all = prs.map((pr) => pr.number);
  if (prs.length === 1) return { culprit: all[0], suspects: all, reason: 'eneste PR i toget' };
  const kind = FAILURES.has(failure) ? failure : 'unknown';
  if (kind === 'ci') {
    const red = prs.find((pr) => pr.ciOk === false);
    if (red) return { culprit: red.number, suspects: [red.number], reason: 'foerste merge-SHA med roed CI (main)' };
    return { culprit: null, suspects: all, reason: 'CI (main) roed, men ingen enkelt SHA kunne udpeges' };
  }
  // Ukendt klassifikation (feltet mangler) taeller som "udloeser maalet".
  const hits = (pr, key) => pr[key] !== false;
  let suspects;
  if (kind === 'vercel') suspects = prs.filter((pr) => hits(pr, 'touchesVercel'));
  // Railway bygger paa naesten alt; backend-produktionskode er den skarpe mistanke.
  else if (kind === 'railway') {
    const backend = prs.filter((pr) => hits(pr, 'touchesBackend'));
    suspects = backend.length > 0 ? backend : prs.filter((pr) => hits(pr, 'touchesRailway'));
  } else if (kind === 'smoke') suspects = prs.filter((pr) => hits(pr, 'touchesBackend') || hits(pr, 'touchesVercel'));
  else suspects = [];
  const numbers = suspects.map((pr) => pr.number);
  if (numbers.length === 1) return { culprit: numbers[0], suspects: numbers, reason: `eneste PR i toget der udloeser ${kind}` };
  if (numbers.length === 0) return { culprit: null, suspects: all, reason: `ingen PR kunne kobles til fejlen (${kind})` };
  return { culprit: null, suspects: numbers, reason: `flere PR'er udloeser ${kind}` };
}

if (process.argv[1]?.endsWith('merge-queue-train.mjs')) {
  let input = null;
  try { input = JSON.parse(process.argv[3] ?? 'null'); } catch { input = null; }
  if (process.argv[2] === 'culprit') process.stdout.write(JSON.stringify(findTrainCulprit(input ?? {})));
  else { process.stderr.write('brug: merge-queue-train.mjs culprit <json>\n'); process.exitCode = 2; }
}
