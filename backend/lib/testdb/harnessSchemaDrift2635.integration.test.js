import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, HARNESS_SCHEMA_DRIFT_2635 } from './createTestDb.js';
import { HARNESS_DRIFT_COLUMNS, HARNESS_DRIFT_CONSTRAINTS, HARNESS_DRIFT_INDEXES, HARNESS_DEPENDENCY_COLUMNS } from './harnessSchemaDrift2635.mjs';

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
    for (const expected of HARNESS_DEPENDENCY_COLUMNS) {
      const { rows } = await db.query(`SELECT table_name,column_name,data_type,udt_name,is_nullable,column_default,
        numeric_precision,numeric_scale,character_maximum_length FROM information_schema.columns
        WHERE table_schema='public' AND table_name=$1 AND column_name=$2`, [expected.table_name,expected.column_name]);
      assert.deepEqual(rows[0], expected, `${expected.table_name}.${expected.column_name}`);
    }
    for (const expected of HARNESS_DRIFT_CONSTRAINTS) {
      const { rows } = await db.query(`SELECT r.relname AS table_name,c.conname,c.contype,pg_get_constraintdef(c.oid) AS definition
        FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
        WHERE n.nspname='public' AND r.relname=$1 AND c.conname=$2`, [expected.table_name,expected.conname]);
      assert.deepEqual(rows[0], expected, expected.conname);
    }
    await assert.rejects(db.query('SELECT full_name FROM riders'), { code: '42703' });
    for (const expected of HARNESS_DRIFT_INDEXES) {
      const { rows } = await db.query(`SELECT tablename,indexname,indexdef FROM pg_indexes
        WHERE schemaname='public' AND tablename=$1 AND indexname=$2`, [expected.tablename,expected.indexname]);
      assert.deepEqual(rows[0], expected, expected.indexname);
    }
    // No second load may silently resurrect retired schema or duplicate constraints.
    await db.exec(HARNESS_SCHEMA_DRIFT_2635.sql);
    await db.exec(HARNESS_SCHEMA_DRIFT_2635.sql);
    const { rows: after } = await db.query("SELECT to_regclass('public.loan_agreements') AS legacy");
    assert.equal(after[0].legacy, null);
  } finally { await db.close(); }
});

test('#2635 synthetic writes enforce defaults, types, enum checks and unique audit keys', async () => {
  const db = await createTestDb();
  try {
    const { rows: users } = await db.query(`INSERT INTO users (email,username,created_at)
      VALUES ('synthetic-contact','synthetic-manager','2026-01-01T00:00:00Z')
      RETURNING id,language,discord_dm_prefs,discord_dm_enabled,is_beta_tester`);
    const user = users[0];
    assert.deepEqual({ ...user, id: undefined }, { id: undefined, language: 'en', discord_dm_prefs: {}, discord_dm_enabled: true, is_beta_tester: false });
    await assert.rejects(db.query("UPDATE users SET language='invalid' WHERE id=$1", [user.id]), { code: '23514' });
    await assert.rejects(db.query('UPDATE users SET discord_dm_enabled=NULL WHERE id=$1', [user.id]), { code: '23502' });
    await assert.rejects(db.query("UPDATE users SET consent_preferences='invalid-json' WHERE id=$1", [user.id]), { code: '22P02' });
    const { rows: teams } = await db.query(`INSERT INTO teams (name,created_at)
      VALUES ('Hold A','2026-01-01T00:00:00Z') RETURNING id,is_test_account,transfer_frozen`);
    const team = teams[0];
    assert.equal(team.is_test_account, false);
    assert.equal(team.transfer_frozen, false);
    const { rows: tx } = await db.query(`INSERT INTO finance_transactions
      (team_id,type,amount,actor_type,metadata,idempotency_key,created_at)
      VALUES ($1,'prize',0,'system','{"synthetic":true}','synthetic-key','2026-01-01T00:00:00Z') RETURNING id,metadata`, [team.id]);
    assert.deepEqual(tx[0].metadata, { synthetic: true });
    await assert.rejects(db.query("UPDATE finance_transactions SET actor_type='invalid' WHERE id=$1", [tx[0].id]), { code: '23514' });
    await assert.rejects(db.query("UPDATE finance_transactions SET related_entity_type='invalid' WHERE id=$1", [tx[0].id]), { code: '23514' });
    await assert.rejects(db.query("UPDATE finance_transactions SET actor_id='invalid-uuid' WHERE id=$1", [tx[0].id]), { code: '22P02' });
    await assert.rejects(db.query(`INSERT INTO finance_transactions (team_id,type,amount,idempotency_key,created_at)
      VALUES ($1,'prize',0,'synthetic-key','2026-01-01T00:00:00Z')`, [team.id]), { code: '23505' });
    // A partial unique index must still permit multiple NULL keys.
    await db.query(`INSERT INTO finance_transactions (team_id,type,amount,created_at)
      VALUES ($1,'prize',0,'2026-01-01T00:00:00Z'),($1,'prize',0,'2026-01-01T00:00:00Z')`, [team.id]);
  } finally { await db.close(); }
});

test('#2635 rider season FK rejects an orphan and clears on deletion', async () => {
  const db = await createTestDb();
  try {
    const { rows: seasons } = await db.query(`INSERT INTO seasons (number,created_at)
      VALUES (1,'2026-01-01T00:00:00Z') RETURNING id`);
    const season = seasons[0];
    const { rows: riders } = await db.query(`INSERT INTO riders
      (firstname,lastname,peak_suggestions_dismissed_season_id,acquired_at,created_at)
      VALUES ('Synthetic','Rider',$1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z') RETURNING id,owner_is_ai`, [season.id]);
    assert.equal(riders[0].owner_is_ai, false);
    await assert.rejects(db.query(`UPDATE riders SET peak_suggestions_dismissed_season_id=gen_random_uuid() WHERE id=$1`, [riders[0].id]), { code: '23503' });
    await db.query('DELETE FROM seasons WHERE id=$1', [season.id]);
    const { rows } = await db.query('SELECT peak_suggestions_dismissed_season_id FROM riders WHERE id=$1', [riders[0].id]);
    assert.equal(rows[0].peak_suggestions_dismissed_season_id, null);
  } finally { await db.close(); }
});

test('#2635 dependency FKs, checks and partial uniqueness reject invalid synthetic writes', async () => {
  const db = await createTestDb();
  try {
    const stamp = '2026-01-01T00:00:00Z';
    const team = (await db.query('INSERT INTO teams(name,created_at) VALUES ($1,$2) RETURNING id', ['Synthetic dependency',stamp])).rows[0].id;
    const season = (await db.query('INSERT INTO seasons(number,created_at) VALUES (1,$1) RETURNING id',[stamp])).rows[0].id;
    await assert.rejects(db.query("UPDATE teams SET team_dna_key='orphan' WHERE id=$1",[team]), {code:'23503'});
    await db.query(`INSERT INTO team_dna(key,label,emoji,short_description,long_description,policy_axes,created_at)
      VALUES ('synthetic','synthetic','synthetic','synthetic','synthetic','{}',$1)`,[stamp]);
    const dna = (await db.query("SELECT national_affinity,specialization_affinity,member_alignment_bonus,goal_weighting FROM team_dna WHERE key='synthetic'")).rows[0];
    assert.deepEqual(dna,{national_affinity:[],specialization_affinity:[],member_alignment_bonus:{},goal_weighting:{}});
    await db.query("UPDATE teams SET team_dna_key='synthetic' WHERE id=$1",[team]);
    await db.query("DELETE FROM team_dna WHERE key='synthetic'");
    assert.equal((await db.query('SELECT team_dna_key FROM teams WHERE id=$1',[team])).rows[0].team_dna_key,null);
    const loanSql = `INSERT INTO loans(team_id,loan_type,principal,origination_fee,interest_rate,seasons_total,seasons_remaining,amount_remaining,season_id,created_at,updated_at)
      VALUES ($1,$2,0,0,0,1,1,0,$3,$4,$4) RETURNING id,status,accrued_interest`;
    const loan = (await db.query(loanSql,[team,'emergency',season,stamp])).rows[0];
    assert.equal(loan.status,'active'); assert.equal(loan.accrued_interest,0);
    await assert.rejects(db.query(loanSql,[team,'emergency',season,stamp]),{code:'23505'});
    await db.query(loanSql,[team,'emergency',null,stamp]);
    await db.query(loanSql,[team,'emergency',null,stamp]);
    await db.query(loanSql,[team,'short',season,stamp]);
    await db.query(loanSql,[team,'short',season,stamp]);
    for (const [sql,code] of [
      ["UPDATE loans SET loan_type='invalid' WHERE id=$1",'23514'],
      ["UPDATE loans SET status='invalid' WHERE id=$1",'23514'],
      ['UPDATE loans SET team_id=gen_random_uuid() WHERE id=$1','23503'],
      ['UPDATE loans SET season_id=gen_random_uuid() WHERE id=$1','23503'],
      ['UPDATE loans SET last_interest_season_id=gen_random_uuid() WHERE id=$1','23503'],
      ['UPDATE loans SET principal=NULL WHERE id=$1','23502'],
      ['UPDATE loans SET interest_rate=10 WHERE id=$1','22003']
    ]) await assert.rejects(db.query(sql,[loan.id]),{code});
    const txSql = `INSERT INTO finance_transactions(team_id,type,amount,related_loan_id,season_id,created_at) VALUES ($1,$2,0,$3,$4,$5)`;
    await assert.rejects(db.query(txSql,[team,'loan_interest','00000000-0000-0000-0000-000000000001',season,stamp]),{code:'23503'});
    await db.query(txSql,[team,'loan_interest',loan.id,season,stamp]);
    await assert.rejects(db.query(txSql,[team,'loan_interest',loan.id,season,stamp]),{code:'23505'});
    for (let i=0;i<2;i++) {
      await db.query(txSql,[team,'loan_interest',null,season,stamp]);
      await db.query(txSql,[team,'loan_interest',loan.id,null,stamp]);
      await db.query(txSql,[team,'prize',loan.id,season,stamp]);
    }
    await assert.rejects(db.query('DELETE FROM loans WHERE id=$1',[loan.id]),{code:'23503'});
    await assert.rejects(db.query('DELETE FROM teams WHERE id=$1',[team]),{code:'23503'});
    await assert.rejects(db.query('DELETE FROM seasons WHERE id=$1',[season]),{code:'23503'});
  } finally { await db.close(); }
});
