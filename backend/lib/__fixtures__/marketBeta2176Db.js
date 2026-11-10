import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { SCHEMA, ESCROW_SCHEMA } from './autoAccept2176Schema.js';
const file = name => readFile(new URL('../../../database/'+name, import.meta.url),'utf8');
const BETA='2026-11-10-2176-transfer-payment-beta-scope.sql';
const id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
const A=id(1),B=id(2),C=id(3),D=id(4);
export async function betaDatabase2176(t) {
  const db = new PGlite(); t.after(() => db.close());
  await prepareBetaDatabase2176(db);
  return db;
}
export async function prepareBetaDatabase2176(db) {
  await db.exec(SCHEMA + ESCROW_SCHEMA);
  await db.exec(`ALTER TABLE finance_transactions DROP CONSTRAINT finance_transactions_type_check;
    ALTER TABLE finance_transactions ADD CONSTRAINT finance_transactions_type_check CHECK
      (type IN ('transfer_in','transfer_out','prize','facility_purchase','scout_travel','staff_severance','academy_signing'));`);
  const balanceSource = (await file('2026-05-26-backend-message-codes.sql')).match(/CREATE OR REPLACE FUNCTION increment_balance_with_audit\([\s\S]*?\$\$ LANGUAGE plpgsql;/);
  assert.ok(balanceSource); await db.exec(balanceSource[0]);
  await db.exec(`CREATE TABLE users(id uuid PRIMARY KEY, role text, is_beta_tester boolean DEFAULT false);
    ALTER TABLE teams ADD COLUMN user_id uuid;
    GRANT SELECT ON users TO service_role;
    CREATE TABLE transfer_offers(id uuid PRIMARY KEY, rider_id uuid, seller_team_id uuid, buyer_team_id uuid,
      offer_amount bigint,counter_amount bigint,status text,buyer_confirmed boolean,seller_confirmed boolean);`);
  await db.exec('CREATE TABLE seasons(id uuid PRIMARY KEY); CREATE TABLE team_staff(id uuid PRIMARY KEY);');
  const scoutSchema = await file('2026-07-10-scout-assignments.sql');
  await db.exec(scoutSchema.slice(scoutSchema.indexOf('CREATE TABLE'), scoutSchema.indexOf('ALTER TABLE scout_assignments ENABLE')));
  await db.exec('GRANT SELECT,INSERT,UPDATE ON scout_assignments TO service_role;');
  const migrations=['2026-11-07-2176-m2-auto-accept.sql','2026-11-07-6181-m3-market-commitment.sql',
    '2026-11-07-6181-sale-escrow-m1.sql','2026-11-07-6181-sale-escrow-m2-guards.sql',
    '2026-11-09-2176-m3-auto-accept-claim-swap.sql','2026-11-09-2176-counter-auction-boundary.sql',
    '2026-11-10-2176-autopris-ved-listepris.sql','2026-11-10-2176-transfer-payment-atomic.sql'].sort();
  assert.deepEqual([...migrations,BETA].sort(),[...migrations,BETA], 'beta must apply after A7 in auto-migrate filename order');
  for (const name of migrations) await db.exec(await file(name));
  await db.exec(`INSERT INTO users VALUES('${A}','user',true),('${B}','user',false),('${C}','admin',false),('${D}','user',false);
    INSERT INTO teams(id,balance,user_id) VALUES('${A}',1000000,'${A}'),('${B}',1000000,'${B}'),('${C}',1000000,'${C}'),('${D}',1000000,'${D}');
    INSERT INTO riders(id,team_id) VALUES('${id(101)}','${D}');
    INSERT INTO transfer_listings(id,rider_id,seller_team_id,asking_price) VALUES('${id(701)}','${id(101)}','${D}',100000);
    UPDATE app_config SET value='"beta"' WHERE key IN ('auto_accept_enabled','market_commitment_6181');`);
  const migration = await file(BETA); await db.exec(migration); await db.exec(migration);
  return db;
}
