import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { betaDatabase2176 } from './__fixtures__/marketBeta2176Db.js';
import { incrementBalanceWithAudit } from './balanceRpc.js';

const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const NOW = '2026-11-11T08:00:00Z';
const END = '2026-11-11T09:00:00Z';
const YOUTH = id(210), AUCTION = id(710), HOLD = id(711);
const one = async (db, sql, args = []) => (await db.query(sql, args)).rows[0];

async function setup(t, team) {
  const db = await betaDatabase2176(t);
  await db.exec(`ALTER TABLE riders ADD COLUMN pending_academy_signing boolean DEFAULT false;
    CREATE TABLE races(id uuid PRIMARY KEY, race_type text, status text, stages_completed integer);
    CREATE TABLE race_entries(rider_id uuid, race_id uuid, team_id uuid);
    INSERT INTO riders(id, team_id, acquired_at) VALUES('${YOUTH}', NULL, '${NOW}');
    INSERT INTO auctions(id,rider_id,seller_team_id,current_bidder_id,current_price,requested_start,calculated_end,is_youth)
      VALUES('${AUCTION}','${YOUTH}',NULL,'${team}',600000,'${NOW}','${END}',true);
    INSERT INTO auctions(id,rider_id,seller_team_id,current_bidder_id,current_price,requested_start,calculated_end,
      origin,source_listing_id,buyer_duration_minutes)
      VALUES('${HOLD}','${id(101)}','${id(4)}','${team}',400000,'${NOW}','${END}','auto_accept','${id(701)}',60);`);
  const source = await readFile(new URL('../../database/2026-09-24-5432-squad-caps-rpc.sql', import.meta.url), 'utf8');
  for (const name of ['count_team_squad_members', 'finalize_academy_acquisition']) {
    const fn = source.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$;`));
    assert.ok(fn, `actual ${name} migration must be loaded`);
    await db.exec(fn[0]);
  }
  return db;
}

function payment(placement) {
  return {
    type: 'academy_signing', amount: -600000, description: 'synthetic auction settlement',
    actor_type: 'cron', source_path: `auctionFinalization.finalizeYouthAuctionRecord.${placement === 'senior' ? 'seniorFallback' : 'winner'}`,
    reason_code: 'auction_winner_payment', related_entity_type: 'auction', related_entity_id: AUCTION,
    idempotency_key: `youth_auction_winner:${AUCTION}`,
  };
}

function balanceClient(db) {
  return { async rpc(name, args) {
    assert.equal(name, 'increment_balance_with_audit');
    try {
      const row = await one(db, 'SELECT increment_balance_with_audit($1,$2,$3) AS balance',
        [args.p_team_id, args.p_delta, args.p_finance_payload]);
      return { data: row.balance, error: null };
    } catch (error) { return { data: null, error }; }
  } };
}

for (const placement of ['senior', 'academy']) {
  for (const [cohort, team] of [['beta', id(1)], ['public non-beta participant', id(2)]]) {
    test(`youth ${placement} settlement consumes its reservation for ${cohort}`, async t => {
      const db = await setup(t, team);
      assert.equal((await one(db, 'SELECT team_market_commitment($1,NULL)::int AS locked', [team])).locked, 1000000);
      if (placement === 'senior') {
        // Production senior placement commits ownership before the separate debit.
        await db.query('UPDATE riders SET team_id=$1,squad=\'senior\',is_academy=false,acquired_at=$2 WHERE id=$3', [team, NOW, YOUTH]);
        const client = balanceClient(db);
        const args = { teamId: team, delta: -600000, payload: payment(placement) };
        assert.equal((await incrementBalanceWithAudit(client, args, { allowDuplicate: true })).skipped, false);
        assert.equal((await incrementBalanceWithAudit(client, args, { allowDuplicate: true })).skipped, true);
      } else {
        const result = await one(db, `SELECT finalize_academy_acquisition($1,$2,600000,1000,2,4,$3,$4,'junior',10) AS result`,
          [team, YOUTH, NOW, payment(placement)]);
        assert.equal(result.result.ok, true);
        assert.equal((await one(db, 'SELECT squad FROM riders WHERE id=$1', [YOUTH])).squad, 'junior');
      }
      assert.equal((await one(db, 'SELECT team_id FROM riders WHERE id=$1', [YOUTH])).team_id, team);
      assert.equal((await one(db, 'SELECT balance::int AS balance FROM teams WHERE id=$1', [team])).balance, 400000);
      assert.equal((await one(db, 'SELECT count(*)::int AS count FROM finance_transactions')).count, 1);
      await db.query("UPDATE auctions SET status='completed',actual_end=$1 WHERE id=$2", [END, AUCTION]);
      assert.equal((await one(db, 'SELECT team_market_commitment($1,NULL)::int AS locked', [team])).locked, 400000);
    });
  }
}

test('a new academy intake still cannot spend an existing auction reservation', async t => {
  const team = id(1), db = await setup(t, team);
  const intake = { ...payment('academy'), reason_code: 'academy_signing', related_entity_type: null,
    related_entity_id: null, idempotency_key: 'synthetic-intake' };
  await assert.rejects(db.query(`SELECT finalize_academy_acquisition($1,$2,600000,1000,2,4,$3,$4,'junior',10)`,
    [team, YOUTH, NOW, intake]), /market_gate_6181:insufficient_available_balance/);
  assert.equal((await one(db, 'SELECT team_id FROM riders WHERE id=$1', [YOUTH])).team_id, null);
  assert.equal((await one(db, 'SELECT balance::int AS balance FROM teams WHERE id=$1', [team])).balance, 1000000);
  assert.equal((await one(db, 'SELECT count(*)::int AS count FROM finance_transactions')).count, 0);
});
