#!/usr/bin/env node
// #614 / #348 — Sentry smoke-test
//
// Verificerer at SENTRY_DSN + captureException-pipeline virker end-to-end ved at
// sende ÉN test-exception med samme call-shape som cron-capture-pattern fra #614:
//   captureException(err, { tags: { cron: "<name>" }, extra: { ... } })
//
// Brug:
//   $env:SENTRY_DSN="https://abc@o123.ingest.us.sentry.io/456"
//   node backend/scripts/sentry-smoke-test.mjs
//
//   ELLER med inline DSN:
//   node backend/scripts/sentry-smoke-test.mjs --dsn=https://abc@o123.ingest.us.sentry.io/456
//
// Exit-codes:
//   0 = event sendt + flushed OK
//   1 = ugyldig DSN / args
//   2 = flush timeout (events nåede måske ikke frem)
//   3 = uventet fejl
//
// Verifikation i Sentry UI:
//   Issues → search: cron:smoke-test
//   Forventet titel: "Sentry smoke test - cron capture pattern verification"

import * as Sentry from "@sentry/node";
import process from "node:process";

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

function validateDsn(dsn) {
  return /^https:\/\/\w+@[\w.]+\.sentry\.io\/\d+$/.test(dsn);
}

async function main() {
  const args = parseArgs(process.argv);
  const dsn = args.dsn || process.env.SENTRY_DSN;

  if (!dsn) {
    console.error("❌ SENTRY_DSN mangler.");
    console.error("   Set env var eller pass --dsn=<value>");
    process.exit(1);
  }

  if (!validateDsn(dsn)) {
    console.error(`❌ DSN format ser forkert ud: ${dsn.slice(0, 40)}...`);
    console.error("   Forventet: https://<publicKey>@<host>.sentry.io/<projectId>");
    process.exit(1);
  }

  console.log("🔧 Initialiserer Sentry SDK...");
  Sentry.init({
    dsn,
    environment: "smoke-test",
    release: `smoke-test-${new Date().toISOString().slice(0, 10)}`,
    tracesSampleRate: 0,
  });

  const timestamp = new Date().toISOString();
  const testError = new Error("Sentry smoke test - cron capture pattern verification");

  console.log("📤 Sender test-exception med tags { cron: 'smoke-test' }...");
  const eventId = Sentry.captureException(testError, {
    tags: { cron: "smoke-test" },
    extra: {
      source: "backend/scripts/sentry-smoke-test.mjs",
      trigger: "manual",
      timestamp,
      scriptVersion: "1.0",
      purpose: "Verificér SENTRY_DSN + #614 cron-capture-pattern end-to-end",
    },
  });

  console.log(`📨 Event ID: ${eventId}`);
  console.log("⏳ Flusher events (op til 5s)...");

  const flushed = await Sentry.flush(5000);
  if (!flushed) {
    console.error("❌ Sentry.flush() timed out — events nåede måske ikke frem");
    process.exit(2);
  }

  console.log("");
  console.log("✅ Event sendt + flushed.");
  console.log("");
  console.log("🔎 Verificér i Sentry UI:");
  console.log("   1. Åbn Issues");
  console.log("   2. Search: cron:smoke-test");
  console.log("   3. Forventet: 'Sentry smoke test - cron capture pattern verification'");
  console.log(`   4. Event ID at lede efter: ${eventId}`);
  console.log("");
  console.log("Hvis event er der → #348 (SDK virker) + #614 (cron-tag-pattern virker) kan lukkes.");
}

main().catch((err) => {
  console.error("💥 Smoke-test fejlede:", err);
  process.exit(3);
});
