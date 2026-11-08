// Real, separate PG17 connections. PGlite's single connection cannot prove races.
// Optional locally; CI without AUTO_ACCEPT_PG_BIN explicitly skips this evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { SCHEMA } from './__fixtures__/autoAccept2176Schema.js';

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
      '-U', 'postgres', '-d', 'auto_accept', '-v', 'ON_ERROR_STOP=1',
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
const claim = (rider, buyer = BUYER) => `SELECT public.auto_accept_claim_transfer(
  '${rider}','${SELLER}','${buyer}',false,'${NOW}','{}',8,'{}',30);`;

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
      '-p', String(port), '-U', 'postgres', '-d', 'auto_accept', '-v', 'ON_ERROR_STOP=1'], sql);
    psql(SCHEMA);
    psql(await sqlFile('2026-05-10-reject-late-auction-bid-trigger.sql'));
    const migration = await sqlFile('2026-11-07-2176-m2-auto-accept.sql');
    psql(migration);
    psql(migration);
    psql(await sqlFile('2026-11-07-6181-m3-market-commitment.sql'));
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

    const reset = ({ sellerCount = 20, buyerCount = 0, buyerBalance = 10000000 } = {}) => {
      psql(`TRUNCATE transfer_listing_price_log, auction_bids, auction_proxy_bids,
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
    const rounds = 10;
    for (let round = 0; round < rounds; round++) {
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
    t.diagnostic(`${version}; m3_enabled=true; scenarios=9; rounds_per_scenario=${rounds}; connections_per_round=8; ` +
      `attempted=${rounds * 9 * 8}; accepted=${rounds * 9}; rejected=${rounds * 9 * 7}; ` +
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
