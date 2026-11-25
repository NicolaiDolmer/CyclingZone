import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const uuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const S5 = uuid(5), S6 = uuid(6), CLUB = uuid(10), BUYER = uuid(11);
const JUNIOR = uuid(20), U23 = uuid(21), SOLD = uuid(22), STAYS = uuid(23);
const EXISTING_WIN = uuid(40), NEW_BID = uuid(41);
const CUTOVER = "2026-11-28T15:00:00Z";
const swapMigration = readFileSync(new URL("../../../database/2026-11-09-2176-m3-auto-accept-claim-swap.sql", import.meta.url), "utf8");
const commitmentMigration = readFileSync(new URL("../../../database/2026-11-07-6181-m3-market-commitment.sql", import.meta.url), "utf8");
const seatCommitment = commitmentMigration.slice(
  commitmentMigration.indexOf("CREATE OR REPLACE FUNCTION public.team_seat_commitment("),
  commitmentMigration.indexOf("-- Holdets egne senior-ryttere"),
);
const paymentMigration = readFileSync(new URL("../../../database/2026-11-10-2176-transfer-payment-beta-scope.sql", import.meta.url), "utf8");
const paidSwap = paymentMigration.slice(
  paymentMigration.indexOf("CREATE OR REPLACE FUNCTION public.auto_accept_claim_swap_paid("),
  paymentMigration.indexOf("-- The assignment and its existing travel debit"),
);
const clubMigration = readFileSync(new URL("../../../database/2026-11-24-8034-club-roster-cap.sql", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../../database/2026-11-24-7323-season-squad-promotion.sql", import.meta.url), "utf8");

test("cutover promotes despite full squads and open sales, closes old rows, and replays from committed history", async (t) => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role;
      CREATE TABLE teams (id uuid PRIMARY KEY, is_ai boolean DEFAULT false, is_bank boolean DEFAULT false);
      INSERT INTO teams (id) VALUES ('${CLUB}'), ('${BUYER}');
      CREATE TABLE seasons (id uuid PRIMARY KEY, status text, number integer);
      CREATE TABLE riders (
        id uuid PRIMARY KEY, team_id uuid, pending_team_id uuid, squad text, is_academy boolean, is_retired boolean DEFAULT false,
        firstname text, lastname text, salary integer, contract_end_season integer, birthdate date,
        promotion_pending_to text, promotion_pending_since timestamptz, acquired_at timestamptz, updated_at timestamptz
      );
      CREATE TABLE academy_graduation (
        rider_id uuid, team_id uuid, season_id uuid, status text, from_squad text, to_squad text,
        deadline timestamptz, resolved_at timestamptz, PRIMARY KEY (rider_id, season_id)
      );
      CREATE TABLE auctions (id uuid PRIMARY KEY, rider_id uuid, status text, current_price integer, current_bidder_id uuid, is_youth boolean DEFAULT false);
      CREATE TABLE auction_bids (auction_id uuid, team_id uuid, bid_time timestamptz, amount integer, is_proxy boolean DEFAULT false);
      CREATE TABLE transfer_listings (rider_id uuid, asking_price integer);
      CREATE FUNCTION auto_accept_lock_teams(uuid, uuid) RETURNS void LANGUAGE plpgsql AS $fixture$
      BEGIN
        PERFORM pg_advisory_xact_lock(hashtextextended(least($1, $2)::text, 0));
        PERFORM pg_advisory_xact_lock(hashtextextended(greatest($1, $2)::text, 0));
      END; $fixture$;
      CREATE FUNCTION market_transport_2176() RETURNS boolean LANGUAGE sql AS 'SELECT false';
      CREATE FUNCTION market_beta_mode_2176() RETURNS boolean LANGUAGE sql AS 'SELECT true';
      CREATE FUNCTION market_scope_2176(uuid, uuid) RETURNS boolean LANGUAGE sql AS 'SELECT true';
      CREATE FUNCTION market_squad_max() RETURNS integer LANGUAGE sql AS 'SELECT 30';
      INSERT INTO seasons VALUES ('${S5}', 'completed', 5), ('${S6}', 'active', 6);
      INSERT INTO riders (id, team_id, squad, is_academy, firstname, lastname, salary, contract_end_season, promotion_pending_to)
      VALUES ('${JUNIOR}', '${CLUB}', 'junior', true, 'Junior', 'Rider', 4000, 8, 'u23'),
             ('${U23}', '${CLUB}', 'u23', true, 'Older', 'Rider', 6000, 7, NULL),
             ('${SOLD}', '${BUYER}', 'u23', true, 'Sold', 'Rider', 5000, 8, NULL),
             ('${STAYS}', '${CLUB}', 'junior', true, 'Stays', 'Rider', 4000, 8, 'u23');
      INSERT INTO riders (id, team_id, squad, is_academy)
      SELECT gen_random_uuid(), '${CLUB}', 'senior', false FROM generate_series(1, 30);
      INSERT INTO riders (id, team_id, squad, is_academy)
      SELECT gen_random_uuid(), '${CLUB}', 'u23', true FROM generate_series(1, 30);
      INSERT INTO academy_graduation (rider_id, team_id, season_id, status)
      VALUES ('${JUNIOR}', '${CLUB}', '${S5}', 'pending'),
             ('${U23}', '${CLUB}', '${S5}', 'sold'),
             ('${SOLD}', '${CLUB}', '${S5}', 'pending'),
             ('${STAYS}', '${CLUB}', '${S5}', 'pending');
      INSERT INTO auctions VALUES ('${EXISTING_WIN}', '${U23}', 'active', 65000, '${CLUB}'),
                                  ('${NEW_BID}', '${JUNIOR}', 'active', 30000, '${CLUB}');
      INSERT INTO auction_bids VALUES
        ('${EXISTING_WIN}', '${CLUB}', '2026-11-28T14:00:00Z'),
        ('${NEW_BID}', '${CLUB}', '2026-11-28T16:00:00Z');
      INSERT INTO transfer_listings VALUES ('${JUNIOR}', 10000);
    `);
    await db.exec(swapMigration);
    await db.exec(seatCommitment);
    await db.exec(paidSwap);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await db.exec(migration);
      await db.exec(clubMigration);
    }
    const requested = [
      { rider_id: JUNIOR, team_id: CLUB, from_squad: "junior", to_squad: "u23" },
      { rider_id: U23, team_id: CLUB, from_squad: "u23", to_squad: "senior" },
      { rider_id: SOLD, team_id: CLUB, from_squad: "u23", to_squad: "senior" },
    ];
    const advance = (moves) => db.query("SELECT * FROM promote_season_squads_7323($1,$2,$3)",
      [S6, CUTOVER, JSON.stringify(moves)]);
    const result = await advance(requested);
    assert.deepEqual(result.rows.map(({ rider_id }) => rider_id), [JUNIOR, U23]);
    assert.deepEqual((await advance([])).rows, result.rows);
    assert.deepEqual((await db.query("SELECT squad, count(*)::int AS riders FROM riders WHERE team_id=$1 GROUP BY squad ORDER BY squad", [CLUB])).rows,
      [{ squad: "junior", riders: 1 }, { squad: "senior", riders: 31 }, { squad: "u23", riders: 31 }]);
    assert.deepEqual((await db.query("SELECT rider_id,status FROM academy_graduation WHERE season_id=$1 ORDER BY rider_id", [S5])).rows,
      [{ rider_id: JUNIOR, status: "promoted" }, { rider_id: U23, status: "sold" },
        { rider_id: SOLD, status: "expired" }, { rider_id: STAYS, status: "expired" }]);
    assert.deepEqual((await db.query("SELECT squad,is_academy,salary,contract_end_season FROM riders WHERE id=$1", [U23])).rows,
      [{ squad: "senior", is_academy: false, salary: 6000, contract_end_season: 7 }]);
    assert.deepEqual((await db.query("SELECT rider_id,status,current_price FROM auctions WHERE id=$1", [EXISTING_WIN])).rows,
      [{ rider_id: U23, status: "active", current_price: 65000 }]);
    const allowance = async (auctionId, teamId, squad) => (
      await db.query("SELECT auction_promotion_allowance_7323($1,$2,$3) AS places", [auctionId, teamId, squad])
    ).rows[0].places;
    assert.equal(await allowance(EXISTING_WIN, CLUB, "senior"), 1);
    assert.equal(await allowance(EXISTING_WIN, CLUB, "u23"), 1);
    assert.equal(await allowance(EXISTING_WIN, BUYER, "senior"), 0);
    assert.equal(await allowance(NEW_BID, CLUB, "senior"), 0);
    assert.deepEqual((await db.query("SELECT * FROM transfer_listings")).rows,
      [{ rider_id: JUNIOR, asking_price: 10000 }]);
    const buy = (column) => db.query(`INSERT INTO riders(id, ${column}, squad, is_academy) VALUES (gen_random_uuid(), $1, 'junior', true)`, [CLUB]);
    await assert.rejects(buy("team_id"), /club_roster_full/);
    await assert.rejects(buy("pending_team_id"), /club_roster_full/);
    await assert.rejects(db.query("SELECT auto_accept_claim_swap($1,$2,$3,$4,false,$5,'{}','{}')",
      [STAYS, SOLD, CLUB, BUYER, CUTOVER]), /club_roster_full/);
    assert.deepEqual((await db.query("SELECT id,team_id FROM riders WHERE id IN ($1,$2) ORDER BY id", [STAYS, SOLD])).rows,
      [{ id: SOLD, team_id: BUYER }, { id: STAYS, team_id: CLUB }]);
    await db.query("UPDATE riders SET team_id=$1 WHERE id IN (SELECT id FROM riders WHERE team_id=$2 AND squad='senior' LIMIT 4)", [BUYER, CLUB]);
    // Use a rider outside the club for the now-live reservation. The
    // earlier fixture reuses an owned rider only for the promotion allowance.
    await db.query("UPDATE auctions SET rider_id=$1 WHERE id=$2", [uuid(70), EXISTING_WIN]);
    const openAuction = () => db.query("INSERT INTO auctions(id,status,current_bidder_id) VALUES (gen_random_uuid(), 'active', $1)", [CLUB]);
    await assert.rejects(openAuction(), /club_roster_full/);
    await db.query("UPDATE auctions SET status = 'completed' WHERE current_bidder_id=$1", [CLUB]);
    await openAuction();
    await assert.rejects(openAuction(), /club_roster_full/);
    await assert.rejects(buy("team_id"), /club_roster_full/);
    await db.query("UPDATE auctions SET status='completed' WHERE current_bidder_id=$1", [CLUB]);
    await buy("team_id");
    await assert.rejects(buy("team_id"), /club_roster_full/);
    await db.query("UPDATE riders SET squad = 'junior' WHERE id = $1", [SOLD]);
    await db.query(
      "INSERT INTO riders(id, team_id, squad, is_academy) SELECT gen_random_uuid(), $1, CASE WHEN n <= 29 THEN 'junior' ELSE 'senior' END, n <= 29 FROM generate_series(1, 60 - (SELECT count(*)::int FROM riders WHERE team_id=$1)) n",
      [BUYER],
    );
    await db.query("UPDATE riders SET squad = 'senior', is_academy = false WHERE id IN (SELECT id FROM riders WHERE team_id=$1 AND squad='u23' LIMIT 3)", [CLUB]);
    const swap = (offered, requested, defer) => db.query(
      "SELECT auto_accept_claim_swap($1,$2,$3,$4,$5,$6,'{}','{}') AS result",
      [offered, requested, CLUB, BUYER, defer, CUTOVER],
    );
    const pickSeniors = (teamId) => db.query(
      "SELECT id FROM riders WHERE team_id=$1 AND squad='senior' ORDER BY id LIMIT 2", [teamId],
    ).then(({ rows }) => rows.map(({ id }) => id));
    const clubSeniors = await pickSeniors(CLUB);
    const buyerSeniors = await pickSeniors(BUYER);
    const placeSwap = async (paid, pair, deferred) => {
      const args = [clubSeniors[pair], buyerSeniors[pair], CLUB, BUYER, deferred, CUTOVER];
      const result = paid
        ? await db.query("SELECT auto_accept_claim_swap_paid($1,$2,$3,$4,$5,$6,'{}','{}',$7,0,NULL) AS result", [...args, uuid(100 + pair)])
        : await swap(args[0], args[1], deferred);
      assert.equal(result.rows[0].result.status, "claimed");
      if (paid) assert.equal(result.rows[0].result.payment_handled, true);
    };
    for (const paid of [false, true]) {
      const mode = paid ? "atomic payment" : "legacy";
      await t.test(`second balanced swap before flush in ${mode} mode`, async () => {
        await db.exec("BEGIN");
        try {
          await placeSwap(paid, 0, true);
          await placeSwap(paid, 1, true);
          assert.deepEqual((await db.query(
            "SELECT count(*)::int AS count FROM riders WHERE pending_team_id IS NOT NULL GROUP BY pending_team_id ORDER BY pending_team_id",
          )).rows, [{ count: 2 }, { count: 2 }]);
          const { rows: [freshSenior] } = await db.query(
            "SELECT id FROM riders WHERE team_id=$1 AND squad='senior' AND pending_team_id IS NULL LIMIT 1", [BUYER],
          );
          await db.query("SAVEPOINT pending_swap");
          await assert.rejects(swap(STAYS, freshSenior.id, true), /swap_pending_registration/);
          await db.query("ROLLBACK TO SAVEPOINT pending_swap");
          assert.equal((await db.query("SELECT pending_team_id FROM riders WHERE id=$1", [STAYS])).rows[0].pending_team_id, null);
          await db.query("SAVEPOINT purchase");
          await assert.rejects(buy("team_id"), /club_roster_full/);
          await db.query("ROLLBACK TO SAVEPOINT purchase");
        } finally {
          await db.exec("ROLLBACK");
        }
      });
      for (const deferred of [false, true]) {
        await t.test(`senior replacement above the squad cap in ${mode} mode (deferred=${deferred})`, async () => {
          await db.exec("BEGIN");
          try {
            const count = () => db.query(
              "SELECT count(*)::int AS count FROM riders WHERE coalesce(pending_team_id,team_id)=$1 AND squad='senior'",
              [CLUB],
            );
            const { rows: [eligible] } = await db.query("SELECT id FROM riders WHERE team_id=$1 AND squad='u23' LIMIT 1", [CLUB]);
            await advance([{ rider_id: eligible.id, team_id: CLUB, from_squad: "u23", to_squad: "senior" }]);
            assert.deepEqual((await count()).rows, [{ count: 31 }]);
            await placeSwap(paid, 0, deferred);
            assert.deepEqual((await count()).rows, [{ count: 31 }]);
          } finally {
            await db.exec("ROLLBACK");
          }
        });
      }
    }

    await t.test("both swap paths protect the reserved senior place", async () => {
      await db.exec("BEGIN");
      try {
        // Club has 29 seniors and one reserved auction place. Buyer has room
        // for the outgoing junior, so only the senior reservation can block it.
        await db.query("UPDATE riders SET team_id=NULL WHERE id=$1", [clubSeniors[1]]);
        await db.query("UPDATE riders SET squad='u23' WHERE id=$1", [SOLD]);
        await db.query("INSERT INTO auctions(id,status,current_bidder_id) VALUES (gen_random_uuid(), 'active', $1)", [CLUB]);
        for (const paid of [false, true]) {
          await db.exec("SAVEPOINT growth_swap");
          const claim = paid
            ? () => db.query(
              "SELECT auto_accept_claim_swap_paid($1,$2,$3,$4,false,$5,'{}','{}',$6,0,NULL)",
              [STAYS, buyerSeniors[0], CLUB, BUYER, CUTOVER, uuid(120)],
            )
            : () => swap(STAYS, buyerSeniors[0], false);
          await assert.rejects(claim(), /swap_destination_squad_full/);
          await db.exec("ROLLBACK TO SAVEPOINT growth_swap");
        }
        assert.deepEqual((await db.query("SELECT team_id,pending_team_id FROM riders WHERE id=$1", [STAYS])).rows,
          [{ team_id: CLUB, pending_team_id: null }]);
        assert.deepEqual((await db.query("SELECT team_id,pending_team_id FROM riders WHERE id=$1", [buyerSeniors[0]])).rows,
          [{ team_id: BUYER, pending_team_id: null }]);
      } finally {
        await db.exec("ROLLBACK");
      }
    });

    const otherTeam = uuid(66);
    await db.query("INSERT INTO teams (id) VALUES ($1)", [otherTeam]);
    // An unrelated departure has not created an extra senior place for this swap.
    await db.query("UPDATE riders SET pending_team_id = $1 WHERE id = (SELECT id FROM riders WHERE team_id=$2 AND squad='senior' LIMIT 1)", [otherTeam, CLUB]);
    const { rows: [senior] } = await db.query("SELECT id FROM riders WHERE team_id=$1 AND squad='senior' LIMIT 1", [BUYER]);
    for (const defer of [false, true]) {
      await assert.rejects(db.query(
        "SELECT auto_accept_claim_swap($1,$2,$3,$4,$5,$6,$7,'{}')",
        [STAYS, senior.id, CLUB, BUYER, defer, CUTOVER, JSON.stringify({ squad: "senior", is_academy: false })],
      ), /swap_destination_squad_full/);
      assert.deepEqual((await db.query("SELECT team_id,pending_team_id FROM riders WHERE id=$1", [STAYS])).rows,
        [{ team_id: CLUB, pending_team_id: null }]);
      assert.deepEqual((await db.query("SELECT team_id,pending_team_id FROM riders WHERE id=$1", [senior.id])).rows,
        [{ team_id: BUYER, pending_team_id: null }]);
    }
    assert.equal((await swap(STAYS, SOLD, false)).rows[0].result.status, "claimed");
    const rosterCounts = () => db.query("SELECT count(*)::int AS count FROM riders GROUP BY team_id ORDER BY team_id");
    assert.deepEqual((await rosterCounts()).rows, [{ count: 60 }, { count: 60 }]);
    assert.equal((await swap(SOLD, STAYS, true)).rows[0].result.status, "claimed");
    assert.deepEqual((await db.query("SELECT id, pending_team_id FROM riders WHERE id IN ($1,$2) ORDER BY id", [STAYS, SOLD])).rows, [
      { id: SOLD, pending_team_id: BUYER }, { id: STAYS, pending_team_id: CLUB },
    ]);
    await assert.rejects(buy("team_id"), /club_roster_full/);
    assert.equal((await db.query("SELECT count(*)::int AS pending FROM riders WHERE promotion_pending_to IS NOT NULL")).rows[0].pending, 0);
  } finally {
    await db.close();
  }
});
