// scripts/summarize-invariant-report.test.mjs
// Tests for invariant-rapportens parser (#4463).
//
// Den vigtigste test i filen er "ville have fanget 30/8-hændelsen": den koerer
// parseren mod PRAECIS det input nat-vagten fik (en tom invariants.json efter at
// verify-invariants doede paa en RPC-timeout) og bekraefter at den afviser i
// stedet for at melde nul brud. En forward-guard der ikke beviseligt fanger
// haendelsen den blev foedt af, er en paastand — ikke en vagt.

import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, MeasurementError, CALENDAR_PREFIX } from './summarize-invariant-report.mjs';

const ok = (detail = 'OK') => ({ ok: true, detail });
const fejl = (detail, violations = []) => ({ ok: false, detail, violations });

// ------------------------------------------------------ "intet maalt" afvises

test('ville have fanget 30/8: TOM invariants.json er en maalefejl, ikke nul brud', () => {
  assert.throws(() => summarize(''), MeasurementError);
  assert.throws(() => summarize('   \n  '), MeasurementError);
});

test('afkortet JSON (scriptet doede midt i skrivningen) er en maalefejl', () => {
  assert.throws(
    () => summarize('{"generatedAt":"2026-08-30T09:28:00Z","checks":{'),
    (err) => err instanceof MeasurementError && /ikke gyldig JSON/.test(err.message)
  );
});

test('gyldig JSON UDEN checks-objekt er en maalefejl', () => {
  assert.throws(() => summarize('{"generatedAt":"2026-08-30T09:28:00Z"}'), MeasurementError);
  assert.throws(() => summarize('{"checks":[]}'), MeasurementError);
  assert.throws(() => summarize('{"checks":null}'), MeasurementError);
});

test('checks med NUL invarianter er en maalefejl', () => {
  assert.throws(
    () => summarize('{"checks":{}}'),
    (err) => err instanceof MeasurementError && /NUL invarianter/.test(err.message)
  );
});

// ------------------------------------------------------------ normal maaling

test('alt groent giver nul brud og naevner hvor mange der blev maalt', () => {
  const r = summarize(JSON.stringify({
    checks: { calendar_overlap_within_tier_cap: ok('OK — 8 puljer'), no_double_active_auctions: ok() },
  }));
  assert.equal(r.kalenderBrud, 0);
  assert.equal(r.oevrigeBrud, 0);
  assert.equal(r.checked, 2);
  assert.match(r.report, /2 invariant\(er\) maalt/);
  assert.match(r.report, /\[ok\] {3}calendar_overlap_within_tier_cap/);
});

test('kalender-brud og oevrige brud taelles hver for sig', () => {
  const r = summarize(JSON.stringify({
    checks: {
      calendar_overlap_within_tier_cap: fejl('3 in-game-dage over cap', [{ game_day: 5, races: 4 }]),
      calendar_game_day_axis_not_collapsed: ok(),
      no_duplicate_race_results: fejl('2 dubletter'),
    },
  }));
  assert.equal(r.kalenderBrud, 1);
  assert.equal(r.oevrigeBrud, 1);
  assert.match(r.report, /\[FEJL\] calendar_overlap_within_tier_cap/);
  // Kun kalender-brud faar deres raekker udskrevet — det er dem gaten blokerer paa.
  assert.match(r.report, /"game_day":5/);
});

test('gaten kender kalender-invarianterne paa praefikset', () => {
  assert.equal(CALENDAR_PREFIX, 'calendar_');
  const r = summarize(JSON.stringify({ checks: { calendar_x: fejl('x'), andet_calendar_y: fejl('y') } }));
  assert.equal(r.kalenderBrud, 1, 'praefikset skal matche i STARTEN af navnet, ikke hvor som helst');
  assert.equal(r.oevrigeBrud, 1);
});

test('en invariant uden detail vaelter ikke rapporten', () => {
  const r = summarize(JSON.stringify({ checks: { calendar_x: { ok: false } } }));
  assert.equal(r.kalenderBrud, 1);
  assert.match(r.report, /\[FEJL\] calendar_x/);
});
