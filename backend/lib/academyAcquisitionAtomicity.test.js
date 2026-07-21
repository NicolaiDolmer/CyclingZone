/**
 * #1558 — Atomær akademi-optagelse: concurrency-property-tests.
 *
 * Disse tests verificerer at akademi-write-stierne
 * (finalizeYouthAuctionRecord, signAcademyCandidate) går gennem den atomære RPC
 * `finalize_academy_acquisition` og at racen + dobbelt-debitten er lukket.
 * (#2456: signFreeAgentYouth-stien er fjernet sammen med fri-agent-butikken.)
 *
 * Selve TOCTOU-beskyttelsen leveres af pg_advisory_xact_lock(team_id) i Postgres-
 * RPC'en (database/2026-06-20-academy-acquisition-rpc.sql) og kan kun verificeres
 * fuldt mod en rigtig Supabase-instans (manuel race-test mod preview-branch efter
 * deploy). Her simulerer en mock-RPC plpgsql-semantikken UNDER en per-team mutex-
 * kæde (samme mønster som balanceAtomicity.test.js' createSerializedRpcMock), så
 * vi kan fyre N parallelle kald og assertere de invarianter koden SKAL holde:
 *   - præcis ÉN optagelse lykkes når cap-grænsen rammes
 *   - netto kun ÉN debit
 *   - cap aldrig overskredet (≤ 8)
 *   - finalize-vs-signAcademyCandidate-krydset (forskellige stier, samme team,
 *     samme rytter) → kun ÉN debit, kun ÉN optagelse
 */
import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_KEY ??= "test-service-key";

const { finalizeAuctionById } = await import("./auctionFinalization.js");
const { signAcademyCandidate } = await import("./academyIntake.js");

const DUPLICATE_VIOLATION_CODE = "23505";

/**
 * Delt verden-state for ét hold + en pulje af ungdomsryttere. Mockens
 * finalize_academy_acquisition-RPC replikerer plpgsql-semantikken (cap-check →
 * balance-check → guarded rider-update → betinget debit) UNDER en per-team
 * mutex-kæde, så concurrent RPC-kald på samme team serialiserer ligesom
 * pg_advisory_xact_lock(team_id) i prod.
 */
function makeAcademyWorld({
  teamId = "team-A",
  balance = 1_000_000,
  riders = {},
  academyStart = 0,
} = {}) {
  // riders: { riderId: { team_id, is_academy, ... } }
  const state = {
    balance,
    riders: { ...riders },
    financeRows: [],
    idempotencyKeys: new Set(),
    rpcCalls: 0,
    // Antal akademiryttere "på holdet" der ikke er i riders-map'en (baseline).
    academyBaseline: academyStart,
  };

  function academyCount() {
    let n = state.academyBaseline;
    for (const r of Object.values(state.riders)) {
      if (r.team_id === teamId && r.is_academy === true) n += 1;
    }
    return n;
  }

  // Per-team mutex-kæde — kun én finalize_academy_acquisition ad gangen pr. team.
  let chain = Promise.resolve();

  const supabase = {
    rpc(name, params) {
      if (name === "finalize_academy_acquisition") {
        const next = chain.then(async () => {
          state.rpcCalls += 1;
          // Simulér DB-roundtrip så concurrent calls reelt overlapper.
          await new Promise((resolve) => setTimeout(resolve, 1));

          const price = Number(params.p_price);

          // (a) cap-check
          if (academyCount() >= 8) {
            return { data: { ok: false, code: "academy_full" }, error: null };
          }

          // (b) balance-check (kun betalende)
          if (price > 0 && state.balance < price) {
            return { data: { ok: false, code: "insufficient_balance" }, error: null };
          }

          // (c) guarded rider-update
          const rider = state.riders[params.p_rider_id];
          const alreadyAssigned = rider && rider.team_id != null && rider.is_academy === true;
          if (alreadyAssigned) {
            return { data: { ok: false, code: "already_assigned" }, error: null };
          }
          state.riders[params.p_rider_id] = {
            ...(rider || {}),
            team_id: teamId,
            is_academy: true,
            salary: Number(params.p_salary),
            contract_length: params.p_contract_length,
            contract_end_season: params.p_contract_end_season,
            acquired_at: params.p_acquired_at,
            pending_team_id: null,
          };

          // (d) debit (kun betalende). Idempotency: dublet-key → 23505-rollback.
          if (price > 0) {
            const key = params.p_finance_payload?.idempotency_key;
            if (key && state.idempotencyKeys.has(key)) {
              // RPC ruller hele transaktionen tilbage ved 23505 — fortryd
              // rider-update'en for at spejle ROLLBACK.
              state.riders[params.p_rider_id] = rider;
              return { data: null, error: { code: DUPLICATE_VIOLATION_CODE, message: "duplicate" } };
            }
            if (key) state.idempotencyKeys.add(key);
            const before = state.balance;
            state.balance -= price;
            state.financeRows.push({
              team_id: params.p_team_id,
              before_balance: before,
              after_balance: state.balance,
              ...params.p_finance_payload,
            });
          }

          return {
            data: { ok: true, balance: state.balance, academy_count: academyCount() },
            error: null,
          };
        });
        chain = next.then(() => {}, () => {});
        return next;
      }
      throw new Error(`Unexpected RPC: ${name}`);
    },
    _state: state,
    _academyCount: academyCount,
  };

  return { supabase, state, academyCount };
}

// ─── RACE: N parallelle finalize på et hold med count=7 (1 ledig plads) ────────

test("RACE: N parallelle akademi-auktion-finalize, count=7 — præcis ÉN lykkes, resten academy_full, netto ÉN debit", async () => {
  const N = 6;
  const teamId = "buyer-team";
  // Hver finalize prøver at optage SIN egen rytter i den ENE ledige plads.
  const riders = {};
  const auctions = {};
  for (let i = 0; i < N; i++) {
    const rid = `youth-${i}`;
    riders[rid] = { team_id: null, is_academy: false, firstname: "Y", lastname: `${i}`, base_value: 100000, market_value: 100000, prize_earnings_bonus: 0 };
    auctions[`auc-${i}`] = {
      id: `auc-${i}`,
      status: "active",
      is_youth: true,
      seller_team_id: null,
      current_bidder_id: teamId,
      current_price: 25000,
      rider: { id: rid, ...riders[rid] },
    };
  }

  const { supabase, state } = makeAcademyWorld({ teamId, balance: 1_000_000, riders, academyStart: 7 });

  // Wire auctions + seasons + teams + transfer_listings + riders read ind i
  // verden-mocken (RPC'en deles, men finalize læser også auction/season/team).
  const baseRpc = supabase.rpc.bind(supabase);
  const wired = {
    rpc: baseRpc,
    from(table) {
      if (table === "auctions") {
        return {
          select: () => ({ eq: (col, id) => ({ maybeSingle: () => Promise.resolve({ data: auctions[id] ?? null, error: null }) }) }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
      }
      if (table === "seasons") {
        return { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "season-1", number: 1 }, error: null }) }) }) }) }) };
      }
      if (table === "teams") {
        // #2754: getTeamMarketState (senior-fallback) læser via expectSingle → .single();
        // akademi-lønnen slår division op via .maybeSingle(). Begge understøttes.
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { id: teamId, name: "Buyer", balance: state.balance, division: 3 }, error: null }),
              single: () => Promise.resolve({ data: { id: teamId, name: "Buyer", balance: state.balance, division: 3, user_id: "u" }, error: null }),
            }),
          }),
        };
      }
      if (table === "transfer_listings") {
        return { update: () => ({ in: () => ({ in: () => Promise.resolve({ error: null }) }) }) };
      }
      // #2456: taberne (academy_full) sletter nu deres usolgte rytter — mocken
      // spejler #1847-guarden (ingen resultater) + den betingede DELETE mod
      // verden-state (kun holdløse ikke-akademi-ryttere rammes).
      if (table === "race_results") {
        return { select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) };
      }
      if (table === "riders") {
        return {
          // #2754: getTeamMarketState's senior-count-queries. Senior sat FULDT (30)
          // så senior-fallbacken afvises (squad_full) og taberne cancel+deleter som
          // før — denne test isolerer AKADEMI-cap-atomicitet, ikke senior-overflow.
          select(cols, options) {
            assert.equal(cols, "id");
            assert.deepEqual(options, { count: "exact", head: true });
            return {
              eq(column) {
                if (column === "team_id") {
                  const b = {
                    eq() { return b; },
                    not() { return { neq: () => Promise.resolve({ count: 0, error: null }) }; },
                    then(resolve, reject) { return Promise.resolve({ count: 30, error: null }).then(resolve, reject); },
                  };
                  return b;
                }
                const pb = {
                  eq() { return pb; },
                  then(resolve, reject) { return Promise.resolve({ count: 0, error: null }).then(resolve, reject); },
                };
                return pb;
              },
            };
          },
          delete() {
            const filters = {};
            const api = {
              eq(col, val) { filters[col] = val; return api; },
              is(col, val) { filters[col] = val; return api; },
              select() {
                const r = state.riders[filters.id];
                const deletable = r && r.team_id == null && r.is_academy !== true;
                if (!deletable) return Promise.resolve({ data: [], error: null });
                delete state.riders[filters.id];
                return Promise.resolve({ data: [{ id: filters.id }], error: null });
              },
            };
            return api;
          },
        };
      }
      if (table === "rider_watchlist") {
        // #2524: deleteUnsoldYouthRider kalder notifyAndClearWatchlistForRiders
        // efter en bekræftet sletning — ingen af disse fixtures har ønskeliste-
        // rækker for de tabende youth-ryttere, så et tomt svar er nok.
        return {
          select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }),
          delete: () => ({ in: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) }),
        };
      }
      if (table === "academy_intake") {
        // #2627: deleteUnsoldYouthRider tjekker for et UDLØBET intake-tilbud før
        // sletning — disse fixtures er afviste/almindelige youth (ingen expired-række).
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };

  const results = await Promise.all(
    Object.keys(auctions).map((aid) =>
      finalizeAuctionById({
        supabase: wired,
        auctionId: aid,
        notifyTeamOwner: async () => {},
        now: new Date("2026-06-20T12:00:00Z"),
      })
    )
  );

  const completed = results.filter((r) => r.code === "youth_completed");
  const full = results.filter((r) => r.code === "academy_full");

  assert.equal(completed.length, 1, `præcis 1 finalize må lykkes — fik ${completed.length}`);
  assert.equal(full.length, N - 1, `de øvrige ${N - 1} må returnere academy_full`);
  assert.equal(state.financeRows.length, 1, "netto kun ÉN debit");
  assert.equal(state.balance, 1_000_000 - 25000, "balance kun trukket én gang");

  // Cap aldrig overskredet.
  const finalCount = Object.values(state.riders).filter((r) => r.team_id === teamId && r.is_academy).length + state.academyBaseline;
  assert.equal(finalCount, 8, "akademi-cap præcis fyldt (7 + 1), aldrig over 8");

  // #2456 "usolgt = væk": den ENE optagne rytter består; de N-1 tabere er slettet
  // (ikke efterladt som holdløse spøgelsesryttere), og en optaget rytter blev
  // aldrig ramt af en sletning.
  assert.equal(Object.keys(state.riders).length, 1, "kun den optagne rytter tilbage i verden");
  const survivor = Object.values(state.riders)[0];
  assert.equal(survivor.team_id, teamId, "overleveren er den optagne akademirytter");
  assert.equal(survivor.is_academy, true);
  for (const r of results) {
    if (r.code === "academy_full") assert.equal(r.rider_deleted, true, "taber-rytter slettet");
  }
});

// ─── KRYDS: finalize-vs-signAcademyCandidate, samme team + samme rytter ────────

test("KRYDS: finalize + signAcademyCandidate samtidig (samme team, samme rytter) — kun ÉN debit, cap ≤ 8", async () => {
  const teamId = "team-A";
  const riderId = "rider-shared";
  const rider = { id: riderId, team_id: null, is_academy: false, firstname: "Sander", lastname: "Akademi", base_value: 100000, market_value: 100000, prize_earnings_bonus: 0 };

  const { supabase, state } = makeAcademyWorld({ teamId, balance: 1_000_000, riders: { [riderId]: { ...rider } }, academyStart: 0 });
  const baseRpc = supabase.rpc.bind(supabase);

  // finalize-stien (auctionFinalization): youth-auktion for samme rytter.
  const auction = {
    id: "auc-shared",
    status: "active",
    is_youth: true,
    seller_team_id: null,
    current_bidder_id: teamId,
    current_price: 25000,
    rider: { ...rider },
  };
  const finalizeClient = {
    rpc: baseRpc,
    from(table) {
      if (table === "auctions") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: auction, error: null }) }) }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
      }
      if (table === "seasons") {
        return { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "season-1", number: 1 }, error: null }) }) }) }) }) };
      }
      if (table === "teams") {
        // #2701: getTeamMarketState (senior-først) læser via .single(); akademi-løn via .maybeSingle().
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { id: teamId, name: "T", balance: state.balance, division: 3 }, error: null }),
              single: () => Promise.resolve({ data: { id: teamId, name: "T", balance: state.balance, division: 3, user_id: "u" }, error: null }),
            }),
          }),
        };
      }
      if (table === "riders") {
        // #2701: getTeamMarketState count-queries. Senior sat FULDT (30) → finalize
        // falder til AKADEMI og racer med signAcademyCandidate (testens pointe bevaret).
        return {
          select(cols, options) {
            assert.equal(cols, "id");
            assert.deepEqual(options, { count: "exact", head: true });
            return {
              eq(column) {
                if (column === "team_id") {
                  const b = { eq() { return b; }, not() { return { neq: () => Promise.resolve({ count: 0, error: null }) }; }, then(res, rej) { return Promise.resolve({ count: 30, error: null }).then(res, rej); } };
                  return b;
                }
                const pb = { eq() { return pb; }, then(res, rej) { return Promise.resolve({ count: 0, error: null }).then(res, rej); } };
                return pb;
              },
            };
          },
        };
      }
      if (table === "transfer_listings") {
        return { update: () => ({ in: () => ({ in: () => Promise.resolve({ error: null }) }) }) };
      }
      throw new Error(`finalize: unexpected table ${table}`);
    },
  };

  // signAcademyCandidate-stien (academyIntake): intake + rider-lookup + RPC + intake-update + notif.
  let intakeStatus = "offered";
  const signClient = {
    rpc: baseRpc,
    from(table) {
      if (table === "academy_intake") {
        const api = {
          select() { return api; },
          eq() { return api; },
          maybeSingle() { return Promise.resolve({ data: { id: "intake-1", status: intakeStatus }, error: null }); },
          update(data) { intakeStatus = data.status; return { eq: () => Promise.resolve({ error: null }) }; },
        };
        return api;
      }
      if (table === "riders") {
        return {
          select() { const api = { eq() { return api; }, maybeSingle() { return Promise.resolve({ data: { ...rider }, error: null }); } }; return api; },
        };
      }
      if (table === "teams") {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { user_id: "user-1" }, error: null }) }) }) };
      }
      if (table === "notifications") {
        const api = { select() { return api; }, eq() { return api; }, gte() { return api; }, order() { return api; }, is() { return api; }, limit() { return Promise.resolve({ data: [], error: null }); }, insert() { return Promise.resolve({ error: null }); } };
        return api;
      }
      throw new Error(`sign: unexpected table ${table}`);
    },
  };

  const [finalizeRes, signRes] = await Promise.allSettled([
    finalizeAuctionById({ supabase: finalizeClient, auctionId: "auc-shared", notifyTeamOwner: async () => {}, now: new Date("2026-06-20T12:00:00Z") }),
    signAcademyCandidate(signClient, { teamId, riderId, seasonNumber: 1 }),
  ]);

  // Netop ÉN debit på tværs af de to forskellige stier (det var rod-årsagen:
  // før-fix lavede de to separate finance_transactions med forskellige keys).
  assert.equal(state.financeRows.length, 1, `netto kun ÉN debit på tværs af de to stier — fik ${state.financeRows.length}`);
  assert.equal(state.balance, 1_000_000 - 25000, "balance kun trukket én gang");

  // Rytteren er optaget præcis én gang; cap = 1, aldrig over 8.
  const finalCount = Object.values(state.riders).filter((r) => r.team_id === teamId && r.is_academy).length;
  assert.equal(finalCount, 1, "rytteren optaget præcis én gang");
  assert.ok(finalCount <= 8, "cap aldrig overskredet");

  // Den tabende sti skal enten kaste 'already_assigned'-afledt fejl eller
  // returnere en ikke-completed kode — IKKE en succesfuld debit.
  const outcomes = [finalizeRes, signRes];
  const successfulPlacements = outcomes.filter((o) => {
    if (o.status === "fulfilled") {
      // finalize returnerer {code:'youth_completed'}; sign returnerer {riderId,...}
      return o.value?.code === "youth_completed" || (o.value && "fee" in o.value);
    }
    return false;
  });
  assert.equal(successfulPlacements.length, 1, "præcis én sti må rapportere en gennemført optagelse");
});
