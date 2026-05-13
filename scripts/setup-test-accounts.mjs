#!/usr/bin/env node
// #203: Opret/idempotent re-sync de 3 test-konti i prod-Supabase.
//
//   test-a@cyclingzone.dev      — alm. byder
//   test-b@cyclingzone.dev      — alm. byder (race-condition partner)
//   test-seller@cyclingzone.dev — sælger der opretter auktioner
//
// Kør:
//   node scripts/setup-test-accounts.mjs
//   node scripts/setup-test-accounts.mjs --dry-run
//
// Skriver IKKE password til stdout — kun til-/fra-status.
//
// Forudsætninger i backend/.env:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY, TEST_ACCOUNT_PASSWORD

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import process from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "../backend/.env"), quiet: true });

const TEST_ACCOUNTS = [
  { email: "test-a@cyclingzone.dev",      username: "test-a",      teamName: "Test A",      division: 3 },
  { email: "test-b@cyclingzone.dev",      username: "test-b",      teamName: "Test B",      division: 3 },
  { email: "test-seller@cyclingzone.dev", username: "test-seller", teamName: "Test Seller", division: 3 },
];

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

async function findAuthUserByEmail(admin, email) {
  // Supabase JS v2 admin.listUsers paginerer; vi sætter perPage høj og forventer
  // ≤ 50 brugere — open beta har 17.
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw new Error(`listUsers: ${error.message}`);
  return (data?.users || []).find(u => u.email === email) || null;
}

async function ensureAuthUser(admin, { email, password, dryRun }) {
  const existing = await findAuthUserByEmail(admin, email);
  if (existing) {
    return { user: existing, action: "exists" };
  }
  if (dryRun) {
    return { user: null, action: "would-create" };
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser(${email}): ${error.message}`);
  return { user: data.user, action: "created" };
}

async function ensureUsersRow(admin, { authUser, username, dryRun }) {
  const { data: existing, error: selErr } = await admin
    .from("users")
    .select("id, username, role")
    .eq("id", authUser.id)
    .maybeSingle();
  if (selErr) throw new Error(`select users: ${selErr.message}`);
  if (existing) return { row: existing, action: "exists" };

  if (dryRun) return { row: null, action: "would-insert" };

  const { data, error } = await admin
    .from("users")
    .insert({
      id: authUser.id,
      email: authUser.email,
      username,
      role: "manager",
      discord_dm_enabled: true,
    })
    .select("id, username, role")
    .single();
  if (error) throw new Error(`insert users: ${error.message}`);
  return { row: data, action: "inserted" };
}

async function ensureTeamRow(admin, { authUser, teamName, division, dryRun }) {
  const { data: existing, error: selErr } = await admin
    .from("teams")
    .select("id, name, balance, is_test_account, is_ai, is_bank, is_frozen")
    .eq("user_id", authUser.id)
    .maybeSingle();
  if (selErr) throw new Error(`select teams: ${selErr.message}`);

  if (existing) {
    // Tving korrekte flags + balance — uden at overskrive name hvis allerede sat.
    if (
      existing.is_test_account &&
      !existing.is_ai &&
      !existing.is_bank &&
      !existing.is_frozen &&
      existing.balance === 800000
    ) {
      return { row: existing, action: "exists" };
    }
    if (dryRun) return { row: existing, action: "would-update" };
    const { data, error } = await admin
      .from("teams")
      .update({
        is_test_account: true,
        is_ai: false,
        is_bank: false,
        is_frozen: false,
        balance: 800000,
      })
      .eq("id", existing.id)
      .select("id, name, balance, is_test_account")
      .single();
    if (error) throw new Error(`update teams: ${error.message}`);
    return { row: data, action: "updated" };
  }

  if (dryRun) return { row: null, action: "would-insert" };

  const { data, error } = await admin
    .from("teams")
    .insert({
      user_id: authUser.id,
      name: teamName,
      division,
      balance: 800000,
      sponsor_income: 240000,
      is_ai: false,
      is_bank: false,
      is_frozen: false,
      is_test_account: true,
    })
    .select("id, name, balance, is_test_account")
    .single();
  if (error) throw new Error(`insert teams: ${error.message}`);
  return { row: data, action: "inserted" };
}

async function main() {
  const args = parseArgs(process.argv);
  const dryRun = !!args["dry-run"];

  for (const v of ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "TEST_ACCOUNT_PASSWORD"]) {
    if (!process.env[v]) {
      console.error(`Mangler ${v} i backend/.env`);
      process.exit(3);
    }
  }

  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  console.log(`#203 setup-test-accounts ${dryRun ? "(dry-run)" : "(live)"}`);
  for (const acct of TEST_ACCOUNTS) {
    console.log(`\n→ ${acct.email}`);
    const { user, action: authAct } = await ensureAuthUser(admin, {
      email: acct.email,
      password: process.env.TEST_ACCOUNT_PASSWORD,
      dryRun,
    });
    console.log(`  auth: ${authAct}${user ? ` (id=${user.id})` : ""}`);
    if (!user) continue;

    const { action: userAct } = await ensureUsersRow(admin, {
      authUser: user,
      username: acct.username,
      dryRun,
    });
    console.log(`  users-row: ${userAct}`);

    const { row, action: teamAct } = await ensureTeamRow(admin, {
      authUser: user,
      teamName: acct.teamName,
      division: acct.division,
      dryRun,
    });
    console.log(`  team-row: ${teamAct}${row ? ` (id=${row.id} balance=${row.balance})` : ""}`);
  }

  console.log(dryRun ? "\nDry-run færdig — ingen ændringer." : "\nDone.");
}

main().catch((err) => {
  console.error("uventet fejl:", err);
  process.exit(1);
});
