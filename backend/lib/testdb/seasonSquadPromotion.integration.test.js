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
const clubMigration = readFileSync(new URL("../../../database/2026-11-24-8034-club-roster-cap.sql", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../../database/2026-11-24-7323-season-squad-promotion.sql", import.meta.url), "utf8");

test("cutover promotes despite full squads and open sales, closes old rows, and replays from committed history", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role;
      CREATE TABLE teams (id uuid PRIMARY KEY, is_ai boolean DEFAULT false, is_bank boolean DEFAULT false);
      INSERT INTO teams (id) VALUES ('${CLUB}'), ('${BUYER}');
      CREATE TABLE seasons (id uuid PRIMARY KEY, status text);
      CREATE TABLE riders (
        id uuid PRIMARY KEY, team_id uuid, pending_team_id uuid, squad text, is_academy boolean, is_retired boolean DEFAULT false,
        firstname text, lastname text, salary integer, contract_end_season integer,
        promotion_pending_to text, promotion_pending_since timestamptz, acquired_at timestamptz, updated_at timestamptz
      );
      CREATE TABLE academy_graduation (
        rider_id uuid, team_id uuid, season_id uuid, status text, from_squad text, to_squad text,
        deadline timestamptz, resolved_at timestamptz, PRIMARY KEY (rider_id, season_id)
      );
      CREATE TABLE auctions (id uuid PRIMARY KEY, rider_id uuid, status text, current_price integer, current_bidder_id uuid);
      CREATE TABLE auction_bids (auction_id uuid, team_id uuid, bid_time timestamptz);
      CREATE TABLE transfer_listings (rider_id uuid, asking_price integer);
      CREATE FUNCTION auto_accept_lock_teams(uuid, uuid) RETURNS void LANGUAGE plpgsql AS $fixture$
      BEGIN
        PERFORM pg_advisory_xact_lock(hashtextextended(least($1, $2)::text, 0));
        PERFORM pg_advisory_xact_lock(hashtextextended(greatest($1, $2)::text, 0));
      END; $fixture$;
      INSERT INTO seasons VALUES ('${S5}', 'completed'), ('${S6}', 'active');
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
    const openAuction = () => db.query("INSERT INTO auctions(id,status,current_bidder_id) VALUES (gen_random_uuid(), 'active', $1)", [CLUB]);
    await assert.rejects(openAuction(), /club_roster_full/);
    await db.query("UPDATE auctions SET status = 'completed' WHERE current_bidder_id=$1", [CLUB]);
    await openAuction();
    await assert.rejects(openAuction(), /club_roster_full/);
    await buy("team_id");
    await assert.rejects(buy("team_id"), /club_roster_full/);
    assert.equal((await db.query("SELECT count(*)::int AS pending FROM riders WHERE promotion_pending_to IS NOT NULL")).rows[0].pending, 0);
  } finally {
    await db.close();
  }
});
