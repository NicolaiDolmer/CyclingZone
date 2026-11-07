// #6181 + #2176 pengelaas M1: sale_escrows og RPC'erne hold_sale_escrow /
// settle_sale_escrow mod en rigtig Postgres (PGlite). Ingen kode kalder dem endnu;
// testen laaser kontrakten fast, foer PR 3 saetter kalderne paa.
//
// Bruger den RIGTIGE migration og den RIGTIGE increment_balance_with_audit fra
// database/. Hold og ryttere er aliaser (Hold A/B), ingen prod-data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const file = name => readFile(new URL(`../../database/${name}`, import.meta.url), 'utf8');
const MIGRATION = '2026-11-07-6181-sale-escrow-m1.sql';
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const TEAM = { A: id(1), B: id(2), C: id(3) };
const RIDER = { r1: id(11), r2: id(12), r3: id(13) };
const DEAL = { t1: id(101), t2: id(102), a1: id(201), s1: id(301) };
const START = 1_000_000;

// Minimalt udsnit af prod-skemaet: de kolonner og checks RPC'erne roerer.
const SCHEMA = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE teams (id uuid PRIMARY KEY, balance bigint NOT NULL);
CREATE TABLE riders (id uuid PRIMARY KEY, team_id uuid, pending_team_id uuid, acquired_at timestamptz);
CREATE TABLE finance_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id),
  type text NOT NULL CHECK (type IN ('transfer_in', 'transfer_out', 'prize')),
  amount bigint NOT NULL, description text, season_id uuid, race_id uuid, related_loan_id uuid,
  actor_type text, actor_id uuid, source_path text, reason_code text,
  before_balance bigint, after_balance bigint,
  related_entity_type text CHECK (related_entity_type IS NULL OR related_entity_type IN
    ('auction','loan','transfer','swap','race','season','manual')),
  related_entity_id uuid, idempotency_key text, metadata jsonb,
  created_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX uniq_finance_idempotency_key ON finance_transactions(idempotency_key) WHERE idempotency_key IS NOT NULL;
GRANT SELECT, INSERT, UPDATE ON teams, riders, finance_transactions TO service_role;
`;

// Den rigtige balance-RPC, klippet ud af sin migration (filen roerer ogsaa andre tabeller).
async function balanceRpc() {
  const source = await file('2026-05-26-backend-message-codes.sql');
  const match = source.match(/CREATE OR REPLACE FUNCTION increment_balance_with_audit\([\s\S]*?\$\$ LANGUAGE plpgsql;/);
  assert.ok(match, 'increment_balance_with_audit not found in its migration');
  return `${match[0]}\nGRANT EXECUTE ON FUNCTION increment_balance_with_audit(UUID, BIGINT, JSONB) TO service_role;`;
}

async function database() {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(await balanceRpc());
  const migration = await file(MIGRATION);
  await db.exec(migration);
  await db.exec(migration); // idempotent
  await db.exec(`INSERT INTO teams VALUES ('${TEAM.A}', ${START}), ('${TEAM.B}', ${START}), ('${TEAM.C}', ${START});
    INSERT INTO riders(id, team_id) VALUES ('${RIDER.r1}', '${TEAM.A}'), ('${RIDER.r2}', '${TEAM.B}'), ('${RIDER.r3}', '${TEAM.A}');`);
  return db;
}

const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const balance = async (db, team) => Number((await one(db, 'SELECT balance FROM teams WHERE id = $1', [team])).balance);
const park = (db, rider, team) => db.query('UPDATE riders SET pending_team_id = $2 WHERE id = $1', [rider, team]);
const rider = (db, r) => one(db, 'SELECT team_id, pending_team_id, acquired_at FROM riders WHERE id = $1', [r]);
const ledger = async (db, key) => (await db.query('SELECT team_id, type, amount, reason_code, related_entity_type, related_entity_id FROM finance_transactions WHERE idempotency_key = $1', [key]))
  .rows.map(row => ({ ...row, amount: Number(row.amount) }));
// Penge forsvinder eller opstaar aldrig: hold-saldi + holdte escrows er konstant.
const total = async db => Number((await one(db, `SELECT (SELECT sum(balance) FROM teams)
  + coalesce((SELECT sum(amount) FROM sale_escrows WHERE status = 'held'), 0) AS t`)).t);

const payer = { type: 'transfer_out', description: 'buy', reason_code: 'transfer_purchase', source_path: 'test.buyer' };
const payee = { type: 'transfer_in', description: 'sell', reason_code: 'transfer_sale', source_path: 'test.seller' };
const refund = { type: 'transfer_in', description: 'refund', source_path: 'test.refund' };

async function hold(db, { type = 'transfer', deal, payerTeam, payeeTeam, amount, riders, targets }) {
  return (await one(db, 'SELECT public.hold_sale_escrow($1,$2,$3,$4,$5,$6::uuid[],$7::uuid[],$8,$9) AS r',
    [type, deal, payerTeam, payeeTeam, amount, `{${riders.join(',')}}`, `{${targets.join(',')}}`, payer, payee])).r;
}
async function settle(db, escrowId, outcome, { payload = outcome === 'refund' ? refund : null, at = '2026-11-08T10:00:00Z' } = {}) {
  return (await one(db, 'SELECT public.settle_sale_escrow($1,$2,$3,$4) AS r', [escrowId, outcome, payload, at])).r;
}
const transfer = (deal = DEAL.t1, amount = 250_000) => ({ deal, payerTeam: TEAM.B, payeeTeam: TEAM.A, amount, riders: [RIDER.r1], targets: [TEAM.B] });

test('parkeret transfer: koeber betaler een gang, saelger krediteres foerst ved holdskiftet', async () => {
  const db = await database();
  const before = await total(db);
  await park(db, RIDER.r1, TEAM.B);

  const held = await hold(db, transfer());
  assert.equal(held.status, 'held');
  assert.equal(held.payer_already_debited, false);
  assert.equal(await balance(db, TEAM.B), START - 250_000);
  assert.equal(await balance(db, TEAM.A), START, 'saelger faar intet, mens rytteren venter');
  assert.deepEqual(await ledger(db, `transfer_buyer:${DEAL.t1}`), [{ team_id: TEAM.B, type: 'transfer_out', amount: -250000,
    reason_code: 'transfer_purchase', related_entity_type: 'transfer', related_entity_id: DEAL.t1 }]);
  assert.equal(await total(db), before);

  // Gentagelse (fx netvaerksfejl hos kalderen): samme escrow, intet nyt traek.
  const again = await hold(db, transfer());
  assert.deepEqual(again, { status: 'exists', escrow_id: held.escrow_id, escrow_status: 'held' });
  assert.equal(await balance(db, TEAM.B), START - 250_000);

  const released = await settle(db, held.escrow_id, 'release');
  assert.deepEqual(released, { status: 'released', escrow_id: held.escrow_id, moved_rider_ids: [RIDER.r1], payee_already_credited: false });
  const moved = await rider(db, RIDER.r1);
  assert.equal(moved.team_id, TEAM.B);
  assert.equal(moved.pending_team_id, null);
  assert.equal(new Date(moved.acquired_at).toISOString(), '2026-11-08T10:00:00.000Z');
  assert.equal(await balance(db, TEAM.A), START + 250_000);
  const credit = await ledger(db, `transfer_seller:${DEAL.t1}`);
  assert.equal(credit.length, 1);
  assert.equal(credit[0].reason_code, 'transfer_sale');
  assert.equal(await total(db), before);

  // Anden afregning af samme escrow betaler aldrig igen.
  assert.deepEqual(await settle(db, held.escrow_id, 'release'), { status: 'already_settled', escrow_status: 'released' });
  assert.deepEqual(await settle(db, held.escrow_id, 'refund'), { status: 'already_settled', escrow_status: 'released' });
  assert.equal(await balance(db, TEAM.A), START + 250_000);
  assert.equal(await balance(db, TEAM.B), START - 250_000);
  assert.deepEqual(await hold(db, transfer()), { status: 'exists', escrow_id: held.escrow_id, escrow_status: 'released' });
});

test('hold kraever en parkeret rytter og en rytter kan kun vaere i een holdt escrow', async () => {
  const db = await database();
  assert.deepEqual(await hold(db, transfer()), { status: 'not_parked' });
  assert.equal(await balance(db, TEAM.B), START, 'intet traek uden escrow');

  await park(db, RIDER.r1, TEAM.C);
  assert.deepEqual(await hold(db, transfer()), { status: 'not_parked' }, 'parkeret mod et andet hold');

  await park(db, RIDER.r1, TEAM.B);
  assert.equal((await hold(db, transfer())).status, 'held');
  assert.deepEqual(await hold(db, transfer(DEAL.t2, 300_000)), { status: 'rider_already_escrowed' });
  assert.equal(await balance(db, TEAM.B), START - 250_000);
  assert.equal(Number((await one(db, 'SELECT count(*) AS n FROM sale_escrows')).n), 1);
});

test('halvfaerdig handel fra den gamle sti betales aldrig to gange', async () => {
  const db = await database();
  await park(db, RIDER.r1, TEAM.B);
  // Koeberen blev traekket efter den gamle sti, men saelger blev ikke krediteret.
  await db.query(`SELECT increment_balance_with_audit($1, -250000, $2)`, [TEAM.B, { ...payer, amount: -250000, idempotency_key: `transfer_buyer:${DEAL.t1}` }]);
  const held = await hold(db, transfer());
  assert.equal(held.status, 'held');
  assert.equal(held.payer_already_debited, true);
  assert.equal(await balance(db, TEAM.B), START - 250_000, 'ingen dobbelt-debitering');
  assert.equal((await ledger(db, `transfer_buyer:${DEAL.t1}`)).length, 1);

  // Saelger er allerede krediteret efter den gamle sti: ingen escrow, intet traek.
  const db2 = await database();
  await park(db2, RIDER.r1, TEAM.B);
  await db2.query(`SELECT increment_balance_with_audit($1, 250000, $2)`, [TEAM.A, { ...payee, amount: 250000, idempotency_key: `transfer_seller:${DEAL.t1}` }]);
  assert.deepEqual(await hold(db2, transfer()), { status: 'payee_already_credited' });
  assert.equal(await balance(db2, TEAM.B), START);
  assert.equal(Number((await one(db2, 'SELECT count(*) AS n FROM sale_escrows')).n), 0);
});

test('release efter at rytteren allerede er ankommet krediterer kun saelger', async () => {
  const db = await database();
  await park(db, RIDER.r1, TEAM.B);
  const held = await hold(db, transfer());
  // Den nuvaerende flush flytter rytteren uden om escrow'en.
  await db.query('UPDATE riders SET team_id = $2, pending_team_id = NULL WHERE id = $1', [RIDER.r1, TEAM.B]);
  const released = await settle(db, held.escrow_id, 'release');
  assert.deepEqual(released.moved_rider_ids, []);
  assert.equal(released.status, 'released');
  assert.equal(await balance(db, TEAM.A), START + 250_000);
  assert.equal((await rider(db, RIDER.r1)).acquired_at, null, 'en allerede flyttet rytter roeres ikke');
});

test('en leveret rytter forbliver leveret, ogsaa naar koeberen handler ham videre', async () => {
  // Rytteren leveres uden om escrow'en og parkeres straks i en ny handel mod Hold C.
  const db = await database();
  await park(db, RIDER.r1, TEAM.B);
  const held = await hold(db, transfer());
  await db.query('UPDATE riders SET team_id = $2, pending_team_id = NULL WHERE id = $1', [RIDER.r1, TEAM.B]);
  await park(db, RIDER.r1, TEAM.C);
  assert.deepEqual((await one(db, 'SELECT delivered_rider_ids FROM sale_escrows WHERE id = $1', [held.escrow_id])).delivered_rider_ids, [RIDER.r1]);
  assert.deepEqual(await settle(db, held.escrow_id, 'refund'), { status: 'already_delivered' });
  assert.equal(await balance(db, TEAM.B), START - 250_000, 'koeber faar ikke pengene tilbage for en rytter, han fik');
  const released = await settle(db, held.escrow_id, 'release');
  assert.equal(released.status, 'released');
  assert.deepEqual(released.moved_rider_ids, [], 'den nye parkering tilhoerer den nye handel');
  assert.equal((await rider(db, RIDER.r1)).pending_team_id, TEAM.C);
  assert.equal(await balance(db, TEAM.A), START + 250_000);

  // Videresolgt og flyttet til Hold C, inden escrow'en blev afregnet: beviset staar.
  const db2 = await database();
  await park(db2, RIDER.r1, TEAM.B);
  const held2 = await hold(db2, transfer());
  await db2.query('UPDATE riders SET team_id = $2, pending_team_id = NULL WHERE id = $1', [RIDER.r1, TEAM.B]);
  await db2.query('UPDATE riders SET team_id = $2 WHERE id = $1', [RIDER.r1, TEAM.C]);
  await park(db2, RIDER.r1, TEAM.B); // Hold C saelger ham tilbage til Hold B
  assert.deepEqual(await settle(db2, held2.escrow_id, 'refund'), { status: 'already_delivered' });
  const released2 = await settle(db2, held2.escrow_id, 'release');
  assert.deepEqual(released2.moved_rider_ids, [], 'parkeringen tilbage til Hold B er en anden handel');
  assert.equal((await rider(db2, RIDER.r1)).team_id, TEAM.C);
});

test('Codex #7853: leveret rytter, hvis raekke siden slettes, taeller stadig som leveret', async () => {
  const db = await database();
  await park(db, RIDER.r1, TEAM.B);
  const held = await hold(db, transfer());
  await db.query('UPDATE riders SET team_id = $2, pending_team_id = NULL WHERE id = $1', [RIDER.r1, TEAM.B]);
  await db.query('DELETE FROM riders WHERE id = $1', [RIDER.r1]);
  assert.deepEqual(await settle(db, held.escrow_id, 'refund'), { status: 'already_delivered' });
  assert.equal(await balance(db, TEAM.B), START - 250_000, 'koeber faar ikke pengene tilbage for en leveret rytter');
  const released = await settle(db, held.escrow_id, 'release');
  assert.equal(released.status, 'released');
  assert.deepEqual(released.moved_rider_ids, []);
  assert.equal(await balance(db, TEAM.A), START + 250_000);
});

test('fejlet levering: release afvises, refusion giver koeber pengene tilbage een gang', async () => {
  const db = await database();
  const before = await total(db);
  await park(db, RIDER.r1, TEAM.B);
  const held = await hold(db, transfer());
  // Rytteren stopper karrieren; parkeringen ryddes af den sti, ikke af escrow'en.
  await db.query('UPDATE riders SET team_id = NULL, pending_team_id = NULL WHERE id = $1', [RIDER.r1]);
  assert.deepEqual(await settle(db, held.escrow_id, 'release'), { status: 'not_deliverable' });
  assert.equal(await balance(db, TEAM.A), START);

  const refunded = await settle(db, held.escrow_id, 'refund');
  assert.deepEqual(refunded, { status: 'refunded', escrow_id: held.escrow_id, unparked_rider_ids: [], payer_already_refunded: false });
  assert.equal(await balance(db, TEAM.B), START);
  assert.equal(await balance(db, TEAM.A), START);
  const back = await ledger(db, `sale_escrow_refund:${held.escrow_id}`);
  assert.equal(back.length, 1);
  assert.equal(back[0].reason_code, 'sale_escrow_refund');
  assert.equal(back[0].related_entity_type, 'transfer');
  assert.equal(await total(db), before);
});

test('refusion af en stadig parkeret handel rydder parkeringen; leveret rytter kan ikke refunderes', async () => {
  const db = await database();
  await park(db, RIDER.r1, TEAM.B);
  const held = await hold(db, transfer());
  const refunded = await settle(db, held.escrow_id, 'refund');
  assert.deepEqual(refunded.unparked_rider_ids, [RIDER.r1]);
  const after = await rider(db, RIDER.r1);
  assert.equal(after.team_id, TEAM.A);
  assert.equal(after.pending_team_id, null);

  const db2 = await database();
  await park(db2, RIDER.r1, TEAM.B);
  const held2 = await hold(db2, transfer());
  await db2.query('UPDATE riders SET team_id = $2, pending_team_id = NULL WHERE id = $1', [RIDER.r1, TEAM.B]);
  assert.deepEqual(await settle(db2, held2.escrow_id, 'refund'), { status: 'already_delivered' });
  assert.equal(await balance(db2, TEAM.B), START - 250_000, 'koeber faar aldrig baade rytter og penge');
  assert.equal((await one(db2, 'SELECT status FROM sale_escrows WHERE id = $1', [held2.escrow_id])).status, 'held');
});

test('auktion bruger de eksisterende auktionsnoegler', async () => {
  const db = await database();
  await park(db, RIDER.r3, TEAM.C);
  const held = await hold(db, { type: 'auction', deal: DEAL.a1, payerTeam: TEAM.C, payeeTeam: TEAM.A, amount: 400_000, riders: [RIDER.r3], targets: [TEAM.C] });
  assert.equal(held.status, 'held');
  assert.equal((await ledger(db, `auction_winner:${DEAL.a1}`))[0].related_entity_type, 'auction');
  await settle(db, held.escrow_id, 'release');
  assert.equal((await ledger(db, `auction_seller:${DEAL.a1}`)).length, 1);
  assert.equal(await balance(db, TEAM.A), START + 400_000);
  assert.equal(await balance(db, TEAM.C), START - 400_000);
});

test('bytte frigives foerst, naar begge ryttere kan flyttes', async () => {
  const db = await database();
  const before = await total(db);
  // Hold A giver r1 + kontanter for Hold Bs r2.
  const swap = { type: 'swap', deal: DEAL.s1, payerTeam: TEAM.A, payeeTeam: TEAM.B, amount: 100_000,
    riders: [RIDER.r1, RIDER.r2], targets: [TEAM.B, TEAM.A] };
  await park(db, RIDER.r1, TEAM.B);
  assert.deepEqual(await hold(db, swap), { status: 'not_parked' }, 'begge skal vaere parkeret');
  await park(db, RIDER.r2, TEAM.A);
  const held = await hold(db, swap);
  assert.equal(held.status, 'held');
  assert.equal((await ledger(db, `swap_payer:${DEAL.s1}`))[0].related_entity_type, 'swap');

  const released = await settle(db, held.escrow_id, 'release');
  assert.deepEqual(released.moved_rider_ids, [RIDER.r1, RIDER.r2].sort());
  assert.equal((await rider(db, RIDER.r1)).team_id, TEAM.B);
  assert.equal((await rider(db, RIDER.r2)).team_id, TEAM.A);
  assert.equal((await ledger(db, `swap_receiver:${DEAL.s1}`)).length, 1);
  assert.equal(await balance(db, TEAM.B), START + 100_000);
  assert.equal(await total(db), before);

  // Den ene rytter kan ikke leveres: intet flyttes, intet krediteres.
  const db2 = await database();
  await park(db2, RIDER.r1, TEAM.B); await park(db2, RIDER.r2, TEAM.A);
  const held2 = await hold(db2, swap);
  await db2.query('UPDATE riders SET pending_team_id = NULL WHERE id = $1', [RIDER.r2]);
  assert.deepEqual(await settle(db2, held2.escrow_id, 'release'), { status: 'not_deliverable' });
  assert.equal((await rider(db2, RIDER.r1)).pending_team_id, TEAM.B, 'den anden rytter flyttes ikke alene');
  assert.equal(await balance(db2, TEAM.B), START);
});

test('kalder-fejl kastes og efterlader intet', async () => {
  const db = await database();
  await park(db, RIDER.r1, TEAM.B);
  const bad = [
    { ...transfer(), type: 'loan' },
    { ...transfer(), amount: 0 },
    { ...transfer(), payeeTeam: TEAM.B },
    { ...transfer(), targets: [TEAM.C] },
    { ...transfer(), riders: [RIDER.r1, RIDER.r2], targets: [TEAM.B, TEAM.A] },
    { type: 'swap', deal: DEAL.s1, payerTeam: TEAM.A, payeeTeam: TEAM.B, amount: 1, riders: [RIDER.r1, RIDER.r2], targets: [TEAM.B, TEAM.C] },
  ];
  for (const args of bad) await assert.rejects(hold(db, args), error => error.code === '22023', JSON.stringify(args));
  await assert.rejects(db.query('SELECT public.hold_sale_escrow($1,$2,$3,$4,$5,$6::uuid[],$7::uuid[],$8,$9)',
    ['transfer', DEAL.t1, TEAM.B, TEAM.A, 1, `{${RIDER.r1}}`, `{${TEAM.B}}`, { ...payer, type: 'prize' }, payee]), error => error.code === '22023');
  const held = await hold(db, transfer());
  await assert.rejects(settle(db, held.escrow_id, 'refund', { payload: null }), error => error.code === '22023');
  await assert.rejects(settle(db, held.escrow_id, 'cancel'), error => error.code === '22023');
  assert.deepEqual(await settle(db, id(999), 'release'), { status: 'missing' });
  assert.equal(Number((await one(db, 'SELECT count(*) AS n FROM sale_escrows')).n), 1);
  assert.equal(await balance(db, TEAM.B), START - 250_000);
});

test('kun service_role kan laese tabellen og kalde RPC\'erne', async () => {
  const db = await database();
  assert.equal((await one(db, "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sale_escrows'::regclass")).relrowsecurity, true);
  for (const role of ['anon', 'authenticated']) {
    const rows = (await db.query(`SELECT p.proname, has_function_privilege('${role}', p.oid, 'EXECUTE') AS ok FROM pg_proc p
      WHERE p.proname IN ('hold_sale_escrow', 'settle_sale_escrow', 'sale_escrow_finance_key', 'sale_escrow_lock_teams', 'sale_escrow_mark_delivery')`)).rows;
    assert.equal(rows.length, 5);
    assert.ok(rows.every(row => row.ok === false), `${role} may not execute`);
    assert.equal((await one(db, `SELECT has_table_privilege('${role}', 'public.sale_escrows', 'SELECT') AS ok`)).ok, false);
  }
  await park(db, RIDER.r1, TEAM.B);
  await db.exec('SET ROLE service_role');
  const held = await hold(db, transfer());
  assert.equal(held.status, 'held');
  assert.equal((await settle(db, held.escrow_id, 'release')).status, 'released');
  await assert.rejects(db.query('DELETE FROM sale_escrows'), error => error.code === '42501', 'escrows slettes aldrig');
  await db.exec('RESET ROLE');
});
