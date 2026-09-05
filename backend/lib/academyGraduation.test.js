import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_AUCTION_CONFIG } from "./auctionEngine.js";
import {
  GRADUATION,
  isGraduateAge,
  detectGraduates,
  resolveGraduation,
  defaultResolveGraduate,
  releaseUnsoldGraduate,
  completeStuckPromotion,
  resolveNeverGraduated,
} from "./academyGraduation.js";

// ─── Mock-supabase ─────────────────────────────────────────────────────────────
// Dækker queries academyGraduation bruger: riders (fetchAllRows-list + maybeSingle
// + update), academy_graduation (fetchAllRows-list + maybeSingle + insert + update),
// auctions (insert). notify injiceres som spy (ingen notifikations-DB-queries).

function makeSupabase(cfg = {}) {
  const rec = { gradInserts: [], gradUpdates: [], riderUpdates: [], auctionInserts: [] };
  const supabase = {
    from(table) {
      if (table === "riders") {
        return {
          select() {
            const api = {
              eq() { return api; },
              order() { return api; },
              range() { return Promise.resolve({ data: cfg.academyRiders || [], error: null }); },
              maybeSingle() { return Promise.resolve({ data: cfg.rider ?? null, error: null }); },
            };
            return api;
          },
          update(payload) {
            // #4495: releaseUnsoldGraduate bruger en CONDITIONAL update
            // (.eq(id).eq(team_id).eq(is_academy).select("id")) saa et gentaget
            // kald rammer 0 raekker i stedet for at flytte en rytter der er
            // kommet videre. Mocken skal derfor baade kunne kaedes og kunne
            // svare med raekke-antal — og den skal HAANDHAEVE filtrene mod
            // cfg.rider, ellers kunne testen for idempotens aldrig fejle.
            const filters = [];
            const builder = {
              eq(col, val) {
                filters.push([col, val]);
                return builder;
              },
              select() {
                const row = cfg.rider ?? {};
                const matches = filters.every(([col, val]) =>
                  col === "id" ? row.id === val : (row[col] ?? null) === val
                );
                if (matches) rec.riderUpdates.push(payload);
                return Promise.resolve({ data: matches ? [{ id: row.id }] : [], error: null });
              },
              then(resolve, reject) {
                rec.riderUpdates.push(payload);
                return Promise.resolve({ error: null }).then(resolve, reject);
              },
            };
            return builder;
          },
        };
      }
      if (table === "academy_graduation") {
        // #4484: maybeSingle() modelleres nu som PostgREST FAKTISK opfører sig —
        // matcher filtrene MERE end én række, svarer den med en fejl (PGRST116)
        // og data=null, ikke med "den første række". Den gamle mock returnerede
        // cfg.gradRow uanset filtre og kunne derfor aldrig fange #4484, hvor to
        // grad-rækker for samme (hold, rytter) over to sæsoner låste både
        // sweepet og managerens egen knap fast.
        //
        // eq-filtre håndhæves kun på kolonner fixturen faktisk bærer, så de
        // eksisterende {id, status}-fixtures forbliver gyldige.
        const rows = cfg.gradRows ?? (cfg.gradRow ? [cfg.gradRow] : []);
        return {
          select() {
            const filters = [];
            let desc = false, cap = Infinity;
            const api = {
              eq(col, val) { filters.push([col, val]); return api; },
              order(col, opts) { desc = opts?.ascending === false; return api; },
              limit(n) { cap = n; return api; },
              range() {
                return Promise.resolve({ data: (cfg.existingGradRiderIds || []).map((rider_id) => ({ rider_id })), error: null });
              },
              maybeSingle() {
                let matched = rows.filter((r) => filters.every(([col, val]) => !(col in r) || r[col] === val));
                if (desc) matched = [...matched].reverse();
                matched = matched.slice(0, cap);
                if (matched.length > 1) {
                  return Promise.resolve({
                    data: null,
                    error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" },
                  });
                }
                return Promise.resolve({ data: matched[0] ?? null, error: null });
              },
            };
            return api;
          },
          insert(row) { rec.gradInserts.push(row); return Promise.resolve({ error: null }); },
          update(payload) {
            return { eq(col, val) { rec.gradUpdates.push({ ...payload, __eq: [col, val] }); return Promise.resolve({ error: null }); } };
          },
        };
      }
      if (table === "auctions") {
        return { insert(row) { rec.auctionInserts.push(row); return Promise.resolve({ error: null }); } };
      }
      // #4004: createGraduateAuction's sæson-transitions-grænse-opslag
      // (fetchSeasonTransitionBoundary) — cfg.appConfigRow/cfg.upcomingSeason
      // styrer grænsen; default (begge undefined) = ingen grænse (uændret
      // adfærd for alle eksisterende tests ovenfor).
      if (table === "app_config") {
        return { select() { return { eq() { return { maybeSingle() { return Promise.resolve({ data: cfg.appConfigRow ?? null, error: null }); } }; } }; } };
      }
      if (table === "seasons") {
        return { select() { return { eq() { return { maybeSingle() { return Promise.resolve({ data: cfg.upcomingSeason ?? null, error: null }); } }; } }; } };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { supabase, rec };
}

function spyNotify() {
  const calls = [];
  const fn = async (payload) => { calls.push(payload); };
  fn.calls = calls;
  return fn;
}

// birthdate så ageForSeason(birthdate, 1) = 2026 + 0 - birthYear giver ønsket alder.
const bornForAge = (age) => `${2026 - age}-06-15`;

// ─── konstanter + helper ────────────────────────────────────────────────────────

test("GRADUATION-konstanter", () => {
  assert.equal(GRADUATION.GRADUATE_AGE, 22);
  assert.ok(GRADUATION.DEADLINE_DAYS >= 1, "override-vindue mindst 1 dag");
});

test("isGraduateAge: 22+ er graduate, 21 og under er ikke", () => {
  assert.equal(isGraduateAge(21), false);
  assert.equal(isGraduateAge(22), true);
  assert.equal(isGraduateAge(25), true);
  assert.equal(isGraduateAge(null), false);
});

// ─── detectGraduates ──────────────────────────────────────────────────────────

test("detectGraduates: opretter pending-row for 22-årig, ignorerer 19-årig", async () => {
  const { supabase, rec } = makeSupabase({
    academyRiders: [
      { id: "r22", team_id: "t1", firstname: "Old", lastname: "Enough", birthdate: bornForAge(22) },
      { id: "r19", team_id: "t1", firstname: "Still", lastname: "Young", birthdate: bornForAge(19) },
    ],
  });
  const notify = spyNotify();
  const res = await detectGraduates(supabase, { seasonId: "s1", seasonNumber: 1, now: new Date("2026-06-20T10:00:00Z"), notify });
  assert.equal(res.graduates, 1);
  assert.equal(rec.gradInserts.length, 1);
  assert.equal(rec.gradInserts[0].rider_id, "r22");
  assert.equal(rec.gradInserts[0].status, "pending");
  assert.ok(rec.gradInserts[0].deadline, "deadline sat");
  assert.equal(notify.calls.length, 1);
  assert.equal(notify.calls[0].type, "academy_graduation_ready");
});

test("detectGraduates: idempotent — rytter med eksisterende grad-row skippes", async () => {
  const { supabase, rec } = makeSupabase({
    academyRiders: [{ id: "r22", team_id: "t1", firstname: "Old", lastname: "Enough", birthdate: bornForAge(22) }],
    existingGradRiderIds: ["r22"],
  });
  const res = await detectGraduates(supabase, { seasonId: "s1", seasonNumber: 1, notify: spyNotify() });
  assert.equal(res.graduates, 0);
  assert.equal(rec.gradInserts.length, 0);
});

test("detectGraduates (dryRun): tæller uden writes", async () => {
  const { supabase, rec } = makeSupabase({
    academyRiders: [{ id: "r22", team_id: "t1", firstname: "Old", lastname: "Enough", birthdate: bornForAge(22) }],
  });
  const notify = spyNotify();
  const res = await detectGraduates(supabase, { seasonId: "s1", seasonNumber: 1, dryRun: true, notify });
  assert.equal(res.dryRun, true);
  assert.equal(res.graduates, 1);
  assert.equal(rec.gradInserts.length, 0);
  assert.equal(notify.calls.length, 0);
});

// ─── resolveGraduation ────────────────────────────────────────────────────────

const PENDING_GRAD = { id: "g1", status: "pending" };
// contract_length/contract_end_season EKSPLICIT null → contractOnAcquirePatch's
// #2902-forward-guard betragter pakken som ufuldstændig og healer den med en
// frisk standard-kontrakt (samme adfærd som en reelt kontraktløs rytter).
// #3620: nullene skal STÅ der. Et fixture der bare udelader felterne modellerer
// "kolonnen blev ikke SELECT'et", ikke "kolonnen er NULL" — to vidt forskellige
// ting, og netop den forveksling var root cause i #3620. resolveGraduation
// henter begge kolonner i prod, så fixturen skal have dem.
const RIDER = { id: "r1", team_id: "t1", firstname: "Grad", lastname: "Uate", base_value: 100000, prize_earnings_bonus: 0, market_value: 100000, salary: 500, contract_length: null, contract_end_season: null };
// #2881: akademirytter der bærer en KOMPLET, gyldig akademi-kontrakt (fra
// intake eller et tidligere demote()-ophold) ind i graduerings-øjeblikket —
// resolveGraduation(promote) må ALDRIG regenerere denne.
const RIDER_WITH_ACADEMY_CONTRACT = {
  id: "r5", team_id: "t1", firstname: "Academy", lastname: "Contracted",
  base_value: 100000, prize_earnings_bonus: 0, market_value: 100000,
  current_production_value: 40_000, salary: 3_200,
  contract_length: 3, contract_end_season: 3,
};

test("resolveGraduation promote: is_academy=false + ufuldstændig kontrakt healer til standard-kontrakt; grad promoted; notify", async () => {
  const { supabase, rec } = makeSupabase({ gradRow: PENDING_GRAD, rider: RIDER });
  const notify = spyNotify();
  const getMarketState = async () => ({ squad_limits: { max: 30 }, future_count: 10, balance: 5000 });
  const res = await resolveGraduation(supabase, { teamId: "t1", riderId: "r1", action: "promote", seasonNumber: 1, getMarketState, notify });
  assert.equal(res.action, "promoted");
  assert.equal(rec.riderUpdates.length, 1);
  assert.equal(rec.riderUpdates[0].is_academy, false);
  assert.ok(rec.riderUpdates[0].salary > 0, "ny standard-kontrakt-løn sat");
  assert.ok(rec.riderUpdates[0].salary !== RIDER.salary, "healer den ufuldstændige pakke (#2902-gate)");
  assert.equal(rec.gradUpdates[0].status, "promoted");
  assert.equal(notify.calls[0].type, "academy_graduated");
});

// #2881 regression: resolveGraduation(promote) overskrev UBETINGET
// salary/contract_length/contract_end_season på enhver graduerende akademirytter
// — samme #1309-invariant-brud som academyTransfer.js promote() (fixet i
// #2929), bare via graduerings-stien. Låser fast at en akademirytter med en
// KOMPLET, gyldig akademi-kontrakt IKKE får den rørt ved graduering — kun
// is_academy flipper.
test("resolveGraduation promote: #2881 — eksisterende akademi-kontrakt overlever UÆNDRET, kun is_academy flipper", async () => {
  const { supabase, rec } = makeSupabase({ gradRow: PENDING_GRAD, rider: RIDER_WITH_ACADEMY_CONTRACT });
  const notify = spyNotify();
  const getMarketState = async () => ({ squad_limits: { max: 30 }, future_count: 10, balance: 5000 });
  const res = await resolveGraduation(supabase, { teamId: "t1", riderId: "r5", action: "promote", seasonNumber: 2, getMarketState, notify });
  assert.equal(res.action, "promoted");
  assert.equal(rec.riderUpdates.length, 1);
  assert.deepEqual(rec.riderUpdates[0], { is_academy: false }, "kun is_academy sat — kontraktfelter UBERØRT");
  assert.equal(res.salary, RIDER_WITH_ACADEMY_CONTRACT.salary, "løn arvet uændret");
  assert.equal(rec.gradUpdates[0].status, "promoted");
  assert.equal(notify.calls[0].type, "academy_graduated");
});

test("resolveGraduation promote: afviser ved fuld senior-trup", async () => {
  const { supabase } = makeSupabase({ gradRow: PENDING_GRAD, rider: RIDER });
  const getMarketState = async () => ({ squad_limits: { max: 30 }, future_count: 30, balance: 5000 });
  await assert.rejects(
    () => resolveGraduation(supabase, { teamId: "t1", riderId: "r1", action: "promote", seasonNumber: 1, getMarketState, notify: spyNotify() }),
    /squad_cap_violation/,
  );
});

test("resolveGraduation sell: opretter senior-auktion (seller=hold, is_youth=false); grad sold", async () => {
  const { supabase, rec } = makeSupabase({ gradRow: PENDING_GRAD, rider: RIDER });
  const res = await resolveGraduation(supabase, { teamId: "t1", riderId: "r1", action: "sell", seasonNumber: 1, auctionConfig: DEFAULT_AUCTION_CONFIG, notify: spyNotify() });
  assert.equal(res.action, "sold");
  assert.equal(rec.auctionInserts.length, 1);
  assert.equal(rec.auctionInserts[0].seller_team_id, "t1");
  assert.equal(rec.auctionInserts[0].is_youth, false);
  assert.equal(rec.gradUpdates[0].status, "sold");
});

// #4004 (ejer-tillæg 21/8): den automatiserede FA-sti (createGraduateAuction)
// springer oprettelsen over — INGEN fejl — når den beregnede sluttid ville
// krydse sæson-transitionen. Grad-rækken forbliver 'pending', så et senere
// kald (næste sweep-run) opretter auktionen naturligt.
test("resolveGraduation sell: #4004 — springer auktionsoprettelse over når sluttid krydser sæson-transitionen; grad forbliver pending", async () => {
  const { supabase, rec } = makeSupabase({
    gradRow: PENDING_GRAD,
    rider: RIDER,
    upcomingSeason: { start_date: "2026-08-24" }, // grænse = 2026-08-23T18:00 dansk tid (CEST)
  });
  const now = new Date("2026-08-23T10:00:00Z"); // 12t-gulvet presser sluttid forbi grænsen
  const res = await resolveGraduation(supabase, {
    teamId: "t1", riderId: "r1", action: "sell", seasonNumber: 1,
    now, auctionConfig: DEFAULT_AUCTION_CONFIG, notify: spyNotify(),
  });
  assert.equal(res.action, "sell_deferred_season_boundary");
  assert.equal(rec.auctionInserts.length, 0, "ingen auktion oprettet");
  assert.equal(rec.gradUpdates.length, 0, "grad-status IKKE flyttet — forbliver pending");
});

test("resolveGraduation sell: #4004 — opretter normalt når sluttid ligger FØR sæson-transitionen", async () => {
  const { supabase, rec } = makeSupabase({
    gradRow: PENDING_GRAD,
    rider: RIDER,
    upcomingSeason: { start_date: "2026-08-24" }, // grænse = 2026-08-23T18:00 dansk tid (CEST)
  });
  const now = new Date("2026-08-01T10:00:00Z"); // langt før grænsen
  const res = await resolveGraduation(supabase, {
    teamId: "t1", riderId: "r1", action: "sell", seasonNumber: 1,
    now, auctionConfig: DEFAULT_AUCTION_CONFIG, notify: spyNotify(),
  });
  assert.equal(res.action, "sold");
  assert.equal(rec.auctionInserts.length, 1);
  assert.equal(rec.gradUpdates[0].status, "sold");
});

test("resolveGraduation release: free agent (team_id=NULL, is_academy=false); grad released", async () => {
  const { supabase, rec } = makeSupabase({ gradRow: PENDING_GRAD, rider: RIDER });
  const res = await resolveGraduation(supabase, { teamId: "t1", riderId: "r1", action: "release", seasonNumber: 1, notify: spyNotify() });
  assert.equal(res.action, "released");
  assert.equal(rec.riderUpdates[0].team_id, null);
  assert.equal(rec.riderUpdates[0].is_academy, false);
  assert.equal(rec.gradUpdates[0].status, "released");
});

// #2881-følgefund: release efterlod tidligere en fri agent med en IKKE-null
// akademi-kontrakt — brød "kontrakter kun på ejede ryttere"-invarianten
// (#1309) og ville få et senere contractOnAcquirePatch-kald (auktion/
// transfer) til fejlagtigt at bevare den stale kontrakt i stedet for at give
// en frisk. Låser fast at release nu nuller kontraktfelterne.
test("resolveGraduation release: #2881 — nuller salary/contract_length/contract_end_season (fri agent skal være kontraktløs)", async () => {
  const { supabase, rec } = makeSupabase({ gradRow: PENDING_GRAD, rider: RIDER_WITH_ACADEMY_CONTRACT });
  await resolveGraduation(supabase, { teamId: "t1", riderId: "r5", action: "release", seasonNumber: 1, notify: spyNotify() });
  assert.equal(rec.riderUpdates[0].salary, null);
  assert.equal(rec.riderUpdates[0].contract_length, null);
  assert.equal(rec.riderUpdates[0].contract_end_season, null);
});

test("resolveGraduation: afviser hvis ingen pending grad-row", async () => {
  const { supabase } = makeSupabase({ gradRow: null, rider: RIDER });
  await assert.rejects(
    () => resolveGraduation(supabase, { teamId: "t1", riderId: "r1", action: "promote", seasonNumber: 1, notify: spyNotify() }),
    /not_pending/,
  );
});

// #4484 regression: academy_graduation er UNIQUE(rider_id, season_id) — én
// række pr. rytter PR. SÆSON. En rytter med akademi-ophold over to sæsoner på
// samme hold har derfor to rækker, og det gamle opslag (team_id + rider_id,
// ingen status/sæson-scope) ramte dem begge → PostgREST svarede med fejl +
// data=null → kalderen læste "ingen række" → 'not_pending'.
//
// Målt i prod 31/8: én rytter (S2 'sold' + S3 'pending') fik graduerings-
// sweepet til at fejle 23 gange på én nat, og manageren fik 409 på sin egen
// promovér/sælg/slip-knap. Låser fast at opslaget nu rammer PENDING-rækken.
const SOLD_GRAD_PREV_SEASON = { id: "g-s2", team_id: "t1", rider_id: "r1", status: "sold", created_at: "2026-07-26T19:30:44Z" };
const PENDING_GRAD_THIS_SEASON = { id: "g-s3", team_id: "t1", rider_id: "r1", status: "pending", created_at: "2026-08-23T18:32:01Z" };

test("resolveGraduation: #4484 — rytter med grad-række i to sæsoner resolveres (rammer den pending, ikke begge)", async () => {
  const { supabase, rec } = makeSupabase({
    gradRows: [SOLD_GRAD_PREV_SEASON, PENDING_GRAD_THIS_SEASON],
    rider: RIDER,
  });
  const getMarketState = async () => ({ squad_limits: { max: 30 }, future_count: 10, balance: 5000 });
  const res = await resolveGraduation(supabase, { teamId: "t1", riderId: "r1", action: "promote", seasonNumber: 3, getMarketState, notify: spyNotify() });
  assert.equal(res.action, "promoted");
  assert.equal(rec.gradUpdates.length, 1, "kun ÉN grad-række rørt");
  assert.equal(rec.gradUpdates[0].status, "promoted");
  assert.deepEqual(rec.gradUpdates[0].__eq, ["id", "g-s3"], "opdaterer den pending række fra i år, ikke sidste sæsons solgte");
});

test("defaultResolveGraduate: #4484 — sweep-stien fejler ikke længere på en to-sæsoners rytter", async () => {
  const { supabase, rec } = makeSupabase({
    gradRows: [SOLD_GRAD_PREV_SEASON, PENDING_GRAD_THIS_SEASON],
    rider: RIDER,
  });
  const getMarketState = async () => ({ squad_limits: { max: 30 }, future_count: 10, balance: 5000 });
  const res = await defaultResolveGraduate(supabase, { teamId: "t1", riderId: "r1", seasonNumber: 3, getMarketState, notify: spyNotify() });
  assert.equal(res.action, "promoted");
  assert.equal(rec.riderUpdates[0].is_academy, false);
});

// Forsvar i dybden: skulle to rækker begge stå 'pending' (fx en sæson hvor
// sweepet aldrig nåede at resolve den gamle), tager opslaget den NYESTE —
// den aktive sæsons — i stedet for at fejle igen.
test("resolveGraduation: #4484 — to PENDING rækker → nyeste vinder, ingen fejl", async () => {
  const { supabase, rec } = makeSupabase({
    gradRows: [
      { ...SOLD_GRAD_PREV_SEASON, status: "pending" },
      PENDING_GRAD_THIS_SEASON,
    ],
    rider: RIDER,
  });
  const getMarketState = async () => ({ squad_limits: { max: 30 }, future_count: 10, balance: 5000 });
  const res = await resolveGraduation(supabase, { teamId: "t1", riderId: "r1", action: "promote", seasonNumber: 3, getMarketState, notify: spyNotify() });
  assert.equal(res.action, "promoted");
  assert.deepEqual(rec.gradUpdates[0].__eq, ["id", "g-s3"], "nyeste (aktive sæsons) række");
});

test("resolveGraduation: afviser ugyldig action", async () => {
  const { supabase } = makeSupabase({ gradRow: PENDING_GRAD, rider: RIDER });
  await assert.rejects(
    () => resolveGraduation(supabase, { teamId: "t1", riderId: "r1", action: "bogus", seasonNumber: 1, notify: spyNotify() }),
    /invalid_action/,
  );
});

// ─── defaultResolveGraduate ───────────────────────────────────────────────────

test("defaultResolveGraduate: promover når plads + solvent", async () => {
  const { supabase, rec } = makeSupabase({ gradRow: PENDING_GRAD, rider: RIDER });
  const getMarketState = async () => ({ squad_limits: { max: 30 }, future_count: 10, balance: 5000 });
  const res = await defaultResolveGraduate(supabase, { teamId: "t1", riderId: "r1", seasonNumber: 1, getMarketState, notify: spyNotify() });
  assert.equal(res.action, "promoted");
  assert.equal(rec.riderUpdates[0].is_academy, false);
});

test("defaultResolveGraduate: sælger når trup fuld", async () => {
  const { supabase, rec } = makeSupabase({ gradRow: PENDING_GRAD, rider: RIDER });
  const getMarketState = async () => ({ squad_limits: { max: 30 }, future_count: 30, balance: 5000 });
  const res = await defaultResolveGraduate(supabase, { teamId: "t1", riderId: "r1", seasonNumber: 1, getMarketState, auctionConfig: DEFAULT_AUCTION_CONFIG, notify: spyNotify() });
  assert.equal(res.action, "sold");
  assert.equal(rec.auctionInserts.length, 1);
});

test("defaultResolveGraduate: sælger når hold i gæld (konservativ auto-default)", async () => {
  const { supabase } = makeSupabase({ gradRow: PENDING_GRAD, rider: RIDER });
  const getMarketState = async () => ({ squad_limits: { max: 30 }, future_count: 10, balance: -2000 });
  const res = await defaultResolveGraduate(supabase, { teamId: "t1", riderId: "r1", seasonNumber: 1, getMarketState, auctionConfig: DEFAULT_AUCTION_CONFIG, notify: spyNotify() });
  assert.equal(res.action, "sold");
});

// ─── #4495 · usolgt graduate-auktion → fri agent ────────────────────────────────
// Kontrakten stod i createGraduateAuction's docblok ("free agent ved ingen bud")
// men fandtes ikke i koden: kun vinder-stien flippede is_academy, så en auktion
// uden bud efterlod rytteren hos sælgeren med is_academy=true og en grad-række
// der allerede var stemplet 'sold'. 8 ryttere på 22-23 år på 6 hold i prod 31/8.

const STUCK_ACADEMY_RIDER = {
  id: "r9", team_id: "t1", is_academy: true, firstname: "Unsold", lastname: "Graduate",
};
const SOLD_GRAD = { id: "g-sold", team_id: "t1", rider_id: "r9", status: "sold" };

test("#4495 releaseUnsoldGraduate: usolgt graduate bliver fri agent (team_id NULL, is_academy false, kontraktfelter nullet)", async () => {
  const { supabase, rec } = makeSupabase({ rider: STUCK_ACADEMY_RIDER, gradRows: [SOLD_GRAD] });
  const notify = spyNotify();
  const res = await releaseUnsoldGraduate(supabase, { teamId: "t1", riderId: "r9", notify });

  assert.equal(res.released, true);
  assert.equal(rec.riderUpdates.length, 1);
  assert.equal(rec.riderUpdates[0].team_id, null);
  assert.equal(rec.riderUpdates[0].is_academy, false);
  // #1309: kontrakter kun på ejede ryttere — ellers arver et senere
  // contractOnAcquirePatch-kald fejlagtigt akademi-kontrakten.
  assert.equal(rec.riderUpdates[0].salary, null);
  assert.equal(rec.riderUpdates[0].contract_length, null);
  assert.equal(rec.riderUpdates[0].contract_end_season, null);
  assert.equal(notify.calls.length, 1);
  assert.equal(notify.calls[0].type, "academy_graduated");
});

test("#4495 releaseUnsoldGraduate: retter den fejlagtige 'sold'-stempling til 'released'", async () => {
  const { supabase, rec } = makeSupabase({ rider: STUCK_ACADEMY_RIDER, gradRows: [SOLD_GRAD] });
  await releaseUnsoldGraduate(supabase, { teamId: "t1", riderId: "r9", notify: spyNotify() });
  assert.equal(rec.gradUpdates.length, 1);
  assert.equal(rec.gradUpdates[0].status, "released");
  assert.deepEqual(rec.gradUpdates[0].__eq, ["id", "g-sold"]);
});

test("#4495 releaseUnsoldGraduate: uden 'sold'-række frigives rytteren stadig (best-effort restempling)", async () => {
  const { supabase, rec } = makeSupabase({ rider: STUCK_ACADEMY_RIDER, gradRows: [] });
  const res = await releaseUnsoldGraduate(supabase, { teamId: "t1", riderId: "r9", notify: spyNotify() });
  assert.equal(res.released, true);
  assert.equal(rec.gradUpdates.length, 0);
});

test("#4495 releaseUnsoldGraduate: idempotent — rytter der ikke længere er akademi røres ikke", async () => {
  const { supabase, rec } = makeSupabase({
    rider: { ...STUCK_ACADEMY_RIDER, is_academy: false },
    gradRows: [SOLD_GRAD],
  });
  const notify = spyNotify();
  const res = await releaseUnsoldGraduate(supabase, { teamId: "t1", riderId: "r9", notify });
  assert.equal(res.released, false);
  assert.equal(res.reason, "not_academy");
  assert.equal(rec.riderUpdates.length, 0);
  assert.equal(notify.calls.length, 0);
});

test("#4495 releaseUnsoldGraduate: rytter der imens er skiftet hold røres ikke", async () => {
  const { supabase, rec } = makeSupabase({
    rider: { ...STUCK_ACADEMY_RIDER, team_id: "t-other" },
    gradRows: [SOLD_GRAD],
  });
  const res = await releaseUnsoldGraduate(supabase, { teamId: "t1", riderId: "r9", notify: spyNotify() });
  assert.equal(res.released, false);
  assert.equal(res.reason, "not_on_team");
  assert.equal(rec.riderUpdates.length, 0);
});

test("#4495 releaseUnsoldGraduate: ukendt rytter giver rider_not_found uden writes", async () => {
  const { supabase, rec } = makeSupabase({ rider: null, gradRows: [] });
  const res = await releaseUnsoldGraduate(supabase, { teamId: "t1", riderId: "r9", notify: spyNotify() });
  assert.equal(res.released, false);
  assert.equal(res.reason, "rider_not_found");
  assert.equal(rec.riderUpdates.length, 0);
});

// ─── completeStuckPromotion (#4495-reparation, 5/9) ────────────────────────────
// Tilstand (b): grad-række 'promoted' men is_academy stadig true — samme felter
// + cap-tjek som resolveGraduation's promote-gren, men UDEN en pending grad-
// række at resolve'e imod (den findes allerede, afsluttet).

const STUCK_PROMOTED_RIDER = {
  id: "r11", team_id: "t1", is_academy: true, firstname: "Halfway", lastname: "Promoted",
  salary: 500, contract_length: null, contract_end_season: null,
};

test("#4495 completeStuckPromotion: fuldfører — is_academy=false, kontrakt healet, notify", async () => {
  const { supabase, rec } = makeSupabase({ rider: STUCK_PROMOTED_RIDER });
  const notify = spyNotify();
  const getMarketState = async () => ({ squad_limits: { max: 30 }, future_count: 10, balance: 5000 });
  const res = await completeStuckPromotion(supabase, { teamId: "t1", riderId: "r11", seasonNumber: 3, getMarketState, notify });
  assert.equal(res.completed, true);
  assert.equal(rec.riderUpdates.length, 1);
  assert.equal(rec.riderUpdates[0].is_academy, false);
  assert.ok(rec.riderUpdates[0].salary > 0);
  assert.equal(notify.calls[0].type, "academy_graduated");
  assert.equal(notify.calls[0].metadata.messageCode, "notif.academyGraduated.promote");
});

test("#4495 completeStuckPromotion: afviser ved fuld senior-trup (squad_cap_violation)", async () => {
  const { supabase } = makeSupabase({ rider: STUCK_PROMOTED_RIDER });
  const getMarketState = async () => ({ squad_limits: { max: 30 }, future_count: 30, balance: 5000 });
  await assert.rejects(
    () => completeStuckPromotion(supabase, { teamId: "t1", riderId: "r11", seasonNumber: 3, getMarketState, notify: spyNotify() }),
    /squad_cap_violation/,
  );
});

test("#4495 completeStuckPromotion: idempotent — rytter der ikke længere er akademi røres ikke", async () => {
  const { supabase, rec } = makeSupabase({ rider: { ...STUCK_PROMOTED_RIDER, is_academy: false } });
  const getMarketState = async () => ({ squad_limits: { max: 30 }, future_count: 10, balance: 5000 });
  const res = await completeStuckPromotion(supabase, { teamId: "t1", riderId: "r11", seasonNumber: 3, getMarketState, notify: spyNotify() });
  assert.equal(res.completed, false);
  assert.equal(res.reason, "not_academy");
  assert.equal(rec.riderUpdates.length, 0);
});

test("#4495 completeStuckPromotion: rytter der imens er skiftet hold røres ikke", async () => {
  const { supabase, rec } = makeSupabase({ rider: { ...STUCK_PROMOTED_RIDER, team_id: "t-other" } });
  const getMarketState = async () => ({ squad_limits: { max: 30 }, future_count: 10, balance: 5000 });
  const res = await completeStuckPromotion(supabase, { teamId: "t1", riderId: "r11", seasonNumber: 3, getMarketState, notify: spyNotify() });
  assert.equal(res.completed, false);
  assert.equal(res.reason, "not_on_team");
  assert.equal(rec.riderUpdates.length, 0);
});

// ─── resolveNeverGraduated (#4495-reparation, 5/9) ─────────────────────────────
// Tilstand (c): INGEN grad-række overhovedet — default-kæden (YOUTH_RULES §2.2):
// promovér hvis plads+råd, ellers sælg, ellers slip. Genbruger completeStuck-
// Promotion, den eksporterede createGraduateAuction og releaseUnsoldGraduate —
// ingen ny implementation.

const NEVER_GRADUATED_RIDER = {
  id: "r12", team_id: "t1", is_academy: true, firstname: "Never", lastname: "Offered",
  base_value: 100000, prize_earnings_bonus: 0, market_value: 100000,
  salary: 500, contract_length: null, contract_end_season: null,
};

test("#4495 resolveNeverGraduated: plads + råd → promoverer (default-kædens 1. led)", async () => {
  const { supabase, rec } = makeSupabase({ rider: NEVER_GRADUATED_RIDER });
  const getMarketState = async () => ({ squad_limits: { max: 30 }, future_count: 10, balance: 5000 });
  const res = await resolveNeverGraduated(supabase, { teamId: "t1", riderId: "r12", seasonNumber: 3, getMarketState, notify: spyNotify() });
  assert.equal(res.action, "promoted");
  assert.equal(rec.riderUpdates[0].is_academy, false);
  assert.equal(rec.auctionInserts.length, 0);
});

test("#4495 resolveNeverGraduated: ingen plads → sælger (default-kædens 2. led, graduate-auktion)", async () => {
  const { supabase, rec } = makeSupabase({ rider: NEVER_GRADUATED_RIDER });
  const getMarketState = async () => ({ squad_limits: { max: 30 }, future_count: 30, balance: 5000 });
  const res = await resolveNeverGraduated(supabase, { teamId: "t1", riderId: "r12", seasonNumber: 3, getMarketState, auctionConfig: DEFAULT_AUCTION_CONFIG, notify: spyNotify() });
  assert.equal(res.action, "sold");
  assert.equal(rec.auctionInserts.length, 1);
  assert.equal(rec.auctionInserts[0].is_youth, false);
  assert.equal(rec.riderUpdates.length, 0, "is_academy rører IKKE ved salg — uændret til auktionen afgøres");
});

test("#4495 resolveNeverGraduated: negativ saldo → sælger (default-kædens 2. led)", async () => {
  const { supabase, rec } = makeSupabase({ rider: NEVER_GRADUATED_RIDER });
  const getMarketState = async () => ({ squad_limits: { max: 30 }, future_count: 10, balance: -2000 });
  const res = await resolveNeverGraduated(supabase, { teamId: "t1", riderId: "r12", seasonNumber: 3, getMarketState, auctionConfig: DEFAULT_AUCTION_CONFIG, notify: spyNotify() });
  assert.equal(res.action, "sold");
  assert.equal(rec.auctionInserts.length, 1);
});

test("#4495 resolveNeverGraduated: salg udskudt af #4004-sæsongrænsen → sidste led, slip", async () => {
  const { supabase, rec } = makeSupabase({
    rider: NEVER_GRADUATED_RIDER,
    upcomingSeason: { start_date: "2026-08-24" }, // grænse = 2026-08-23T18:00 dansk tid
  });
  const now = new Date("2026-08-23T10:00:00Z"); // 12t-gulvet presser sluttid forbi grænsen
  const getMarketState = async () => ({ squad_limits: { max: 30 }, future_count: 30, balance: 5000 }); // ingen plads → forsøg salg
  const res = await resolveNeverGraduated(supabase, { teamId: "t1", riderId: "r12", seasonNumber: 3, now, getMarketState, auctionConfig: DEFAULT_AUCTION_CONFIG, notify: spyNotify() });
  assert.equal(res.action, "released");
  assert.equal(rec.auctionInserts.length, 0, "auktion ikke oprettet — sæsongrænsen blokerede");
  assert.equal(rec.riderUpdates[0].team_id, null);
  assert.equal(rec.riderUpdates[0].is_academy, false);
});

test("#4495 resolveNeverGraduated: race mellem tjek og skriv (squad_cap_violation) falder til salg", async () => {
  const { supabase, rec } = makeSupabase({ rider: NEVER_GRADUATED_RIDER });
  let calls = 0;
  // Første kald (resolveNeverGraduateds eget tjek) siger plads; andet kald
  // (completeStuckPromotion's INTERNE tjek, lige før selve skrivningen) siger
  // fuld trup — modellerer en anden handling der lige har taget pladsen imens.
  const getMarketState = async () => {
    calls += 1;
    return calls === 1
      ? { squad_limits: { max: 30 }, future_count: 10, balance: 5000 }
      : { squad_limits: { max: 30 }, future_count: 30, balance: 5000 };
  };
  const res = await resolveNeverGraduated(supabase, { teamId: "t1", riderId: "r12", seasonNumber: 3, getMarketState, auctionConfig: DEFAULT_AUCTION_CONFIG, notify: spyNotify() });
  assert.equal(res.action, "sold");
  assert.equal(rec.auctionInserts.length, 1);
  assert.equal(rec.riderUpdates.length, 0, "promote-forsøget skrev intet — kastede squad_cap_violation FØR update");
});

test("#4495 resolveNeverGraduated: rytter der imens er kommet videre (is_academy=false) springes over", async () => {
  const { supabase, rec } = makeSupabase({ rider: { ...NEVER_GRADUATED_RIDER, is_academy: false } });
  const res = await resolveNeverGraduated(supabase, { teamId: "t1", riderId: "r12", seasonNumber: 3, notify: spyNotify() });
  assert.equal(res.action, "skipped");
  assert.equal(res.reason, "already_resolved");
  assert.equal(rec.riderUpdates.length, 0);
  assert.equal(rec.auctionInserts.length, 0);
});
