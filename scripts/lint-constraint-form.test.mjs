// scripts/lint-constraint-form.test.mjs
// Tests for constraint-form-vagten (#4163).
//
// Den vigtigste test i filen er "ville have fanget #4155": den kører vagten mod
// den ÆGTE migration der udløste prod-incidenten og bekræfter at den flages.
// En forward-guard der ikke beviseligt fanger hændelsen den blev født af, er
// en påstand — ikke en vagt.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  scanSource, definitionAfter, CRITICAL_CONSTRAINTS, REMEDIATED, defaultFiles,
} from './lint-constraint-form.mjs';

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)));
const db = (name) => readFileSync(resolve(REPO, 'database', name), 'utf8');

// --------------------------------------------------------------- form-drift

test('flager ADD CONSTRAINT uden DEFERRABLE', () => {
  const sql = `
    alter table public.race_entries
      add constraint no_rider_double_booking
      exclude using gist (rider_id with =, binding_span with &&)
      where (binding_span is not null);
  `;
  const found = scanSource(sql, 'fixture.sql');
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'form-drift');
  assert.match(found[0].message, /mangler DEFERRABLE/);
});

test('accepterer ADD CONSTRAINT MED deferrable initially immediate', () => {
  const sql = `
    alter table public.race_entries
      add constraint no_rider_double_booking
      exclude using gist (rider_id with =, binding_span with &&)
      where (binding_span is not null)
      deferrable initially immediate;
  `;
  assert.deepEqual(scanSource(sql, 'fixture.sql'), []);
});

test('SQL er case-insensitivt — DEFERRABLE i versaler taeller ogsaa', () => {
  const sql = `ALTER TABLE race_entries ADD CONSTRAINT no_rider_double_booking
               EXCLUDE USING gist (rider_id WITH =, binding_span WITH &&) DEFERRABLE;`;
  assert.deepEqual(scanSource(sql, 'fixture.sql'), []);
});

test('ser gennem en DO $$-blok (den idiomatiske idempotens-indpakning)', () => {
  const bad = `
    do $$
    begin
      if not exists (select 1 from pg_constraint where conname = 'no_rider_double_booking') then
        alter table public.race_entries
          add constraint no_rider_double_booking
          exclude using gist (rider_id with =, binding_span with &&);
      end if;
    end $$;
  `;
  assert.equal(scanSource(bad, 'fixture.sql').length, 1, 'manglende klausul inde i DO-blok skal flages');

  const good = bad.replace('binding_span with &&)', 'binding_span with &&) deferrable initially immediate');
  assert.deepEqual(scanSource(good, 'fixture.sql'), [], 'korrekt form inde i DO-blok skal bestaa');
});

// Den faelde en naiv "indeholder filen ordet deferrable?"-lint ville gaa i:
// et NABO-statement kan sagtens baere klausulen uden at DENNE constraint goer.
test('en deferrable paa en ANDEN constraint redder ikke den manglende klausul', () => {
  const sql = `
    alter table public.other add constraint other_fk foreign key (x) references y(id) deferrable initially deferred;
    alter table public.race_entries
      add constraint no_rider_double_booking
      exclude using gist (rider_id with =, binding_span with &&);
  `;
  const found = scanSource(sql, 'fixture.sql');
  assert.equal(found.length, 1, 'kun den registrerede constraint vurderes, og den mangler klausulen');
  assert.equal(found[0].constraint, 'no_rider_double_booking');
});

test('definitionAfter stopper ved statementets semikolon', () => {
  const stmt = 'add constraint foo exclude using gist (a with =);\nsomething deferrable else';
  assert.ok(!/deferrable/i.test(definitionAfter(stmt, 0)), 'tekst efter `;` hoerer ikke til definitionen');
});

// ------------------------------------------------------- dropped-not-restored

test('flager en fil der dropper constrainten uden at give den tilbage', () => {
  const sql = `
    alter table public.race_entries drop constraint if exists no_rider_double_booking;
    update public.race_stage_schedule set game_day = 0;
  `;
  const found = scanSource(sql, 'fixture.sql');
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'dropped-not-restored');
});

test('drop + korrekt re-add i samme fil bestaar', () => {
  const sql = `
    alter table public.race_entries drop constraint if exists no_rider_double_booking;
    update public.race_stage_schedule set game_day = 0;
    alter table public.race_entries
      add constraint no_rider_double_booking
      exclude using gist (rider_id with =, binding_span with &&)
      where (binding_span is not null)
      deferrable initially immediate;
  `;
  assert.deepEqual(scanSource(sql, 'fixture.sql'), []);
});

// --------------------------------------------------- mod de aegte migrationer

test('ville have fanget #4155: den aegte reparations-migration flages som form-drift', () => {
  const found = scanSource(db('2026-08-23-4155-s3-gameday-repair.sql'), '2026-08-23-4155-s3-gameday-repair.sql');
  const drift = found.filter((f) => f.kind === 'form-drift' && f.constraint === 'no_rider_double_booking');
  assert.equal(drift.length, 1, 'praecis den fejl der satte sweepen i doedvande 24/8');
  assert.match(drift[0].message, /mangler DEFERRABLE/);
});

test('#4163-reparationen selv bestaar vagten', () => {
  const name = '2026-08-24-4163-restore-deferrable-double-booking.sql';
  assert.deepEqual(scanSource(db(name), name), []);
});

test('#3934 (som SATTE formen) bestaar vagten', () => {
  const name = '2026-08-18-3934-sweep-batch-rpc-deferrable.sql';
  assert.deepEqual(scanSource(db(name), name), []);
});

// ------------------------------------------------------------------- registre

test('hele database/*.sql er rent naar repareret historik er sprunget over', () => {
  const findings = [];
  for (const file of defaultFiles()) {
    const name = file.split(/[\\/]/).pop();
    if (REMEDIATED[name]) continue;
    findings.push(...scanSource(readFileSync(file, 'utf8'), name));
  }
  assert.deepEqual(findings, [], `uventet form-drift: ${JSON.stringify(findings, null, 2)}`);
});

test('hver REMEDIATED-post navngiver den fil der reparerer den', () => {
  for (const [name, reason] of Object.entries(REMEDIATED)) {
    assert.match(reason, /\.sql/, `${name}: begrundelsen skal pege paa den reparerende migration`);
    assert.ok(reason.length > 60, `${name}: begrundelsen skal forklare hvad der gik galt`);
  }
});

test('hver bevogtet constraint forklarer hvad formen garanterer', () => {
  for (const [name, spec] of Object.entries(CRITICAL_CONSTRAINTS)) {
    assert.ok(spec.why && spec.why.length > 80, `${name}: mangler en brugbar 'why'`);
    assert.ok(spec.require.length > 0, `${name}: ingen paakraevede klausuler`);
    for (const c of spec.require) {
      assert.equal(typeof c.test, 'function');
      assert.ok(c.fix, `${name}/${c.name}: mangler et konkret fix`);
    }
  }
});

// -------------------------------------------------------- supersededBy (#4173)

test('drop uden retur er lovligt naar SAMME fil tilfoejer den registrerede afloeser', () => {
  const sql = `
    alter table public.race_entry_days
      add constraint no_rider_double_booking_day
      unique (rider_id, season_id, game_day)
      deferrable initially immediate;
    alter table public.race_entries drop constraint if exists no_rider_double_booking;
  `;
  assert.deepEqual(scanSource(sql, 'flyt.sql'), []);
});

test('drop uden retur OG uden afloeser i filen er stadig et fund', () => {
  const sql = `alter table public.race_entries drop constraint if exists no_rider_double_booking;`;
  const findings = scanSource(sql, 'nedtag.sql');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'dropped-not-restored');
});

test('afloeseren form-tjekkes selv: uden DEFERRABLE er den form-drift', () => {
  const sql = `
    alter table public.race_entry_days
      add constraint no_rider_double_booking_day
      unique (rider_id, season_id, game_day);
    alter table public.race_entries drop constraint if exists no_rider_double_booking;
  `;
  const findings = scanSource(sql, 'flyt-uden-form.sql');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'form-drift');
  assert.equal(findings[0].constraint, 'no_rider_double_booking_day');
});
