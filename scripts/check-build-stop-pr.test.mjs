import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { evaluatePr, issuesFromBody, issuesFromBranch, isDocsOrOpsFile } from './check-build-stop-pr.mjs';
import { loadBuildStop } from './lib/build-stop.mjs';

const cfg = {
  active: true,
  since: '2026-10-29',
  areaCap: 3,
  finishList: [{ issue: 6110, area: 'udvikling-2' }],
  cleanupList: [{ issue: 6514, why: 'aaben PR' }],
  brandList: [{ issue: 7316, reason: 'forkert live', since: '2026-10-29' }],
};
const code = ['backend/lib/x.js'];

test('issuesFromBody: Refs/Closes, lister, andre repoer og skabelon-kommentarer', () => {
  assert.deepEqual(issuesFromBody('Refs #6110'), [6110]);
  assert.deepEqual(issuesFromBody('closes #1, #2 og #3'), [1, 2, 3]);
  assert.deepEqual(issuesFromBody('Fixes NicolaiDolmer/CyclingZone#42'), [42]);
  assert.deepEqual(issuesFromBody('Refs other/repo#9'), []);
  assert.deepEqual(issuesFromBody('<!-- Refs #5 -->\nIngen'), []);
  assert.deepEqual(issuesFromBody('se #77 uden nøgleord'), []);
  assert.deepEqual(issuesFromBody(null), []);
});

test('issuesFromBranch: nummer afgraenset af / _ -', () => {
  assert.deepEqual(issuesFromBranch('chore/7336-byggestop'), [7336]);
  assert.deepEqual(issuesFromBranch('fix/foo_6110_bar'), [6110]);
  assert.deepEqual(issuesFromBranch('feat/abc12345'), []);
  assert.deepEqual(issuesFromBranch('main'), []);
});

test('isDocsOrOpsFile: kun docs/, learnings og rod-.md', () => {
  for (const f of ['docs/NOW.md', 'docs/STATUS_BOARD.md', '.claude/learnings/a.md', 'README.md', 'docs\\x.md']) assert.equal(isDocsOrOpsFile(f), true, f);
  for (const f of ['scripts/x.mjs', 'backend/a.js', 'frontend/docs/a.md', '.github/workflows/a.yml', 'docs-evil/a.md']) assert.equal(isDocsOrOpsFile(f), false, f);
});

test('inaktivt byggestop lader alt passere', () => {
  const r = evaluatePr({ body: '', branch: 'feat/ny', author: 'x', files: code, cfg: { ...cfg, active: false } });
  assert.equal(r.ok, true);
  assert.equal(r.rule, 'inactive');
});

test('finishList, cleanupList og brandList via body tillades', () => {
  for (const n of [6110, 6514, 7316]) {
    const r = evaluatePr({ body: `Refs #${n}`, branch: 'feat/x', author: 'a', files: code, cfg });
    assert.equal(r.ok, true, `#${n}`);
    assert.equal(r.rule, 'listed');
  }
});

test('issue i branch-navn alene er nok', () => {
  const r = evaluatePr({ body: '', branch: 'fix/6110-noget', author: 'a', files: code, cfg });
  assert.equal(r.ok, true);
});

test('ny-arbejde-issue afvises og besked nævner issue + listerne', () => {
  const r = evaluatePr({ body: 'Refs #9999', branch: 'feat/ny-ting', author: 'a', files: code, cfg });
  assert.equal(r.ok, false);
  assert.match(r.message, /#9999/);
  assert.match(r.message, /brandList/);
});

test('ingen reference afvises', () => {
  const r = evaluatePr({ body: 'ingen', branch: 'feat/ny-ting', author: 'a', files: code, cfg });
  assert.equal(r.ok, false);
  assert.match(r.message, /refererer intet issue/);
});

test('et tilladt issue blandt flere er nok', () => {
  const r = evaluatePr({ body: 'Refs #9999\nRefs #6110', branch: 'feat/x', author: 'a', files: code, cfg });
  assert.equal(r.ok, true);
});

test('dependabot undtages via forfatter og via branch', () => {
  assert.equal(evaluatePr({ body: '', branch: 'x', author: 'dependabot[bot]', files: code, cfg }).rule, 'dependabot');
  assert.equal(evaluatePr({ body: '', branch: 'dependabot/npm_and_yarn/foo', author: 'a', files: code, cfg }).rule, 'dependabot');
});

test('ren docs/ops-PR undtages, men een kodefil haever undtagelsen', () => {
  const docs = ['docs/NOW.md', 'docs/STATUS_BOARD.md'];
  assert.equal(evaluatePr({ body: '', branch: 'chore/now', author: 'a', files: docs, cfg }).rule, 'docs-ops');
  const mixed = evaluatePr({ body: '', branch: 'chore/now', author: 'a', files: [...docs, 'scripts/x.mjs'], cfg });
  assert.equal(mixed.ok, false);
});

test('tom filliste er ikke en docs/ops-undtagelse (fail closed)', () => {
  const r = evaluatePr({ body: '', branch: 'feat/x', author: 'a', files: [], cfg });
  assert.equal(r.ok, false);
});

test('CLI: den rigtige scripts/build-stop.json laeses og afviser et ukendt issue', () => {
  assert.equal(loadBuildStop().active, true);
  assert.throws(
    () => execFileSync(process.execPath, ['scripts/check-build-stop-pr.mjs'], {
      env: { ...process.env, PR_BODY: 'Refs #1', PR_BRANCH: 'feat/ny', PR_AUTHOR: 'a', CHANGED_FILES: 'backend/lib/x.js' },
      stdio: 'pipe',
    }),
    (err) => err.status === 1 && /AFVIST/.test(String(err.stdout)),
  );
  const ok = execFileSync(process.execPath, ['scripts/check-build-stop-pr.mjs'], {
    env: { ...process.env, PR_BODY: 'Refs #7336', PR_BRANCH: 'chore/7336-x', PR_AUTHOR: 'a', CHANGED_FILES: 'backend/lib/x.js' },
    encoding: 'utf8',
  });
  assert.match(ok, /OK \(listed\)/);
});

test('issuesFromBody: indlejrede og uafsluttede HTML-kommentarer fjernes helt (CodeQL #384)', () => {
  assert.deepEqual(issuesFromBody('<!<!-- x -->-- Refs #111 -->Refs #222'), [222]);
  assert.deepEqual(issuesFromBody('Refs #333 <!-- Refs #444'), [333]);
});

test('issuesFromBody: "<!--" i kode sluger ikke referencerne (review #7432)', () => {
  assert.deepEqual(issuesFromBody('Fjern `<!--` i parser\n\nRefs #7431'), [7431]);
  assert.deepEqual(issuesFromBody('```\n<!--\n```\nRefs #7431'), [7431]);
});
