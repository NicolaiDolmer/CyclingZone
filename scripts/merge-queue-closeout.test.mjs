import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  parseIssueRefs, isBehindSwitch, shouldFlip, runCloseOut, buildNowLine, markerFor, commentBody, copenhagenDate, validTrain, main,
} from './merge-queue-closeout.mjs';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
// Fast ur i alle tests (AGENTS.md: deterministiske tests, intet vaeg-ur).
const NOW = new Date('2026-11-04T12:00:00Z');

// Fake gh med tilstand: kommentarer og labels pr. issue. Logger hvert kald.
function fakeGh({ prs = {}, comments = {}, labels = {}, fail = {} } = {}) {
  const calls = [];
  const state = { comments: structuredClone(comments), labels: structuredClone(labels) };
  const gh = (args) => {
    calls.push(args);
    const key = args.slice(0, 2).join(' ');
    if (fail[key]) return { status: 1, stdout: '' };
    if (args[0] === 'pr' && args[1] === 'view') {
      const pr = prs[args[2]];
      return pr ? { status: 0, stdout: JSON.stringify(pr) } : { status: 1, stdout: '' };
    }
    if (args[0] === 'api' && args.includes('PATCH')) {
      // Kommentar-id = issue * 1000 + indeks (se listen herunder).
      if (fail['api patch']) return { status: 1, stdout: '' };
      const id = Number(/issues\/comments\/(\d+)$/.exec(args[1])[1]);
      const list = state.comments[Math.floor(id / 1000)];
      list[id % 1000] = args[args.indexOf('-f') + 1].replace(/^body=/, '');
      return { status: 0, stdout: '' };
    }
    if (args[0] === 'api') {
      const issue = /issues\/(\d+)\/comments/.exec(args[1])[1];
      if (fail[`comments ${issue}`]) return { status: 1, stdout: '' };
      const list = (state.comments[issue] ?? []).map((body, i) => ({ id: Number(issue) * 1000 + i, body }));
      return { status: 0, stdout: JSON.stringify([list]) };
    }
    if (args[0] === 'issue' && args[1] === 'comment') {
      const body = args[args.indexOf('--body') + 1];
      (state.comments[args[2]] ??= []).push(body);
      return { status: 0, stdout: '' };
    }
    if (args[0] === 'issue' && args[1] === 'view') {
      if (fail[`labels ${args[2]}`]) return { status: 1, stdout: '' };
      return { status: 0, stdout: JSON.stringify({ labels: (state.labels[args[2]] ?? []).map((name) => ({ name })) }) };
    }
    if (args[0] === 'issue' && args[1] === 'edit') {
      const issue = args[2];
      const remove = args[args.indexOf('--remove-label') + 1];
      const add = args[args.indexOf('--add-label') + 1];
      state.labels[issue] = [...(state.labels[issue] ?? []).filter((l) => l !== remove), add];
      return { status: 0, stdout: '' };
    }
    return { status: 1, stdout: '' };
  };
  return { gh, calls, state };
}
const writes = (calls) => calls.filter((a) => (a[0] === 'issue' && (a[1] === 'comment' || a[1] === 'edit')) || (a[0] === 'api' && a.includes('PATCH')));

test('parseIssueRefs finds Refs and closing keywords, lists, and lets Closes win', () => {
  const body = 'Refs #10, #11 og #12\nCloses #20\nFixes: #21\nrefs #20\nresolves #22 and #23';
  assert.deepEqual(parseIssueRefs(body), [
    { issue: 10, kind: 'refs' }, { issue: 11, kind: 'refs' }, { issue: 12, kind: 'refs' },
    { issue: 20, kind: 'closes' }, { issue: 21, kind: 'closes' }, { issue: 22, kind: 'closes' }, { issue: 23, kind: 'closes' },
  ]);
  assert.deepEqual(parseIssueRefs('Refs #5\nCloses #5'), [{ issue: 5, kind: 'closes' }]);
});

test('parseIssueRefs ignores template help text, code, bare mentions and the PR itself', () => {
  const body = [
    'Refs #',
    '<!-- Brug `Refs #N` ikke `Closes #N`; fx Closes #999 -->',
    '```\nCloses #998\n```',
    '~~~text\nCloses #123\n~~~',
    'Se `Closes #997` og #996 (bare mention).',
    'Prefs #995 og xrefs #994',
    'Refs #7601',
    'Refs #7587',
  ].join('\n');
  assert.deepEqual(parseIssueRefs(body, 7601), [{ issue: 7587, kind: 'refs' }]);
  assert.deepEqual(parseIssueRefs(null), []);
});

test('fenced examples in a PR body never trigger issue mutations', () => {
  const body = 'Refs #1\n~~~text\nCloses #123\n~~~\n```\nCloses #124\n```';
  const { gh, calls } = fakeGh({ prs: { 100: { title: 't', body } }, labels: { 123: ['claude:todo'], 124: ['claude:todo'] } });
  const res = runCloseOut({ train: [{ number: 100, sha: SHA_A }], gh, now: NOW });
  assert.deepEqual(res.comments, [{ issue: 1, pr: 100 }]);
  assert.deepEqual(res.flips, []);
  assert.ok(calls.every((a) => !a.includes('123') && !a.includes('124') && !String(a[1]).includes('/123/') && !String(a[1]).includes('/124/')));
});

test('close-out comments on every referenced issue and flips Closes and Refs issues from claude:todo (#7782)', () => {
  const { gh, calls, state } = fakeGh({
    prs: { 100: { title: 'feat: noget', body: 'Refs #1\nCloses #2\nCloses #3' }, 101: { title: 'fix: andet', body: 'Refs #2' } },
    labels: { 1: ['claude:todo'], 2: ['claude:todo', 'type:bug'], 3: ['claude:done'] },
  });
  const res = runCloseOut({ train: [{ number: 100, sha: SHA_A }, { number: 101, sha: SHA_B }], gh, now: new Date('2026-11-04T12:00:00Z') });
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.comments, [{ issue: 1, pr: 100 }, { issue: 2, pr: 100 }, { issue: 3, pr: 100 }, { issue: 2, pr: 101 }]);
  assert.deepEqual(res.flips, [1, 2], 'Refs-issue #1 flips too; #3 is already done');
  assert.deepEqual(state.labels[1], ['claude:done']);
  assert.deepEqual(state.labels[2], ['type:bug', 'claude:done']);
  assert.equal(state.comments[2].length, 2, 'one comment per (PR, issue)');
  assert.ok(state.comments[2][0].includes(markerFor(100, 2)) && state.comments[2][0].includes(SHA_A));
  assert.ok(state.comments[2][1].includes(markerFor(101, 2)) && state.comments[2][1].includes(SHA_B));
  assert.deepEqual(calls.filter((a) => a[0] === 'issue' && a[1] === 'view').map((a) => a[2]), ['1', '2', '3', '2']);
  assert.equal(res.nowLine, '- 4/11 merge-tog verificeret (main-CI + deploy-verifikation grønne): #100 `aaaaaaaa` feat: noget (Refs #1, Closes #2, Closes #3); #101 `bbbbbbbb` fix: andet (Refs #2).');
});

test('close-out is idempotent: a rerun writes no duplicate comments or labels', () => {
  const setup = { prs: { 100: { title: 't', body: 'Closes #2\nRefs #1' } }, labels: { 2: ['claude:todo'] } };
  const first = fakeGh(setup);
  const train = [{ number: 100, sha: SHA_A }];
  runCloseOut({ train, gh: first.gh, now: NOW });
  const second = fakeGh({ ...setup, comments: first.state.comments, labels: first.state.labels });
  const rerun = runCloseOut({ train, gh: second.gh, now: NOW });
  assert.deepEqual(writes(second.calls), []);
  assert.deepEqual(rerun.comments, []);
  assert.deepEqual(rerun.skippedComments, [{ issue: 2, pr: 100 }, { issue: 1, pr: 100 }]);
  assert.deepEqual(rerun.flips, []);
  assert.deepEqual(rerun.errors, []);
});

test('merged phase writes the SHA comment at once, touches no labels and gives no NOW line', () => {
  const { gh, calls, state } = fakeGh({ prs: { 100: { title: 't', body: 'Closes #2\nRefs #1' } }, labels: { 2: ['claude:todo'] } });
  const res = runCloseOut({ train: [{ number: 100, sha: SHA_A }], gh, phase: 'merged', now: NOW });
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.comments, [{ issue: 2, pr: 100 }, { issue: 1, pr: 100 }]);
  assert.deepEqual(res.flips, []);
  assert.equal(res.nowLine, null);
  assert.deepEqual(state.labels[2], ['claude:todo'], 'labels wait for the verified train');
  assert.ok(calls.every((a) => !(a[0] === 'issue' && (a[1] === 'view' || a[1] === 'edit'))));
  const body = state.comments[2][0];
  assert.ok(body.startsWith(markerFor(100, 2)) && body.includes(SHA_A) && body.includes(SHA_A.slice(0, 7)), 'the Stop hook finds the short SHA');
  assert.match(body, /Verifikation afventer/);
  assert.doesNotMatch(body, /Verificeret:|—/);
  // Samme merge rapporteret igen (fx genstart): ingen dublet.
  const again = runCloseOut({ train: [{ number: 100, sha: SHA_A }], gh, phase: 'merged', now: NOW });
  assert.deepEqual(again.comments, []);
  assert.deepEqual(again.skippedComments, [{ issue: 2, pr: 100 }, { issue: 1, pr: 100 }]);
  assert.equal(state.comments[2].length, 1);
});

test('the verified run updates the same pending comment instead of writing a duplicate', () => {
  const { gh, calls, state } = fakeGh({ prs: { 100: { title: 't', body: 'Closes #2\nRefs #1' } }, labels: { 2: ['claude:todo'] }, comments: { 2: ['andet'] } });
  runCloseOut({ train: [{ number: 100, sha: SHA_A }], gh, phase: 'merged', now: NOW });
  const res = runCloseOut({ train: [{ number: 100, sha: SHA_A }], gh, deployVerified: false, now: NOW });
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.comments, [], 'no new comment');
  assert.deepEqual(res.updatedComments, [{ issue: 2, pr: 100 }, { issue: 1, pr: 100 }]);
  assert.deepEqual(res.flips, [2]);
  assert.equal(state.comments[2].length, 2, 'unrelated comment + the one SHA comment');
  assert.equal(state.comments[2][0], 'andet');
  assert.equal(state.comments[2][1], commentBody({ pr: 100, issue: 2, sha: SHA_A, kind: 'closes', deployVerified: false }));
  assert.equal(state.comments[1].length, 1);
  assert.match(state.comments[1][0], /Verificeret: main-CI grøn, toget deployer ikke/);
  const patch = calls.find((a) => a[0] === 'api' && a.includes('PATCH'));
  assert.equal(patch[1], 'repos/NicolaiDolmer/CyclingZone/issues/comments/2001');
  assert.ok(res.nowLine);
  // Endnu en verificeret koersel: alt er opdateret, intet skrives.
  const before = writes(calls).length;
  const rerun = runCloseOut({ train: [{ number: 100, sha: SHA_A }], gh, now: NOW });
  assert.equal(writes(calls).length, before);
  assert.deepEqual(rerun.skippedComments, [{ issue: 2, pr: 100 }, { issue: 1, pr: 100 }]);
});

test('a failed update is a warning; dry-run only says it would update', () => {
  const setup = { prs: { 100: { title: 't', body: 'Refs #1' } } };
  const first = fakeGh(setup);
  runCloseOut({ train: [{ number: 100, sha: SHA_A }], gh: first.gh, phase: 'merged', now: NOW });
  const failing = fakeGh({ ...setup, comments: first.state.comments, fail: { 'api patch': true } });
  const res = runCloseOut({ train: [{ number: 100, sha: SHA_A }], gh: failing.gh, now: NOW });
  assert.match(res.errors.join('\n'), /opdatering af SHA-kommentar fejlede/);
  assert.equal(failing.calls.filter((a) => a[1] === 'comment').length, 0, 'never falls back to a duplicate');
  const lines = [];
  const dry = fakeGh({ ...setup, comments: first.state.comments });
  runCloseOut({ train: [{ number: 100, sha: SHA_A }], gh: dry.gh, dryRun: true, log: (l) => lines.push(l), now: NOW });
  assert.deepEqual(writes(dry.calls), []);
  assert.ok(lines.some((l) => l.includes('ville opdatere SHA-kommentaren til verificeret')));
  assert.deepEqual(runCloseOut({ train: [{ number: 100, sha: SHA_A }], gh: dry.gh, phase: 'x' }).errors, ['ukendt fase: x']);
});

test('CLI merged subcommand writes the pending comment and no NOW line', () => {
  const out = [];
  const { gh, state } = fakeGh({ prs: { 5: { title: 't', body: 'Refs #9' } } });
  assert.equal(main(['merged', '--train', JSON.stringify([{ number: 5, sha: SHA_A }]), '--repo', 'o/r'], { gh, out: (l) => out.push(l), now: NOW }), 0);
  assert.equal(state.comments[9].length, 1);
  assert.ok(!out.some((l) => l.startsWith('NOW-LINJE')));
  assert.match(out.at(-1), /\(straks efter merge\) faerdig: 1 kommentar\(er\), 0 opdateret/);
});

test('dry-run reads but never writes', () => {
  const { gh, calls } = fakeGh({ prs: { 100: { title: 't', body: 'Closes #2\nRefs #1' } }, labels: { 2: ['claude:todo'] } });
  const lines = [];
  const res = runCloseOut({ train: [{ number: 100, sha: SHA_A }], gh, dryRun: true, log: (l) => lines.push(l), now: NOW });
  assert.deepEqual(writes(calls), []);
  assert.deepEqual(res.comments, []);
  assert.deepEqual(res.flips, []);
  assert.ok(lines.every((l) => l.startsWith('[dry-run] ')));
  assert.ok(lines.some((l) => l.includes('ville flippe claude:todo -> claude:done')));
  assert.ok(lines.some((l) => l.includes('ville skrive SHA-kommentar for PR #100')));
});

test('a preview without merge SHA never writes, even outside dry-run, and gives no NOW line', () => {
  const { gh, calls } = fakeGh({ prs: { 100: { title: 't', body: 'Closes #2' } }, labels: { 2: ['claude:todo'] } });
  const res = runCloseOut({ train: [{ number: 100, sha: null }], gh, now: NOW });
  assert.deepEqual(writes(calls), []);
  assert.equal(res.nowLine, null);
});

test('close-out is fail-soft: gh failures become warnings and unreadable comments are never written', () => {
  const unreadable = fakeGh({ prs: { 100: { title: 't', body: 'Closes #2' } }, labels: { 2: ['claude:todo'] }, fail: { 'comments 2': true } });
  const res = runCloseOut({ train: [{ number: 100, sha: SHA_A }], gh: unreadable.gh, now: NOW });
  assert.equal(unreadable.calls.filter((a) => a[1] === 'comment').length, 0, 'unknown comments = no write (no duplicate risk)');
  assert.deepEqual(res.flips, [2], 'label flip is independent of the comment read');
  assert.match(res.errors.join('\n'), /kommentarer kunne ikke laeses/);

  const noBody = fakeGh({ fail: { 'pr view': true } });
  const res2 = runCloseOut({ train: [{ number: 100, sha: SHA_A }], gh: noBody.gh, now: NOW });
  assert.deepEqual(writes(noBody.calls), []);
  assert.match(res2.errors.join('\n'), /PR #100: body kunne ikke laeses/);

  const writeFails = fakeGh({ prs: { 100: { title: 't', body: 'Closes #2' } }, labels: { 2: ['claude:todo'] }, fail: { 'issue comment': true, 'issue edit': true } });
  const res3 = runCloseOut({ train: [{ number: 100, sha: SHA_A }], gh: writeFails.gh, now: NOW });
  assert.equal(res3.errors.length, 2);
  assert.deepEqual(res3.comments, []);
  assert.deepEqual(res3.flips, []);

  const labelsFail = fakeGh({ prs: { 100: { title: 't', body: 'Closes #2' } }, fail: { 'labels 2': true } });
  const res4 = runCloseOut({ train: [{ number: 100, sha: SHA_A }], gh: labelsFail.gh, now: NOW });
  assert.equal(labelsFail.calls.filter((a) => a[1] === 'edit').length, 0);
  assert.match(res4.errors.join('\n'), /labels kunne ikke laeses; intet flip/);

  const throwing = runCloseOut({ train: [{ number: 100, sha: SHA_A }], gh: () => { throw new Error('boom'); }, now: NOW });
  assert.match(throwing.errors.join('\n'), /boom/);
  assert.deepEqual(runCloseOut({ train: [{ number: 100, sha: SHA_A }], now: NOW }).errors, ['ingen gh-runner']);
});

test('comment and NOW line state the verification honestly and use no em-dash', () => {
  const body = commentBody({ pr: 7, issue: 8, sha: SHA_A, kind: 'refs', deployVerified: false, behindSwitch: true });
  assert.match(body, /main-CI grøn, toget deployer ikke/);
  assert.match(body, /bag slukket kontakt; labels er ikke ændret/);
  assert.match(commentBody({ pr: 7, issue: 8, sha: SHA_A, kind: 'refs' }), /label flyttet til `claude:done`/);
  assert.ok(body.startsWith(markerFor(7, 8)));
  assert.doesNotMatch(body + commentBody({ pr: 7, issue: 8, sha: SHA_A, kind: 'closes' }), /—/);
  const line = buildNowLine([{ number: 7, sha: SHA_A, title: 'x'.repeat(100), refs: [] }], new Date('2026-11-04T23:30:00Z'), false);
  assert.match(line, /^- 5\/11 merge-tog verificeret \(main-CI grøn, toget deployer ikke\): #7 `aaaaaaaa` x{67}\.\.\.\.$/);
  assert.equal(copenhagenDate(new Date('2026-07-01T22:30:00Z')), '2/7', 'summer time is Copenhagen local');
});

test('behind-switch detection reads PR title and prose, not template help text or code (#7782)', () => {
  assert.equal(isBehindSwitch('feat: ny motor', 'Ligger bag slukket kontakt.'), true);
  assert.equal(isBehindSwitch('feat: x (bag kontakt)', ''), true);
  assert.equal(isBehindSwitch('x', 'Shipped behind a feature flag, default off.'), true);
  assert.equal(isBehindSwitch('x', 'Dark launch af nyt kort.'), true);
  assert.equal(isBehindSwitch('fix: bug', 'Refs #1\nRettelsen er live.'), false);
  assert.equal(isBehindSwitch('x', '<!-- skriv hvis bag slukket kontakt -->'), false);
  assert.equal(isBehindSwitch('x', 'Se `bag slukket kontakt` i koden'), false);
  assert.equal(isBehindSwitch('x', 'Alt er bag slukket flag.'), true);
  assert.equal(isBehindSwitch('x', 'Bag slukkede flag.'), true);
  assert.equal(isBehindSwitch('x', 'Flaget new_thing er slukket.'), true);
  assert.equal(isBehindSwitch('x', 'Shipped behind a feature flag, enabled for all players.'), false);
  assert.equal(isBehindSwitch('x', 'Ligger bag flag, tændt for alle.'), false);
  // Rigtige formuleringer fra projektets kontakt-PR'er (#7761, #7576, #7764, #7590).
  assert.equal(isBehindSwitch('fix(motor): startfeltet holder til mål i etapeløb bag kontakt (#7733)', ''), true);
  assert.equal(isBehindSwitch('feat(training): rollen styrer basis-dag bag egen kontakt (#5950)', ''), true);
  assert.equal(isBehindSwitch('x', 'Ligger **slukket** kontakt i app_config.'), true);
  assert.equal(isBehindSwitch('x', 'Ny motor (slukket)'), true);
  assert.equal(isBehindSwitch('feat: potentiale bag slukket flag (#7685)', ''), true);
  assert.equal(isBehindSwitch('x', 'Ligger bag _slukket_ kontakt.'), true);
  assert.equal(isBehindSwitch(null, undefined), false);
  assert.equal(shouldFlip('closes', true), true, 'Closes closes the issue on GitHub, so the label follows');
  assert.equal(shouldFlip('refs', true), false);
  assert.equal(shouldFlip('refs', false), true);
});

test('Refs issues of a PR behind a switched-off switch keep claude:todo and only get the comment (#7782)', () => {
  const { gh, state } = fakeGh({
    prs: { 100: { title: 'feat: dagsform', body: 'Refs #1\nLigger bag slukket kontakt.' }, 101: { title: 'fix: andet', body: 'Refs #2' } },
    labels: { 1: ['claude:todo'], 2: ['claude:todo'] },
  });
  const lines = [];
  const res = runCloseOut({ train: [{ number: 100, sha: SHA_A }, { number: 101, sha: SHA_B }], gh, now: NOW, log: (l) => lines.push(l) });
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.flips, [2]);
  assert.deepEqual(state.labels[1], ['claude:todo']);
  assert.deepEqual(state.labels[2], ['claude:done']);
  assert.match(state.comments[1][0], /bag slukket kontakt; labels er ikke ændret/);
  assert.ok(lines.some((l) => l.includes('#1') && l.includes('bag slukket kontakt')));
});

test('the switch exception holds per issue: a later or same-train PR without the phrase does not flip it (#7782)', () => {
  // Samme tog: kontakt-PR'en og en samle-PR (patch notes) Refs'er begge issue 1, i begge raekkefoelger.
  for (const order of [[100, 101], [101, 100]]) {
    const { gh, state } = fakeGh({
      prs: { 100: { title: 'feat: dagsform bag kontakt', body: 'Refs #1' }, 101: { title: 'docs(patch-notes): samlet note', body: 'Refs #1, #2' } },
      labels: { 1: ['claude:todo'], 2: ['claude:todo'] },
    });
    const res = runCloseOut({ train: order.map((number, i) => ({ number, sha: i ? SHA_B : SHA_A })), gh, now: NOW });
    assert.deepEqual(res.errors, []);
    assert.deepEqual(res.flips, [2], 'only the issue no PR holds back is flipped');
    assert.deepEqual(state.labels[1], ['claude:todo']);
    assert.deepEqual(state.labels[2], ['claude:done']);
    assert.match(state.comments[1].join(' '), /en anden PR på issuet ligger bag slukket kontakt/);
  }
  // Senere tog: kontakt-PR'ens egen kommentar staar paa issuet og holder patch-note-PR'en tilbage.
  const first = fakeGh({ prs: { 100: { title: 'feat: x bag kontakt', body: 'Refs #1' } }, labels: { 1: ['claude:todo'] } });
  runCloseOut({ train: [{ number: 100, sha: SHA_A }], gh: first.gh, now: NOW });
  const later = fakeGh({ prs: { 101: { title: 'docs(patch-notes): note', body: 'Refs #1' } }, labels: first.state.labels, comments: first.state.comments });
  const res = runCloseOut({ train: [{ number: 101, sha: SHA_B }], gh: later.gh, now: NOW });
  assert.deepEqual(res.flips, []);
  assert.deepEqual(later.state.labels[1], ['claude:todo']);
  // Closes flipper stadig altid.
  const closes = fakeGh({ prs: { 100: { title: 'feat bag kontakt', body: 'Refs #1' }, 101: { title: 'fix', body: 'Closes #1' } }, labels: { 1: ['claude:todo'] } });
  assert.deepEqual(runCloseOut({ train: [{ number: 100, sha: SHA_A }, { number: 101, sha: SHA_B }], gh: closes.gh, now: NOW }).flips, [1]);
});

test('dry-run and merged phase never flip a Refs issue (#7782)', () => {
  const setup = { prs: { 100: { title: 't', body: 'Refs #1' } }, labels: { 1: ['claude:todo'] } };
  const dry = fakeGh(setup);
  const dryRes = runCloseOut({ train: [{ number: 100, sha: SHA_A }], gh: dry.gh, dryRun: true, now: NOW });
  assert.deepEqual(dryRes.flips, []);
  assert.deepEqual(writes(dry.calls), []);
  const merged = fakeGh(setup);
  const mergedRes = runCloseOut({ train: [{ number: 100, sha: SHA_A }], gh: merged.gh, phase: 'merged', now: NOW });
  assert.deepEqual(mergedRes.flips, []);
  assert.deepEqual(merged.state.labels[1], ['claude:todo']);
  assert.match(merged.state.comments[1][0], /label flyttes først, når toget er verificeret/);
});

test('train validation and CLI exit codes', () => {
  assert.equal(validTrain([{ number: 1, sha: SHA_A }]), true);
  assert.equal(validTrain([{ number: 1, sha: null }]), true);
  assert.equal(validTrain([{ number: 1, sha: 'nope' }]), false);
  assert.equal(validTrain([]), false);
  const out = [];
  assert.equal(main(['run', '--train', 'not json'], { gh: () => ({ status: 1, stdout: '' }), out: (l) => out.push(l), now: NOW }), 1);
  assert.equal(main(['help'], { out: (l) => out.push(l), now: NOW }), 1);
  const ok = [];
  const { gh, calls } = fakeGh({ prs: { 5: { title: 't', body: 'Refs #9' } } });
  assert.equal(main(['run', '--train', JSON.stringify([{ number: 5, sha: SHA_A }]), '--repo', 'o/r', '--no-deploy'], { gh, out: (l) => ok.push(l), now: NOW }), 0);
  assert.ok(calls.every((a) => a[0] === 'api' || a.includes('o/r')), 'every gh call targets --repo');
  assert.ok(ok.some((l) => l.startsWith('NOW-LINJE') && l.includes('toget deployer ikke')));
  assert.ok(ok.at(-1).includes('1 kommentar(er)'));
});

// --- merge-queue.ps1-integration: den rigtige Close-OpenTrain + Invoke-TrainCloseOut ---
const queue = readFileSync(new URL('./merge-queue.ps1', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const psQuote = (value) => "'" + value.replaceAll("'", "''") + "'";
function runQueue(body) {
  const prelude = `$ErrorActionPreference='Stop'
$ast=[Management.Automation.Language.Parser]::ParseInput(${psQuote(queue)},[ref]$null,[ref]$null)
foreach($name in @('Close-OpenTrain','Invoke-TrainCloseOut','Get-DeployGateAction')){
 $fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
 if(-not $fn){throw "Missing queue function: $name"}
 Invoke-Expression $fn.Extent.Text
}
$Repo='fixture/repo'; $script:CloseOutScript='fixture/merge-queue-closeout.mjs'; $DryRun=$false
$CiTimeoutMinutes=1; $StallMinutes=0; $DeployVerifyTimeoutMinutes=1; $MinWaitMinutesNoBackend=0
$script:nodeCalls=@(); $script:nextMerge=0; $script:unexpected=$null; $script:ciOk=$true; $script:nodeMode='ok'
$script:batchMerged=@(1,2); $script:batchShas=@('${SHA_A}','${SHA_B}'); $script:lastMergedSha='${SHA_B}'
$script:batchBackend=$true; $script:batchRailway=$false; $script:batchVercel=$false
$script:trainDeploys=1; $script:trainNeedsRailway=$false; $script:queueStall=$null; $script:ciUnverified=$false; $script:ciResults=@{}
$script:trainEntries=@([pscustomobject]@{number=1;sha='${SHA_A}'},[pscustomobject]@{number=2;sha='${SHA_B}'})
function Wait-BatchCi { return $script:ciOk }
function Wait-BatchMigrations { return $true }
function Wait-ForDeployVerification { param($Sha,$TimeoutMinutes,$StallMinutes); return 'released' }
function Write-TrainCulprit { param($Failure) }
function Start-Sleep { param($Seconds) }
function node {
 $script:nodeCalls += ,@($args)
 if($script:nodeMode -eq 'throw'){ throw 'private-closeout-failure' }
 if($script:nodeMode -eq 'fail'){ $global:LASTEXITCODE=1; return 'close-out ADVARSEL: fixture' }
 $global:LASTEXITCODE=0; return 'NOW-LINJE fixture'
}
`;
  const input = `${prelude}
try { ${body}; $script:nextMerge++ }
catch { $script:unexpected=$_.Exception.Message; exit 2 }
finally {
 $calls=@($script:nodeCalls | ForEach-Object { ,@($_ | ForEach-Object { [string]$_ }) })
 Write-Output ('RESULT='+(@{calls=$calls;nextMerge=$script:nextMerge;unexpected=$script:unexpected;batch=$script:batchMerged.Count}|ConvertTo-Json -Compress -Depth 5))
}
`;
  const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', '& ([scriptblock]::Create([Console]::In.ReadToEnd()))'], { input, encoding: 'utf8', timeout: 60_000 });
  assert.ifError(result.error);
  const line = result.stdout.split(/\r?\n/).find((l) => l.startsWith('RESULT='));
  assert.ok(line, `queue fixture produced no result: ${result.stderr.slice(-1200)}`);
  const data = JSON.parse(line.slice(7));
  data.calls = (data.calls ?? []).map((c) => (Array.isArray(c) ? c : [c]));
  return { status: result.status, data, stdout: result.stdout };
}

test('verified train closure runs close-out once with every merged PR and SHA', () => {
  const res = runQueue('Close-OpenTrain');
  assert.equal(res.status, 0, res.stdout);
  assert.equal(res.data.unexpected, null);
  assert.equal(res.data.nextMerge, 1);
  assert.equal(res.data.calls.length, 1);
  const args = res.data.calls[0];
  assert.match(args[0], /merge-queue-closeout\.mjs$/);
  assert.equal(args[1], 'run');
  assert.deepEqual(JSON.parse(args[args.indexOf('--train') + 1]), [{ number: 1, sha: SHA_A }, { number: 2, sha: SHA_B }]);
  assert.ok(validTrain(JSON.parse(args[args.indexOf('--train') + 1])), 'PowerShell JSON is accepted by the Node module');
  assert.equal(args[args.indexOf('--repo') + 1], 'fixture/repo');
  assert.ok(!args.includes('--dry-run') && !args.includes('--no-deploy'));
  assert.match(res.stdout, /NOW-LINJE fixture/);
});

test('a train without deploy is closed out with --no-deploy', () => {
  const res = runQueue('$script:batchBackend=$false; Close-OpenTrain');
  assert.equal(res.status, 0, res.stdout);
  assert.ok(res.data.calls[0].includes('--no-deploy'));
});

test('red main CI never reaches close-out', () => {
  const res = runQueue("$script:ciOk=$false; $script:ciResults=@{'x'=$false}; Close-OpenTrain");
  assert.equal(res.status, 1);
  assert.deepEqual(res.data.calls, []);
  assert.equal(res.data.nextMerge, 0);
});

test('close-out failure never turns a verified merge into a failure', () => {
  for (const mode of ['fail', 'throw']) {
    const res = runQueue(`$script:nodeMode='${mode}'; Close-OpenTrain`);
    assert.equal(res.status, 0, `${mode}: ${res.stdout}`);
    assert.equal(res.data.unexpected, null, mode);
    assert.equal(res.data.nextMerge, 1, mode);
    assert.equal(res.data.batch, 0, mode);
    assert.doesNotMatch(res.stdout, /private-closeout-failure/);
  }
  const missing = runQueue('Remove-Item Function:\\Invoke-TrainCloseOut; Close-OpenTrain');
  assert.equal(missing.status, 0, missing.stdout);
  assert.equal(missing.data.nextMerge, 1);
});

test('Invoke-TrainCloseOut -Phase merged calls the merged subcommand', () => {
  const res = runQueue(`Invoke-TrainCloseOut -Entries @([pscustomobject]@{number=7;sha='${SHA_A}'}) -Phase 'merged'`);
  assert.equal(res.status, 0, res.stdout);
  const args = res.data.calls[0];
  assert.equal(args[1], 'merged');
  assert.deepEqual(JSON.parse(args[args.indexOf('--train') + 1]), [{ number: 7, sha: SHA_A }]);
});

test('-DryRun preview passes --dry-run and carries no merge SHA', () => {
  const res = runQueue("$DryRun=$true; Invoke-TrainCloseOut -Entries @([pscustomobject]@{number=7;sha=$null})");
  assert.equal(res.status, 0, res.stdout);
  const args = res.data.calls[0];
  assert.ok(args.includes('--dry-run'));
  assert.deepEqual(JSON.parse(args[args.indexOf('--train') + 1]), [{ number: 7, sha: null }]);
  const mergePreview = queue.indexOf('    Write-Host "  [dry-run] ville merge nu');
  assert.ok(mergePreview >= 0, 'merge preview exists');
  const dryBranch = queue.slice(queue.lastIndexOf('  if ($DryRun) {', mergePreview), queue.indexOf('    continue\n  }\n\n  $failedRuns'));
  assert.match(dryBranch, /Invoke-TrainCloseOut -Entries @\(\[pscustomobject\]@\{ number = \$n; sha = \$null \}\)/, 'dry-run branch previews close-out without SHA');
});
