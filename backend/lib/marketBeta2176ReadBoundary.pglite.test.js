import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { betaDatabase2176 } from './__fixtures__/marketBeta2176Db.js';

const migration = new URL('../../database/2026-11-10-2176-transfer-payment-beta-scope.sql', import.meta.url);
const PUBLIC_COLUMNS = 'id,rider_id,seller_team_id,asking_price,status,created_at';

for (const role of ['anon', 'authenticated']) {
  test(`${role} follows the listing read boundary without direct auto-price access`, async t => {
    const db = await betaDatabase2176(t);
    // Match the observed legacy table grant, plus a preexisting column grant:
    // revoking the table grant alone must not leave the price readable.
    await db.exec(`GRANT SELECT ON transfer_listings TO PUBLIC,anon,authenticated;
      GRANT SELECT(id,auto_accept_price) ON transfer_listings TO PUBLIC,anon,authenticated;
      UPDATE transfer_listings SET auto_accept_price=700000;`);
    await db.exec(await readFile(migration, 'utf8'));
    await db.exec(`SET ROLE ${role}`);
    try {
      if (role === 'authenticated') {
        const rows = (await db.query(`SELECT ${PUBLIC_COLUMNS} FROM transfer_listings WHERE status='open'`)).rows;
        assert.equal(rows.length, 1);
        assert.equal(rows[0].asking_price, 100000);
      } else {
        await assert.rejects(db.query(`SELECT ${PUBLIC_COLUMNS} FROM transfer_listings`), /permission denied/);
        await assert.rejects(db.query('SELECT id FROM transfer_listings'), /permission denied/);
      }
      await assert.rejects(db.query('SELECT auto_accept_price FROM transfer_listings'), /permission denied/);
      await assert.rejects(db.query('SELECT * FROM transfer_listings'), /permission denied/);
      await assert.rejects(db.query('SELECT id FROM transfer_listings WHERE auto_accept_price>0'), /permission denied/);
    } finally { await db.exec('RESET ROLE'); }
    await db.exec('SET ROLE service_role');
    try {
      assert.equal((await db.query('SELECT auto_accept_price FROM transfer_listings')).rows[0].auto_accept_price, 700000);
    } finally { await db.exec('RESET ROLE'); }
  });
}
