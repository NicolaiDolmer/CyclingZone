// Ejer 4/11 (#7660, Codex P2): finder det worktree, en `git push` faktisk koerer fra.
// Laeser hook-input (JSON) paa stdin og printer mappen fra `cd <dir> && ...` eller
// `git -C <dir> push`, med shell-quoting fjernet. Intet output = sessionens cwd.
// Med --dest printes i stedet pushets maal og mapper, som vagterne skal tjekke (ejer 8/11).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Enkeltquotet, dobbeltquotet (med \-escapes) eller uquotet argument.
const ARG = String.raw`(?:'([^']*)'|"((?:[^"\\]|\\.)*)"|([^\s&;|'"\`)]+))`;

function pick(m) {
  if (!m) return null;
  if (m[1] !== undefined) return m[1];
  if (m[2] !== undefined) return m[2].replace(/\\(.)/g, '$1');
  return m[3] ?? null;
}

// Mappe med en shell-udvidelse kan vagten ikke cd'e til (saa ville den give op): brug cwd.
const literalDir = (d) => (d && !/[$`]/.test(d) ? d : null);

const leadingCdDir = (cmd) => literalDir(pick(cmd.match(new RegExp(String.raw`^\s*\(?\s*cd\s+${ARG}\s*&&`))));

export function pushTargetDir(command) {
  const cmd = String(command ?? '');
  const viaC = gitPushes(cmd).pushes.find((p) => p.dir)?.dir;
  if (viaC) return literalDir(viaC);
  return leadingCdDir(cmd);
}

export const LOCAL_BRANCH = '__LOCAL__';
export const DELETED = '__DELETED__';
export const ALL_EXEMPT = '__ALL_EXEMPT__';

// Backup-branches uden PR: preflight og CI-loop-vagten har intet at beskytte der.
export const BACKUP_BRANCH_RE = /^(wip|backup)\//;

// Omtale af git push inde i en streng (commit-besked, bash -c): kan ikke afgoeres.
const PUSH_MENTION_RE = /\bgit\s(?:[\s\S]*\s)?push(?:\s|$|[;&|)])/;

// Laeser dobbeltquotet tekst fra from; $(...) indeni maa gerne have egne anfoerselstegn.
function readDoubleQuoted(src, from) {
  let text = '';
  let depth = 0;
  let i = from;
  for (; i < src.length && (depth > 0 || src[i] !== '"'); i++) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '\\' && next !== undefined && '$`"\\\n'.includes(next)) {
      i++;
      if (next !== '\n') text += next;
    } else if (c === '$' && next === '(') {
      depth++;
      i++;
      text += '$(';
    } else {
      if (depth > 0 && c === '(') depth++;
      if (depth > 0 && c === ')') depth--;
      text += c;
    }
  }
  return [text, i];
}

// Minimal shell-laeser (review #7907): deler i simple kommandoer af ord, med quoting
// fjernet og redirects droppet. Afsluttes af ; | & linjeskift, ( ) og backticks.
// En $(...) eller backtick efterlader $ i ordet, saa det aldrig er et bogstaveligt navn.
function shellCommands(src) {
  const cmds = [];
  const stack = [];
  let cur = [];
  let word = null;
  let dropNext = false;
  let mentionsPush = false;
  const add = (t) => { word = (word ?? '') + t; };
  const addQuoted = (t) => { add(t); if (PUSH_MENTION_RE.test(t)) mentionsPush = true; };
  const endWord = () => {
    if (word === null) return;
    if (dropNext) dropNext = false; else cur.push(word);
    word = null;
  };
  const endCmd = () => {
    endWord();
    dropNext = false;
    if (cur.length) cmds.push(cur);
    cur = [];
  };
  const open = (kind) => {
    stack.push({ kind, cur, word, dropNext });
    cur = [];
    word = null;
    dropNext = false;
  };
  const close = () => {
    endCmd();
    ({ cur, word, dropNext } = stack.pop());
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "'") {
      const end = src.indexOf("'", i + 1);
      const stop = end < 0 ? src.length : end;
      addQuoted(src.slice(i + 1, stop));
      i = stop;
    } else if (c === '"') {
      const [text, stop] = readDoubleQuoted(src, i + 1);
      addQuoted(text);
      i = stop;
    } else if (c === '\\') {
      i++;
      if (next !== undefined && next !== '\n') add(next);
    } else if (c === '$' && next === '(') {
      add('$');
      open('(');
      i++;
    } else if (c === '`') {
      if (stack.at(-1)?.kind === '`') close();
      else { add('$'); open('`'); }
    } else if (c === '(') {
      endWord();
      open('(');
    } else if (c === ')') {
      if (stack.at(-1)?.kind === '(') close(); else endCmd();
    } else if (c === ' ' || c === '\t') {
      endWord();
    } else if (c === '#' && word === null) {
      while (i + 1 < src.length && src[i + 1] !== '\n') i++;
    } else if (c === '>' || c === '<' || (c === '&' && next === '>')) {
      // Redirect: et fd-nummer foran og maalet bagefter er ikke argumenter.
      if (word !== null && /^\d+$/.test(word)) word = null; else endWord();
      while (i + 1 < src.length && '<>&|'.includes(src[i + 1])) i++;
      dropNext = true;
    } else if (c === '\n' || c === '\r' || c === ';' || c === '|' || c === '&') {
      endCmd();
    } else {
      add(c);
    }
  }
  while (stack.length) close();
  endCmd();
  return { cmds, mentionsPush };
}

// Globale git-flag, hvis vaerdi staar i naeste ord.
const GIT_VALUE_FLAGS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--super-prefix', '--attr-source']);

// Hvert `git [globale flag] push` i kommandoen, med argumenterne efter push.
function gitPushes(src) {
  const { cmds, mentionsPush } = shellCommands(src);
  const pushes = [];
  for (const words of cmds) {
    for (let i = 0; i < words.length; i++) {
      if (!/(^|[\\/])git(\.exe)?$/.test(words[i])) continue;
      let j = i + 1;
      let dir = null;
      while (words[j]?.startsWith('-')) {
        if (words[j] === '-C') dir = words[j + 1] ?? null;
        j += GIT_VALUE_FLAGS.has(words[j]) ? 2 : 1;
      }
      // Et ukendt flag kan have taget en vaerdi; fail-closed: taeller som push.
      if (j > i + 1 && words[j + 1] === 'push') j++;
      if (words[j] === 'push') {
        pushes.push({ dir, args: words.slice(j + 1) });
        break;
      }
    }
  }
  return { pushes, mentionsPush };
}

// Kun et bogstaveligt navn kan slaas op eller vaere backup (review #7907).
const LITERAL_BRANCH_RE = /^[\w./-]+$/;

// git push' korte flag uden vaerdi; -d kan staa i en klynge (-fd). -o tager en vaerdi
// og er derfor ikke med: `-od` er et push-option, ikke en sletning.
const DELETE_FLAG_RE = /^(?:--delete|-[vqfnu46]*d[vqfnu46]*)$/;

function destinationsOf(args) {
  const positional = [];
  const everything = args.some((a) => a === '--all' || a === '--mirror' || a === '--branches');
  let deleting = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-o' || a === '--push-option' || a === '--repo') { i++; continue; }
    if (DELETE_FLAG_RE.test(a)) deleting = true;
    if (a.startsWith('-')) continue;
    positional.push(a);
  }
  const specs = positional.slice(1); // positional[0] = remote
  if (!specs.length) return [LOCAL_BRANCH];
  if (deleting && !everything) return specs.map(() => DELETED);
  const named = specs.map((raw) => {
    const spec = raw.replace(/^\+/, '');
    const dst = spec.includes(':') ? spec.slice(spec.indexOf(':') + 1) : spec;
    if (!dst || dst === 'HEAD') return LOCAL_BRANCH;
    const name = dst.replace(/^refs\/heads\//, '');
    if (!LITERAL_BRANCH_RE.test(name)) return LOCAL_BRANCH;
    return spec.startsWith(':') ? DELETED : name;
  });
  return everything ? [...named, LOCAL_BRANCH] : named;
}

// Hvert maal i kommandoen med den mappe, netop det push koerer fra (review #7907:
// ved kaedede pushes gaelder hvert -C sit eget push). dir null = sessionens cwd.
function pushTargets(command) {
  const cmd = String(command ?? '');
  const { pushes, mentionsPush } = gitPushes(cmd);
  const cdDir = leadingCdDir(cmd);
  const out = pushes.flatMap((p) => {
    const dir = p.dir ? literalDir(p.dir) : cdDir;
    return destinationsOf(p.args).map((dest) => ({ dest, dir }));
  });
  // En omtale kan vaere et rigtigt push (bash -c): aldrig grundlag for en undtagelse.
  return mentionsPush ? [...out, { dest: LOCAL_BRANCH, dir: pushTargetDir(cmd) }] : out;
}

// Ejer 8/11: vagterne doemte pushets maal ud fra den lokale branch, saa
// `git push origin HEAD:wip/x` fra feat/y blev tjekket som feat/y. Returnerer ALLE
// maal i ALLE `git push` i kommandoen (Codex P2); LOCAL_BRANCH = den lokale branch,
// DELETED = en sletning, der intet kode sender.
export function pushDestinations(command) {
  return pushTargets(command).map((t) => t.dest);
}

const isExempt = (dest) => dest === DELETED || BACKUP_BRANCH_RE.test(dest);

// Det vagterne skal tjekke: ALL_EXEMPT naar hvert eneste maal er en backup-branch
// eller en sletning, ellers de maal der er tilbage, hvert med sin mappe. Sletninger
// skal ende i ALL_EXEMPT og ikke i en tom liste: tom betyder "intet fundet", og saa
// falder vagterne tilbage til den lokale branch.
export function guardPlan(command) {
  const all = pushTargets(command);
  if (all.length && all.every((t) => isExempt(t.dest))) return [{ dest: ALL_EXEMPT, dir: null }];
  const seen = new Set();
  return all.filter((t) => {
    const key = `${t.dest}\t${t.dir ?? ''}`;
    if (isExempt(t.dest) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function guardTargets(command) {
  return [...new Set(guardPlan(command).map((t) => t.dest))];
}

// Vagternes format: et maal pr. linje, efterfulgt af tab + mappe naar pushet har sin egen.
const planLines = (command) => guardPlan(command).map((t) => (t.dir ? `${t.dest}\t${t.dir}` : t.dest)).join('\n');

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    const command = input?.tool_input?.command;
    const out = process.argv.includes('--dest') ? planLines(command) : pushTargetDir(command);
    if (out) process.stdout.write(out);
  } catch { /* fail-soft: intet output */ }
}
