#!/usr/bin/env node
// scripts/merge-queue-baseline-resolve.mjs
//
// #7628 (ejer-go 4/11, valg B): merge-koeen loeser selv en konflikt der KUN
// ligger i TS-baseline-filerne. TS-kaeden (#7583) konverterer en fil pr. PR, og
// hver PR saenker de samme to baseline-filer. Naar een af dem er merget, er
// resten CONFLICTING, selvom selve koden ikke overlapper. Loesningen er
// mekanisk: tag main's baseline og genberegn den paa det mergede trae.
//
// Hvad modulet goer for EEN PR (kaldt fra scripts/merge-queue.ps1):
//   1. Laeser PR'en (gh) og afviser alt der ikke er en aaben, ikke-fork PR mod
//      main i konflikt.
//   2. Henter origin/main + PR-hovedet og finder konflikt-filerne med
//      `git merge-tree` (skriver intet i noget arbejdstrae).
//   3. Er der konflikt i en ANDEN fil end baseline-filerne: exit 2, intet sker
//      (koeen opfoerer sig som foer: STOP/SKIP).
//   4. Ellers, i et midlertidigt worktree paa en midlertidig lokal branch:
//      merge main ind, tag main's version af baseline-filen(e), koer
//      --update-baseline (kan kun saenke), STOP hvis den nye baseline er hoejere
//      end main's, koer gaten og testene for PR'ens filer, commit bag
//      scripts/guard-commit-branch.sh, push (aldrig force) og bestil
//      `@codex review`. Koeens eksisterende ventelogik venter derefter paa groen
//      CI + review-gate foer merge.
//   5. Rydder op: junctions fjernes ikke-rekursivt FOER `git worktree remove`.
//
// --dry-run: laeser og analyserer (fetch + merge-tree er read-only for alle
// arbejdstraeer), men opretter intet worktree, committer, pusher eller
// kommenterer intet. Skriver hvad der ville ske.
//
// Exit-koder: 0 loest (eller ville blive loest i --dry-run), 2 ikke kun
// baseline (uaendret koe-adfaerd), 3 intet at loese, 1 stoppet/fejl.
//
// Brug: node scripts/merge-queue-baseline-resolve.mjs --pr <N> [--repo owner/name] [--dry-run]
// Tests: node --test scripts/merge-queue-baseline-resolve.test.mjs

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

export const TS_CORE_BASELINE = 'scripts/ts-core-ratchet-baseline.json';
export const FRONTEND_BASELINE = 'frontend/typecheck-baseline.json';
export const BASELINE_FILES = Object.freeze([TS_CORE_BASELINE, FRONTEND_BASELINE]);

export const EXIT = Object.freeze({ RESOLVED: 0, STOPPED: 1, NOT_ELIGIBLE: 2, NOTHING: 3 });

// Pakker hvis node_modules linkes ind i det midlertidige worktree (gaten,
// frontend-typecheck, tests og git-hooks skal kunne koere der).
const NODE_MODULE_PACKAGES = Object.freeze(['', 'backend', 'frontend']);

// ---------------------------------------------------------------------------
// Rene funktioner
// ---------------------------------------------------------------------------

/** Konflikt-filerne fra `git merge-tree --write-tree --name-only` (linje 1 er trae-id'et). */
export function parseMergeTreeConflicts(stdout) {
  const lines = String(stdout ?? '').split(/\r?\n/).map((l) => l.trim());
  return [...new Set(lines.slice(1).filter(Boolean).map((l) => l.replaceAll('\\', '/')))].sort();
}

/** Kun-baseline-konflikt? Tom liste er IKKE en baseline-konflikt. */
export function classifyConflicts(files) {
  const list = [...new Set((files ?? []).map(String))].sort();
  const baseline = list.filter((f) => BASELINE_FILES.includes(f));
  const others = list.filter((f) => !BASELINE_FILES.includes(f));
  return { eligible: baseline.length > 0 && others.length === 0, baseline, others };
}

/**
 * Den nye ts-core-baseline maa aldrig have flere .js-filer eller flere fejl end
 * main's, hverken samlet eller pr. omraade. Et omraade main ikke kender, kan
 * ikke sammenlignes og stopper derfor ogsaa (fail closed).
 */
export function compareTsCoreBaselines(mainBaseline, nextBaseline) {
  const problems = [];
  const mainAreas = mainBaseline?.areas ?? {};
  const nextAreas = nextBaseline?.areas ?? {};
  for (const [id, area] of Object.entries(nextAreas)) {
    const before = mainAreas[id];
    if (!before || before.files === undefined) {
      problems.push(`omraade "${id}" findes ikke (maalt) i main's baseline`);
      continue;
    }
    if ((area.jsFileCount ?? 0) > (before.jsFileCount ?? 0)) {
      problems.push(`omraade "${id}": .js-filer ${before.jsFileCount} -> ${area.jsFileCount}`);
    }
    if ((area.tsErrorCount ?? 0) > (before.tsErrorCount ?? 0)) {
      problems.push(`omraade "${id}": tsc-fejl ${before.tsErrorCount} -> ${area.tsErrorCount}`);
    }
  }
  const mt = mainBaseline?.totals ?? {};
  const nt = nextBaseline?.totals ?? {};
  if (!Number.isFinite(nt.jsFileCount) || !Number.isFinite(nt.tsErrorCount)) {
    problems.push('ny baseline mangler totals');
  } else {
    if (nt.jsFileCount > (mt.jsFileCount ?? -1)) problems.push(`i alt .js-filer ${mt.jsFileCount} -> ${nt.jsFileCount}`);
    if (nt.tsErrorCount > (mt.tsErrorCount ?? -1)) problems.push(`i alt tsc-fejl ${mt.tsErrorCount} -> ${nt.tsErrorCount}`);
  }
  return { ok: problems.length === 0, problems };
}

/** Frontend-budgettet er pr. fil OG kode; intet par og ikke summen maa stige over main's. */
export function compareFrontendBaselines(mainBaseline, nextBaseline) {
  const problems = [];
  const sum = (b) => Object.values(b ?? {}).reduce((a, codes) => a + Object.values(codes ?? {}).reduce((x, y) => x + y, 0), 0);
  for (const [file, codes] of Object.entries(nextBaseline ?? {})) {
    for (const [code, count] of Object.entries(codes ?? {})) {
      const before = mainBaseline?.[file]?.[code] ?? 0;
      if (count > before) problems.push(`${file} ${code}: ${before} -> ${count}`);
    }
  }
  const before = sum(mainBaseline);
  const after = sum(nextBaseline);
  if (after > before) problems.push(`i alt ${before} -> ${after} fejl`);
  return { ok: problems.length === 0, problems };
}

const TEST_RE = /\.test\.[cm]?[jt]sx?$/;
const SOURCE_RE = /\.[cm]?[jt]sx?$/;
const TEST_EXTS = Object.freeze(['.test.js', '.test.ts', '.test.mjs', '.test.cjs', '.test.jsx', '.test.tsx']);

/**
 * Testene for de filer PR'en aendrer: aendrede testfiler + sidestillede
 * `<navn>.test.*` til aendrede kildefiler, grupperet pr. pakke (backend,
 * frontend, rod). `exists` afgoer om en kandidat findes i det mergede trae.
 */
export function testsForChangedFiles(changed, exists) {
  const picked = new Set();
  for (const raw of changed ?? []) {
    const file = String(raw).replaceAll('\\', '/');
    if (TEST_RE.test(file)) {
      if (exists(file)) picked.add(file);
      continue;
    }
    if (!SOURCE_RE.test(file)) continue;
    const stem = file.replace(SOURCE_RE, '');
    for (const ext of TEST_EXTS) {
      if (exists(stem + ext)) picked.add(stem + ext);
    }
  }
  const groups = new Map();
  for (const file of [...picked].sort()) {
    const pkg = file.startsWith('backend/') ? 'backend' : file.startsWith('frontend/') ? 'frontend' : '';
    if (!groups.has(pkg)) groups.set(pkg, []);
    groups.get(pkg).push(pkg ? file.slice(pkg.length + 1) : file);
  }
  return [...groups.entries()].map(([pkg, files]) => ({
    pkg,
    // Backend-suiten koerer altid med sin test-setup (backend/scripts/run-tests.js).
    args: pkg === 'backend' ? ['--test', '--import', './test-setup.js', ...files] : ['--test', ...files],
  }));
}

export function commitMessage({ pr, files }) {
  return [
    `chore(ts-baseline): merge main ind i #${pr} og genberegn baseline`,
    '',
    `Merge-koeen (#7628): konflikten laa kun i ${files.join(', ')}.`,
    "Main's version er taget og genberegnet paa det mergede trae (kan kun saenkes);",
    'gaten og testene for PR\'ens filer er groenne.',
    '',
    `Refs #${pr}`,
    'Refs #7628',
    '',
  ].join('\n');
}

export function parseArgs(argv) {
  const out = { pr: null, repo: 'NicolaiDolmer/CyclingZone', dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--pr') out.pr = Number(argv[++i]);
    else if (a === '--repo') out.repo = String(argv[++i] ?? '');
    else if (a === '--dry-run') out.dryRun = true;
    else throw new Error(`ukendt argument: ${a}`);
  }
  if (!Number.isInteger(out.pr) || out.pr <= 0) throw new Error('--pr <N> mangler eller er ugyldig');
  if (!/^[\w.-]+\/[\w.-]+$/.test(out.repo)) throw new Error('--repo skal vaere owner/name');
  return out;
}

// ---------------------------------------------------------------------------
// Orkestrering (al I/O gaar gennem deps, saa testene kan injicere den)
// ---------------------------------------------------------------------------

function realDeps() {
  const exec = (cmd, args, opts = {}) => {
    const r = spawnSync(cmd, args, {
      cwd: opts.cwd ?? REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
    return { status: r.error ? -1 : r.status, stdout: r.stdout ?? '', stderr: r.error ? String(r.error.message) : (r.stderr ?? '') };
  };
  return {
    repoRoot: REPO_ROOT,
    git: (args, opts) => exec('git', args, opts),
    gh: (args, opts) => exec('gh', args, opts),
    node: (args, opts) => exec(process.execPath, args, opts),
    bash: (args, opts) => exec('bash', args, opts),
    fs: {
      exists: (p) => fs.existsSync(p),
      readFile: (p) => fs.readFileSync(p, 'utf8'),
      writeFile: (p, text) => fs.writeFileSync(p, text, 'utf8'),
      mkdtemp: (prefix) => fs.mkdtempSync(prefix),
      realpath: (p) => fs.realpathSync(p),
      junction: (target, p) => fs.symlinkSync(target, p, 'junction'),
      isLink: (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } },
      // Ikke-rekursivt: unlink paa en junction fjerner kun linket, aldrig maalets indhold.
      unlink: (p) => fs.unlinkSync(p),
      removeTempDir: (p) => fs.rmSync(p, { recursive: true, force: true }),
    },
    tmpRoot: os.tmpdir(),
    now: () => Date.now(),
    log: (line) => console.log(line),
  };
}

class Stop extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function must(result, what) {
  if (result.status !== 0) {
    const tail = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split(/\r?\n/).slice(-15).join('\n    ');
    throw new Stop(EXIT.STOPPED, `${what} fejlede (exit ${result.status})${tail ? `:\n    ${tail}` : ''}`);
  }
  return result.stdout;
}

/**
 * Loeser en kun-baseline-konflikt for een PR. Returnerer { code, lines }.
 * Kaster aldrig; alle fejl bliver til EXIT.STOPPED med en forklaring.
 */
export function resolveBaselineConflict({ pr, repo, dryRun = false }, injected = {}) {
  const defaults = realDeps();
  const deps = { ...defaults, ...injected, fs: { ...defaults.fs, ...(injected.fs ?? {}) } };
  const lines = [];
  const say = (line) => { lines.push(line); deps.log(line); };
  const tag = dryRun ? '[dry-run] ' : '';
  let cleanup = null;
  try {
    // 1. PR-tilstand
    const view = JSON.parse(must(deps.gh(['pr', 'view', String(pr), '--repo', repo, '--json',
      'state,baseRefName,headRefName,headRefOid,isCrossRepository,mergeable']), 'gh pr view') || '{}');
    if (view.state !== 'OPEN') throw new Stop(EXIT.NOTHING, `PR #${pr} er ikke aaben (${view.state}).`);
    if (view.baseRefName !== 'main') throw new Stop(EXIT.NOT_ELIGIBLE, `PR #${pr} gaar mod ${view.baseRefName}, ikke main.`);
    if (view.isCrossRepository) throw new Stop(EXIT.NOT_ELIGIBLE, `PR #${pr} kommer fra en fork; koeen kan ikke pushe dertil.`);
    if (view.mergeable !== 'CONFLICTING') throw new Stop(EXIT.NOTHING, `PR #${pr} er ikke i konflikt (${view.mergeable}).`);
    const head = String(view.headRefOid ?? '');
    const branch = String(view.headRefName ?? '');
    if (!/^[0-9a-f]{40}$/.test(head) || !branch) throw new Stop(EXIT.STOPPED, `PR #${pr}: ulaeseligt hoved/branch.`);

    // 2. Hent main + PR-hovedet (kun remote-tracking-ref + objekter; intet arbejdstrae roeres)
    must(deps.git(['fetch', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main']), 'git fetch main');
    must(deps.git(['fetch', '--no-tags', 'origin', `refs/heads/${branch}`]), 'git fetch PR-branch');
    const fetched = must(deps.git(['rev-parse', 'FETCH_HEAD']), 'git rev-parse FETCH_HEAD').trim();
    if (fetched !== head) throw new Stop(EXIT.STOPPED, `PR #${pr}: hovedet flyttede sig under laesningen (${head.slice(0, 9)} -> ${fetched.slice(0, 9)}). Koer koeen igen.`);
    const main = must(deps.git(['rev-parse', 'refs/remotes/origin/main']), 'git rev-parse origin/main').trim();

    // 3. Konflikt-filer uden at roere et arbejdstrae
    const mt = deps.git(['merge-tree', '--write-tree', '--name-only', '--no-messages', main, head]);
    if (mt.status === 0) throw new Stop(EXIT.NOTHING, `PR #${pr}: ingen konflikt mod main lokalt; intet at loese.`);
    if (mt.status !== 1) must(mt, 'git merge-tree');
    const conflicts = classifyConflicts(parseMergeTreeConflicts(mt.stdout));
    if (!conflicts.eligible) {
      throw new Stop(EXIT.NOT_ELIGIBLE, `PR #${pr}: konflikt i andre filer end TS-baseline (${conflicts.others.join(', ') || 'ingen filer'}); koeen loeser den ikke.`);
    }

    // PR'ens egne filer -> testene der skal koere
    const base = must(deps.git(['merge-base', main, head]), 'git merge-base').trim();
    const changed = must(deps.git(['diff', '--name-only', `${base}..${head}`]), 'git diff PR-filer').split(/\r?\n/).filter(Boolean);
    const headTree = new Set(must(deps.git(['ls-tree', '-r', '--name-only', head]), 'git ls-tree').split(/\r?\n/).filter(Boolean));

    say(`${tag}PR #${pr}: konflikten ligger kun i ${conflicts.baseline.join(', ')} - koeen loeser den selv (#7628).`);
    if (dryRun) {
      const tests = testsForChangedFiles(changed, (f) => headTree.has(f));
      say(`${tag}ville: midlertidigt worktree paa ${head.slice(0, 9)}, merge origin/main (${main.slice(0, 9)}) ind, tage main's ${conflicts.baseline.join(' + ')}`);
      if (conflicts.baseline.includes(TS_CORE_BASELINE)) say(`${tag}ville: node scripts/check-ts-core-ratchet.mjs --update-baseline (STOP hvis hoejere end main's)`);
      if (conflicts.baseline.includes(FRONTEND_BASELINE)) say(`${tag}ville: node scripts/ci/typecheck-baseline.mjs --update (STOP hvis hoejere end main's)`);
      say(`${tag}ville: koere gaten (node scripts/check-ts-core-ratchet.mjs) og ${tests.length ? tests.map((t) => `${t.pkg || '.'}: node ${t.args.join(' ')}`).join('; ') : 'ingen testfiler for PR\'ens filer'}`);
      say(`${tag}ville: committe bag guard-commit-branch.sh, pushe til ${branch} (aldrig force) og kommentere @codex review. Intet er aendret.`);
      return { code: EXIT.RESOLVED, lines };
    }

    // 4. Midlertidigt worktree paa en midlertidig lokal branch (guarden kraever en branch)
    const tmpDir = deps.fs.mkdtemp(path.join(deps.tmpRoot, `cz-mq-baseline-${pr}-`));
    const wt = path.join(tmpDir, 'wt');
    const tmpBranch = `mq-baseline/pr-${pr}-${deps.now()}`;
    const links = [];
    let worktreeAdded = false;
    cleanup = () => {
      // Junctions FOERST og ikke-rekursivt; ellers kunne en rekursiv sletning foelge
      // linket ind i det delte node_modules-install.
      let linksGone = true;
      for (const link of links) {
        try { if (deps.fs.isLink(link)) deps.fs.unlink(link); } catch { /* tjekkes herunder */ }
        if (deps.fs.isLink(link)) linksGone = false;
      }
      if (!linksGone) {
        say(`ADVARSEL: kunne ikke fjerne en node_modules-junction i ${wt}; worktreet er IKKE fjernet. Ryd op manuelt (rmdir paa junctionen, derefter git worktree remove --force).`);
        return;
      }
      if (worktreeAdded) {
        const rm = deps.git(['worktree', 'remove', '--force', wt]);
        if (rm.status !== 0) say(`ADVARSEL: git worktree remove fejlede for ${wt}: ${(rm.stderr || rm.stdout).trim()}`);
        deps.git(['branch', '-D', tmpBranch]);
      }
      try { deps.fs.removeTempDir(tmpDir); } catch { /* temp-mappe; ufarligt */ }
    };
    must(deps.git(['worktree', 'add', '-b', tmpBranch, wt, head]), 'git worktree add');
    worktreeAdded = true;
    for (const pkg of NODE_MODULE_PACKAGES) {
      const src = path.join(deps.repoRoot, pkg, 'node_modules');
      const dst = path.join(wt, pkg, 'node_modules');
      if (!deps.fs.exists(src) || deps.fs.exists(dst)) continue;
      deps.fs.junction(deps.fs.realpath(src), dst);
      links.push(dst);
    }
    const inWt = { cwd: wt };

    const merge = deps.git(['merge', '--no-ff', '--no-commit', main], inWt);
    if (merge.status !== 0 && merge.status !== 1) must(merge, 'git merge origin/main');
    const unmerged = must(deps.git(['diff', '--name-only', '--diff-filter=U'], inWt), 'git diff --diff-filter=U').split(/\r?\n/).filter(Boolean);
    const recheck = classifyConflicts(unmerged);
    if (!recheck.eligible) throw new Stop(EXIT.NOT_ELIGIBLE, `PR #${pr}: merge gav konflikt i ${recheck.others.join(', ') || 'ingen filer'}; stopper.`);
    for (const file of recheck.baseline) {
      must(deps.git(['checkout', '--theirs', '--', file], inWt), `git checkout --theirs ${file}`);
      must(deps.git(['add', '--', file], inWt), `git add ${file}`);
    }

    // Genberegn: kan kun saenke (scripts naegter selv at haeve) + eksplicit sammenligning mod main
    if (recheck.baseline.includes(TS_CORE_BASELINE)) {
      must(deps.node(['scripts/check-ts-core-ratchet.mjs', '--update-baseline'], inWt), 'ts-core --update-baseline');
      const cmp = compareTsCoreBaselines(
        JSON.parse(must(deps.git(['show', `${main}:${TS_CORE_BASELINE}`]), 'git show main-baseline')),
        JSON.parse(deps.fs.readFile(path.join(wt, TS_CORE_BASELINE))),
      );
      if (!cmp.ok) throw new Stop(EXIT.STOPPED, `PR #${pr}: ny ts-core-baseline er hoejere end main's (${cmp.problems.join('; ')}). Ingen push.`);
    }
    if (recheck.baseline.includes(FRONTEND_BASELINE)) {
      must(deps.node(['scripts/ci/typecheck-baseline.mjs', '--update'], inWt), 'frontend typecheck --update');
      const cmp = compareFrontendBaselines(
        JSON.parse(must(deps.git(['show', `${main}:${FRONTEND_BASELINE}`]), 'git show main-frontend-baseline')),
        JSON.parse(deps.fs.readFile(path.join(wt, FRONTEND_BASELINE))),
      );
      if (!cmp.ok) throw new Stop(EXIT.STOPPED, `PR #${pr}: ny frontend-baseline er hoejere end main's (${cmp.problems.join('; ')}). Ingen push.`);
      must(deps.node(['scripts/ci/typecheck-baseline.mjs'], inWt), 'frontend typecheck-gate');
    }
    must(deps.node(['scripts/check-ts-core-ratchet.mjs'], inWt), 'ts-core-gaten');
    say(`  baseline genberegnet og gaten er groen.`);

    const tests = testsForChangedFiles(changed, (f) => deps.fs.exists(path.join(wt, f)));
    for (const t of tests) {
      must(deps.node(t.args, { cwd: path.join(wt, t.pkg) }), `tests (${t.pkg || '.'})`);
    }
    say(`  tests for PR'ens filer: ${tests.length ? 'groenne' : 'ingen testfiler fundet'}.`);

    for (const file of recheck.baseline) must(deps.git(['add', '--', file], inWt), `git add ${file}`);
    const left = must(deps.git(['diff', '--name-only', '--diff-filter=U'], inWt), 'git diff --diff-filter=U').trim();
    if (left) throw new Stop(EXIT.STOPPED, `PR #${pr}: uloeste filer tilbage (${left}); stopper.`);
    const stray = must(deps.git(['diff', '--name-only'], inWt), 'git diff').trim();
    if (stray) throw new Stop(EXIT.STOPPED, `PR #${pr}: gate/tests aendrede sporede filer (${stray.split(/\r?\n/).join(', ')}); stopper uden push.`);

    const msgFile = path.join(tmpDir, 'msg.txt');
    deps.fs.writeFile(msgFile, commitMessage({ pr, files: recheck.baseline }));
    must(deps.bash([path.join(wt, 'scripts', 'guard-commit-branch.sh'), tmpBranch, wt], inWt), 'guard-commit-branch.sh');
    must(deps.git(['commit', '-F', msgFile], inWt), 'git commit');
    // Aldrig force: er der pushet til PR'en imens, afvises pushet og koeen stopper.
    must(deps.git(['push', 'origin', `HEAD:refs/heads/${branch}`], inWt), `git push til ${branch}`);
    const sha = must(deps.git(['rev-parse', 'HEAD'], inWt), 'git rev-parse HEAD').trim();
    say(`  pushet ${sha.slice(0, 9)} til ${branch}.`);
    must(deps.gh(['pr', 'comment', String(pr), '--repo', repo, '--body',
      '@codex review\n\nMerge-koeen (#7628) mergede main ind; konflikten laa kun i TS-baseline-filerne. Main\'s baseline er genberegnet (kan kun saenkes), og gaten + testene for PR\'ens filer er groenne.']), 'gh pr comment');
    say(`  @codex review bestilt; koeen venter nu paa groen CI + review-gate.`);
    return { code: EXIT.RESOLVED, lines };
  } catch (err) {
    const code = err instanceof Stop ? err.code : EXIT.STOPPED;
    say(`${code === EXIT.STOPPED ? 'STOP' : 'INFO'}: ${err.message}`);
    return { code, lines };
  } finally {
    if (cleanup) cleanup();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.log(`Brug: node scripts/merge-queue-baseline-resolve.mjs --pr <N> [--repo owner/name] [--dry-run] (${err.message})`);
    process.exit(EXIT.STOPPED);
  }
  process.exit(resolveBaselineConflict(opts).code);
}
