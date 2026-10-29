// Byggestop (#7336, spec docs/superpowers/specs/2026-10-29-foelg-til-doers-design.md §3.1-3.3).
//
// HVORFOR: 90 dage målt 29/10 - backloggen voksede 455 -> 942, kun 39 % af
// de byggbare specs blev afleveret helt, og færdig kode lå slukket i ugevis.
// Indtil ejerens rangerede fase 1-liste er afsluttet, må der KUN optages:
//   finish  - issue på finishList (højst areaCap områder ad gangen)
//   cleanup - issue bag en PR der allerede var åben 29/10 (engangsoprydning, uden for loftet)
//   brand   - issue på brandList: live hos spillerne og forkert. Claude
//             klassificerer, ejeren kan nedlægge veto (fjern linjen -> triage:new).
//   exempt  - undersøgelsesspor (kind:'investigate'), de bygger intet.
// Alt andet er nyt arbejde og afvises. Listerne står i scripts/build-stop.json,
// så hver ændring er synlig i en diff.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_FILE = new URL('../build-stop.json', import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_LOG = path.join(REPO_ROOT, '.claude', 'run', 'build-stop-brand-log.jsonl');
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isIssue = n => Number.isSafeInteger(n) && n > 0;

export function validateBuildStop(cfg) {
  if (!cfg || typeof cfg.active !== 'boolean') throw Error('build-stop: "active" skal være true/false');
  if (!isDate(cfg.since)) throw Error('build-stop: "since" skal være YYYY-MM-DD');
  if (!Number.isSafeInteger(cfg.areaCap) || cfg.areaCap < 1) throw Error('build-stop: "areaCap" skal være et positivt heltal');
  for (const key of ['finishList', 'cleanupList', 'brandList']) {
    if (!Array.isArray(cfg[key])) throw Error(`build-stop: "${key}" skal være en liste`);
  }
  const seen = new Map();
  const claim = (issue, list) => {
    if (!isIssue(issue)) throw Error(`build-stop: ugyldigt issue i ${list}: ${JSON.stringify(issue)}`);
    if (seen.has(issue)) throw Error(`build-stop: #${issue} står på flere lister (${seen.get(issue)} og ${list})`);
    seen.set(issue, list);
  };
  for (const e of cfg.finishList) {
    claim(e.issue, 'finishList');
    if (typeof e.area !== 'string' || !e.area.trim()) throw Error(`build-stop: #${e.issue} på finishList mangler "area"`);
  }
  for (const e of cfg.cleanupList) claim(e.issue, 'cleanupList');
  for (const e of cfg.brandList) {
    claim(e.issue, 'brandList');
    if (typeof e.reason !== 'string' || !e.reason.trim()) throw Error(`build-stop: brand #${e.issue} mangler begrundelse ("reason")`);
    if (!isDate(e.since)) throw Error(`build-stop: brand #${e.issue} mangler "since" (YYYY-MM-DD)`);
  }
  const areas = new Set(cfg.finishList.map(e => e.area));
  if (areas.size > cfg.areaCap) throw Error(`build-stop: finishList har ${areas.size} områder, loft ${cfg.areaCap} (${[...areas].join(', ')}). Gør et område færdigt før det næste tilføjes.`);
  return cfg;
}

export function loadBuildStop(file = process.env.CZ_BUILD_STOP_FILE || DEFAULT_FILE) {
  return validateBuildStop(JSON.parse(fs.readFileSync(file, 'utf8')));
}

// item = { issue, kind? } -> { cls, area, reason }
export function classifyWork(item, cfg) {
  if (item?.kind === 'investigate') return { cls: 'exempt', area: null, reason: 'undersøgelse bygger intet' };
  const finish = cfg.finishList.find(e => e.issue === item?.issue);
  if (finish) return { cls: 'finish', area: finish.area, reason: `fase 1-listen: ${finish.area}` };
  const cleanup = cfg.cleanupList.find(e => e.issue === item?.issue);
  if (cleanup) return { cls: 'cleanup', area: null, reason: `engangsoprydning: ${cleanup.why || 'åben PR 29/10'}` };
  const brand = cfg.brandList.find(e => e.issue === item?.issue);
  if (brand) return { cls: 'brand', area: null, reason: brand.reason };
  return { cls: 'new', area: null, reason: 'ikke på fase 1-listen og ikke brand' };
}

export function assertBuildStop(items, cfg = loadBuildStop()) {
  if (!cfg.active) return;
  const blocked = items.filter(t => classifyWork(t, cfg).cls === 'new').map(t => `#${t.issue}`);
  if (!blocked.length) return;
  throw Error(`Byggestop (spec 2026-10-29 §3.1): ${blocked.join(', ')} er nyt arbejde. Kun fase 1-listen, åbne PR'er fra 29/10 og brand må bygges nu. Er det brand (live hos spillerne og forkert), så tilføj det til brandList i scripts/build-stop.json med en begrundelse; ellers hører det i triage:new.`);
}

// Afslutningskortet (spec §3.3) viser hvert brand-valg, så ejeren kan nedlægge veto.
export function logBrandAdmissions(items, cfg, { channel, now = Date.now(), file = process.env.CZ_BUILD_STOP_LOG || DEFAULT_LOG } = {}) {
  const lines = items
    .map(t => ({ t, c: classifyWork(t, cfg) }))
    .filter(({ c }) => c.cls === 'brand')
    .map(({ t, c }) => JSON.stringify({ at: new Date(now).toISOString(), issue: t.issue, reason: c.reason, channel }));
  if (!lines.length) return 0;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, lines.join('\n') + '\n');
  return lines.length;
}
