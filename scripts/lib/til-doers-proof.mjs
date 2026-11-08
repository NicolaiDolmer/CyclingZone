// scripts/lib/til-doers-proof.mjs
// ============================================================
// Auto-bevis efter merge (#7585), PR 1: den rene kerne.
//
// Efter et merge-tog tager en lokal koersel (runneren, PR 3) live-bevis for de
// issues en PR refererer, og laegger EN kommentar pr. issue pr. tog. Denne fil
// afgoer, hvad det bevis maa sige. Den laver intet netvaerk og ingen gh-kald:
// runneren henter og koerer tjekkene, og giver resultaterne hertil.
//
// 1) Deklarationen i PR-body, som reviewer tjekker:
//
//    ```til-doers-proof
//    issue: 7585
//    side: /team | selector [data-testid="squad-table"]
//    side: /team | tekst Trup
//    prod: GET https://cyclingzone.org/api/health -> 200
//    ```
//
//    Kun GET. Et side-tjek uden selector eller tekst afvises. En blok med fejl
//    giver aldrig ok, kun udkast.
//
// 2) Reglerne for krav 4 (Synligt) og 8 (Verificeret i prod):
//    - 4 ok kun ved et erklaeret side-tjek, et build fra merge-SHA'en, logget
//      ind, mocks slaaet fra, og selector/tekst fundet.
//    - 8 ok kun naar alle erklaerede prod-tjek bestaar efter groen Deploy verify.
//    - Mangler deklarationen, kunne et tjek ikke koeres, eller var forholdene
//      forkerte (andet build, ikke logget ind, mocks): udkast. Linjen hedder
//      "Udkast (auto-bevis) N: ...", som MARKER_LINE ikke matcher, saa et udkast
//      kan aldrig markere eller lukke noget.
//    - Et tjek der faktisk koerte under rigtige forhold og fejlede: mangler.
//
// 3) Rendering af en idempotent kommentar med markoeren
//    <!-- til-doers-proof:v1 pr=X issue=Y sha=Z -->. Samme tog giver samme tekst,
//    saa runneren kan nøjes med at redigere, naar noget faktisk har aendret sig.
//
// Koerslen bruger ejerens gh-token, saa kommentaren faar author_association
// OWNER og dens "Til dørs:"-linjer taeller som markeringer (kilde 'auto-bevis' i
// til-doers.mjs). Derfor er reglerne haarde, og et brand-issue lukkes aldrig
// alene paa auto-bevis for krav 8 (decideClose i til-doers.mjs).

import {
  MARKER,
  MARKER_LINE,
  COLLABORATOR_ASSOCIATIONS,
  PROOF_MARKER_PREFIX,
  parseProofMarker,
  extractRefIssues,
  titleScopeIssues,
} from './til-doers.mjs';

export { PROOF_MARKER_PREFIX, parseProofMarker };

export const PROOF_KRAV = [4, 8];
export const DRAFT_PREFIX = 'Udkast (auto-bevis)';
export const PROOF_HEADING = '### Til dørs: auto-bevis';
const MAX_VALUE = 160;

// ---------------------------------------------------------------- markoer

function isSha(s) {
  return /^[0-9a-f]{7,40}$/.test(String(s || ''));
}

function posInt(n) {
  return Number.isSafeInteger(Number(n)) && Number(n) > 0;
}

/** `<!-- til-doers-proof:v1 pr=X issue=Y sha=Z -->`. Kaster ved ugyldigt input. */
export function proofMarker({ pr, issue, sha }) {
  if (!posInt(pr) || !posInt(issue)) throw new Error('proofMarker kræver pr og issue som positive heltal');
  const s = String(sha || '').toLowerCase();
  if (!isSha(s)) throw new Error('proofMarker kræver en hex-sha (7-40 tegn)');
  return `${PROOF_MARKER_PREFIX} pr=${Number(pr)} issue=${Number(issue)} sha=${s} -->`;
}

/** To sha'er er den samme commit, hvis den ene er et praefiks af den anden (min. 7 tegn). */
export function sameSha(a, b) {
  const x = String(a || '').toLowerCase();
  const y = String(b || '').toLowerCase();
  if (!isSha(x) || !isSha(y)) return false;
  return x.startsWith(y) || y.startsWith(x);
}

// ---------------------------------------------------------------- deklaration

const FENCE_OPEN = /^\s*(`{3,})\s*til-doers-proof\s*$/i;
const KEY_LINE = /^(issue|side|prod)\s*:\s*(.*)$/i;
const SIDE_CHECK = /^(selector|tekst|text)\s+(.+)$/i;
const PROD_CHECK = /^(\S+)\s+(\S+)\s*->\s*(\d{3})$/;
const ROUTE = /^\/(?!\/)[^\s|]*$/;
const ROUTE_BASE = 'https://route-check.invalid';

// En rute skal blive på samme origin, også efter URL-parsing: "/\host" og
// lignende læses som "//host" og må aldrig pege ud af sitet (Codex).
function isSameOriginRoute(path) {
  if (!ROUTE.test(path) || /[\\\u0000-\u001f]/.test(path)) return false;
  try {
    const u = new URL(path, ROUTE_BASE);
    return u.origin === ROUTE_BASE && !u.username && !u.password;
  } catch {
    return false;
  }
}

function validProdUrl(url) {
  if (url.startsWith('/')) return isSameOriginRoute(url);
  if (!/^https:\/\//i.test(url)) return false;
  try {
    const u = new URL(url);
    // Ingen credentials i en URL, der ender i en offentlig kommentar.
    return !u.username && !u.password && Boolean(u.hostname);
  } catch {
    return false;
  }
}

function parseBlock(lines, startLine) {
  const decl = { issue: null, sides: [], prods: [], errors: [] };
  for (const [i, raw] of lines.entries()) {
    const line = raw.trim();
    if (!line) continue;
    const where = `linje ${startLine + i}`;
    const km = KEY_LINE.exec(line);
    if (!km) {
      decl.errors.push(`${where}: ukendt linje "${oneLine(line)}"`);
      continue;
    }
    const key = km[1].toLowerCase();
    const val = km[2].trim();
    if (key === 'issue') {
      const im = /^#?(\d+)$/.exec(val);
      if (!im || !posInt(im[1])) decl.errors.push(`${where}: ugyldigt issue "${oneLine(val)}"`);
      else if (decl.issue !== null && decl.issue !== Number(im[1])) decl.errors.push(`${where}: kun ét issue pr. blok`);
      else decl.issue = Number(im[1]);
    } else if (key === 'side') {
      const bar = val.indexOf('|');
      const path = (bar === -1 ? val : val.slice(0, bar)).trim();
      const check = bar === -1 ? '' : val.slice(bar + 1).trim();
      const sm = SIDE_CHECK.exec(check);
      if (!sm || !sm[2].trim()) {
        decl.errors.push(`${where}: side-tjek uden selector eller tekst afvises ("${oneLine(val)}")`);
      } else if (!isSameOriginRoute(path)) {
        decl.errors.push(`${where}: siden skal være en rute der starter med / ("${oneLine(path)}")`);
      } else {
        const kind = sm[1].toLowerCase() === 'selector' ? 'selector' : 'tekst';
        decl.sides.push({ path, kind, value: sm[2].trim() });
      }
    } else {
      const pm = PROD_CHECK.exec(val);
      if (!pm) {
        decl.errors.push(`${where}: prod-tjek skal have formen "GET <url> -> <status>"`);
      } else if (pm[1].toUpperCase() !== 'GET') {
        decl.errors.push(`${where}: kun GET er tilladt (fik ${oneLine(pm[1])})`);
      } else if (!validProdUrl(pm[2])) {
        decl.errors.push(`${where}: prod-URL skal være https:// uden login-oplysninger eller en rute der starter med /`);
      } else {
        const status = Number(pm[3]);
        if (status < 100 || status > 599) decl.errors.push(`${where}: ugyldig HTTP-status ${pm[3]}`);
        else decl.prods.push({ method: 'GET', url: pm[2], status });
      }
    }
  }
  return decl;
}

/**
 * Laes alle ```til-doers-proof```-blokke i en PR-body.
 *
 * refIssues: issues PR'en refererer (Refs/Closes/... eller titlens scope). Er
 * listen givet, faar en blok for et andet issue en fejl, saa en PR ikke kan
 * erklaere bevis for et issue, den ikke handler om.
 *
 * @returns {{declarations: Array<{issue, sides, prods, errors}>, errors: string[]}}
 *   errors er fejl der ikke kan knyttes til et issue (fx en blok uden issue).
 */
export function parseProofDeclarations(body, { refIssues = null } = {}) {
  const lines = String(body || '').split(/\r?\n/);
  const byIssue = new Map();
  const errors = [];
  for (let i = 0; i < lines.length; i += 1) {
    const open = FENCE_OPEN.exec(lines[i]);
    if (!open) continue;
    const fence = open[1];
    const closeRe = new RegExp(`^\\s*\`{${fence.length},}\\s*$`);
    let end = i + 1;
    while (end < lines.length && !closeRe.test(lines[end])) end += 1;
    const blockStart = i + 1;
    if (end >= lines.length) {
      errors.push(`linje ${blockStart}: til-doers-proof-blokken er ikke lukket`);
      break;
    }
    const decl = parseBlock(lines.slice(i + 1, end), blockStart + 1);
    i = end;
    if (decl.issue === null) {
      errors.push(`linje ${blockStart}: til-doers-proof-blok uden issue`);
      continue;
    }
    if (!decl.sides.length && !decl.prods.length && !decl.errors.length) decl.errors.push('blokken har ingen tjek');
    if (refIssues && !refIssues.map(Number).includes(decl.issue)) decl.errors.push(`PR'en refererer ikke #${decl.issue}`);
    const prev = byIssue.get(decl.issue);
    if (prev) {
      prev.sides.push(...decl.sides);
      prev.prods.push(...decl.prods);
      prev.errors.push(...decl.errors);
    } else {
      byIssue.set(decl.issue, decl);
    }
  }
  const declarations = [...byIssue.values()].sort((a, b) => a.issue - b.issue);
  // En blok der ikke kan knyttes til et issue (ulukket eller uden issue) kan
  // have vaeret ment for hvilket som helst af dem. Saa giver ingen af PR'ens
  // deklarationer ok, kun udkast, til body'en er rettet.
  if (errors.length) for (const d of declarations) d.errors.push(`PR-body har en ugyldig til-doers-proof-blok (${errors.join('; ')})`);
  return { declarations, errors };
}

/** Bekvemt: deklarationer fra en PR, med refererede issues fra titel + body. */
export function proofDeclarationsForPr(pr) {
  const refIssues = [...new Set([...extractRefIssues(`${pr?.title || ''}\n${pr?.body || ''}`), ...titleScopeIssues(pr?.title)])];
  return parseProofDeclarations(pr?.body, { refIssues });
}

export function declarationFor(parsed, issue) {
  return (parsed?.declarations || []).find((d) => d.issue === Number(issue)) || null;
}

// ---------------------------------------------------------------- regler

// Linjeskift inkl. Unicode-linje- og afsnitsseparator. Bygget fra tegnkoder,
// fordi en raa separator i en regex-literal er en syntaksfejl.
const LINE_BREAKS = new RegExp(`[\\r\\n${String.fromCharCode(0x2028, 0x2029)}]+`, 'g');

function truncate(s, max) {
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

/**
 * En hel linje: kan ikke bryde ud til en ny linje (og dermed starte en falsk
 * "Til dørs:"-markering), og kan ikke aabne eller lukke en HTML-kommentar.
 */
export function flatLine(s, max = 400) {
  const flat = String(s ?? '')
    .replace(LINE_BREAKS, ' ')
    .replace(/\s+/g, ' ')
    .replace(/<!--/g, '&lt;!--')
    .replace(/--!?>/g, (end) => end.replace('>', '&gt;')) // ogsaa --!>, som browsere accepterer (CodeQL #386)
    .trim();
  return truncate(flat, max);
}

/** En vaerdi fra PR-body eller runneren: som flatLine, og uden < og > overhovedet. */
export function oneLine(s, max = MAX_VALUE) {
  const flat = String(s ?? '')
    .replace(LINE_BREAKS, ' ')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\s+/g, ' ')
    .trim();
  return truncate(flat, max);
}

function sha7(s) {
  return oneLine(String(s || '').slice(0, 7), 7);
}

function sideKey(c) {
  return `${c.path}\u0000${c.kind}\u0000${c.value}`;
}

function describeSide(c) {
  return `${c.path} ${c.kind} ${oneLine(c.value, 80)}`;
}

function describeProd(c) {
  return `GET ${oneLine(c.url, 100)}`;
}

function result(krav, udfald, tekst) {
  return { krav, udfald, tekst: flatLine(tekst) };
}

function derivedNote(side) {
  const derived = (side?.derived || []).map((p) => oneLine(p, 60)).filter(Boolean);
  return derived.length ? ` (udledte sider giver kun udkast: ${derived.slice(0, 6).join(', ')})` : '';
}

/**
 * Krav 4 (Synligt).
 *
 * side (fra runneren, eller null hvis intet blev koert):
 *   { buildSha, loggedIn: boolean, mocks: boolean, derived?: string[],
 *     results: [{ path, kind, value, found?: boolean, error?: string }] }
 * mocks skal vaere eksplicit false; ukendt taeller som slaaet til.
 */
export function evaluateSideProof({ declaration, sha, side }) {
  if (!declaration) return result(4, 'udkast', `ingen til-doers-proof-deklaration for issuet${derivedNote(side)}`);
  if (declaration.errors.length) return result(4, 'udkast', `deklarationen har fejl: ${declaration.errors.join('; ')}`);
  if (!declaration.sides.length) return result(4, 'udkast', `ingen erklæret side-tjek${derivedNote(side)}`);
  if (!side) return result(4, 'udkast', 'side-tjekket blev ikke kørt');
  if (!sameSha(side.buildSha, sha)) return result(4, 'udkast', `buildet er ikke fra merge-SHA ${sha7(sha)} (build ${sha7(side.buildSha) || 'ukendt'})`);
  if (side.loggedIn !== true) return result(4, 'udkast', 'billedstationen var ikke logget ind');
  if (side.mocks !== false) return result(4, 'udkast', 'mocks var ikke slået fra');

  const byKey = new Map((side.results || []).map((r) => [sideKey(r), r]));
  const failed = [];
  const notRun = [];
  for (const c of declaration.sides) {
    const r = byKey.get(sideKey(c));
    if (!r || r.error || typeof r.found !== 'boolean') notRun.push(`${describeSide(c)}${r?.error ? ` (${oneLine(r.error, 80)})` : ''}`);
    else if (!r.found) failed.push(describeSide(c));
  }
  if (failed.length) return result(4, 'mangler', `auto-bevis: ikke fundet på build ${sha7(sha)}: ${failed.join('; ')}`);
  if (notRun.length) return result(4, 'udkast', `kunne ikke køre: ${notRun.join('; ')}`);
  return result(4, 'ok', `auto-bevis: ${declaration.sides.map(describeSide).join('; ')} fundet (build ${sha7(sha)}, logget ind, uden mocks)`);
}

/**
 * Krav 8 (Verificeret i prod).
 *
 * prod (fra runneren, eller null):
 *   { deployVerify: { conclusion, sha, containsMerge?: boolean },
 *     results: [{ method, url, status?: number, error?: string }] }
 * Deploy verify skal vaere groen og daekke merge-SHA'en (samme sha, eller en
 * senere deploy runneren har set indeholder den: containsMerge).
 */
export function evaluateProdProof({ declaration, sha, prod }) {
  if (!declaration) return result(8, 'udkast', 'ingen til-doers-proof-deklaration for issuet');
  if (declaration.errors.length) return result(8, 'udkast', `deklarationen har fejl: ${declaration.errors.join('; ')}`);
  if (!declaration.prods.length) return result(8, 'udkast', 'ingen erklæret prod-tjek');
  const dv = prod?.deployVerify;
  if (!dv || dv.conclusion !== 'success') return result(8, 'udkast', `Deploy verify er ikke grøn (${oneLine(dv?.conclusion || 'ikke kørt', 30)})`);
  if (!sameSha(dv.sha, sha) && dv.containsMerge !== true) return result(8, 'udkast', `Deploy verify dækker ikke merge-SHA ${sha7(sha)}`);

  const byUrl = new Map((prod.results || []).map((r) => [r.url, r]));
  const failed = [];
  const notRun = [];
  for (const c of declaration.prods) {
    const r = byUrl.get(c.url);
    if (!r || r.error || !Number.isInteger(r.status)) notRun.push(`${describeProd(c)}${r?.error ? ` (${oneLine(r.error, 80)})` : ''}`);
    else if (String(r.method || 'GET').toUpperCase() !== 'GET') notRun.push(`${describeProd(c)} (kørt som ${oneLine(r.method, 10)}, kun GET tæller)`);
    else if (r.status !== c.status) failed.push(`${describeProd(c)} gav ${r.status}, forventet ${c.status}`);
  }
  if (failed.length) return result(8, 'mangler', `auto-bevis: ${failed.join('; ')}`);
  if (notRun.length) return result(8, 'udkast', `kunne ikke køre: ${notRun.join('; ')}`);
  return result(8, 'ok', `auto-bevis: ${declaration.prods.map((c) => `${describeProd(c)} -> ${c.status}`).join('; ')} efter grøn Deploy verify (${sha7(sha)})`);
}

/** Begge krav for ét issue. */
export function evaluateProof({ declaration = null, sha, side = null, prod = null }) {
  return [evaluateSideProof({ declaration, sha, side }), evaluateProdProof({ declaration, sha, prod })];
}

// ---------------------------------------------------------------- rendering

/**
 * En resultat-linje. ok/mangler bliver til en "Til dørs:"-markering; udkast
 * faar et praefiks MARKER_LINE ikke matcher.
 */
export function renderProofLine({ krav, udfald, tekst }) {
  if (!PROOF_KRAV.includes(krav)) throw new Error(`auto-bevis dækker kun krav ${PROOF_KRAV.join(' og ')}`);
  const t = flatLine(tekst);
  if (udfald === 'ok' || udfald === 'mangler') return `Til dørs: ${krav} ${udfald} ${t}`;
  if (udfald === 'udkast') return `${DRAFT_PREFIX} ${krav}: ${t}`;
  throw new Error(`ukendt udfald: ${udfald}`);
}

/**
 * Hele kommentaren for ét issue i ét tog. Deterministisk (ingen tidsstempler),
 * saa samme input giver samme tekst, og runneren kan springe uaendrede over.
 * brand: issuet staar paa brand-listen; kommentaren siger saa, at krav 8 ogsaa
 * kraever en menneskelig markering.
 */
export function renderProofComment({ pr, issue, sha, results, brand = false }) {
  const marker = proofMarker({ pr, issue, sha });
  const lines = [...results].sort((a, b) => a.krav - b.krav).map(renderProofLine);
  const body = [
    marker,
    PROOF_HEADING,
    `PR #${Number(pr)}, merge ${sha7(String(sha).toLowerCase())}.`,
    '',
    ...lines,
    '',
    'Linjer der starter med "Udkast (auto-bevis)" tæller ikke som markering. Denne kommentar opdateres, hvis samme tog køres igen.',
    ...(brand ? ['Brand-issue: krav 8 lukker ikke på auto-bevis alene. Det kræver også en menneskelig markering.'] : []),
  ].join('\n');
  // Vagt: kommentaren maa aldrig ligne til-doers-tabellen, og kun de tilsigtede
  // ok/mangler-linjer maa kunne laeses som markeringer.
  if (body.includes(MARKER)) throw new Error('auto-bevis-kommentaren må ikke indeholde til-doers-tabellens markør');
  const markerLines = body.split('\n').filter((l) => MARKER_LINE.test(l));
  const intended = lines.filter((l) => !l.startsWith(DRAFT_PREFIX));
  if (markerLines.length !== intended.length) throw new Error('auto-bevis-kommentaren har uventede markeringslinjer');
  return body;
}

/**
 * Skal kommentaren oprettes, redigeres eller lades vaere? Kun kommentarer fra
 * en collaborator (den lokale koersel med ejerens token) med praecis samme
 * markoer (pr, issue, sha) er vores. En udenforstaaendes kopi, eller en
 * bot-kommentar (author_association CONTRIBUTOR), redigeres aldrig.
 *
 * @returns {{action: 'create'|'edit'|'unchanged', id?: number|string, duplicates: Array}}
 */
export function planProofComment({ comments, pr, issue, sha, body }) {
  const key = { pr: Number(pr), issue: Number(issue), sha: String(sha).toLowerCase() };
  const ours = (comments || [])
    .filter((c) => COLLABORATOR_ASSOCIATIONS.has(String(c.author_association || '').toUpperCase()))
    .filter((c) => {
      const m = parseProofMarker(c.body);
      return m && m.pr === key.pr && m.issue === key.issue && m.sha === key.sha;
    })
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')) || Number(a.id) - Number(b.id));
  const [existing, ...duplicates] = ours;
  if (!existing) return { action: 'create', duplicates: [] };
  const same = String(existing.body || '').replace(/\r\n/g, '\n') === String(body).replace(/\r\n/g, '\n');
  return { action: same ? 'unchanged' : 'edit', id: existing.id, duplicates };
}

// ---------------------------------------------------------------- forsinket bevis (PR 4)

export const OVERDUE_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;

/** Issues en PR refererer (Refs/Closes/... eller titlens scope), sorteret. */
export function proofRefIssues(pr) {
  return [...new Set([...extractRefIssues(`${pr?.title || ''}\n${pr?.body || ''}`), ...titleScopeIssues(pr?.title)])].sort((a, b) => a - b);
}

function commentsOf(comments, issue) {
  if (comments instanceof Map) return comments.get(Number(issue)) || [];
  return comments?.[issue] || [];
}

/** Har en collaborator allerede lagt en auto-bevis-kommentar for (pr, issue)? Sha'en er ligegyldig. */
export function hasProofComment(issueComments, pr, issue) {
  return (issueComments || []).some((c) => {
    if (!COLLABORATOR_ASSOCIATIONS.has(String(c.author_association || '').toUpperCase())) return false;
    const m = parseProofMarker(c.body);
    return Boolean(m) && m.pr === Number(pr) && m.issue === Number(issue);
  });
}

/**
 * Hvilke merge'de PR'er har et aabent issue, hvor auto-beviset burde vaere
 * koert for mindst `hours` timer siden, men ikke er det? Ren funktion.
 *
 * prs:      [{number, title, body, mergedAt, baseRefName?}]  (kun main taeller)
 * issues:   [{number, state}]                                 (kun aabne taeller)
 * comments: {issueNummer: [kommentarer]} eller Map            (bruges kun ved en deklaration)
 *
 * Tre udfald, som holdes adskilt for at undgaa falske alarmer:
 *  - overdue:       deklaration findes, men ingen auto-bevis-kommentar: ikke koert.
 *  - noDeclaration: PR'en erklaerede intet bevis for issuet. Ingen alarm, kun info.
 *  - proven:        auto-bevis-kommentaren findes (ogsaa et udkast: koerslen skete).
 * Praecis `hours` timer gammel taeller som forsinket.
 */
export function findProofOverdue({ prs, issues, comments, now, hours = OVERDUE_HOURS }) {
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs)) throw new Error('findProofOverdue kræver en gyldig now');
  if (!Number.isFinite(Number(hours)) || Number(hours) < 0) throw new Error('findProofOverdue kræver hours >= 0');
  const open = new Set((issues || []).filter((i) => String(i?.state || '').toLowerCase() === 'open').map((i) => Number(i.number)));
  const out = { overdue: [], noDeclaration: [], proven: [] };
  for (const pr of [...(prs || [])].sort((a, b) => Number(a.number) - Number(b.number))) {
    if (!pr?.mergedAt || (pr.baseRefName && pr.baseRefName !== 'main')) continue;
    const mergedMs = new Date(pr.mergedAt).getTime();
    if (!Number.isFinite(mergedMs)) continue;
    const ageHours = (nowMs - mergedMs) / HOUR_MS;
    if (ageHours < Number(hours)) continue;
    const parsed = proofDeclarationsForPr(pr);
    for (const issue of proofRefIssues(pr)) {
      if (!open.has(issue)) continue;
      const row = { pr: Number(pr.number), issue, mergedAt: pr.mergedAt, ageHours: Math.floor(ageHours) };
      const decl = declarationFor(parsed, issue);
      if (!decl) out.noDeclaration.push(row);
      else if (hasProofComment(commentsOf(comments, issue), pr.number, issue)) out.proven.push(row);
      else out.overdue.push({ ...row, declarationErrors: decl.errors.length });
    }
  }
  out.overdue.sort((a, b) => b.ageHours - a.ageHours || a.pr - b.pr || a.issue - b.issue);
  return out;
}
