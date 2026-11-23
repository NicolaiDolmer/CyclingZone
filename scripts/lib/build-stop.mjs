// Byggestop (#7336, spec docs/superpowers/specs/2026-10-29-foelg-til-doers-design.md §3.1-3.3).
//
// HVORFOR: 90 dage målt 29/10 - backloggen voksede 455 -> 942, kun 39 % af
// de byggbare specs blev afleveret helt, og færdig kode lå slukket i ugevis.
// Indtil ejerens rangerede fase 1-liste er afsluttet, må der KUN optages:
//   finish  - issue på finishList (ingen øvre grænse på antal områder)
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
//
// Ejerens go (ejer 23/11): et issue med ejerens go-markør i en issue-kommentar
// tæller som på listen ('finish' med markørens område), uden en ekstra PR til
// build-stop.json. Se findOwnerGo() og scripts/build-stop-go.mjs.
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
  if (cfg.loft !== undefined) validateLoft(cfg.loft);
  return cfg;
}

const isStrList = a => Array.isArray(a) && a.every(s => typeof s === 'string' && s.trim());

function validateLoft(loft) {
  if (!loft || !Array.isArray(loft.areas) || !loft.areas.length) throw Error('build-stop: "loft.areas" skal være en ikke-tom liste');
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

// Ejerens go som markør på issuet (#7336, ejer 23/11: "Behold vagten, fjern
// bremsen"). Et issue tæller som på listen, når en kommentar på selve issuet
// fra repo-ejerens konto indeholder
//   <!-- build-stop: ejer-go area=<område> -->
// sammen med ejerens ordrette citat i anførselstegn. Samme tillidsmodel som
// merge-autotrains ejer-merge-markør: kommentarer fra andre konti ignoreres
// (repoet er offentligt), og markøren skrives kun efter ejerens ordrette ja
// (scripts/build-stop-go.mjs). build-stop.json gælder uændret; markøren er et
// ekstra spor. Kode (blokke og inline) tæller aldrig, så et eksempel på
// formatet i en kommentar ikke åbner porten.
export const OWNER_GO_MARKER_RE = /<!--\s*build-stop:\s*ejer-go\s+area=([\p{L}\p{N}._-]{1,40})\s*-->/iu;
const QUOTE_RE = /["“„]([^"“”„\n]*?\S[^"“”„\n]*?)["”“]/u;
export const OWNER_LOGIN = 'NicolaiDolmer';
export const GO_TIMEOUT_MS = 10000;

const stripCode = s => String(s).replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');

// Ren: kommentarer [{ login | author.login, body }] -> { area, quote } eller null.
// Nyeste gyldige markør vinder (kommentarerne kommer i GitHubs rækkefølge).
export function findOwnerGo(comments, { ownerLogin = OWNER_LOGIN } = {}) {
  const owner = String(ownerLogin || '').toLowerCase();
  if (!owner) return null;
  let found = null;
  for (const c of Array.isArray(comments) ? comments : []) {
    const login = String(c?.login ?? c?.author?.login ?? c?.user?.login ?? '').toLowerCase();
    if (login !== owner) continue;
    const text = stripCode(c?.body ?? '');
    const m = OWNER_GO_MARKER_RE.exec(text);
    if (!m) continue;
    const q = QUOTE_RE.exec(text.replace(OWNER_GO_MARKER_RE, ''));
    if (!q) continue; // markør uden ejerens citat tæller ikke
    found = { area: m[1], quote: q[1].trim() };
  }
  return found;
}

// Ejer-go-markør fra issuets kommentarer via gh (REST, alle sider). null ved
// enhver fejl eller timeout, så et utilgængeligt GitHub aldrig åbner porten.
export function ghOwnerGo(issue, { repo = 'NicolaiDolmer/CyclingZone', exec = execFileSync, timeout = GO_TIMEOUT_MS, ownerLogin = repo.split('/')[0] } = {}) {
  if (process.env.CZ_BUILD_STOP_NO_GH === '1') return null; // tests: ingen netværk
  if (!isIssue(issue)) return null;
  // Forfilter (kun for at holde svaret lille); parseren afgør stadig alt.
  const jq = '.[] | select((.body // "") | ascii_downcase | contains("ejer-go")) | {login: .user.login, body: .body}';
  try {
    const out = exec('gh', ['api', '--paginate', `repos/${repo}/issues/${issue}/comments?per_page=100`, '--jq', jq],
      { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'] });
    const comments = String(out || '').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
    return findOwnerGo(comments, { ownerLogin });
  } catch {
    return null; // Ingen gh/ingen adgang/timeout: som før markøren fandtes.
  }
}

// Beriger kun de spor der ellers ville være 'new'. Label/titel/forælder hentes
// kun når loftet er sat; ejer-go-markøren hentes for spor der stadig er 'new'
// bagefter. Spor der allerede er beriget, hentes ikke igen. Alle opslag deler
// én frist, så et langsomt GitHub aldrig får optaget til at overleve hookens
// timeout (guard-agent-spawn); efter fristen forbliver resten 'new' (fail closed).
export const META_BUDGET_MS = 45000;
export function withIssueMeta(items, cfg, fetchMeta = ghIssueMeta, { budgetMs = META_BUDGET_MS, now = Date.now, fetchGo = null } = {}) {
  const useMeta = Boolean(cfg?.loft && fetchMeta);
  if (!useMeta && !fetchGo) return items;
  const deadline = now() + budgetMs;
  return items.map(t => {
    if (!t || classifyWork(t, cfg).cls !== 'new') return t;
    let out = t;
    if (useMeta && !Array.isArray(t.labels)) {
      const left = deadline - now();
      const meta = left > 0 ? fetchMeta(t.issue, { timeout: Math.min(20000, left) }) : null;
      out = meta ? { ...out, ...meta } : { ...out, metaUnavailable: true };
    }
    if (fetchGo && out.ownerGo === undefined && classifyWork(out, cfg).cls === 'new') {
      const left = deadline - now();
      const go = left > 0 ? fetchGo(out.issue, { timeout: Math.min(GO_TIMEOUT_MS, left) }) : null;
      out = go ? { ...out, ownerGo: go } : { ...out, ownerGo: null };
    }
    return out;
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
  const go = item?.ownerGo;
  if (go && typeof go.area === 'string' && go.area) return { cls: 'finish', area: go.area, reason: `ejer-go-markør på issuet: ${go.area}` };
  const brandLabel = matchBrandLabel(item, cfg.loft);
  if (brandLabel) return { cls: 'brand', area: null, reason: `brand-label ${brandLabel}` };
  const loft = matchLoft(item, cfg.loft);
  if (loft) return { cls: 'loft', area: loft.area, reason: `loft-område ${loft.area} (${loft.via})` };
  return { cls: 'new', area: null, reason: cfg.loft ? 'uden for loftet, ikke på listen og ikke brand' : 'ikke på fase 1-listen og ikke brand' };
}

// Returnerer sporene beriget med GitHub-metadata, så kalderen kan logge
// brand-valg ud fra samme klassifikation som optaget.
export const OWNER_GO_HINT = "ejerens go som markør på issuet: node scripts/build-stop-go.mjs --issue N --area <område> --quote '<ejerens ordrette ja>'";

export function assertBuildStop(items, cfg = loadBuildStop(), { fetchMeta = ghIssueMeta, fetchGo = ghOwnerGo } = {}) {
  if (!cfg.active) return items;
  const admitted = withIssueMeta(items, cfg, fetchMeta, { fetchGo });
  const blocked = admitted.filter(t => classifyWork(t, cfg).cls === 'new');
  if (!blocked.length) return admitted;
  const ids = blocked.map(t => `#${t.issue}${t.metaUnavailable ? ' (labels kunne ikke læses fra GitHub)' : ''}`);
  if (cfg.loft) {
    throw Error(`Loftet (ejer 4/11): ${ids.join(', ')} er uden for loftet. Kun de tre loft-områder (${cfg.loft.areas.map(a => a.area).join(', ')}), brand/forkert info, issues i scripts/build-stop.json og issues med ejerens go-markør må bygges. Hører det til et loft-område, så giv det områdets label; er det brand, så giv det label ${cfg.loft.brandLabels[0]} eller tilføj det til brandList med en begrundelse; ellers kræver det ${OWNER_GO_HINT} (triage:new indtil da).`);
  }
  throw Error(`Byggestop (spec 2026-10-29 §3.1): ${ids.join(', ')} er nyt arbejde. Kun fase 1-listen, åbne PR'er fra 29/10, brand og issues med ejerens go-markør må bygges nu. Er det brand (live hos spillerne og forkert), så tilføj det til brandList i scripts/build-stop.json med en begrundelse; har ejeren sagt ja, så skriv ${OWNER_GO_HINT}; ellers hører det i triage:new.`);
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
