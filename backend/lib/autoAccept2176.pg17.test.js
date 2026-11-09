// Real, separate PG17 connections. PGlite's single connection cannot prove races.
// Optional locally; CI without AUTO_ACCEPT_PG_BIN explicitly skips this evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { SCHEMA, ESCROW_SCHEMA } from './__fixtures__/autoAccept2176Schema.js';

// Migrationerne i den raekkefoelge, auto-migrate.yml bruger (filnavn).
const FILENAME_ORDER = [
  '2026-11-07-2176-m2-auto-accept.sql',
  '2026-11-07-6181-m3-market-commitment.sql',
  '2026-11-07-6181-sale-escrow-m1.sql',
  '2026-11-07-6181-sale-escrow-m2-guards.sql',
  '2026-11-09-2176-m3-auto-accept-claim-swap.sql',
];
// Escrow foerst: filerne maa ikke afhaenge af hinandens raekkefoelge.
const ESCROW_FIRST_ORDER = [
  '2026-11-07-6181-sale-escrow-m1.sql',
  '2026-11-07-6181-sale-escrow-m2-guards.sql',
  '2026-11-07-2176-m2-auto-accept.sql',
  '2026-11-07-6181-m3-market-commitment.sql',
  '2026-11-09-2176-m3-auto-accept-claim-swap.sql',
];
let database = 'auto_accept';

const PG_BIN = process.env.AUTO_ACCEPT_PG_BIN;
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const SELLER = id(1);
const BUYER = id(2);
const NOW = '2026-11-09T10:00:00Z';
const END = '2026-11-09T14:00:00Z';
const PRICE = 600000;
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

function connection(port, sql) {
  return new Promise((resolve, reject) => {
    const child = spawn(join(PG_BIN, 'psql'), [
      '-X', '-q', '-t', '-A', '-h', '127.0.0.1', '-p', String(port),
      '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1',
    ], { windowsHide: true, env: { ...process.env, PGCLIENTENCODING: 'UTF8' } });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', part => { stdout += part; });
    child.stderr.on('data', part => { stderr += part; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) reject(new Error(`concurrent SQL failed (${code}): ${stderr}`));
      else {
        try { resolve(JSON.parse(stdout.trim())); } catch (error) { reject(error); }
      }
    });
    child.stdin.end(`SET statement_timeout='15s'; ${sql}`);
  });
}

const start = (listing, buyer = BUYER) => `SELECT public.start_auto_accept_auction(
  '${listing}','${buyer}',(SELECT rider_id FROM transfer_listings WHERE id='${listing}'),
  '${SELLER}','{"market_value":1000000,"base_value":1000000,"prize_earnings_bonus":0}'::jsonb,${PRICE},60,'${END}',30,8,'{}','${NOW}');`;
const release = rider => `SELECT public.auto_accept_release_rider('${rider}','${SELLER}',8,'{}');`;
const claim = (rider, buyer = BUYER, defer = false) => `SELECT public.auto_accept_claim_transfer(
  '${rider}','${SELLER}','${buyer}',${defer},'${NOW}','{}',8,'{}',30);`;
const claimSwap = (offered, requested, defer = false) => `SELECT public.auto_accept_claim_swap(
  '${offered}','${requested}','${SELLER}','${BUYER}',${defer},'${NOW}','{}','{}');`;
const ESCROW_AMOUNT = 250000;
const hold = (deal, rider) => `SELECT public.hold_sale_escrow('transfer','${deal}','${BUYER}','${SELLER}',${ESCROW_AMOUNT},
  ARRAY['${rider}']::uuid[],ARRAY['${BUYER}']::uuid[],
  '{"type":"transfer_out","description":"buy","reason_code":"transfer_purchase","source_path":"test.buyer"}'::jsonb,
  '{"type":"transfer_in","description":"sell","reason_code":"transfer_sale","source_path":"test.seller"}'::jsonb);`;
const settle = (escrow, outcome) => `SELECT public.settle_sale_escrow('${escrow}','${outcome}',
  ${outcome === 'refund' ? `'{"type":"transfer_in","description":"refund","source_path":"test.refund"}'::jsonb` : 'NULL'},'${NOW}');`;

test('PG17: auto-accept serializes listing, money, seats, seller floor and release', {
  skip: !PG_BIN && 'AUTO_ACCEPT_PG_BIN is not set', timeout: 600000,
}, async t => {
  const version = run('psql', ['--version']).trim();
  assert.match(version, /PostgreSQL\) 17\./);
  const temporaryRoot = resolve(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, 'auto-accept-pg17-'));
  const data = join(directory, 'data');
  const port = 57000 + Math.floor(Math.random() * 1000);
  let started = false;
  const failures = [];
  try {
    run('initdb', ['-D', data, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C']);
    const server = spawnSync(join(PG_BIN, 'pg_ctl'), [
      '-D', data, '-o', `-p ${port} -c listen_addresses=127.0.0.1 -c max_connections=20`,
      '-w', '-l', join(directory, 'pg.log'), 'start',
    ], { windowsHide: true, stdio: 'ignore', timeout: 30000 });
    assert.equal(server.status, 0, 'PG17 must start');
    started = true;
    run('psql', ['-X', '-q', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres',
      '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE DATABASE auto_accept']);
    const psql = sql => run('psql', ['-X', '-q', '-t', '-A', '-h', '127.0.0.1',
      '-p', String(port), '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1'], sql);
    const json = sql => JSON.parse(psql(sql).trim());
    const balanceRpcSource = (await sqlFile('2026-05-26-backend-message-codes.sql'))
      .match(/CREATE OR REPLACE FUNCTION increment_balance_with_audit\([\s\S]*?\$\$ LANGUAGE plpgsql;/);
    assert.ok(balanceRpcSource, 'increment_balance_with_audit not found in its migration');
    const prepare = async (order, { roles }) => {
      psql(roles ? SCHEMA : SCHEMA.replace(/CREATE ROLE[^\n]*\n/, ''));
      psql(ESCROW_SCHEMA);
      psql(`${balanceRpcSource[0]}\nGRANT EXECUTE ON FUNCTION increment_balance_with_audit(UUID, BIGINT, JSONB) TO service_role;`);
      psql(await sqlFile('2026-05-10-reject-late-auction-bid-trigger.sql'));
      for (const name of order) {
        const migration = await sqlFile(name);
        psql(migration);
        psql(migration);
      }
      psql(`UPDATE app_config SET value='"on"' WHERE key='market_commitment_6181'`);
      // Adapt only the expected real trigger refusal to JSON; every other SQL
      // failure still aborts the test instead of looking like a correct loser.
      psql(`CREATE FUNCTION public.test_attempt_bid(p_auction uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
        BEGIN
          INSERT INTO auction_bids(auction_id,team_id,amount,bid_time) VALUES(p_auction,'${BUYER}',${PRICE},'${NOW}');
          RETURN jsonb_build_object('status','bid_placed');
        EXCEPTION WHEN SQLSTATE 'P0001' THEN
          IF SQLERRM <> 'market_gate_6181:insufficient_available_balance' THEN RAISE; END IF;
          RETURN jsonb_build_object('status','insufficient_funds');
        END; $$;`);
    };
    await prepare(FILENAME_ORDER, { roles: true });

    const reset = ({ sellerCount = 20, buyerCount = 0, buyerBalance = 10000000 } = {}) => {
      psql(`TRUNCATE sale_escrows, finance_transactions, transfer_listing_price_log, auction_bids, auction_proxy_bids,
        auctions, transfer_listings, swap_offers, riders, teams CASCADE;
        INSERT INTO teams VALUES ('${SELLER}',10000000),('${BUYER}',${buyerBalance});
        INSERT INTO riders(id,team_id) SELECT
          ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'${SELLER}'
          FROM generate_series(100,${99 + sellerCount}) n;
        INSERT INTO riders(id,team_id) SELECT
          ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'${BUYER}'
          FROM generate_series(500,${499 + buyerCount}) n;
        INSERT INTO transfer_listings(id,rider_id,seller_team_id,asking_price,auto_accept_price)
          SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
          ('00000000-0000-0000-0000-'||lpad((n-900)::text,12,'0'))::uuid,
          '${SELLER}',100000,${PRICE} FROM generate_series(1000,1007) n;`);
    };
    const assertRace = async (commands, success, rejected) => {
      const results = await Promise.all(commands.map(sql => connection(port, sql)));
      assert.equal(results.filter(row => success.includes(row.status)).length, 1, JSON.stringify(results));
      for (const row of results) assert.ok([...success, ...rejected].includes(row.status), JSON.stringify(row));
      return results;
    };
    const leading = () => Number(psql(`SELECT count(*) FROM auctions WHERE current_bidder_id='${BUYER}'`).trim());
    const remainingSeller = () => Number(psql(`SELECT count(*) FROM riders r WHERE team_id='${SELLER}'
      AND NOT EXISTS (SELECT 1 FROM auctions a WHERE a.rider_id=r.id AND a.status IN ('active','extended')
      AND a.current_bidder_id IS NOT NULL AND a.current_bidder_id <> '${SELLER}')`).trim());
    const value = sql => psql(sql).trim();
    const riderTeam = rider => value(`SELECT coalesce(team_id::text,'') FROM riders WHERE id='${rider}'`);
    const riderPending = rider => value(`SELECT coalesce(pending_team_id::text,'') FROM riders WHERE id='${rider}'`);
    const teamBalance = team => Number(value(`SELECT balance FROM teams WHERE id='${team}'`));
    const held = n => {
      const deal = id(3000 + n);
      assert.equal(json(claim(id(100 + n), BUYER, true)).status, 'claimed');
      const row = json(hold(deal, id(100 + n)));
      assert.equal(row.status, 'held');
      return row.escrow_id;
    };
    // M2 og escrow i samme database: hele forloebet paa samme rytter og samme hold.
    const escrowRound = async () => {
      reset();
      const escrow = held(0);
      assert.equal(teamBalance(BUYER), 10000000 - ESCROW_AMOUNT);
      assert.equal(teamBalance(SELLER), 10000000, 'seller is not credited while the rider is parked');
      assert.equal(json(start(id(1000))).status, 'rider_pending_transfer');
      assert.equal(json(settle(escrow, 'release')).status, 'released');
      assert.equal(riderTeam(id(100)), BUYER);
      assert.equal(teamBalance(SELLER), 10000000 + ESCROW_AMOUNT);
      assert.equal(json(start(id(1000))).status, 'rider_not_with_seller');

      reset();
      const refunded = held(0);
      assert.equal(json(settle(refunded, 'refund')).status, 'refunded');
      assert.equal(riderTeam(id(100)), SELLER);
      assert.equal(riderPending(id(100)), '');
      assert.equal(teamBalance(BUYER), 10000000);
      assert.equal(json(start(id(1000))).status, 'started', 'a refunded rider is free to sell again');

      reset();
      const [winner] = (await assertRace([
        ...Array.from({ length: 4 }, () => claim(id(100), BUYER, true)),
        ...Array.from({ length: 4 }, () => start(id(1000))),
      ], ['claimed', 'started'], ['rider_on_auction', 'rider_state_changed', 'rider_pending_transfer', 'listing_closed']))
        .filter(row => ['claimed', 'started'].includes(row.status));
      assert.equal(json(hold(id(3100), id(100))).status, winner.status === 'claimed' ? 'held' : 'not_parked');

      reset({ buyerCount: 28 });
      const seatEscrow = held(0);
      const results = await Promise.all([
        connection(port, settle(seatEscrow, 'release')),
        ...Array.from({ length: 4 }, (_, n) => connection(port, start(id(1001 + n)))),
      ]);
      assert.equal(results[0].status, 'released', JSON.stringify(results));
      const seats = results.slice(1).map(row => row.status).sort();
      assert.deepEqual(seats, ['squad_full', 'squad_full', 'squad_full', 'started'], JSON.stringify(results));
      assert.equal(Number(value(`SELECT count(*) FROM riders WHERE team_id='${BUYER}'`)) + leading(), 30);
      assert.equal(Number(value(`SELECT count(*) FROM sale_escrows WHERE status='held'`)), 0);
    };
    const rounds = 10;
    const escrowScenarios = 4;
    for (let round = 0; round < rounds; round++) {
      await escrowRound();

      // Bytte mod start paa samme rytter: enten er rytteren byttet (begge ben), eller paa auktion.
      const defer = round % 2 === 1;
      reset({ buyerCount: 1 });
      await assertRace([
        ...Array.from({ length: 4 }, () => start(id(1000))),
        ...Array.from({ length: 4 }, () => claimSwap(id(100), id(500), defer)),
      ], ['started', 'claimed'], ['rider_on_auction', 'rider_state_changed', 'rider_not_with_seller', 'rider_pending_transfer', 'listing_closed']);
      const swapped = (defer ? riderPending(id(100)) : riderTeam(id(100))) === BUYER;
      assert.equal(Number(swapped) + leading(), 1);
      assert.equal(defer ? riderPending(id(500)) === SELLER : riderTeam(id(500)) === SELLER, swapped, 'both legs or neither');

      reset();
      psql(`INSERT INTO teams SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
        10000000 FROM generate_series(10,17) n;`);
      await assertRace(Array.from({ length: 8 }, (_, n) => start(id(1000), id(10 + n))),
        ['started'], ['listing_closed']);
      assert.equal(Number(psql('SELECT count(*) FROM auctions').trim()), 1);

      reset({ buyerBalance: 1000000 });
      await assertRace(Array.from({ length: 8 }, (_, n) => start(id(1000 + n))),
        ['started'], ['insufficient_funds']);
      assert.equal(leading(), 1);
      assert.equal(Number(psql('SELECT sum(amount) FROM auction_bids').trim()), PRICE);

      reset({ buyerCount: 29 });
      await assertRace(Array.from({ length: 8 }, (_, n) => start(id(1000 + n))),
        ['started'], ['squad_full']);
      assert.equal(29 + leading(), 30);

      reset({ sellerCount: 9 });
      await assertRace(Array.from({ length: 8 }, (_, n) => start(id(1000 + n))),
        ['started'], ['seller_squad_floor']);
      assert.equal(remainingSeller(), 8);

      reset({ sellerCount: 9 });
      await assertRace([
        ...Array.from({ length: 4 }, (_, n) => start(id(1000 + n))),
        ...Array.from({ length: 4 }, (_, n) => release(id(104 + n))),
      ], ['started', 'released'], ['seller_squad_floor', 'squad_floor']);
      assert.equal(remainingSeller(), 8);

      reset({ sellerCount: 9 });
      await assertRace([
        ...Array.from({ length: 4 }, (_, n) => start(id(1000 + n))),
        ...Array.from({ length: 4 }, (_, n) => claim(id(104 + n))),
      ], ['started', 'claimed'], ['seller_squad_floor']);
      assert.equal(remainingSeller(), 8);

      reset({ buyerCount: 29 });
      await assertRace([
        ...Array.from({ length: 4 }, (_, n) => start(id(1000 + n))),
        ...Array.from({ length: 4 }, (_, n) => claim(id(104 + n))),
      ], ['started', 'claimed'], ['squad_full']);
      assert.equal(Number(psql(`SELECT count(*) FROM riders WHERE team_id='${BUYER}'`).trim()) + leading(), 30);

      reset();
      await assertRace([
        ...Array.from({ length: 4 }, () => start(id(1000))),
        ...Array.from({ length: 4 }, () => claim(id(100))),
      ], ['started', 'claimed'], ['rider_on_auction', 'rider_state_changed', 'rider_not_with_seller', 'listing_closed']);
      const sold = Number(psql(`SELECT count(*) FROM riders WHERE id='${id(100)}' AND team_id='${BUYER}'`).trim());
      assert.equal(sold + leading(), 1);

      reset({ buyerBalance: 1000000 });
      psql(`INSERT INTO auctions(id,rider_id,calculated_end)
        SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
          ('00000000-0000-0000-0000-'||lpad((n-1892)::text,12,'0'))::uuid,'${END}'
        FROM generate_series(2000,2003) n;`);
      await assertRace([
        ...Array.from({ length: 4 }, (_, n) => start(id(1000 + n))),
        ...Array.from({ length: 4 }, (_, n) => `SELECT public.test_attempt_bid('${id(2000 + n)}');`),
      ], ['started', 'bid_placed'], ['insufficient_funds']);
      assert.equal(leading(), 1);
      assert.ok(Number(psql(`SELECT public.team_market_commitment('${BUYER}')`).trim()) <= 1000000);
    }
    const deadlocks = Number(psql("SELECT deadlocks FROM pg_stat_database WHERE datname='auto_accept'").trim());
    assert.equal(deadlocks, 0);
    // Samme forloeb med escrow-filerne anvendt foerst, i en frisk database.
    run('psql', ['-X', '-q', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres',
      '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE DATABASE auto_accept_escrow_first']);
    database = 'auto_accept_escrow_first';
    await prepare(ESCROW_FIRST_ORDER, { roles: false });
    for (let round = 0; round < 3; round++) await escrowRound();
    assert.equal(Number(psql("SELECT deadlocks FROM pg_stat_database WHERE datname='auto_accept_escrow_first'").trim()), 0);
    t.diagnostic(`${version}; m3_enabled=true; migrations=${FILENAME_ORDER.length}; orders=2; scenarios=10; ` +
      `escrow_scenarios=${escrowScenarios}; rounds_per_scenario=${rounds}; connections_per_round=8; ` +
      `attempted=${rounds * 10 * 8}; accepted=${rounds * 10}; rejected=${rounds * 10 * 7}; ` +
      'overbooked=0; deadlocks=0');
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      const stopped = spawnSync(join(PG_BIN, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop'],
        { windowsHide: true, stdio: 'ignore', timeout: 30000 });
      // Preserve cluster evidence if stopping fails; never delete a running cluster.
      if (started) assert.equal(stopped.status, 0, 'temporary PG17 server must stop');
      if (started) {
        const status = spawnSync(join(PG_BIN, 'pg_ctl'), ['-D', data, 'status'],
          { windowsHide: true, stdio: 'ignore', timeout: 30000 });
        assert.equal(status.status, 3, 'pg_ctl must positively report that no server is running');
        t.diagnostic('temporary_pg17_server_stopped=true');
      }
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
