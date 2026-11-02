import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './createTestDb.js';
import { HARNESS_DRIFT_COLUMNS, HARNESS_DRIFT_CONSTRAINTS } from './harnessSchemaDrift2635.mjs';

test('bounded #2635 catalog matches real types, defaults, nullability and constraints', async () => {
  const db = await createTestDb();
  try {
    const { rows: legacy } = await db.query("SELECT to_regclass('public.loan_agreements') AS legacy");
    assert.equal(legacy[0].legacy, null, 'retired table must not provide false-positive contracts');
    for (const expected of HARNESS_DRIFT_COLUMNS) {
      const { rows } = await db.query(`SELECT table_name,column_name,data_type,is_nullable,column_default
        FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
      [expected.table_name, expected.column_name]);
      assert.deepEqual(rows[0], expected, `${expected.table_name}.${expected.column_name}`);
    }
    for (const expected of HARNESS_DRIFT_CONSTRAINTS) {
      const { rows } = await db.query(`SELECT r.relname AS table_name,c.conname,c.contype,pg_get_constraintdef(c.oid) AS definition
        FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
        WHERE n.nspname='public' AND r.relname=$1 AND c.conname=$2`, [expected.table_name,expected.conname]);
      assert.deepEqual(rows[0], expected, expected.conname);
    }
    await assert.rejects(db.query('SELECT full_name FROM riders'), { code: '42703' });
  } finally { await db.close(); }
});
