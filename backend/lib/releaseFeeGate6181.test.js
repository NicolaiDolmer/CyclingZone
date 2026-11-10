// #6181 dommer-fund 10/11: fyringens gebyr mod disponibel saldo, kun med pengelåsen tændt.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { releaseFeeAvailableResponse6181 } from "./releaseFeeGate6181.js";
import { auctionCommitmentTable, isAuctionCommitmentTable } from "./availableBalanceMock.js";

function mockSupabase({ flag = null, leading = [], proxies = [] } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(table);
      if (table === "app_config") {
        const chain = {
          select() { return chain; },
          eq() { return chain; },
          maybeSingle: async () => ({ data: flag == null ? null : { value: flag }, error: null }),
        };
        return chain;
      }
      if (isAuctionCommitmentTable(table)) return auctionCommitmentTable(table, { leading, proxies });
      throw new Error(`unexpected table ${table}`);
    },
  };
}

const LEADING = [{ id: "a1", current_price: 600000 }];

test("tændt: køber fører med hele saldoen => fyring med gebyr afvises", async () => {
  const sb = mockSupabase({ flag: "on", leading: LEADING });
  const res = await releaseFeeAvailableResponse6181(sb, { teamId: "t1", balance: 600000, fee: 50000, errorCode: "insufficient_balance_after_bids" });
  assert.equal(res?.status, 400);
  assert.equal(res.body.errorCode, "insufficient_balance_after_bids");
  assert.equal(res.body.errorParams.available, 0);
  assert.equal(res.body.errorParams.fee, 50000);
});

test("tændt: disponibel saldo dækker gebyret => null", async () => {
  const sb = mockSupabase({ flag: "on", leading: [{ id: "a1", current_price: 100000 }] });
  assert.equal(await releaseFeeAvailableResponse6181(sb, { teamId: "t1", balance: 600000, fee: 50000, errorCode: "x" }), null);
});

test("tændt: proxy-loftet tæller også som låst", async () => {
  const sb = mockSupabase({ flag: true, proxies: [{ auction_id: "a2", max_amount: 580000, auction: { status: "active" } }] });
  const res = await releaseFeeAvailableResponse6181(sb, { teamId: "t1", balance: 600000, fee: 50000, errorCode: "insufficient_available_balance" });
  assert.equal(res?.body.errorCode, "insufficient_available_balance");
});

test("slukket (off/manglende): uændret, ingen opslag ud over kontakten", async () => {
  for (const flag of [null, "off", false]) {
    const sb = mockSupabase({ flag, leading: LEADING });
    assert.equal(await releaseFeeAvailableResponse6181(sb, { teamId: "t1", balance: 600000, fee: 50000, errorCode: "x" }), null);
    assert.deepEqual(sb.calls, ["app_config"]);
  }
});

test("gebyr 0 eller rå saldo for lav: ingen opslag (rutens eget tjek tager det)", async () => {
  const sb = mockSupabase({ flag: "on", leading: LEADING });
  assert.equal(await releaseFeeAvailableResponse6181(sb, { teamId: "t1", balance: 600000, fee: 0, errorCode: "x" }), null);
  assert.equal(await releaseFeeAvailableResponse6181(sb, { teamId: "t1", balance: 10, fee: 50000, errorCode: "x" }), null);
  assert.deepEqual(sb.calls, []);
});

test("begge fyrings-ruter kalder gaten efter rå-saldo-tjekket og før rytteren frigøres", () => {
  const src = readFileSync(new URL("../routes/api.js", import.meta.url), "utf8");
  for (const [route, marker] of [["/riders/:id/release\"", "releaseRiderUnderTeamLock"], ["/riders/:id/academy-release\"", "is_academy: false"]]) {
    const start = src.indexOf(`router.post("${route}`);
    assert.ok(start > 0, route);
    const block = src.slice(start, src.indexOf("\nrouter.", start + 10));
    const raw = block.indexOf("cannot_afford_release");
    const gate = block.indexOf("releaseFeeAvailableResponse6181");
    const release = block.indexOf(marker);
    assert.ok(raw > 0 && gate > raw && release > gate, `${route}: rå tjek < gate < frigørelse`);
  }
});
