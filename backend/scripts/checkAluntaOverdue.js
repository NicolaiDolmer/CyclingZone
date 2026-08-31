#!/usr/bin/env node
// #4514 — manuel kørsel af betalings-vagten.
//
// Søsterscript til reconcileAluntaSubscriptions.js. Samme vagt som cron'en
// kører dagligt, men med læsbart output så en tilstand kan inspiceres med det
// samme i stedet for at vente på næste tick.
//
// Kør (fra backend/):
//   infisical run --env=prod -- node scripts/checkAluntaOverdue.js
//
// Vagten SKRIVER intet — hverken i Alunta eller i vores DB. Der er derfor
// ingen --apply-flag og ingen dry-run-tilstand: kørslen er altid sikker.
//
// Exit-kode 1 hvis der findes fund, så scriptet kan bruges som en gate.
//
// Dumper ALDRIG ALUNTA_API_TOKEN, SUPABASE_SERVICE_KEY eller andre secrets, og
// logger aldrig kundenavn, e-mail eller pay_url (se PRIVATLIV i vagtens hoved).

import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { createAluntaClient } from "../lib/alunta.js";
import { runAluntaOverdueWatch, formatFindings } from "../lib/aluntaOverdueWatch.js";

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), "../.env"), quiet: true });

if (!process.env.ALUNTA_API_TOKEN) {
  console.error("ALUNTA_API_TOKEN mangler (Infisical/.env) — kan ikke kalde Alunta-API'et.");
  process.exit(1);
}

const hasSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
if (!hasSupabase) {
  console.warn("SUPABASE_URL / SUPABASE_SERVICE_KEY mangler — tjekker KUN fakturaer, ikke entitlements.\n");
}

const supabase = hasSupabase
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
  : null;

// Vagten logger selv via logger.warn; her vil vi have et samlet, sorteret
// output i stedet, så vi sluger dens linjer og printer dem struktureret bagefter.
const res = await runAluntaOverdueWatch({
  client: createAluntaClient(),
  supabase,
  captureExceptionFn: () => {},
  logger: { warn: () => {} },
});

console.log(`Fakturaer tjekket: ${res.invoicesChecked}`);
console.log(`Ubetalte over forfald: ${res.overdue.length}`);
console.log(`Entitlement-afvigelser: ${res.stale.length}\n`);

const lines = formatFindings(res);
if (lines.length === 0) {
  console.log("Ingen fund. Ingen ubetalte fakturaer, ingen udløbne entitlements.");
  process.exit(0);
}

for (const line of lines) console.log(line);
console.error(`\n${lines.length} fund — se ovenfor.`);
process.exit(1);
