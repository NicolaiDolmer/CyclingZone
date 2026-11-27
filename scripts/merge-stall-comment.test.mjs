import test from 'node:test';
import assert from 'node:assert/strict';
import { commentPostOutcome, dueStallComments, stallCommentBody, shouldPostStallComment } from './merge-stall-comment.mjs';

const HEAD = 'a'.repeat(40);
const OWNER = 'NicolaiDolmer';
const at = new Date('2026-11-26T08:00:00Z');
const evaluation = { number: 21, headSha: HEAD, ownerMarkerSha: HEAD, eligible: false, reason: 'checks: roed: frontend-build' };
const first = { 21: { headSha: HEAD, since: at.toISOString() } };

test('notices require the owner marker and more than 30 continuously stalled minutes at the same head', () => {
  const options = { seen: first, now: new Date('2026-11-26T08:30:00Z') };
  assert.deepEqual(dueStallComments([evaluation], options).notices, []);
  options.now = new Date('2026-11-26T08:30:01Z');
  assert.equal(dueStallComments([evaluation], options).notices.length, 1);
  assert.deepEqual(dueStallComments([{ ...evaluation, ownerMarkerSha: null }], options).notices, []);
  assert.deepEqual(dueStallComments([{ ...evaluation, headSha: 'b'.repeat(40) }], options).notices, []);
  assert.deepEqual(dueStallComments([{ ...evaluation, eligible: true }], options).notices, []);
});

test('red checks, review, wave block and unknown classification give an actionable reason', () => {
  const now = new Date('2026-11-26T08:45:00Z');
  const scenarios = [
    [{ reason: 'checks: roed: frontend-build' }, /røde checks.*Ret/s],
    [{ reason: 'review-gate roed' }, /review.*HEAD.*Bestil/s],
    [{ eligible: true, waveBlocked: true }, /bølgelås.*Vent/s],
    [{ reason: 'kunne ikke klassificeres (ejer-go)' }, /klassificering.*Kontrollér/s],
  ];
  for (const [override, expected] of scenarios) {
    const { notices } = dueStallComments([{ ...evaluation, ...override }], { seen: first, now });
    assert.match(stallCommentBody(notices[0]), expected);
  }
});

test('publication rechecks open head and a valid owner marker, and skips a receipt on that head', () => {
  const notice = { number: 21, headSha: HEAD };
  const marker = { author: { login: OWNER }, body: '<!-- merge-autotrain: ejer-merge sha=' + HEAD + ' -->' };
  const pr = { state: 'OPEN', headRefOid: HEAD, comments: [marker] };
  assert.equal(shouldPostStallComment(pr, notice, OWNER), true);
  assert.equal(shouldPostStallComment({ ...pr, state: 'MERGED' }, notice, OWNER), false);
  assert.equal(shouldPostStallComment({ ...pr, headRefOid: 'b'.repeat(40) }, notice, OWNER), false);
  assert.equal(shouldPostStallComment({ ...pr, comments: [] }, notice, OWNER), false);
  pr.comments.push({ author: { login: OWNER }, body: '<!-- merge-stall-v1 head=' + HEAD + ' -->' });
  assert.equal(shouldPostStallComment(pr, notice, OWNER), false);
});

test('only a definite rejected POST can release a head reservation for retry', () => {
  assert.equal(commentPostOutcome('HTTP/2.0 201 Created\r\n'), 'created');
  assert.equal(commentPostOutcome('HTTP/2.0 429 Too Many Requests\r\n'), 'rejected');
  assert.equal(commentPostOutcome('HTTP/2.0 502 Bad Gateway\r\n'), 'uncertain');
  assert.equal(commentPostOutcome(''), 'uncertain');
});
