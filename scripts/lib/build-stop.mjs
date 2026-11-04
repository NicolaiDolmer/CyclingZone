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
//
// Loftet (ejer 4/11, MASTERPLAN "Loftet afløser byggestoppet"): et issue uden
// for listerne må også bygges, når det hører til et af loft-områderne (label,
// titel-nøgleord eller under et loft-epic) -> 'loft', eller har en brand/forkert
// info-label -> 'brand'. Listerne gælder stadig som fallback. Alt andet kræver
// ejerens go. Label/titel/forælder læses fra GitHub kun for issues der ellers
// ville være 'new', og kun når cfg.loft findes.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const DEFAULT_FILE = new URL('../build-stop.json', import.meta.url);
// Loggen ligger i boelgens delte run-dir (samme mappe som wave-active.json),
// saa den overlever at et worktree ryddes op. Kalderen giver stien.
export const BRAND_LOG_NAME = 'build-stop-brand-log.jsonl';
export const brandLogPath = dir => process.env.CZ_BUILD_STOP_LOG || path.join(dir, BRAND_LOG_NAME);
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
  if (cfg.loft !== undefined) validateLoft(cfg.loft, cfg.areaCap);
  return cfg;
}

const isStrList = a => Array.isArray(a) && a.every(s => typeof s === 'string' && s.trim());

function validateLoft(loft, areaCap) {
  if (!loft || !Array.isArray(loft.areas) || !loft.areas.length) throw Error('build-stop: "loft.areas" skal være en ikke-tom liste');
  if (loft.areas.length > areaCap) throw Error(`build-stop: loft har ${loft.areas.length} områder, loft ${areaCap}`);
  const names = new Set();
  for (const a of loft.areas) {
    if (typeof a?.area !== 'string' || !a.area.trim()) throw Error('build-stop: loft-område mangler "area"');
    if (names.has(a.area)) throw Error(`build-stop: loft-område "${a.area}" står to gange`);
    names.add(a.area);
    for (const key of ['labels', 'titleKeywords']) {
      if (!isStrList(a[key])) throw Error(`build-stop: loft-område "${a.area}": "${key}" skal være en liste af tekster`);
    }
    if (!Array.isArray(a.epics) || !a.epics.every(isIssue)) throw Error(`build-stop: loft-område "${a.area}": "epics" skal være en liste af issue-numre`);
    if (!a.labels.length && !a.titleKeywords.length && !a.epics.length) throw Error(`build-stop: loft-område "${a.area}" matcher intet`);
  }
  if (!isStrList(loft.brandLabels) || !loft.brandLabels.length) throw Error('build-stop: "loft.brandLabels" skal være en ikke-tom liste af labels');
}

const lower = s => String(s).toLowerCase();
const labelNames = labels => (Array.isArray(labels) ? labels : []).map(l => lower(typeof l === 'string' ? l : l?.name || ''));

// Ren: item = { issue, labels?, title?, parent? } -> loft-område eller null.
export function matchLoft(item, loft) {
  if (!loft) return null;
  const labels = labelNames(item?.labels);
  const title = lower(item?.title || '');
  for (const a of loft.areas) {
    const label = a.labels.find(l => labels.includes(lower(l)));
    if (label) return { area: a.area, via: `label ${label}` };
    const epic = a.epics.find(n => n === item?.issue || n === item?.parent);
    if (epic) return { area: a.area, via: epic === item?.issue ? `epic #${epic}` : `under epic #${epic}` };
    const kw = title && a.titleKeywords.find(k => title.includes(lower(k)));
    if (kw) return { area: a.area, via: `titel "${kw}"` };
  }
  return null;
}

// Ren: brand/forkert info-label -> labelnavnet, ellers null.
export function matchBrandLabel(item, loft) {
  if (!loft) return null;
  const labels = labelNames(item?.labels);
  return loft.brandLabels.find(l => labels.includes(lower(l))) || null;
}

// Label, titel og forælder fra GitHub (én GraphQL-kald). null ved enhver fejl,
// så et utilgængeligt GitHub aldrig åbner porten - issuet forbliver 'new'.
export function ghIssueMeta(issue, { repo = 'NicolaiDolmer/CyclingZone', exec = execFileSync, timeout = 20000 } = {}) {
  if (process.env.CZ_BUILD_STOP_NO_GH === '1') return null; // tests: ingen netværk
  const [owner, name] = repo.split('/');
  const query = 'query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){title labels(first:50){nodes{name}} parent{number}}}}';
  try {
    const out = exec('gh', ['api', 'graphql', '-f', `query=${query}`, '-F', `o=${owner}`, '-F', `r=${name}`, '-F', `n=${issue}`],
      { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'] });
    const node = JSON.parse(out)?.data?.repository?.issue;
    if (!node) return null;
    return { title: node.title || '', labels: (node.labels?.nodes || []).map(l => l.name), parent: node.parent?.number ?? null };
  } catch {
    return null; // Ingen gh/ingen adgang/ukendt issue: forbliver 'new', afvisningen siger hvorfor.
  }
}

// Beriger kun de spor der ellers ville være 'new', og kun når loftet er sat.
// Spor der allerede har labels, hentes ikke igen. Alle opslag deler én frist,
// så et langsomt GitHub aldrig får optaget til at overleve hookens timeout
// (guard-agent-spawn); efter fristen forbliver resten 'new' (fail closed).
export const META_BUDGET_MS = 45000;
export function withIssueMeta(items, cfg, fetchMeta = ghIssueMeta, { budgetMs = META_BUDGET_MS, now = Date.now } = {}) {
  if (!cfg?.loft || !fetchMeta) return items;
  const deadline = now() + budgetMs;
  return items.map(t => {
    if (!t || Array.isArray(t.labels) || classifyWork(t, cfg).cls !== 'new') return t;
    const left = deadline - now();
    const meta = left > 0 ? fetchMeta(t.issue, { timeout: Math.min(20000, left) }) : null;
    return meta ? { ...t, ...meta } : { ...t, metaUnavailable: true };
  });
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
  const brandLabel = matchBrandLabel(item, cfg.loft);
  if (brandLabel) return { cls: 'brand', area: null, reason: `brand-label ${brandLabel}` };
  const loft = matchLoft(item, cfg.loft);
  if (loft) return { cls: 'loft', area: loft.area, reason: `loft-område ${loft.area} (${loft.via})` };
  return { cls: 'new', area: null, reason: cfg.loft ? 'uden for loftet, ikke på listen og ikke brand' : 'ikke på fase 1-listen og ikke brand' };
}

// Returnerer sporene beriget med GitHub-metadata, så kalderen kan logge
// brand-valg ud fra samme klassifikation som optaget.
export function assertBuildStop(items, cfg = loadBuildStop(), { fetchMeta = ghIssueMeta } = {}) {
  if (!cfg.active) return items;
  const admitted = withIssueMeta(items, cfg, fetchMeta);
  const blocked = admitted.filter(t => classifyWork(t, cfg).cls === 'new');
  if (!blocked.length) return admitted;
  const ids = blocked.map(t => `#${t.issue}${t.metaUnavailable ? ' (labels kunne ikke læses fra GitHub)' : ''}`);
  if (cfg.loft) {
    throw Error(`Loftet (ejer 4/11): ${ids.join(', ')} er uden for loftet. Kun de tre loft-områder (${cfg.loft.areas.map(a => a.area).join(', ')}), brand/forkert info og issues i scripts/build-stop.json må bygges uden ejer-go. Hører det til et loft-område, så giv det områdets label; er det brand, så giv det label ${cfg.loft.brandLabels[0]} eller tilføj det til brandList med en begrundelse; ellers kræver det ejerens go (triage:new).`);
  }
  throw Error(`Byggestop (spec 2026-10-29 §3.1): ${ids.join(', ')} er nyt arbejde. Kun fase 1-listen, åbne PR'er fra 29/10 og brand må bygges nu. Er det brand (live hos spillerne og forkert), så tilføj det til brandList i scripts/build-stop.json med en begrundelse; ellers hører det i triage:new.`);
}

// Afslutningskortet (spec §3.3) viser hvert brand-valg, så ejeren kan nedlægge veto.
export function logBrandAdmissions(items, cfg, { channel, now = Date.now(), file } = {}) {
  const lines = items
    .map(t => ({ t, c: classifyWork(t, cfg) }))
    .filter(({ c }) => c.cls === 'brand')
    .map(({ t, c }) => JSON.stringify({ at: new Date(now).toISOString(), issue: t.issue, reason: c.reason, channel }));
  if (!lines.length) return 0;
  if (!file) throw Error('build-stop: logBrandAdmissions kraever "file" (brug brandLogPath(runDir))');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, lines.join('\n') + '\n');
  return lines.length;
}
