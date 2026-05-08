#!/usr/bin/env node
// #203: Mint Supabase JWT for et test-account.
// Bruger anon-key + signInWithPassword — ingen service-role-key i CLI.
//
// Forudsætning: test-konti er oprettet med kendt password (TEST_ACCOUNT_PASSWORD)
// via scripts/setup-test-accounts.mjs (eller Supabase MCP create_user).
//
// Brug:
//   node scripts/get-test-token.mjs --email=test-a@cyclingzone.dev
//   node scripts/get-test-token.mjs --email=test-a@cyclingzone.dev --json
//
// Env (læses fra backend/.env):
//   SUPABASE_URL              — Supabase project URL
//   SUPABASE_ANON_KEY         — anon/publishable key (ikke service-role)
//   TEST_ACCOUNT_PASSWORD     — fælles password for alle test-konti

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import process from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "../backend/.env") });

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

async function main() {
  const args = parseArgs(process.argv);
  const email = args.email;
  if (!email) {
    console.error("Brug: node scripts/get-test-token.mjs --email=<email> [--json]");
    process.exit(2);
  }

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const password = process.env.TEST_ACCOUNT_PASSWORD;

  if (!url || !anonKey) {
    console.error("Mangler SUPABASE_URL eller SUPABASE_ANON_KEY i backend/.env");
    process.exit(3);
  }
  if (!password) {
    console.error("Mangler TEST_ACCOUNT_PASSWORD i backend/.env");
    process.exit(3);
  }

  const supabase = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    console.error(`Login fejlede for ${email}: ${error.message}`);
    process.exit(1);
  }

  const token = data?.session?.access_token;
  if (!token) {
    console.error(`Ingen access_token returneret for ${email}`);
    process.exit(1);
  }

  if (args.json) {
    console.log(JSON.stringify({
      email,
      access_token: token,
      user_id: data.user.id,
      expires_at: data.session.expires_at,
    }));
  } else {
    console.log(token);
  }
}

main().catch((err) => {
  console.error("uventet fejl:", err.message);
  process.exit(1);
});
