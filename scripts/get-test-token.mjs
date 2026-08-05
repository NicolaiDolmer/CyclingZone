#!/usr/bin/env node
// #203: Mint Supabase JWT for et test-account.
// Bruger anon-key + signInWithPassword — ingen service-role-key i CLI.
//
// SIKKERHED (#3342): default-output-kanalen er en gitignored fil, IKKE
// stdout. Stdout = agent-transcript naar scriptet koeres fra en agent (Claude
// Code, subagent, spawn_task) — et fuldt Supabase access_token paa stdout er
// en direkte secret-leak-vektor. Leaket 2026-08-04 20:00 under #3336-arbejde;
// fanget af sanitize-secrets.sh, men FOERST efter tokenet allerede stod i
// transcriptet. Se docs/SECRET_LEAK_VECTORS.md (tabel B).
//
// Forudsætning: test-konti er oprettet med kendt password (TEST_ACCOUNT_PASSWORD)
// via scripts/setup-test-accounts.mjs (eller Supabase MCP create_user).
//
// Brug (SIKKER default — skriver til fil, printer kun stien):
//   node scripts/get-test-token.mjs --email=test-a@cyclingzone.dev
//   node scripts/get-test-token.mjs --email=test-a@cyclingzone.dev --out=.codex.local/my-token.json
//
// Brug (UTRYG — printer tokenet direkte til stdout):
//   node scripts/get-test-token.mjs --email=test-a@cyclingzone.dev --print
//   node scripts/get-test-token.mjs --email=test-a@cyclingzone.dev --print --json
//
//   ADVARSEL: --print er KUN til manuel brug fra en terminal UDENFOR Claude
//   Code. Kør ALDRIG --print fra en agent-session — stdout ER transcriptet,
//   og tokenet lander permanent i konteksten selvom sanitize-secrets.sh
//   fanger og redacter det bagefter (#3342). Blokeres proaktivt af
//   .claude/hooks/block-dangerous-secret-commands.sh.
//
// Env (læses fra backend/.env):
//   SUPABASE_URL              — Supabase project URL
//   SUPABASE_ANON_KEY         — anon/publishable key (ikke service-role)
//   TEST_ACCOUNT_PASSWORD     — fælles password for alle test-konti

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { mkdirSync, writeFileSync, chmodSync } from "fs";
import process from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const DEFAULT_OUT = join(REPO_ROOT, ".codex.local", "test-token.json");

config({ path: join(__dirname, "../backend/.env"), quiet: true });

const HELP = `
Brug:
  node scripts/get-test-token.mjs --email=<email> [--out=<path>]
  node scripts/get-test-token.mjs --email=<email> --print [--json]   ⚠️ UTRYG

Default (sikker): minter tokenet og skriver det til en gitignored fil
(default: .codex.local/test-token.json, restriktive rettigheder hvor OS
tillader det). Stdout printer KUN filstien — aldrig selve tokenet.

Flags:
  --email=<email>  Påkrævet. Test-konto-email (fx test-a@cyclingzone.dev).
  --out=<path>     Overstyr output-filens sti (default .codex.local/test-token.json).
  --json           Sammen med --print: print fuldt JSON-objekt (email,
                    access_token, user_id, expires_at) i stedet for bar token.
                    Uden --print: ingen effekt — filen er altid JSON.
  --print          ⚠️ ALDRIG fra en agent-session. Printer tokenet (eller
                    JSON m. --json) direkte til stdout — den gamle, utrygge
                    adfærd. Kun til manuel brug i en terminal UDENFOR Claude
                    Code. Se docs/SECRET_LEAK_VECTORS.md.
  --help           Vis denne hjælp.
`;

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

  if (args.help) {
    console.log(HELP.trim());
    return;
  }

  const email = args.email;
  if (!email) {
    console.error("Brug: node scripts/get-test-token.mjs --email=<email> [--out=<path>] [--print] [--json]");
    console.error("Kør med --help for fuld dokumentation.");
    process.exit(2);
  }

  // Infisical (env=dev) har anon-key/URL under frontend-prefikset
  // VITE_SUPABASE_*; fald tilbage til dem så scriptet virker både med en
  // backend/.env og med `infisical run --env=dev` (#767 follow-up 2026-05-30).
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const password = process.env.TEST_ACCOUNT_PASSWORD;

  if (!url || !anonKey) {
    console.error("Mangler SUPABASE_URL/VITE_SUPABASE_URL eller SUPABASE_ANON_KEY/VITE_SUPABASE_ANON_KEY (backend/.env eller Infisical)");
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

  const payload = {
    email,
    access_token: token,
    user_id: data.user.id,
    expires_at: data.session.expires_at,
  };

  if (args.print) {
    console.error(
      "⚠️  ADVARSEL: --print skriver tokenet direkte til stdout. " +
        "Kør ALDRIG dette fra en agent-session (Claude Code/subagent/spawn_task) " +
        "— stdout ER transcriptet (#3342, docs/SECRET_LEAK_VECTORS.md)."
    );
    if (args.json) {
      console.log(JSON.stringify(payload));
    } else {
      console.log(token);
    }
    return;
  }

  const outArg = typeof args.out === "string" ? args.out : undefined;
  const outPath = outArg ? resolve(REPO_ROOT, outArg) : DEFAULT_OUT;

  mkdirSync(dirname(outPath), { recursive: true, mode: 0o700 });
  writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n", { mode: 0o600 });
  try {
    // Best effort — NTFS/Windows respekterer ikke POSIX-mode fuldt via Node,
    // men chmod fejler ikke destruktivt der. .gitignore (.codex.local/) er
    // det primære værn; filrettigheder er defense-in-depth.
    chmodSync(outPath, 0o600);
  } catch {
    // ignoreret — se kommentar ovenfor.
  }

  console.log(outPath);
}

main().catch((err) => {
  console.error("uventet fejl:", err.message);
  process.exit(1);
});
