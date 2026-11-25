import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { finalizeAuctionById } from "../auctionFinalization.js";
import { SCHEMA, ESCROW_SCHEMA } from "../__fixtures__/autoAccept2176Schema.js";

const PG_BIN = process.env.AUTO_ACCEPT_PG_BIN;
const id = number => "00000000-0000-0000-0000-" + String(number).padStart(12, "0");
const buyer = id(1);
const seller = id(2);
const rival = id(3);
const time = "2026-11-28T14:00:00Z";
const sql = name => readFileSync(new URL("../../../database/" + name, import.meta.url), "utf8");

function definition(source, name) {
  const start = source.indexOf("CREATE OR REPLACE FUNCTION public." + name + "(");
  const end = /^END;\s*\$\$;/m.exec(source.slice(start));
  assert.ok(start >= 0 && end, name);
  return source.slice(start, start + end.index + end[0].length);
}

// Run the real finalizer and payment RPCs, translating the fixture's PostgREST
// operations to the isolated PostgreSQL database.
function pgAuctionClient(query, beforeRpc = () => {}) {
  function literal(value) {
    if (value == null) return "NULL";
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    const text = typeof value === "object" ? JSON.stringify(value) : value;
    return "'" + text.replaceAll("'", "''") + "'";
  }
  return {
    async rpc(name, args) {
      beforeRpc(name);
      const parameters = Object.entries(args).map(([key, value]) => key + " => " + literal(value)).join(", ");
      return { data: JSON.parse(query(`SELECT to_jsonb(public.${name}(${parameters}));`)) };
    },
    from(table) {
      const filters = [];
      let count = false;
      let update;
      let remove = false;
      let order = "";
      let limit = "";
      function execute() {
        // Notifications and transfer-list bookkeeping are outside this fixture.
        if (!["auctions", "auction_bids", "riders", "seasons", "teams"].includes(table)) return { data: [] };
        const where = filters.length ? " WHERE " + filters.join(" AND ") : "";
        if (update || remove) {
          const assignment = update && Object.entries(update).map(([key, value]) => key + " = " + literal(value)).join(", ");
          const statement = remove ? `DELETE FROM ${table} AS row` : `UPDATE ${table} AS row SET ${assignment}`;
          try {
            return { data: JSON.parse(query(`WITH changed AS (${statement}${where} RETURNING id)
              SELECT coalesce(jsonb_agg(to_jsonb(changed)), '[]'::jsonb) FROM changed;`)) };
          } catch (error) {
            const match = /^ERROR:\s*(.+)$/m.exec(error.message);
            if (!match) throw error;
            return { error: { message: match[1] } };
          }
        }
        if (count) return { count: Number(query(`SELECT count(*) FROM ${table} AS row${where};`)) };
        const fields = table === "auctions"
          ? "to_jsonb(row) || jsonb_build_object('rider', (SELECT to_jsonb(r) FROM riders r WHERE r.id = row.rider_id))"
          : "to_jsonb(row)";
        return { data: JSON.parse(query(`SELECT coalesce(jsonb_agg(result), '[]'::jsonb)
          FROM (SELECT ${fields} AS result FROM ${table} AS row${where}${order}${limit}) selected;`)) };
      }
      return {
        select(_fields, options) { count = Boolean(options?.count); return this; },
        update(values) { update = values; return this; },
        delete() { remove = true; return this; },
        upsert() { return this; },
        insert() { return this; },
        eq(key, value) { filters.push(`row.${key} = ${literal(value)}`); return this; },
        neq(key, value) { filters.push(`row.${key} <> ${literal(value)}`); return this; },
        is(key, value) { filters.push(`row.${key} IS ${literal(value)}`); return this; },
        not(key, operator, value) { assert.equal(operator, "is"); filters.push(`row.${key} IS NOT ${literal(value)}`); return this; },
        in(key, values) { filters.push(`row.${key} IN (${values.map(literal).join(", ")})`); return this; },
        or(condition) {
          const terms = condition.split(",").map(term => {
            const [field, operator, value] = term.split(".");
            assert.equal(operator, "eq");
            return `row.${field} = ${literal(value)}`;
          });
          filters.push("(" + terms.join(" OR ") + ")");
          return this;
        },
        order(key, { ascending = true } = {}) { order = ` ORDER BY row.${key} ${ascending ? "ASC" : "DESC"}`; return this; },
        limit(size) { limit = ` LIMIT ${size}`; return this; },
        async maybeSingle() { return { data: execute().data[0] ?? null }; },
        async single() { return this.maybeSingle(); },
        then(resolve, reject) { return Promise.resolve().then(execute).then(resolve, reject); },
      };
    },
  };
}

test("PG17: independent market transactions cannot claim the same reserved place", {
  skip: !PG_BIN && "AUTO_ACCEPT_PG_BIN is not set", timeout: 300000,
}, async (t) => {
  const scratch = mkdtempSync(join(tmpdir(), "cz-8034-reservations-"));
  const data = join(scratch, "data");
  const socket = createServer();
  await new Promise((resolve, reject) => socket.once("error", reject).listen(0, "127.0.0.1", resolve));
  const { port } = socket.address();
  await new Promise(resolve => socket.close(resolve));
  const args = ["-X", "-qAt", "-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"];
  const env = { ...process.env, PGCLIENTENCODING: "UTF8" };
  const binary = name => join(PG_BIN, process.platform === "win32" ? name + ".exe" : name);
  const run = (name, command, input, expected = 0, expectedError) => {
    const result = spawnSync(binary(name), command, { input, encoding: "utf8", env, windowsHide: true, timeout: 60000 });
    assert.equal(result.status, expected, result.error?.message ?? result.stderr);
    if (expectedError) assert.match(result.stderr, expectedError);
    return result.stdout.trim();
  };
  const psql = input => run("psql", args, input);
  const snapshot = () => JSON.parse(psql(`
    SELECT jsonb_build_object(
      'balances',(SELECT jsonb_agg(row_to_json(t) ORDER BY id) FROM teams t),
      'payments',(SELECT count(*) FROM finance_transactions),
      'riders',(SELECT jsonb_agg(jsonb_build_array(id,team_id,pending_team_id,squad) ORDER BY id) FROM riders),
      'proxies',(SELECT jsonb_agg(jsonb_build_array(auction_id,team_id,max_amount) ORDER BY auction_id,team_id) FROM auction_proxy_bids),
      'auctions',(SELECT jsonb_agg(jsonb_build_array(id,current_bidder_id,current_price,status) ORDER BY id) FROM auctions),
      'bids',(SELECT count(*) FROM auction_bids));
  `));
  const open = (name) => {
    const child = spawn(binary("psql"), args, { env: { ...env, PGAPPNAME: name }, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    const done = new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", status => resolve({ status, stdout, stderr }));
    });
    return { child, done };
  };
  const reaches = async (application, event) => {
    for (let i = 0; i < 45; i += 1) {
      if (psql(`SELECT wait_event_type FROM pg_stat_activity WHERE application_name='${application}';`) === event) return true;
      await new Promise(resolve => setTimeout(resolve, 35));
    }
    return false;
  };
  const collision = async (firstSql, nextSql, verify) => {
    psql("UPDATE fixture_race_gate SET opened=false;");
    const first = open("cz8034_first");
    let second;
    try {
      first.child.stdin.end("SET statement_timeout='45s'; BEGIN;\n" + firstSql + "\nSELECT fixture_wait_for_release(); COMMIT;\n");
      assert.equal(await reaches("cz8034_first", "Timeout"), true, "first operation must already hold the lock");
      second = open("cz8034_second");
      second.child.stdin.end("SET statement_timeout='30s';\n" + nextSql);
      assert.equal(await reaches("cz8034_second", "Lock"), true, "second operation must reach the shared lock before the first commits");
      psql("UPDATE fixture_race_gate SET opened=true;");
      const committed = await first.done;
      assert.equal(committed.status, 0, committed.stderr);
      const denied = await second.done;
      assert.notEqual(denied.status, 0);
      assert.match(denied.stderr, /club_roster_full|squad_full/);
      verify(snapshot());
    } finally {
      psql("UPDATE fixture_race_gate SET opened=true;");
      await first.done;
      if (second) await second.done;
    }
  };

  assert.match(run("postgres", ["--version"]), /\b17\./);
  run("initdb", ["-D", data, "-U", "postgres", "-A", "trust", "-E", "UTF8", "--locale=C"]);
  let started = false;
  try {
    const server = spawnSync(binary("pg_ctl"), ["-D", data, "-l", join(scratch, "pg.log"), "-o",
      `-h 127.0.0.1 -p ${port}`, "-w", "start"], { stdio: "ignore", windowsHide: true, timeout: 30000 });
    assert.equal(server.status, 0);
    started = true;
    assert.match(psql("SHOW server_version;"), /^17\./);
    psql(SCHEMA + ESCROW_SCHEMA + `
      ALTER TABLE teams ADD COLUMN is_ai boolean DEFAULT false, ADD COLUMN is_bank boolean DEFAULT false;
      ALTER TABLE transfer_listings ADD COLUMN auto_accept_price bigint;
      ALTER TABLE auctions ADD COLUMN origin text, ADD COLUMN source_listing_id uuid, ADD COLUMN buyer_duration_minutes integer;
      ALTER TABLE auctions ADD COLUMN rider_market_value_at_close bigint, ADD COLUMN rider_base_value_at_close bigint;
      ALTER TABLE riders ADD COLUMN birthdate date, ADD COLUMN firstname text, ADD COLUMN lastname text,
        ADD COLUMN promotion_pending_to text, ADD COLUMN promotion_pending_since timestamptz,
        ADD COLUMN pending_academy_signing boolean;
      ALTER TABLE finance_transactions DROP CONSTRAINT finance_transactions_type_check;
      CREATE TABLE races(id uuid, race_type text, status text, stages_completed int);
      CREATE TABLE race_entries(race_id uuid, rider_id uuid, team_id uuid);
      CREATE TABLE sale_escrows(deal_type text, deal_id uuid);
      CREATE TABLE academy_intake(id uuid PRIMARY KEY, team_id uuid, rider_id uuid,
        status text, resolved_at timestamptz, signing_fee bigint);
      CREATE TABLE fixture_race_gate(opened boolean NOT NULL);
      INSERT INTO fixture_race_gate VALUES (false);
      CREATE FUNCTION fixture_wait_for_release() RETURNS void LANGUAGE plpgsql AS $$
        BEGIN
          WHILE NOT (SELECT opened FROM public.fixture_race_gate) LOOP
            PERFORM pg_sleep(0.05);
          END LOOP;
        END;
      $$;
      CREATE TABLE seasons(id uuid PRIMARY KEY, status text, number integer);
      INSERT INTO seasons VALUES ('${id(400)}','active',6);
      CREATE TABLE academy_graduation(rider_id uuid,team_id uuid,season_id uuid,from_squad text,to_squad text,
        status text,deadline timestamptz,resolved_at timestamptz,PRIMARY KEY(rider_id,season_id));
      CREATE FUNCTION auto_accept_lock_teams(uuid,uuid) RETURNS void LANGUAGE plpgsql AS $$
        BEGIN
          PERFORM pg_advisory_xact_lock(hashtextextended(least($1,$2)::text,0));
          PERFORM pg_advisory_xact_lock(hashtextextended(greatest($1,$2)::text,0));
        END;
      $$;
      CREATE FUNCTION market_transport_2176() RETURNS boolean LANGUAGE sql AS
        'SELECT EXISTS(SELECT 1 FROM public.app_config WHERE key=''fixture_atomic'' AND value=''true'')';
      CREATE FUNCTION market_beta_mode_2176() RETURNS boolean LANGUAGE sql AS 'SELECT true';
      CREATE FUNCTION market_scope_2176(uuid,uuid) RETURNS boolean LANGUAGE sql AS 'SELECT true';
      CREATE FUNCTION market_squad_max() RETURNS integer LANGUAGE sql AS 'SELECT 30';
      CREATE FUNCTION auto_accept_pair_2176(uuid,uuid) RETURNS boolean LANGUAGE sql AS 'SELECT true';
      CREATE FUNCTION auto_accept_outgoing_2176(uuid,uuid,text) RETURNS uuid[] LANGUAGE sql AS 'SELECT ARRAY[]::uuid[]';
      CREATE FUNCTION team_market_commitment(uuid,uuid) RETURNS bigint LANGUAGE sql AS 'SELECT 0::bigint';
      CREATE FUNCTION market_bid_issue_scoped_2176(uuid,uuid,bigint,boolean) RETURNS text LANGUAGE sql AS 'SELECT NULL::text';
      CREATE FUNCTION try_auction_proxy_tie_6181(uuid,uuid,bigint,uuid,timestamptz) RETURNS jsonb LANGUAGE plpgsql AS $$
        DECLARE v_message text := ''; BEGIN IF false THEN NULL;
        ELSIF v_message='market_gate_6181:squad_full' THEN NULL; END IF; RETURN '{}'::jsonb; END;
      $$;
    `);
    const finance = sql("2026-05-26-backend-message-codes.sql")
      .match(/CREATE OR REPLACE FUNCTION increment_balance_with_audit\([\s\S]*?\$\$ LANGUAGE plpgsql;/);
    assert.ok(finance);
    const payment = sql("2026-11-10-2176-transfer-payment-beta-scope.sql");
    psql(finance[0]+sql("2026-11-09-2176-m3-auto-accept-claim-swap.sql")+
      ["market_commitment_6181_bid_gate","place_auction_bid_6181","auto_accept_claim_swap_paid","start_auto_accept_auction_bid"].map(name => definition(payment,name)).join("\n"));
    psql(definition(sql("2026-09-24-5432-squad-caps-rpc.sql"), "finalize_academy_acquisition"));
    psql(sql("2026-05-10-reject-late-auction-bid-trigger.sql"));
    psql(sql("2026-05-10-reject-late-auction-bid-trigger.sql"));
    psql("CREATE TRIGGER trg_market_commitment_6181_bid BEFORE INSERT ON auction_bids FOR EACH ROW EXECUTE FUNCTION market_commitment_6181_bid_gate();");
    for (let i=0;i<2;i+=1) psql(sql("2026-11-24-7323-season-squad-promotion.sql")+sql("2026-11-24-8034-club-roster-cap.sql"));

    function reset(mode, cap) {
      const senior = cap === "club" ? 20 : 29;
      const youth = cap === "club" ? 39 : 1;
      psql(`
        TRUNCATE academy_intake,finance_transactions,auction_bids,auction_proxy_bids,auctions,transfer_listings,riders,teams,app_config,seasons;
        INSERT INTO seasons VALUES ('${id(400)}','active',6);
        INSERT INTO app_config VALUES ('fixture_atomic','${mode === "atomic"}'::jsonb,NULL);
        INSERT INTO teams(id,balance) VALUES ('${buyer}',100000),('${seller}',100000),('${rival}',100000);
        INSERT INTO riders(id,team_id,squad) SELECT gen_random_uuid(),'${buyer}','senior' FROM generate_series(1,${senior});
        INSERT INTO riders(id,team_id,squad,is_academy) SELECT gen_random_uuid(),'${buyer}',CASE WHEN n<=20 THEN 'u23' ELSE 'junior' END,true FROM generate_series(1,${youth}) n;
        INSERT INTO riders(id,team_id) VALUES ('${id(10)}','${seller}'),('${id(11)}','${seller}'),('${id(12)}','${seller}');
        INSERT INTO auctions(id,rider_id,seller_team_id,calculated_end) VALUES
          ('${id(20)}','${id(10)}','${seller}','2026-11-28T14:50Z'),
          ('${id(21)}','${id(11)}','${seller}','2026-11-28T14:50Z');
      `);
    }
    const bid = (mode, auction, team = buyer, amount = 200) => mode === "atomic"
      ? `SELECT place_auction_bid_6181('${auction}','${team}',${amount},'${time}');`
      : `INSERT INTO auction_bids(auction_id,team_id,amount,bid_time) VALUES ('${auction}','${team}',${amount},'${time}');`;
    const acquire = `UPDATE riders SET team_id='${buyer}' WHERE id='${id(12)}';`;
    const finalize = (beforeRpc) => finalizeAuctionById({
      supabase: pgAuctionClient(psql, beforeRpc), auctionId: id(20), notifyTeamOwner: async () => {},
      now: new Date("2026-11-28T15:10:00Z"),
    });
    const seniorSigning = (n, price = 200) => `public.finalize_academy_acquisition(
      '${buyer}', '${id(n)}', ${price}, 1000, 1, 6, '${time}',
      '${JSON.stringify({ type: "academy_signing", amount: -price,
        description: "fixture", idempotency_key: "academy_signing:" + id(n), academy_intake_id: id(n + 100) })}',
      'senior', 30)`;
    const seedOffer = n => psql(`
      INSERT INTO riders(id,squad,birthdate) VALUES ('${id(n)}','u23','2010-06-01');
      INSERT INTO academy_intake(id,team_id,rider_id,status) VALUES
        ('${id(n + 100)}','${buyer}','${id(n)}','offered');
    `);
    const resultOf = (n, price) => JSON.parse(psql(`SELECT ${seniorSigning(n, price)};`));

    await t.test("#8605: the installed youth RPC rejects senior before the migration", () => {
      reset("legacy", "senior");
      seedOffer(800);
      assert.deepEqual(resultOf(800), {ok: false, code: "invalid_squad"});
    });
    for (let i = 0; i < 2; i += 1) psql(sql("2026-11-25-8605-academy-intake-senior.sql"));

    await t.test("#8605: senior registration consumes one seat and one debit", () => {
      reset("legacy", "senior");
      psql(`INSERT INTO riders(id,team_id,squad,is_academy)
        SELECT gen_random_uuid(),'${buyer}','u23',true FROM generate_series(1,29);`);
      seedOffer(800);
      assert.equal(resultOf(800).ok, true);
      assert.equal(psql(`SELECT squad || ':' || is_academy FROM riders WHERE id='${id(800)}';`), "senior:false");
      assert.equal(psql(`SELECT status || ':' || signing_fee FROM academy_intake WHERE rider_id='${id(800)}';`), "signed:200");
      assert.equal(resultOf(800).code, "not_offered");
      assert.equal(psql("SELECT count(*) FROM finance_transactions;"), "1");
      assert.equal(psql(`SELECT balance FROM teams WHERE id='${buyer}';`), "99800");
    });

    await t.test("#8605: a free signing cannot be replayed into a freed youth seat", () => {
      reset("legacy", "senior");
      seedOffer(800);
      assert.equal(resultOf(800, 0).ok, true);
      const replay = seniorSigning(800, 0).replace("'senior', 30", "'u23', 30");
      assert.equal(JSON.parse(psql(`SELECT ${replay};`)).code, "not_offered");
      const oldBackend = replay.replace(/,"academy_intake_id":"[^"]+"/, "");
      assert.equal(JSON.parse(psql(`SELECT ${oldBackend};`)).code, "not_offered");
      run("psql", args, `UPDATE academy_intake SET status='rejected' WHERE rider_id='${id(800)}';`, 3, /not_offered/);
      assert.equal(psql(`SELECT status FROM academy_intake WHERE rider_id='${id(800)}';`), "signed");
      assert.equal(psql(`SELECT squad FROM riders WHERE id='${id(800)}';`), "senior");
      assert.equal(psql("SELECT count(*) FROM finance_transactions;"), "0");
    });

    await t.test("#8605: a leading auction protects the final senior seat", () => {
      reset("legacy", "senior");
      psql(bid("legacy", id(20)));
      seedOffer(800);
      assert.equal(resultOf(800).code, "academy_full");
      assert.equal(psql(`SELECT status FROM academy_intake WHERE rider_id='${id(800)}';`), "offered");
      assert.equal(psql("SELECT count(*) FROM finance_transactions;"), "0");
    });

    await t.test("#8605: a full club rejects intake with no payment or status change", () => {
      reset("legacy", "club");
      psql(`INSERT INTO riders(id,team_id,squad,is_academy)
        VALUES (gen_random_uuid(),'${buyer}','junior',true);`);
      seedOffer(800);
      run("psql", args, `SELECT ${seniorSigning(800)};`, 3, /club_roster_full/);
      assert.equal(psql(`SELECT status FROM academy_intake WHERE rider_id='${id(800)}';`), "offered");
      assert.equal(psql("SELECT count(*) FROM finance_transactions;"), "0");
    });

    await t.test("#8605: two intakes contend for the same last senior place", async () => {
      reset("legacy", "senior");
      seedOffer(800);
      seedOffer(801);
      await collision(`SELECT ${seniorSigning(800)};`, `DO $$ BEGIN
        IF (${seniorSigning(801)})->>'code' = 'academy_full' THEN
          RAISE EXCEPTION 'squad_full';
        END IF;
      END $$;`, state => {
        assert.equal(state.payments, 1);
        assert.equal(psql("SELECT count(*) FROM academy_intake WHERE status='signed';"), "1");
      });
    });

    function openYouthAuction() {
      psql(`
        UPDATE riders SET team_id=NULL,birthdate='2012-04-20',firstname='Fixture',lastname='Winner' WHERE id='${id(10)}';
        UPDATE auctions SET is_youth=true,seller_team_id=NULL WHERE id='${id(20)}';
      `);
    }
    for (const mode of ["legacy","atomic"]) {
      for (const boundary of ["season gap", "aging after the bid", "turning 23", "old lead without a reservation"]) {
        await t.test(`${mode}: youth settlement protects the final U23 place at ${boundary}`, async () => {
          reset(mode, "senior");
          openYouthAuction();
          psql(`
            UPDATE riders SET squad='senior',is_academy=false WHERE team_id='${buyer}' AND squad='u23';
            INSERT INTO riders(id,team_id,squad,is_academy)
              SELECT gen_random_uuid(),'${buyer}','u23',true FROM generate_series(1,29);
            ${boundary === "season gap" ? `UPDATE seasons SET status='upcoming'; INSERT INTO seasons VALUES ('${id(401)}','completed',5);` : ""}
            ${["aging after the bid", "turning 23"].includes(boundary) ? "UPDATE seasons SET number=5;" : ""}
            ${boundary === "turning 23" ? `UPDATE riders SET birthdate='2008-04-20' WHERE id='${id(10)}';` : ""}
          `);
          const releaseSenior = `UPDATE riders SET team_id='${seller}' WHERE id=(
            SELECT id FROM riders WHERE team_id='${buyer}' AND squad='senior' ORDER BY id LIMIT 1);`;
          if (boundary === "old lead without a reservation") {
            // Legacy youth must fall back to U23 even when senior has a
            // physically free place already committed to another auction.
            psql(releaseSenior);
            psql(bid(mode, id(21)));
            psql(`ALTER TABLE auctions DISABLE TRIGGER enforce_club_opening_bid_cap_8034;`);
            psql(bid(mode, id(20)));
            psql(`ALTER TABLE auctions ENABLE TRIGGER enforce_club_opening_bid_cap_8034;`);
            assert.equal(psql(`SELECT reservation_squad IS NULL FROM auctions WHERE id='${id(20)}';`), "t");
          } else {
            psql(bid(mode, id(20)));
          }
          if (["aging after the bid", "turning 23"].includes(boundary)) psql("UPDATE seasons SET number=6;");
          const count = psql(`SELECT auction_reserved_places_8034('${buyer}','u23');`);
          const routeFunction = psql("SELECT to_regprocedure('public.market_leading_auctions_8034(uuid)') IS NOT NULL;");
          const bidRouteSquad = routeFunction === "t"
            ? psql(`SELECT reservation_squad FROM market_leading_auctions_8034('${buyer}') WHERE id='${id(20)}';`)
            : null;
          if (boundary !== "old lead without a reservation") psql(releaseSenior);
          const before = snapshot();
          let denied = false;
          try {
            psql(`UPDATE riders SET team_id='${buyer}',squad='u23',is_academy=true WHERE id='${id(12)}';`);
          } catch (error) {
            assert.match(error.message, /academy_full|club_roster_full/);
            assert.deepEqual(snapshot(), before);
            denied = true;
          }
          const result = await finalize();
          assert.deepEqual(
            { reserved: count, denied, code: result.code },
            { reserved: "1", denied: true, code: "youth_completed" },
          );
          assert.equal(bidRouteSquad, "u23");
          const settled = snapshot();
          assert.deepEqual(settled.riders.find(r => r[0] === id(10)).slice(1), [buyer, null, "u23"]);
          assert.equal(settled.payments, 1);
          assert.equal(settled.balances.find(team => team.id === buyer).balance, 99800);
          assert.equal((await finalize()).code, "already_completed");
          assert.deepEqual(snapshot(), settled);
        });
      }
      await t.test(`${mode}: youth senior settlement charges a rider already delivered before an interrupted debit`, async () => {
        reset(mode, "club");
        openYouthAuction();
        psql(bid(mode, id(20)));
        await assert.rejects(finalize(name => {
          if (name === "increment_balance_with_audit") throw new Error("fixture: interrupted before debit");
        }), /interrupted before debit/);
        const interrupted = snapshot();
        assert.equal(interrupted.payments, 0);
        assert.deepEqual(interrupted.riders.find(r => r[0] === id(10)).slice(1), [buyer, null, "senior"]);
        assert.equal((await finalize()).code, "youth_completed_senior");
        const settled = snapshot();
        assert.equal(settled.payments, 1);
        assert.equal(settled.balances.find(team => team.id === buyer).balance, 99800);
        assert.equal((await finalize()).code, "already_completed");
        assert.deepEqual(snapshot(), settled);
      });
      for (const registration of ["deferred", "partially registered"]) {
        await t.test(`${mode}: youth senior settlement consumes a reserved place after a ${registration} balanced swap`, async () => {
          const partiallyRegistered = registration === "partially registered";
          reset(mode, partiallyRegistered ? "senior" : "club");
          openYouthAuction();
          psql(bid(mode, id(20)));
          const outgoing = psql(`SELECT id FROM riders WHERE team_id='${buyer}' AND squad='senior' ORDER BY id LIMIT 1;`);
          const args = `'${outgoing}','${id(12)}','${buyer}','${seller}',true,'${time}','{}','{}'`;
          const swap = mode === "atomic"
            ? `auto_accept_claim_swap_paid(${args},'${id(48)}',0,'{}')`
            : `auto_accept_claim_swap(${args})`;
          assert.equal(JSON.parse(psql(`SELECT ${swap};`)).status, "claimed");
          assert.equal(psql(`SELECT pending_team_id FROM riders WHERE id='${outgoing}';`), seller);
          assert.equal(psql(`SELECT pending_team_id FROM riders WHERE id='${id(12)}';`), buyer);
          if (partiallyRegistered) {
            psql(`UPDATE riders SET team_id=pending_team_id,pending_team_id=NULL WHERE id='${id(12)}';`);
            assert.equal(psql(`SELECT count(*) FROM riders WHERE team_id='${buyer}' AND squad='senior';`), "30");
            const before = snapshot();
            assert.throws(() => psql(`UPDATE riders SET team_id='${buyer}' WHERE id='${id(11)}';`), /squad_full/);
            assert.deepEqual(snapshot(), before);
          }
          assert.equal((await finalize()).code, "youth_completed_senior");
          const settled = snapshot();
          assert.deepEqual(settled.riders.find(r => r[0] === id(10)).slice(1), [buyer, null, "senior"]);
          assert.equal(settled.payments, 1);
          assert.equal(settled.balances.find(team => team.id === buyer).balance, 99800);
        });
      }
      for (const cap of ["club","senior"]) {
        await t.test(`${mode}/${cap}: bidder and acquisition compete in both orders`,async () => {
          for (const bidFirst of [true,false]) {
            reset(mode,cap);
            const before=snapshot();
            await collision(bidFirst ? bid(mode,id(20)) : acquire,bidFirst ? acquire : bid(mode,id(20)),after=>{
              assert.deepEqual(after.balances,before.balances);
              assert.equal(after.payments,0);
              assert.equal(after.bids,bidFirst?1:0);
              assert.equal(after.auctions[0][1],bidFirst?buyer:null);
              assert.equal(after.riders.find(r=>r[0]===id(12))[1],bidFirst?seller:buyer);
            });
          }
        });
        await t.test(`${mode}/${cap}: two auctions compete in both orders`,async () => {
          for (const first of [id(20),id(21)]) {
            reset(mode,cap);
            const before=snapshot();
            const other=first===id(20)?id(21):id(20);
            await collision(bid(mode,first),bid(mode,other),after=>{
              assert.deepEqual(after.riders,before.riders);
              assert.deepEqual(after.balances,before.balances);
              assert.equal(after.payments,0);
              assert.equal(after.bids,1);
              assert.equal(after.auctions.find(a=>a[0]===first)[1],buyer);
              assert.equal(after.auctions.find(a=>a[0]===other)[1],null);
            });
          }
        });
      }

      await t.test(`${mode}: a balanced cash swap works at and above the senior cap`,()=>{
        for (const seniors of [30,31]) {
          reset(mode,"senior");
          psql(`UPDATE riders SET squad='senior',is_academy=false WHERE team_id='${buyer}' AND squad='u23';`);
          if (seniors===31) {
            psql(`INSERT INTO riders(id,team_id,squad,is_academy) VALUES ('${id(30)}','${buyer}','junior',true);
              SELECT promote_season_squads_7323('${id(400)}','2026-11-28T15:00:00Z',
                jsonb_build_array(jsonb_build_object('rider_id','${id(30)}','team_id','${buyer}','from_squad','junior','to_squad','senior')));`);
          }
          const outgoing = psql(`SELECT id FROM riders WHERE team_id='${buyer}' AND squad='senior' ORDER BY id LIMIT 1;`);
          const deal=id(48);
          const p = { type:"transfer_out",amount:-100,description:"fixture",idempotency_key:"swap_payer:"+deal };
          const q = { type:"transfer_in",amount:100,description:"fixture",idempotency_key:"swap_receiver:"+deal };
          const args=`'${outgoing}','${id(12)}','${buyer}','${seller}',false,'${time}','{}','{}'`;
          if (mode==="atomic") {
            const payload=JSON.stringify({payer_team_id:buyer,payee_team_id:seller,amount:100,payer_payload:p,payee_payload:q});
            const result=JSON.parse(psql(`SELECT auto_accept_claim_swap_paid(${args},'${deal}',100,'${payload}');`));
            assert.equal(result.status,"claimed");
            assert.equal(result.payment_handled,true);
          } else {
            assert.equal(JSON.parse(psql(`SELECT auto_accept_claim_swap(${args});`)).status,"claimed");
            psql(`SELECT increment_balance_with_audit('${buyer}',-100,'${JSON.stringify(p)}');
              SELECT increment_balance_with_audit('${seller}',100,'${JSON.stringify(q)}');`);
          }
          const state=snapshot();
          assert.equal(state.riders.filter(r=>r[1]===buyer && r[3]==="senior").length,seniors);
          assert.equal(state.riders.find(r=>r[0]===id(12))[1],buyer);
          assert.equal(state.riders.find(r=>r[0]===outgoing)[1],seller);
          assert.equal(state.payments,2);
          assert.equal(state.balances.find(team=>team.id===buyer).balance,99900);
        }
      });
      await t.test(`${mode}: a senior reservation leaves an available youth place usable`,()=>{
        reset(mode,"senior");
        psql(bid(mode,id(20)));
        psql(`UPDATE riders SET team_id='${buyer}',squad='u23',is_academy=true WHERE id='${id(12)}';`);
        assert.equal(snapshot().riders.find(r=>r[0]===id(12))[1],buyer);
      });
      await t.test(`${mode}: a youth reservation leaves the last senior auto-accept place usable`,()=>{
        reset(mode,"senior");
        psql(`UPDATE riders SET squad='senior',is_academy=false WHERE team_id='${buyer}' AND squad='u23';
          UPDATE auctions SET is_youth=true WHERE id='${id(20)}';`);
        psql(bid(mode,id(20)));
        assert.equal(psql(`SELECT reservation_squad FROM auctions WHERE id='${id(20)}';`),"junior");
        psql(`UPDATE riders SET team_id='${seller}' WHERE id=(SELECT id FROM riders WHERE team_id='${buyer}' AND squad='senior' LIMIT 1);
          INSERT INTO transfer_listings(id,rider_id,seller_team_id,asking_price,auto_accept_price) VALUES ('${id(22)}','${id(12)}','${seller}',200,200);`);
        const outcome=JSON.parse(psql(`SELECT start_auto_accept_auction_bid(
          '${id(22)}','${buyer}','${id(12)}','${seller}','{"market_value":1000000,"base_value":1000000,"prize_earnings_bonus":0}',
          200,30,'2026-11-28T14:30Z',30,0,'{}','${time}');`));
        assert.equal(outcome.status,"started");
        assert.equal(psql(`SELECT reservation_squad FROM auctions WHERE id='${outcome.auction_id}';`),"senior");
      });
      await t.test(`${mode}: the existing cutover allowance survives settlement`,()=>{
        reset(mode,"senior");
        psql(bid(mode,id(20)));
        const promoted=psql(`SELECT id FROM riders WHERE team_id='${buyer}' AND squad='u23';`);
        const reserved=snapshot();
        assert.throws(()=>psql(`UPDATE riders SET squad='senior' WHERE id='${promoted}';`),/squad_full/);
        assert.deepEqual(snapshot(),reserved);
        psql(`SELECT promote_season_squads_7323('${id(400)}','2026-11-28T15:00:00Z',
          jsonb_build_array(jsonb_build_object('rider_id','${promoted}','team_id','${buyer}','from_squad','u23','to_squad','senior')));`);
        assert.equal(psql(`SELECT auction_promotion_allowance_7323('${id(20)}','${buyer}','senior');`),"1");
        const before=snapshot();
        assert.throws(()=>psql(acquire),/squad_full/);
        assert.deepEqual(snapshot(),before);
        psql(`UPDATE riders SET team_id='${buyer}' WHERE id='${id(10)}';`);
        const after=snapshot();
        assert.equal(after.riders.filter(r=>r[1]===buyer && r[3]==="senior").length,31);
      });
      await t.test(`${mode}: a winner uses its own reservation, and an outbid club can use the released place`,()=>{
        reset(mode,"club");
        psql(bid(mode,id(20)));
        psql(`UPDATE riders SET team_id='${buyer}' WHERE id='${id(10)}';
          SELECT increment_balance_with_audit('${buyer}',-200,'{"type":"transfer_out","amount":-200,"idempotency_key":"fixture-winner"}');
          UPDATE auctions SET status='completed' WHERE id='${id(20)}';
          DO $retry$ BEGIN
            PERFORM increment_balance_with_audit('${buyer}',-200,'{"type":"transfer_out","amount":-200,"idempotency_key":"fixture-winner"}');
            RAISE EXCEPTION 'duplicate debit unexpectedly committed';
          EXCEPTION WHEN unique_violation THEN NULL; END $retry$;`);
        const won=snapshot();
        assert.equal(won.payments,1);
        assert.equal(won.riders.find(r=>r[0]===id(10))[1],buyer);
        assert.equal(won.balances.find(team=>team.id===buyer).balance,99800);
        reset(mode,"club");
        psql(bid(mode,id(20))+bid(mode,id(20),rival,300)+acquire);
        assert.equal(snapshot().riders.find(r=>r[0]===id(12))[1],buyer);
      });
    }
    await t.test("legacy: the second proxy opening cannot steal a tied lead or leave a proxy row",()=>{
      reset("legacy","club");
      const opening=(team,max)=>`SELECT set_legacy_proxy_opening_bid_8034('${id(20)}','${team}',${max},200,'${time}');`;
      psql(opening(buyer,300));
      const before=snapshot();
      assert.throws(()=>psql(opening(rival,200)),/price_changed/);
      assert.deepEqual(snapshot(),before);
      psql(bid("legacy",id(20),rival,300));
      psql(`SELECT match_legacy_auction_proxy_tie_8034('${id(20)}','${buyer}',300,'${rival}','${time}');`);
      assert.deepEqual(snapshot().auctions[0].slice(1,3),[buyer,300]);
    });
  } finally {
    if (started) {
      run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
      run("pg_ctl", ["-D", data, "status"], undefined, 3);
      t.diagnostic("temporary_pg17_server_stopped=true");
    }
  }
});
