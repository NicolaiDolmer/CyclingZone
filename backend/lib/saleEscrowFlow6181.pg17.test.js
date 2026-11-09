// #6181 · Tjeklisten 9/11: pengelaasen mod RIGTIG PG17 med separate forbindelser.
// PGlite har kun een forbindelse og kan ikke vise et kapploeb. Springes over uden
// AUTO_ACCEPT_PG_BIN (CI); koeres lokalt, foer kontakterne taendes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { MIGRATIONS, SCHEMA, balanceRpcFrom } from './__fixtures__/saleEscrow6181Schema.js';

const PG_BIN = process.env.AUTO_ACCEPT_PG_BIN;
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const SELLER = id(1);
const BUYER = id(2);
const USERS = [id(901), id(902)];
const RIDER = id(11);
const DEAL = id(101);
const START = 1000000;
const PRICE = 40000;
const sqlFile = name => readFile(new URL(`../../database/${name}`, import.meta.url), 'utf8');

function run(binary, args, input) {
  const result = spawnSync(join(PG_BIN, binary), args, {
    input, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, PGCLIENTENCODING: 'UTF8' },
    timeout: binary === 'initdb' ? 120000 : 30000,
  });
  assert.equal(result.status, 0, `${binary}: ${result.error?.message || result.stderr}`);
  return result.stdout;
}

// Afviser med hele stderr, saa kalderen kan taelle en deadlock som en deadlock.
function connection(port, sql) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(join(PG_BIN, 'psql'), [
      '-X', '-q', '-t', '-A', '-h', '127.0.0.1', '-p', String(port),
      '-U', 'postgres', '-d', 'escrow', '-v', 'ON_ERROR_STOP=1',
    ], { windowsHide: true, env: { ...process.env, PGCLIENTENCODING: 'UTF8' } });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', part => { stdout += part; });
    child.stderr.on('data', part => { stderr += part; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) reject(new Error(stderr));
      else {
        try { resolvePromise(JSON.parse(stdout.trim())); } catch (error) { reject(error); }
      }
    });
    child.stdin.end(`SET statement_timeout='20s'; ${sql}`);
  });
}

const payload = (type, amount, key) => JSON.stringify({ type, amount, idempotency_key: key, reason_code: 'test', source_path: 'pg17' });
const hold = () => `SELECT public.hold_sale_escrow('transfer','${DEAL}','${BUYER}','${SELLER}',${PRICE},
  ARRAY['${RIDER}']::uuid[],ARRAY['${BUYER}']::uuid[],'${payload('transfer_out', -PRICE, `transfer_buyer:${DEAL}`)}'::jsonb,
  '${payload('transfer_in', PRICE, `transfer_seller:${DEAL}`)}'::jsonb,'{}'::jsonb);`;
const escrowId = `(SELECT id FROM sale_escrows WHERE deal_id='${DEAL}')`;
const settle = outcome => `SELECT public.settle_sale_escrow(${escrowId},'${outcome}',
  '{"type":"transfer_in","description":"r","metadata":{},"source_path":"pg17"}'::jsonb,'2026-11-09T12:00:00Z');`;
const credit = `SELECT public.test_legacy_credit('${DEAL}',${PRICE});`;
const move = (team, n) => `SELECT public.test_move('${team}',${n});`;
const startBid = n => `SELECT public.test_start_bid('${id(2000 + n)}');`;

test('PG17: pengelaasens tjekliste under aegte samtidighed', {
  skip: !PG_BIN && 'AUTO_ACCEPT_PG_BIN is not set', timeout: 900000,
}, async t => {
  const version = run('psql', ['--version']).trim();
  assert.match(version, /PostgreSQL\) 17\./, 'beviset kraever rigtig PostgreSQL 17');
  const temporaryRoot = resolve(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, 'sale-escrow-pg17-'));
  const data = join(directory, 'data');
  const port = 58000 + Math.floor(Math.random() * 1000);
  let started = false;
  const failures = [];
  try {
    run('initdb', ['-D', data, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C']);
    const server = spawnSync(join(PG_BIN, 'pg_ctl'), [
      '-D', data, '-o', `-p ${port} -c listen_addresses=127.0.0.1 -c max_connections=40`,
      '-w', '-l', join(directory, 'pg.log'), 'start',
    ], { windowsHide: true, stdio: 'ignore', timeout: 30000 });
    assert.equal(server.status, 0, 'PG17 must start');
    started = true;
    run('psql', ['-X', '-q', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres',
      '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE DATABASE escrow']);
    const psql = sql => run('psql', ['-X', '-q', '-t', '-A', '-h', '127.0.0.1',
      '-p', String(port), '-U', 'postgres', '-d', 'escrow', '-v', 'ON_ERROR_STOP=1'], sql);
    psql(SCHEMA);
    psql(balanceRpcFrom(await sqlFile('2026-05-26-backend-message-codes.sql')));
    for (const name of MIGRATIONS) psql(await sqlFile(name));
    psql(`UPDATE app_config SET value='"on"' WHERE key='market_commitment_6181'`);
    psql(`INSERT INTO app_config(key,value) VALUES ('sale_escrow_enabled','"on"')`);
    // Kun de forventede afvisninger bliver til JSON; alt andet vaelter testen.
    psql(`CREATE FUNCTION public.test_legacy_credit(p_deal uuid, p_amount bigint) RETURNS jsonb LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM public.increment_balance_with_audit('${SELLER}', p_amount, jsonb_build_object(
          'type','transfer_in','amount',p_amount,'idempotency_key','transfer_seller:'||p_deal,'source_path','pg17',
          'reason_code','test','related_entity_type','transfer','related_entity_id',p_deal));
        RETURN jsonb_build_object('status','credited');
      EXCEPTION
        WHEN unique_violation THEN RETURN jsonb_build_object('status','duplicate');
        WHEN SQLSTATE 'P0001' THEN
          IF SQLERRM NOT LIKE 'sale_escrow_refunded:%' THEN RAISE; END IF;
          RETURN jsonb_build_object('status','refused');
      END; $$;`);
    psql(`CREATE FUNCTION public.test_move(p_team uuid, p_n integer) RETURNS jsonb LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM public.increment_balance_with_audit(p_team, 1, jsonb_build_object(
          'type','transfer_in','amount',1,'source_path','pg17','reason_code','test','idempotency_key',
          'move:'||p_team||':'||p_n||':'||gen_random_uuid()));
        RETURN jsonb_build_object('status','moved');
      END; $$;`);
    psql(`CREATE FUNCTION public.test_start_bid(p_rider uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO auctions(rider_id,current_price,current_bidder_id) VALUES(p_rider,1,'${BUYER}');
        RETURN jsonb_build_object('status','started');
      EXCEPTION WHEN SQLSTATE 'P0001' THEN
        IF SQLERRM <> 'market_gate_6181:insufficient_available_balance' THEN RAISE; END IF;
        RETURN jsonb_build_object('status','insufficient');
      END; $$;`);
    // Samme laas som guard_draining_ai_obligation (FOR SHARE paa holdraekken) og samme navn;
    // den rigtige funktion traekker hele AI-pulje-skemaet med. Pausen aabner vinduet.
    psql(`CREATE FUNCTION public.test_ai_guard() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.current_bidder_id IS NOT NULL THEN
          PERFORM 1 FROM teams WHERE id=NEW.current_bidder_id FOR SHARE;
          PERFORM pg_sleep(0.02);
        END IF;
        RETURN NEW;
      END; $$;
      CREATE TRIGGER trg_ai_drain_auctions BEFORE INSERT ON auctions FOR EACH ROW EXECUTE FUNCTION public.test_ai_guard();`);

    const reset = () => psql(`TRUNCATE finance_transactions, sale_escrows, notifications, transfer_offers, swap_offers,
        auction_bids, auction_proxy_bids, auctions, academy_graduation, race_entries, races, riders, teams CASCADE;
      INSERT INTO teams(id,balance,user_id) VALUES ('${SELLER}',${START},'${USERS[0]}'),('${BUYER}',${START},'${USERS[1]}');
      INSERT INTO riders(id,firstname,lastname,team_id,pending_team_id) VALUES ('${RIDER}','Rytter','En','${SELLER}','${BUYER}');
      INSERT INTO transfer_offers(id,status) VALUES ('${DEAL}','accepted');`);
    const scalar = sql => psql(sql).trim();
    const number = sql => Number(scalar(sql));
    const money = () => number(`SELECT (SELECT sum(balance) FROM teams) + coalesce((SELECT sum(amount) FROM sale_escrows WHERE status='held'),0)`);
    const statusOf = row => row.hold_sale_escrow?.status ?? row.status;

    const rounds = 10;
    let accepted = 0;
    for (let round = 0; round < rounds; round++) {
      // A: otte samtidige laase paa samme handel: een escrow, eet traek.
      reset();
      const holds = await Promise.all(Array.from({ length: 8 }, () => connection(port, hold())));
      assert.equal(holds.filter(r => statusOf(r) === 'held').length, 1, JSON.stringify(holds));
      assert.equal(holds.filter(r => statusOf(r) === 'exists').length, 7, JSON.stringify(holds));
      assert.equal(number(`SELECT balance FROM teams WHERE id='${BUYER}'`), START - PRICE);
      assert.equal(money(), START * 2);
      accepted += 1;

      // B: refusion, frigivelse og den gamle saelger-kredit paa samme escrow.
      // Hvert udfald er lovligt, saa laenge pengene passer og det sker een gang.
      const before = money();
      const raced = await Promise.all([
        ...Array.from({ length: 3 }, () => connection(port, settle('refund'))),
        ...Array.from({ length: 3 }, () => connection(port, settle('release'))),
        ...Array.from({ length: 2 }, () => connection(port, credit)),
      ]);
      assert.ok(raced.length === 8);
      const final = scalar(`SELECT status FROM sale_escrows WHERE deal_id='${DEAL}'`);
      assert.ok(['refunded', 'released'].includes(final), final);
      assert.equal(money(), before, 'penge opstaar eller forsvinder aldrig');
      const sent = number('SELECT count(*) FROM notifications');
      const credits = number(`SELECT count(*) FROM finance_transactions WHERE idempotency_key='transfer_seller:${DEAL}'`);
      const refunds = number(`SELECT count(*) FROM finance_transactions WHERE idempotency_key LIKE 'sale_escrow_refund:%'`);
      if (final === 'refunded') {
        assert.deepEqual([sent, credits, refunds], [2, 0, 1], 'refusion: besked til begge, ingen kredit');
        assert.equal(scalar(`SELECT status FROM transfer_offers WHERE id='${DEAL}'`), 'withdrawn');
        assert.equal(number(`SELECT balance FROM teams WHERE id='${BUYER}'`), START);
      } else {
        assert.deepEqual([sent, credits, refunds], [0, 1, 0], 'frigivelse: een kredit, ingen besked');
        assert.equal(scalar(`SELECT team_id FROM riders WHERE id='${RIDER}'`), BUYER);
      }
      accepted += 1;

      // C: otte samtidige refusioner midt i saldobevaegelser paa begge hold.
      reset();
      psql(hold());
      const refundRace = await Promise.all([
        ...Array.from({ length: 8 }, () => connection(port, settle('refund'))),
        ...Array.from({ length: 4 }, (_, n) => connection(port, move(BUYER, n))),
        ...Array.from({ length: 4 }, (_, n) => connection(port, move(SELLER, n))),
      ]);
      assert.equal(refundRace.length, 16);
      assert.equal(number('SELECT count(*) FROM notifications'), 2, 'besked praecis een gang');
      assert.equal(number(`SELECT count(*) FROM finance_transactions WHERE idempotency_key LIKE 'sale_escrow_refund:%'`), 1);
      assert.equal(money(), START * 2 + 8);
      accepted += 1;

      // D: et overforpligtet hold saenker sit autobud fra otte forbindelser samtidig.
      reset();
      const auction = scalar(`INSERT INTO auctions(rider_id,current_price) VALUES ('${id(3000)}',1) RETURNING id`);
      psql(`INSERT INTO auction_proxy_bids(auction_id,team_id,max_amount) VALUES ('${auction}','${BUYER}',500000);
        UPDATE teams SET balance=10 WHERE id='${BUYER}';`);
      const lowered = await Promise.all(Array.from({ length: 8 }, () => connection(port, `
        WITH x AS (INSERT INTO auction_proxy_bids(auction_id,team_id,max_amount) VALUES ('${auction}','${BUYER}',400000)
          ON CONFLICT (auction_id,team_id) DO UPDATE SET max_amount=EXCLUDED.max_amount RETURNING max_amount)
        SELECT jsonb_build_object('status','saved') FROM x;`)));
      assert.equal(lowered.filter(r => r.jsonb_build_object?.status === 'saved' || r.status === 'saved').length, 8, JSON.stringify(lowered));
      accepted += 1;
    }

    // E: startbud mod saldobevaegelser. Foerst med det gamle triggernavn (foerstatus),
    // saa med migrationen. Kun fejl med teksten "deadlock" taeller; alt andet vaelter testen.
    const deadlocks = async () => {
      let count = 0;
      for (let round = 0; round < rounds; round++) {
        reset();
        const results = await Promise.allSettled([
          ...Array.from({ length: 6 }, (_, n) => connection(port, startBid(round * 10 + n))),
          ...Array.from({ length: 6 }, (_, n) => connection(port, move(BUYER, round * 10 + n))),
        ]);
        for (const r of results) {
          if (r.status === 'fulfilled') continue;
          if (/deadlock detected/.test(r.reason.message)) count += 1;
          else throw r.reason;
        }
      }
      return count;
    };
    psql(`DROP TRIGGER a_market_commitment_6181_start ON auctions;
      CREATE TRIGGER trg_market_commitment_6181_start BEFORE INSERT ON auctions FOR EACH ROW EXECUTE FUNCTION public.market_commitment_6181_start_gate();`);
    const baselineDeadlocks = await deadlocks();
    psql(await sqlFile('2026-11-09-6181-tjekliste.sql'));
    const fixedDeadlocks = await deadlocks();
    assert.equal(fixedDeadlocks, 0, 'startbud maa ikke kunne give deadlock med saldobevaegelser');

    t.diagnostic(`${version}; rounds=${rounds}; scenarios=4 + startbud; accepted=${accepted}; money_conserved=true; ` +
      `start_bid_deadlocks_old_trigger_name=${baselineDeadlocks}; start_bid_deadlocks_after_migration=${fixedDeadlocks}`);
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      const stopped = spawnSync(join(PG_BIN, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop'],
        { windowsHide: true, stdio: 'ignore', timeout: 30000 });
      if (started) assert.equal(stopped.status, 0, 'temporary PG17 server must stop');
      assert.equal(dirname(resolve(directory)), temporaryRoot, 'cleanup must stay in the temporary root');
      try {
        await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
      } catch (error) {
        if (['EBUSY', 'EPERM'].includes(error.code)) t.diagnostic(`temporary_pg17_cleanup_deferred=${directory}`);
        else failures.push(error);
      }
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'PG17 verification and cleanup failed');
});
