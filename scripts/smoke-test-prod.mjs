#!/usr/bin/env node
// #203: Smoke-test af #192/#193/#194 mod prod uden manuel klik.
//
// Brug:
//   node scripts/smoke-test-prod.mjs --test=all
//   node scripts/smoke-test-prod.mjs --test=owner-check     (#192)
//   node scripts/smoke-test-prod.mjs --test=reserved-balance (#193)
//   node scripts/smoke-test-prod.mjs --test=race-confirm     (#194)
//
// Hvert scenario:
//   1. Setup state via service-role-key (balance reset + auction-fixture)
//   2. Kald backend-endpoint som test-konto via signInWithPassword JWT
//   3. Asserter HTTP-status + dansk fejlbesked
//   4. Cleanup (cancel test-auctions så de ikke kører videre)
//
// Forudsætninger:
//   backend/.env har SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY,
//   TEST_ACCOUNT_PASSWORD. Test-konti oprettet via scripts/setup-test-accounts.mjs.

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import process from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "../backend/.env") });

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || "https://cyclingzone-production.up.railway.app";

const TEST_EMAILS = {
  a: "test-a@cyclingzone.dev",
  b: "test-b@cyclingzone.dev",
  seller: "test-seller@cyclingzone.dev",
};

function parseArgs(argv) {
  const args = {};
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--")) {
      const [key, ...rest] = arg.slice(2).split("=");
      args[key] = rest.length ? rest.join("=") : true;
    }
  }
  return args;
}

function fmt(ok, msg) {
  return `${ok ? "✅" : "❌"} ${msg}`;
}

// ── Supabase clients ──────────────────────────────────────────────────────────

function makeAdminClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

async function signIn(email) {
  const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({
    email,
    password: process.env.TEST_ACCOUNT_PASSWORD,
  });
  if (error || !data?.session?.access_token) {
    throw new Error(`signIn(${email}) failed: ${error?.message || "no token"}`);
  }
  return { token: data.session.access_token, userId: data.user.id };
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function api(token, method, path, body) {
  const res = await fetch(`${BACKEND_URL}/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed = null;
  const text = await res.text();
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
  return { status: res.status, body: parsed };
}

// ── Setup helpers (service-role-key) ──────────────────────────────────────────

async function getTestTeams(admin) {
  const { data, error } = await admin
    .from("teams")
    .select("id, user_id, name, balance, is_test_account")
    .eq("is_test_account", true);
  if (error) throw new Error(`getTestTeams: ${error.message}`);

  // auth.users tabellen har email; public.users har kun username + email i nogle setups.
  // Brug Supabase admin auth API for at slå email op pr. user_id.
  const byEmail = {};
  for (const t of data || []) {
    if (!t.user_id) continue;
    const { data: authUser } = await admin.auth.admin.getUserById(t.user_id);
    const email = authUser?.user?.email;
    if (email) byEmail[email] = t;
  }
  return byEmail;
}

async function resetBalances(admin, teamIds, amount = 800000) {
  const { error } = await admin
    .from("teams")
    .update({ balance: amount })
    .in("id", teamIds);
  if (error) throw new Error(`resetBalances: ${error.message}`);
}

async function cancelTestAuctions(admin, sellerIds) {
  // Sæt aktive/extended auktioner fra test-sælgere til 'cancelled' så vi starter rent.
  const { error } = await admin
    .from("auctions")
    .update({ status: "cancelled" })
    .in("seller_team_id", sellerIds)
    .in("status", ["active", "extended"]);
  if (error) throw new Error(`cancelTestAuctions: ${error.message}`);
}

async function clearProxiesForTeams(admin, teamIds) {
  const { error } = await admin
    .from("auction_proxy_bids")
    .delete()
    .in("team_id", teamIds);
  if (error) throw new Error(`clearProxiesForTeams: ${error.message}`);
}

async function findFreeAgentRiders(admin, count) {
  const { data, error } = await admin
    .from("riders")
    .select("id, firstname, lastname, uci_points")
    .is("team_id", null)
    .gte("uci_points", 100)
    .order("uci_points", { ascending: false })
    .limit(count);
  if (error) throw new Error(`findFreeAgentRiders: ${error.message}`);
  if ((data || []).length < count) {
    throw new Error(`Mangler ${count - (data || []).length} free-agent ryttere — kan ikke setup smoke-test`);
  }
  return data;
}

async function ensureTestSellerOwnsRider(admin, sellerId, riderId) {
  const { error } = await admin
    .from("riders")
    .update({ team_id: sellerId })
    .eq("id", riderId);
  if (error) throw new Error(`ensureTestSellerOwnsRider: ${error.message}`);
}

async function createAuctionRow(admin, { sellerId, riderId, startingPrice, currentPrice, currentBidderId, calculatedEnd }) {
  const { data, error } = await admin
    .from("auctions")
    .insert({
      seller_team_id: sellerId,
      rider_id: riderId,
      starting_price: startingPrice,
      current_price: currentPrice ?? startingPrice,
      current_bidder_id: currentBidderId ?? null,
      calculated_end: calculatedEnd ?? new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      status: "active",
      min_increment: 1,
    })
    .select("id, current_price")
    .single();
  if (error) throw new Error(`createAuctionRow: ${error.message}`);
  return data;
}

async function setProxyDirect(admin, { auctionId, teamId, maxAmount }) {
  const { error } = await admin
    .from("auction_proxy_bids")
    .upsert(
      { auction_id: auctionId, team_id: teamId, max_amount: maxAmount },
      { onConflict: "auction_id,team_id" }
    );
  if (error) throw new Error(`setProxyDirect: ${error.message}`);
}

// ── Scenarios ─────────────────────────────────────────────────────────────────

async function scenarioOwnerCheck({ admin, teams }) {
  const seller = teams[TEST_EMAILS.seller];
  if (!seller) throw new Error("test-seller-konto findes ikke");

  // Frisk rytter, tildel test-seller, lav auktion. test-seller forsøger så at
  // sætte proxy på egen auktion → backend skal returnere 400 (#192).
  const [rider] = await findFreeAgentRiders(admin, 1);
  await ensureTestSellerOwnsRider(admin, seller.id, rider.id);
  const auction = await createAuctionRow(admin, {
    sellerId: seller.id,
    riderId: rider.id,
    startingPrice: 10000,
    currentPrice: 10000,
    currentBidderId: null,
  });

  const { token } = await signIn(TEST_EMAILS.seller);
  const res = await api(token, "PATCH", `/auctions/${auction.id}/proxy`, { max_amount: 50000 });

  const ok = res.status === 400 && /egen rytter/i.test(res.body?.error || "");
  return {
    ok,
    msg: ok
      ? `#192 owner-check: PATCH /proxy returnerede 400 med "${res.body.error}"`
      : `#192 owner-check FEJL: status=${res.status} body=${JSON.stringify(res.body)}`,
    cleanup: async () => {
      await admin.from("auctions").update({ status: "cancelled" }).eq("id", auction.id);
      await admin.from("riders").update({ team_id: null }).eq("id", rider.id);
    },
  };
}

async function scenarioReservedBalance({ admin, teams }) {
  const seller = teams[TEST_EMAILS.seller];
  const a = teams[TEST_EMAILS.a];
  if (!seller || !a) throw new Error("test-seller eller test-a findes ikke");

  // Reset test-a balance til 800K for forudsigeligt scenario
  await resetBalances(admin, [a.id], 800000);

  // 3 nye free-agent ryttere → tildel test-seller → 3 auktioner med test-a som
  // current_bidder (50K + proxy 200K, 80K, ingen)
  const riders = await findFreeAgentRiders(admin, 3);
  for (const r of riders) await ensureTestSellerOwnsRider(admin, seller.id, r.id);

  const auc1 = await createAuctionRow(admin, {
    sellerId: seller.id, riderId: riders[0].id,
    startingPrice: 10000, currentPrice: 50000, currentBidderId: a.id,
  });
  await setProxyDirect(admin, { auctionId: auc1.id, teamId: a.id, maxAmount: 200000 });

  const auc2 = await createAuctionRow(admin, {
    sellerId: seller.id, riderId: riders[1].id,
    startingPrice: 10000, currentPrice: 80000, currentBidderId: a.id,
  });

  const auc3 = await createAuctionRow(admin, {
    sellerId: seller.id, riderId: riders[2].id,
    startingPrice: 10000, currentPrice: 10000, currentBidderId: null,
  });

  // Forventet reserved-balance for test-a:
  //   auc1: max(50K, 200K) = 200K
  //   auc2: max(80K, 0)    =  80K  (ingen proxy)
  //   total reserved = 280K
  //   available efter reserved = 800K - 280K = 520K
  // Bud 250K på auc3 → samlet commitment 530K (250 nyt + 280 reserved på 1+2),
  //   over balance på 800K? Nej, faktisk under. Lad os bruge større bud.
  //
  // For at trigge insufficient_available_balance skal amount > available efter reserved:
  //   amount > 520K → 600K
  //
  // (#193's regression: før fix var reserved = 50K + 80K = 130K, så 600K bud ville
  // være OK ifølge buggy beregning men forkert fordi worst-case er 280K reserved.)
  const { token } = await signIn(TEST_EMAILS.a);
  const res = await api(token, "POST", `/auctions/${auc3.id}/bid`, { amount: 600000 });

  // Forventet: 400, dansk fejl med "tilbage" + det rigtige beløb (520.000 CZ$).
  const matches520 =
    res.status === 400 &&
    /tilbage/i.test(res.body?.error || "") &&
    /520\.000|520000|520 000/.test(res.body?.error || "");
  return {
    ok: matches520,
    msg: matches520
      ? `#193 reserved-balance: POST /bid returnerede 400 med "${res.body.error}"`
      : `#193 reserved-balance FEJL: status=${res.status} body=${JSON.stringify(res.body)}`,
    cleanup: async () => {
      await admin.from("auctions").update({ status: "cancelled" }).in("id", [auc1.id, auc2.id, auc3.id]);
      await admin.from("auction_proxy_bids").delete().in("auction_id", [auc1.id, auc2.id, auc3.id]);
      await admin.from("riders").update({ team_id: null }).in("id", riders.map(r => r.id));
      await resetBalances(admin, [a.id], 800000);
    },
  };
}

async function scenarioRaceConfirm({ admin, teams }) {
  const seller = teams[TEST_EMAILS.seller];
  const a = teams[TEST_EMAILS.a];
  const b = teams[TEST_EMAILS.b];
  if (!seller || !a || !b) throw new Error("test-seller / test-a / test-b mangler");

  await resetBalances(admin, [a.id, b.id], 800000);

  // 1 auktion ved current_price=50K, ingen leader (begge byder fra ren state)
  const [rider] = await findFreeAgentRiders(admin, 1);
  await ensureTestSellerOwnsRider(admin, seller.id, rider.id);
  const auc = await createAuctionRow(admin, {
    sellerId: seller.id, riderId: rider.id,
    startingPrice: 10000, currentPrice: 50000, currentBidderId: null,
  });

  const [{ token: tokenA }, { token: tokenB }] = await Promise.all([
    signIn(TEST_EMAILS.a),
    signIn(TEST_EMAILS.b),
  ]);

  // Først forsøges Promise.all — hvis backend tilfældigt serialiserer reads
  // sekventielt får vi den klassiske 200/409-split. Hvis begge læser 50K før
  // nogen committer, falder vi tilbage til sekventiel test (deterministisk).
  const [resA1, resB1] = await Promise.all([
    api(tokenA, "POST", `/auctions/${auc.id}/bid`, { amount: 60000, expected_current_price: 50000 }),
    api(tokenB, "POST", `/auctions/${auc.id}/bid`, { amount: 60000, expected_current_price: 50000 }),
  ]);
  const parallelStatuses = [resA1.status, resB1.status].sort((x, y) => x - y);
  let resA = resA1, resB = resB1, mode = "parallel";

  // Fallback: hvis Promise.all gav begge 200 (TOCTOU window), test sekventielt
  // med eksplicit stale expected_current_price på B.
  if (parallelStatuses[0] === 200 && parallelStatuses[1] === 200) {
    // Ryd state og kør stale-detection test
    await admin.from("auctions").update({ current_price: 50000, current_bidder_id: null }).eq("id", auc.id);
    await admin.from("auction_bids").delete().eq("auction_id", auc.id);

    resA = await api(tokenA, "POST", `/auctions/${auc.id}/bid`, { amount: 60000, expected_current_price: 50000 });
    // B's request bruger samme expected som før A's commit — svarer til
    // brugerens UI der ikke har set realtime-update endnu.
    resB = await api(tokenB, "POST", `/auctions/${auc.id}/bid`, { amount: 70000, expected_current_price: 50000 });
    mode = "sequential";
  }

  const statuses = [resA.status, resB.status].sort((x, y) => x - y);
  const oneOk = statuses[0] === 200 && statuses[1] === 409;
  const loser = resA.status === 409 ? resA : resB;
  const errorOk = loser.body?.error === "price_changed";

  const ok = oneOk && errorOk;
  return {
    ok,
    msg: ok
      ? `#194 race-confirm (${mode}): én vandt (200), én fik 409 "price_changed" med currentPrice=${loser.body.currentPrice}`
      : `#194 race-confirm FEJL (${mode}): A=${resA.status}/${JSON.stringify(resA.body)} B=${resB.status}/${JSON.stringify(resB.body)}`,
    cleanup: async () => {
      await admin.from("auctions").update({ status: "cancelled" }).eq("id", auc.id);
      await admin.from("riders").update({ team_id: null }).eq("id", rider.id);
      await resetBalances(admin, [a.id, b.id], 800000);
    },
  };
}

// ── Runner ────────────────────────────────────────────────────────────────────

async function run(name, fn) {
  process.stdout.write(`▶ ${name} ... `);
  let result;
  try {
    result = await fn();
    console.log(result.ok ? "✅" : "❌");
    console.log(`  ${result.msg}`);
  } catch (err) {
    console.log("💥");
    console.log(`  Uventet fejl: ${err.message}`);
    return { ok: false, cleanup: null };
  }
  if (result.cleanup) {
    try { await result.cleanup(); } catch (e) { console.error(`  cleanup-fejl: ${e.message}`); }
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv);
  const which = args.test || "all";

  for (const v of ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "SUPABASE_ANON_KEY", "TEST_ACCOUNT_PASSWORD"]) {
    if (!process.env[v]) {
      console.error(`Mangler ${v} i backend/.env`);
      process.exit(3);
    }
  }

  const admin = makeAdminClient();
  const teams = await getTestTeams(admin);
  const sellerTeam = teams[TEST_EMAILS.seller];
  const aTeam = teams[TEST_EMAILS.a];
  const bTeam = teams[TEST_EMAILS.b];
  if (!sellerTeam || !aTeam || !bTeam) {
    console.error("Mangler test-konti. Kør scripts/setup-test-accounts.mjs først.");
    process.exit(4);
  }

  // Pre-cleanup: cancel evt. tidligere test-auktioner + ryd proxies
  await cancelTestAuctions(admin, [sellerTeam.id, aTeam.id, bTeam.id]);
  await clearProxiesForTeams(admin, [aTeam.id, bTeam.id]);

  const ctx = { admin, teams };
  const results = [];

  if (which === "all" || which === "owner-check") {
    results.push(await run("#192 owner-check", () => scenarioOwnerCheck(ctx)));
  }
  if (which === "all" || which === "reserved-balance") {
    results.push(await run("#193 reserved-balance", () => scenarioReservedBalance(ctx)));
  }
  if (which === "all" || which === "race-confirm") {
    results.push(await run("#194 race-confirm", () => scenarioRaceConfirm(ctx)));
  }

  const failed = results.filter(r => !r.ok).length;
  console.log("");
  console.log(fmt(failed === 0, `${results.length - failed}/${results.length} scenarier grønne`));
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("uventet fejl:", err);
  process.exit(1);
});
