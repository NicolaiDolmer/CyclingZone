import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readJson = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const senior = readJson('./__fixtures__/racePoolCatalog.prod.json').catalog;
const fixtureUrl = './__fixtures__/racePoolCatalog.youth.json';
const normalize = value => value.normalize('NFKC').trim().toLocaleLowerCase('en');

test('youth catalogue supplies the agreed reserves and only youth squads', () => {
  const { catalog, pools } = readJson(fixtureUrl);
  assert.ok(Array.isArray(pools));
  assert.ok(catalog.every(row => ['u23', 'junior'].includes(row.squad)));
  for (const [squad, min, max] of [['u23', 30, 40], ['junior', 15, 20]]) {
    const rows = catalog.filter(row => row.squad === squad);
    assert.ok(rows.length >= min && rows.length <= max, `${squad}: ${rows.length}`);
  }
});

test('names and identities are unique, including against the senior catalogue', () => {
  const { catalog } = readJson(fixtureUrl);
  for (const key of ['id', 'external_id', 'name']) {
    const values = catalog.map(row => normalize(row[key]));
    assert.equal(new Set(values).size, values.length, key);
    const existing = new Set(senior.map(row => normalize(row[key])));
    assert.ok(values.every(value => !existing.has(value)), `senior collision: ${key}`);
  }
  for (const row of catalog) {
    assert.ok(row.external_id.startsWith(row.squad === 'u23' ? 'u23-' : 'jun-'));
    assert.match(row.id, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  }
});

test('classes, existing terrain, stages and calendar dates respect youth formats', () => {
  const terrains = new Set(senior.map(row => row.terrain_archetype));
  for (const row of readJson(fixtureUrl).catalog) {
    const classes = row.squad === 'u23' ? ['Class1', 'Class2', 'ProSeries'] : ['Class1', 'Class2'];
    assert.ok(classes.includes(row.race_class), row.external_id);
    assert.ok(terrains.has(row.terrain_archetype), row.external_id);
    assert.ok(Number.isInteger(row.stages) && row.stages > 0, row.external_id);
    if (row.squad === 'junior') assert.ok(row.stages <= 5, row.external_id);
    assert.equal(row.race_type, row.stages === 1 ? 'single' : 'stage_race');
    assert.match(row.country, /^[A-Z]{3}$/);
    assert.equal(row.retired_at, null);
    assert.match(row.date_text, /^\d{1,2}\/\d{1,2}( - \d{1,2}\/\d{1,2})?$/);
    const dates = row.date_text.split(' - ').map(text => {
      const [day, month] = text.split('/').map(Number);
      // Fixed reference year; never read the wall clock.
      const date = new Date(Date.UTC(2026, month - 1, day));
      assert.equal(date.getUTCMonth(), month - 1, row.external_id);
      assert.equal(date.getUTCDate(), day, row.external_id);
      assert.ok(month >= 3 && month <= 9, row.external_id);
      return date.getTime();
    });
    assert.equal(dates.length, row.stages === 1 ? 1 : 2, row.external_id);
    if (dates.length === 2) assert.equal((dates[1] - dates[0]) / 86400000 + 1, row.stages, row.external_id);
  }
});

test('SQL seed and fixture contain exactly the same rows', () => {
  const sql = readFileSync(new URL('../../database/2026-09-15-4620-race-pool-squad-and-youth-catalog.sql', import.meta.url), 'utf8');
  const insert = sql.match(/INSERT INTO public\.race_pool\s*\(([^)]+)\)\s*VALUES([\s\S]+?)ON CONFLICT\s*\(external_id\)\s*DO NOTHING;/i);
  assert.ok(insert, 'idempotent race_pool seed');
  const columns = insert[1].split(',').map(value => value.trim());
  const rows = [...insert[2].matchAll(/\(([^()]*)\)/g)].map(match => {
    const values = [...match[1].matchAll(/'(?:''|[^'])*'|\bNULL\b|\b\d+\b/g)].map(([value]) =>
      value === 'NULL' ? null : value.startsWith("'") ? value.slice(1, -1).replaceAll("''", "'") : Number(value));
    assert.equal(values.length, columns.length);
    return Object.fromEntries(columns.map((column, index) => [column, values[index]]));
  });
  assert.deepEqual(rows, readJson(fixtureUrl).catalog);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS squad TEXT NOT NULL DEFAULT 'senior'/i);
  assert.match(sql, /CHECK\s*\(squad IN\s*\('senior', 'u23', 'junior'\)\)/i);
  assert.match(sql, /NOTIFY pgrst, 'reload schema'/i);
});
