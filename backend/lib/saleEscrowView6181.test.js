// #6181 · Saelgers laaste salgspenge: den laesende vej, de to beskeder og force-spaerren.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildSaleLockedSellerNotification,
  countHeldSaleEscrowsForForce,
  daysUntil,
  isSaleLockedForDeal,
  loadLockedSalesForTeam,
  notifySellerSaleEscrowReleased,
  SALE_ESCROW_FORCE_BLOCKED_ERROR,
  soldRiderIds,
} from "./saleEscrowView6181.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(__dirname, rel), "utf8");

// Hold A saelger, Hold B koeber (aliaser, ingen rigtige id'er).
const SELLER = "team-a";
const BUYER = "team-b";

/**
 * Minimal PostgREST-fake: filtrerer tabellerne i hukommelsen og svarer som
 * supabase-js ({ data, error } / { count, error }).
 * @param {Record<string, any[]>} tables
 * @param {{ errors?: Record<string, any> }} [opts]
 */
function fakeSupabase(tables, { errors = {} } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const filters = [];
      let head = false;
      let limit = null;
      const q = {
        select(_cols, opts) { head = Boolean(opts?.head); return q; },
        eq(col, val) { filters.push((r) => r[col] === val); return q; },
        neq(col, val) { filters.push((r) => r[col] !== val); return q; },
        gt(col, val) { filters.push((r) => r[col] > val); return q; },
        in(col, vals) { filters.push((r) => vals.includes(r[col])); return q; },
        order() { return q; },
        limit(n) { limit = n; return q; },
        range(from, to) { filters.push((_r, i) => i >= from && i <= to); return q; },
        then(resolve, reject) {
          calls.push(table);
          if (errors[table]) return Promise.resolve({ data: null, count: null, error: errors[table] }).then(resolve, reject);
          let rows = (tables[table] || []).filter((r, i) => filters.every((f) => f(r, i)));
          if (limit != null) rows = rows.slice(0, limit);
          return Promise.resolve(head ? { count: rows.length, error: null } : { data: rows, error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
}

const NOW = new Date("2026-11-13T12:00:00Z");

function world() {
  return {
    sale_escrows: [
      { id: "e1", deal_type: "transfer", payer_team_id: BUYER, payee_team_id: SELLER, amount: 1250000, rider_ids: ["r1"], target_team_ids: [BUYER], status: "held", created_at: "2026-11-12T10:00:00Z" },
      { id: "e2", deal_type: "auction", payer_team_id: BUYER, payee_team_id: SELLER, amount: 640000, rider_ids: ["r2"], target_team_ids: [BUYER], status: "held", created_at: "2026-11-12T11:00:00Z" },
      // Afregnet og en anden saelgers: maa aldrig vises.
      { id: "e3", deal_type: "transfer", payer_team_id: BUYER, payee_team_id: SELLER, amount: 999, rider_ids: ["r3"], target_team_ids: [BUYER], status: "released", created_at: "2026-11-01T10:00:00Z" },
      { id: "e4", deal_type: "transfer", payer_team_id: SELLER, payee_team_id: BUYER, amount: 777, rider_ids: ["r4"], target_team_ids: [SELLER], status: "held", created_at: "2026-11-12T10:00:00Z" },
    ],
    riders: [
      { id: "r1", firstname: "Rytter", lastname: "En" },
      { id: "r2", firstname: "Rytter", lastname: "To" },
    ],
    races: [
      { id: "race-1", name: "Loeb Et", race_type: "stage_race", status: "scheduled", stages_completed: 2 },
      { id: "race-2", name: "Loeb To", race_type: "stage_race", status: "scheduled", stages_completed: 1 },
      { id: "race-old", name: "Faerdigt", race_type: "stage_race", status: "completed", stages_completed: 5 },
    ],
    race_entries: [
      { race_id: "race-1", rider_id: "r1" },
      { race_id: "race-2", rider_id: "r2" },
      { race_id: "race-old", rider_id: "r1" },
    ],
    race_stage_schedule: [
      { race_id: "race-1", scheduled_at: "2026-11-14T18:00:00Z" },
      { race_id: "race-1", scheduled_at: "2026-11-15T18:00:00Z" },
      { race_id: "race-2", scheduled_at: "2026-11-13T19:00:00Z" },
    ],
  };
}

test("soldRiderIds: kun de ryttere, saelgeren har afgivet (bytte har een i hver retning)", () => {
  assert.deepEqual(soldRiderIds({ rider_ids: ["r1"], target_team_ids: [BUYER], payer_team_id: BUYER }), ["r1"]);
  assert.deepEqual(soldRiderIds({ rider_ids: ["x", "y"], target_team_ids: [SELLER, BUYER], payer_team_id: BUYER }), ["y"]);
});

test("daysUntil: hele kalenderdage i dansk tid, i dag = 0, aldrig negativ", () => {
  assert.equal(daysUntil("2026-11-15T18:00:00Z", NOW), 2);
  assert.equal(daysUntil("2026-11-13T22:30:00Z", NOW), 0); // 23:30 dansk tid samme dag
  assert.equal(daysUntil("2026-11-13T23:30:00Z", NOW), 1); // 00:30 dansk tid naeste dag
  assert.equal(daysUntil("2026-11-10T18:00:00Z", NOW), 0);
  assert.equal(daysUntil(null, NOW), null);
});

test("loadLockedSalesForTeam: kun eget holds holdte salg, med rytter, loeb og dage tilbage", async () => {
  const supabase = fakeSupabase(world());
  const result = await loadLockedSalesForTeam(supabase, SELLER, { now: NOW });
  assert.equal(result.total, 1250000 + 640000);
  assert.deepEqual(result.sales.map((s) => s.id), ["e1", "e2"]);
  const [a, b] = result.sales;
  assert.deepEqual(a.riders, [{ id: "r1", name: "Rytter En" }]);
  assert.deepEqual(a.race, { id: "race-1", name: "Loeb Et" });
  assert.equal(a.daysLeft, 2);
  assert.equal(a.amount, 1250000);
  assert.equal(b.daysLeft, 0);
  assert.equal(b.dealType, "auction");
});

test("loadLockedSalesForTeam: intet laast = tomt svar, og intet slaas op udover sale_escrows", async () => {
  const supabase = fakeSupabase({ sale_escrows: [] });
  assert.deepEqual(await loadLockedSalesForTeam(supabase, SELLER, { now: NOW }), { total: 0, sales: [] });
  assert.deepEqual(supabase.calls, ["sale_escrows"]);
});

test("loadLockedSalesForTeam: manglende tabel = intet laast; anden fejl kaster", async () => {
  const missing = fakeSupabase({}, { errors: { sale_escrows: { code: "PGRST205", message: "missing" } } });
  assert.deepEqual(await loadLockedSalesForTeam(missing, SELLER), { total: 0, sales: [] });
  const broken = fakeSupabase({}, { errors: { sale_escrows: { code: "XX000", message: "boom" } } });
  await assert.rejects(() => loadLockedSalesForTeam(broken, SELLER), /boom/);
});

test("loadLockedSalesForTeam: uden aktivt loeb vises salget uden loeb og dage", async () => {
  const w = world();
  w.races = [];
  const result = await loadLockedSalesForTeam(fakeSupabase(w), SELLER, { now: NOW });
  assert.equal(result.sales[0].race, null);
  assert.equal(result.sales[0].daysLeft, null);
});

test("loadLockedSalesForTeam: et afmeldt holds staaende entry taeller ikke som loebet", async () => {
  const w = world();
  w.race_entries = [
    { race_id: "race-1", rider_id: "r1", team_id: SELLER },
    { race_id: "race-2", rider_id: "r1", team_id: SELLER }, // afmeldt, men entry bevaret (#5636)
  ];
  w.race_stage_schedule.push({ race_id: "race-2", scheduled_at: "2026-11-20T19:00:00Z" });
  w.race_withdrawals = [{ race_id: "race-2", team_id: SELLER }];
  const [sale] = (await loadLockedSalesForTeam(fakeSupabase(w), SELLER, { now: NOW })).sales;
  assert.deepEqual(sale.race, { id: "race-1", name: "Loeb Et" });
  assert.equal(sale.daysLeft, 2);
});

test("loadLockedSalesForTeam: et bytte venter paa den rytter, der endnu ikke er leveret", async () => {
  const w = world();
  // Hold A afgiver r1 (leveret allerede) og faar r5 + kontanter; r5 koerer loeb 2.
  w.sale_escrows = [{ id: "s1", deal_type: "swap", payer_team_id: BUYER, payee_team_id: SELLER, amount: 300000, rider_ids: ["r1", "r5"], target_team_ids: [BUYER, SELLER], delivered_rider_ids: ["r1"], status: "held", created_at: "2026-11-12T10:00:00Z" }];
  w.race_entries = [{ race_id: "race-2", rider_id: "r5", team_id: BUYER }];
  const [sale] = (await loadLockedSalesForTeam(fakeSupabase(w), SELLER, { now: NOW })).sales;
  assert.deepEqual(sale.riders.map((r) => r.id), ["r1"], "vist navn er saelgerens afgivne rytter");
  assert.deepEqual(sale.race, { id: "race-2", name: "Loeb To" });
});

test("isSaleLockedForDeal: kun en parkeret handel med en holdt escrow er laast", async () => {
  const supabase = fakeSupabase({ sale_escrows: [
    { deal_type: "transfer", deal_id: "d1", status: "held" },
    { deal_type: "transfer", deal_id: "d2", status: "released" },
  ] });
  assert.equal(await isSaleLockedForDeal(supabase, { parked: true, dealType: "transfer", dealId: "d1" }), true);
  assert.equal(await isSaleLockedForDeal(supabase, { parked: true, dealType: "transfer", dealId: "d2" }), false);
  assert.equal(await isSaleLockedForDeal(supabase, { parked: true, dealType: "transfer", dealId: "none" }), false);
  const before = supabase.calls.length;
  assert.equal(await isSaleLockedForDeal(supabase, { parked: false, dealType: "transfer", dealId: "d1" }), false);
  assert.equal(supabase.calls.length, before, "ikke parkeret: ingen opslag");
});

test("kontakten slukket: ingen escrow-raekke, saa saelgerens besked er den fra foer", async () => {
  // Med sale_escrow_enabled slukket opretter handlen aldrig en escrow (saleEscrowFlow6181).
  const supabase = fakeSupabase({ sale_escrows: [] });
  assert.equal(await isSaleLockedForDeal(supabase, { parked: true, dealType: "auction", dealId: "a1" }), false);
  const failing = fakeSupabase({}, { errors: { sale_escrows: { code: "XX000", message: "boom" } } });
  assert.equal(await isSaleLockedForDeal(failing, { parked: true, dealType: "auction", dealId: "a1" }), false);
});

test("buildSaleLockedSellerNotification: ejerens tekst, titlen fra handelstypen", () => {
  const n = buildSaleLockedSellerNotification({ riderName: "Rytter En", price: 1250000, riderId: "r1", titleCode: "notif.transfer.completed.title" });
  assert.equal(n.metadata.messageCode, "notif.saleEscrow.lockedMessage");
  assert.equal(n.metadata.titleCode, "notif.transfer.completed.title");
  assert.deepEqual(n.metadata.messageParams, { riderName: "Rytter En", price: 1250000 });
  assert.equal(n.metadata.riderId, "r1");
  assert.match(n.message, /Rytter En was sold for .* CZ\$\. The money is locked and paid out when he changes teams after his stage race\./);
});

test("notifySellerSaleEscrowReleased: saelgeren faar udbetalings-beskeden een gang", async () => {
  const supabase = fakeSupabase(world());
  const sent = [];
  const ok = await notifySellerSaleEscrowReleased(supabase, world().sale_escrows[0], { notifyTeamOwner: async (args) => { sent.push(args); } });
  assert.equal(ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].teamId, SELLER);
  assert.equal(sent[0].relatedId, "e1");
  assert.equal(sent[0].metadata.messageCode, "notif.saleEscrow.releasedMessage");
  assert.equal(sent[0].metadata.titleCode, "notif.saleEscrow.releasedTitle");
  assert.deepEqual(sent[0].metadata.messageParams, { riderName: "Rytter En", amount: 1250000 });
  assert.match(sent[0].message, /Rytter En has changed teams\. .* CZ\$ is now in your balance\./);
});

test("notifySellerSaleEscrowReleased: kaster aldrig (pengene er allerede flyttet)", async () => {
  const broken = fakeSupabase({}, { errors: { riders: { message: "boom" } } });
  assert.equal(await notifySellerSaleEscrowReleased(broken, world().sale_escrows[0], { notifyTeamOwner: async () => {} }), false);
  const supabase = fakeSupabase(world());
  assert.equal(await notifySellerSaleEscrowReleased(supabase, world().sale_escrows[0], { notifyTeamOwner: async () => { throw new Error("down"); } }), false);
});

test("countHeldSaleEscrowsForForce: taeller holdte; manglende tabel = 0; laesefejl afviser force", async () => {
  assert.equal(await countHeldSaleEscrowsForForce(fakeSupabase(world())), 3);
  assert.equal(await countHeldSaleEscrowsForForce(fakeSupabase({ sale_escrows: [] })), 0);
  assert.equal(await countHeldSaleEscrowsForForce(fakeSupabase({}, { errors: { sale_escrows: { code: "42P01", message: "missing" } } })), 0);
  assert.equal(await countHeldSaleEscrowsForForce(fakeSupabase({}, { errors: { sale_escrows: { code: "XX000", message: "boom" } } })), 1);
  assert.match(SALE_ESCROW_FORCE_BLOCKED_ERROR, /tvinges igennem, mens der står låste salg/);
});

// ── Koblingerne i delte filer (kilde-tjek, samme moenster som seasonTransitionRoute.test.js) ──

const api = read("../routes/api.js");

test("GET /api/me/locked-sales: requireAuth og kun eget hold", () => {
  const m = api.match(/router\.get\("\/me\/locked-sales", requireAuth, presencePulseLimiter,[\s\S]*?\n\}\);/);
  assert.ok(m, "ruten mangler");
  assert.match(m[0], /loadLockedSalesForTeam\(supabase, req\.team\.id\)/);
  assert.doesNotMatch(m[0], /req\.(query|params|body)/, "holdet maa aldrig komme fra klienten");
});

test("POST /admin/season-transition: force afvises med 409, mens der staar laaste salg (ejer 13/11)", () => {
  const m = api.match(/router\.post\(\s*"\/admin\/season-transition"[\s\S]*?\n\}\);/);
  assert.ok(m, "transition-handleren mangler");
  const block = m[0];
  const count = block.indexOf("countHeldSaleEscrowsForForce(supabase)");
  const forceLog = block.indexOf("beforeTransitionWrites = async");
  assert.ok(count > 0, "force-grenen skal taelle holdte escrows");
  assert.ok(count < forceLog, "spaerren skal ligge foer force-loggen og selve skiftet");
  assert.match(block, /status\(409\)\.json\(\{ error: SALE_ESCROW_FORCE_BLOCKED_ERROR, code: "held_sale_escrows"/);
});

test("executeSeasonTransition-scriptet stopper ogsaa ved laaste salg", () => {
  const src = read("../scripts/executeSeasonTransition.js");
  const guard = src.indexOf("countHeldSaleEscrowsForForce(supabase)");
  const run = src.indexOf("await transitionToNextSeason(");
  assert.ok(guard > 0 && guard < run);
  assert.match(src, /process\.exit\(1\)/);
});

test("saelgerens besked ved handlen skifter kun, naar handlen faktisk er laast", () => {
  const transfer = read("./transferExecution.js");
  assert.match(transfer, /isSaleLockedForDeal\(supabase, \{ parked: deferRegistration, dealType: "transfer", dealId: offer\.id \}\)\)\s*\?[\s\S]*?: completedPayload;/);
  assert.match(transfer, /notifyTeamOwner\(offer\.seller_team_id, sellerPayload\.type/);
  const auction = read("./auctionFinalization.js");
  assert.match(auction, /const sellerLocked = sellerOwned && await isSaleLockedForDeal\(supabase, \{ parked: deferTeamChange, dealType: "auction", dealId: auction\.id \}\);/);
  assert.match(auction, /messageCode: sellerLocked \? "notif\.saleEscrow\.lockedMessage" : sellerOwned \? "notif\.auction\.soldMessage" : "notif\.auction\.boughtMessage"/);
  // Ikke laast: praecis de parametre, saelgeren fik foer.
  assert.match(auction, /: \{ rider: `\$\{auction\.rider\.firstname\} \$\{auction\.rider\.lastname\}`, price \},/);
});

test("udbetalings-beskeden sendes ved hver 'released' i flush og reconcile", () => {
  const flow = read("./saleEscrowFlow6181.js");
  assert.match(flow, /if \(data\?\.status !== "released"\) return null;\s*await notifySellerSaleEscrowReleased\(supabase, escrow\);/);
  assert.match(flow, /result\.released \+= 1;\s*await notifySellerSaleEscrowReleased\(supabase, escrow\);/);
});
