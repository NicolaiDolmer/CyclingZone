#!/usr/bin/env node
// #2736 — manuel kørsel af Alunta subscription-reconcilen.
//
// Formål: FØRSTE verifikation mod den ægte Alunta-API, uafhængig af
// app_config-flaget (alunta_reconcile_enabled er fail-safe OFF indtil denne
// kørsel er set + godkendt — se database/2026-08-03-alunta-reconcile-flag.sql).
//
// Kør (fra backend/):
//   infisical run --env=prod -- node scripts/reconcileAluntaSubscriptions.js
//
// Default = DRY-RUN: henter + beregner forslag, skriver INTET. Print RAW
// Alunta-feltnavne (extractSubscriptionFields-output) så du kan bekræfte at
// backend/lib/aluntaSubscriptionReconcile.js's forsvarsmæssige feltudtræk
// rent faktisk rammer Aluntas ægte svarform, FØR flaget flippes til on.
//
// Kør med writes (kun når dry-run-output er bekræftet korrekt):
//   node scripts/reconcileAluntaSubscriptions.js --apply
//
// Dumper ALDRIG ALUNTA_API_TOKEN, SUPABASE_SERVICE_KEY eller andre secrets.

import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { createAluntaClient } from "../lib/alunta.js";
import { runAluntaSubscriptionReconcile, extractSubscriptionFields } from "../lib/aluntaSubscriptionReconcile.js";

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), "../.env"), quiet: true });

const APPLY = process.argv.includes("--apply");

if (!process.env.ALUNTA_API_TOKEN) {
  console.error("ALUNTA_API_TOKEN mangler (Infisical/.env) — kan ikke kalde Alunta-API'et.");
  process.exit(1);
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_KEY mangler (Infisical/.env).");
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});
const client = createAluntaClient();

console.log(`\n=== Alunta subscription-reconcile (#2736) — ${APPLY ? "APPLY (skriver til DB)" : "DRY-RUN (ingen writes)"} ===\n`);

const result = await runAluntaSubscriptionReconcile({ supabase, client, dryRun: !APPLY });

console.log(`Lokale rækker tjekket:     ${result.checkedLocal}`);
console.log(`Alunta-abonnementer set:  ${result.checkedRemote}`);
console.log(`Uændrede (allerede sync): ${result.unchanged}`);
console.log(`Foreslåede/anvendte:      ${result.proposedUpdates}${APPLY ? ` (anvendt: ${result.applied})` : ""}`);
console.log(`Mangler i Alunta-svar:    ${result.missingRemote} (Pro-relevant lokal række uden match — undersøg!)`);
console.log(`Ukendt Alunta-status:     ${result.skippedUnknownStatus} (ret mapAluntaStatus hvis > 0)`);
if (result.errors.length) console.log(`Upsert-fejl:              ${result.errors.length}`);

if (result.updates.length) {
  console.log("\n--- Forslag pr. team (team_id forkortet) ---");
  for (const u of result.updates) {
    console.log(
      `  team ${String(u.team_id).slice(0, 8)}…  status=${u.status}  period_end=${u.current_period_end ?? "null"}  ` +
        `plan=${u.plan_interval ?? "null"}  customer=${u.alunta_customer_id ? "set" : "null"}  subscription=${u.alunta_subscription_id ? "set" : "null"}`
    );
  }
} else {
  console.log("\nIngen forslag — enten alt allerede synket, eller ingen match fundet (se 'Mangler i Alunta-svar' ovenfor).");
}

if (!APPLY && result.checkedRemote > 0) {
  console.log("\n--- RAW feltudtræk pr. Alunta-abonnement (verificér mod Aluntas ægte svar) ---");
  // Genkører selve list-kaldet for at kunne printe rå felter uden at ændre
  // reconcile-funktionens kontrakt — samme data, kun til inspektion.
  const raw = await client.listSubscriptions({ page: 1, perPage: 100 });
  const items = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];
  for (const entry of items.slice(0, 20)) {
    console.log(JSON.stringify(extractSubscriptionFields(entry), null, 2));
  }
  if (items.length > 20) console.log(`… (${items.length - 20} flere, ikke printet)`);
}

console.log(
  `\n${APPLY ? "Kørsel færdig." : "Dry-run færdig — ingen writes. Gennemgå forslagene ovenfor, kør derefter --apply, og flip app_config.alunta_reconcile_enabled til true for at aktivere den daglige cron."}\n`
);

if (result.errors.length) process.exitCode = 1;
