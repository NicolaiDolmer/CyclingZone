// #5635 — rene funktions-tests for forum-identifikation i sweep-daily.mjs.
// Ingen Discord-kald: alt input er hardcodede kanal-lister (som
// `GET /guilds/{id}/channels` ville returnere), aldrig et rigtigt fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXPECTED_FORUMS, resolveForums, readPinnedForumIds, categoryNameMap } from './sweep-daily.mjs';

const CATEGORY = 4;
const FORUM = 15;
const TEXT = 0;

function cat(id, name) { return { id, name, type: CATEGORY }; }
function forum(id, name, parent_id) { return { id, name, type: FORUM, parent_id }; }

test('resolveForums: happy path — 3 forums i hver sin kategori matches korrekt', () => {
  const channels = [
    cat('c-main', 'community'),
    cat('c-beta', 'beta-testing'),
    forum('f1', 'feedback-and-ideas', 'c-main'),
    forum('f2', 'bugs', 'c-main'),
    forum('f3', 'feedback-and-bugs', 'c-beta'),
  ];
  const { resolved, missing } = resolveForums(channels);
  assert.equal(missing.length, 0);
  assert.deepEqual(
    resolved.map((r) => [r.key, r.id]).sort(),
    [['bugs', 'f2'], ['feedback-and-ideas', 'f1'], ['beta', 'f3']].sort(),
  );
});

test('resolveForums: #5635-regressionen — beta-forum hedder "bugs" og skygger IKKE det rigtige #bugs', () => {
  // Nøjagtig scenariet fra issuet 21-24/9: beta-forummet i beta-testing-kategorien
  // hed midlertidigt "bugs", samme navn som det rigtige #bugs i en anden kategori.
  const channels = [
    cat('c-main', 'community'),
    cat('c-beta', 'beta-testing'),
    forum('f-real-bugs', 'bugs', 'c-main'),
    forum('f-beta-shadow', 'bugs', 'c-beta'),
    forum('f-ideas', 'feedback-and-ideas', 'c-main'),
  ];
  const { resolved, missing } = resolveForums(channels);
  assert.equal(missing.length, 0);
  const byKey = Object.fromEntries(resolved.map((r) => [r.key, r]));
  assert.equal(byKey.bugs.id, 'f-real-bugs');
  assert.equal(byKey.beta.id, 'f-beta-shadow');
  assert.equal(byKey['feedback-and-ideas'].id, 'f-ideas');
});

test('resolveForums: beta-forum matches paa kategori uanset navn (navnet har allerede skiftet 2x)', () => {
  const channels = [
    cat('c-beta', 'beta-testing'),
    forum('f-beta', 'noget-helt-andet-navn', 'c-beta'),
  ];
  const { resolved, missing } = resolveForums(channels);
  const beta = resolved.find((r) => r.key === 'beta');
  assert.ok(beta, 'beta-forum skal findes via kategori, ikke navn');
  assert.equal(beta.id, 'f-beta');
  assert.equal(missing.filter((m) => m.key !== 'bugs' && m.key !== 'feedback-and-ideas').length, 0);
});

test('resolveForums: manglende forventet kanal advarer i stedet for at forsvinde tavst', () => {
  const channels = [
    cat('c-main', 'community'),
    forum('f-ideas', 'feedback-and-ideas', 'c-main'),
    // #bugs og beta-forummet findes ikke i denne kanal-liste.
  ];
  const { resolved, missing } = resolveForums(channels);
  assert.equal(resolved.length, 1);
  assert.equal(missing.length, 2);
  const keys = missing.map((m) => m.key).sort();
  assert.deepEqual(keys, ['beta', 'bugs']);
  for (const m of missing) assert.match(m.reason, /ingen forum-kanal matcher/);
});

test('resolveForums: tvetydigt navne-match (2 kandidater udenfor beta) markeres MISSING, aldrig et gaet', () => {
  const channels = [
    cat('c-main', 'community'),
    cat('c-archive', 'archive'),
    forum('f1', 'bugs', 'c-main'),
    forum('f2', 'bugs', 'c-archive'),
  ];
  const { resolved, missing } = resolveForums(channels);
  assert.ok(!resolved.some((r) => r.key === 'bugs'));
  const bugsMissing = missing.find((m) => m.key === 'bugs');
  assert.ok(bugsMissing);
  assert.match(bugsMissing.reason, /2 forum-kanaler matcher/);
  assert.match(bugsMissing.reason, /tvetydigt/);
});

test('resolveForums: manglende kanal (type != 4/15 eller helt fravaerende) tælles ikke med som kandidat', () => {
  const channels = [
    cat('c-main', 'community'),
    { id: 'text-1', name: 'bugs', type: TEXT, parent_id: 'c-main' }, // tekst-kanal, ikke forum
  ];
  const { missing } = resolveForums(channels);
  assert.equal(missing.find((m) => m.key === 'bugs').reason, 'ingen forum-kanal matcher');
});

test('resolveForums: pinnet id (DISCORD_FORUM_IDS) vinder over navn/kategori-match', () => {
  const channels = [
    cat('c-main', 'community'),
    forum('f-old-name', 'renamed-away-from-bugs', 'c-main'),
  ];
  const pinned = { bugs: 'f-old-name' };
  const { resolved, missing } = resolveForums(channels, EXPECTED_FORUMS, pinned);
  const bugs = resolved.find((r) => r.key === 'bugs');
  assert.ok(bugs, 'pinnet id skal resolve selvom navnet ikke matcher');
  assert.equal(bugs.id, 'f-old-name');
  assert.ok(!missing.some((m) => m.key === 'bugs'));
});

test('resolveForums: pinnet id der ikke findes i guilden markeres MISSING med aarsag', () => {
  const channels = [cat('c-main', 'community')];
  const pinned = { bugs: 'does-not-exist' };
  const { resolved, missing } = resolveForums(channels, EXPECTED_FORUMS, pinned);
  assert.ok(!resolved.some((r) => r.key === 'bugs'));
  const bugsMissing = missing.find((m) => m.key === 'bugs');
  assert.match(bugsMissing.reason, /does-not-exist/);
  assert.match(bugsMissing.reason, /findes ikke i guilden/);
});

test('categoryNameMap: udtraekker kun type-4 (kategori) kanaler', () => {
  const channels = [
    cat('c1', 'community'),
    forum('f1', 'bugs', 'c1'),
    { id: 't1', name: 'general', type: TEXT },
  ];
  const map = categoryNameMap(channels);
  assert.equal(map.size, 1);
  assert.equal(map.get('c1'), 'community');
});

test('readPinnedForumIds: gyldig JSON parses, mangler env giver {}, ugyldig JSON giver {} uden at kaste', () => {
  assert.deepEqual(readPinnedForumIds({}), {});
  assert.deepEqual(readPinnedForumIds({ DISCORD_FORUM_IDS: '{"bugs":"123"}' }), { bugs: '123' });
  assert.deepEqual(readPinnedForumIds({ DISCORD_FORUM_IDS: 'not json' }), {});
  assert.deepEqual(readPinnedForumIds({ DISCORD_FORUM_IDS: '[1,2,3]' }), {});
});

test('EXPECTED_FORUMS: praecis de 3 forventede kilder, beta-forummet er en fast sweep-kilde', () => {
  const keys = EXPECTED_FORUMS.map((f) => f.key).sort();
  assert.deepEqual(keys, ['beta', 'bugs', 'feedback-and-ideas']);
});
