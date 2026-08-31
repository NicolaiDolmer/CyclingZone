// Opsætning + drift-tjek af CZ Pro-planer i Alunta via API (#1903, #4005).
// Kør: infisical run --env=dev -- node scripts/alunta-setup-plans.js  (fra backend/)
// ALUNTA_API_TOKEN injiceres af Infisical ved runtime (source of truth, jf.
// docs/decisions/secret-management-adr.md); .env-fallback via dotenv nedenfor.
//
// Printer KUN navne, priser og UUID'er — aldrig tokenet.
//
// VIGTIGT om priser (#4005, kostede en fejlpris på den første betalende kunde):
// Alunta gemmer beløb i ØRE EKSKL. MOMS og lægger momsen oveni når charge_vat
// er true. 3920 gemt => 39,20 ekskl. => 49,00 kr. INKL. moms for kunden.
// Ejer-beslutning 31/8: prisen er 49 kr. INKL. moms. Se docs/BILLING_STACK.md §2.
//
// Denne version SKIPPER ikke længere stiltiende en eksisterende plan: den
// sammenligner prisen og rapporterer afvigelser. Den gamle adfærd betød at en
// forkert pris kunne overleve enhver gen-kørsel uden at nogen opdagede det.
// Scriptet RETTER aldrig en pris automatisk — en plan med aktive abonnenter kan
// alligevel ikke reprises, og vejen er da ny plan -> Railway-env -> flyt
// abonnenter -> arkivér gammel.

import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), "../.env"), quiet: true });

const BASE = process.env.ALUNTA_BASE || "https://app.alunta.com/api/v1";
const TOKEN = process.env.ALUNTA_API_TOKEN;
if (!TOKEN) {
  console.error("ALUNTA_API_TOKEN mangler i backend/.env — opret en API-nøgle i Alunta-dashboardet først.");
  process.exit(1);
}

const APPLY = process.argv.includes("--create-missing");

// amount = øre EKSKL. moms. inclVat er kun til menneskelig kontrol i outputtet.
const PLANS = [
  {
    name: "CZ Pro Monthly 49",
    amount: 3920,
    inclVat: "49,00",
    currency: "DKK",
    interval: "monthly",
    description: "Cycling Zone Pro, billed monthly.",
  },
  {
    name: "CZ Pro 6 Months",
    amount: 23600,
    inclVat: "295,00",
    currency: "DKK",
    interval: "half-yearly",
    description: "Cycling Zone Pro, billed every 6 months.",
  },
];

// Planer der bevidst er udfaset. Rapporteres hvis de stadig er aktive, så en
// glemt arkivering ikke bliver til en plan der stadig kan sælges.
const RETIRED = ["CZ Pro Monthly"];

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", Accept: "application/json", ...opts.headers },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${path} -> ${res.status}: ${JSON.stringify(body)?.slice(0, 300)}`);
  return body;
}

// Aluntas plan-svar bærer priser i renewal_intervals[] med felterne
// { uuid, interval, price, currency }. Verificeret mod live-API 2026-08-31.
//
// BEMÆRK: MCP-fladen (get_plan_catalog) bruger ANDRE feltnavne for de samme
// data — prices[] / interval_months / amount_minor. Læs ikke den ene form af
// på den anden; det gav en falsk "AFVIGER null øre" første gang.
function storedAmount(plan, intervalMonths) {
  const intervals = plan?.renewal_intervals ?? [];
  const hit = intervals.find((p) => Number(p.interval) === intervalMonths) ?? intervals[0];
  return hit ? Number(hit.price) : null;
}

const INTERVAL_MONTHS = { monthly: 1, quarterly: 3, "half-yearly": 6, yearly: 12 };

// /me svarer FLADT — ingen data-envelope, i modsætning til /plans og
// /checkout-sessions. Verificeret mod live-API 2026-08-31:
// { team_uuid, team_name, scopes, base_currency, timezone }
const me = await api("/me");
console.log(`Forbundet til Alunta-team: ${me?.team_name ?? "ukendt"} (${me?.base_currency ?? "?"})\n`);

const existing = await api("/plans?per_page=100");
const byName = new Map((existing?.data ?? []).map((p) => [p.name, p]));

let drift = 0;

for (const plan of PLANS) {
  const found = byName.get(plan.name);

  if (!found) {
    if (!APPLY) {
      console.log(`MANGLER   ${plan.name} (${plan.amount} øre = ${plan.inclVat} kr. inkl.) — kør med --create-missing for at oprette`);
      drift++;
      continue;
    }
    const { name, amount, currency, interval, description } = plan;
    const created = await api("/plans", { method: "POST", body: JSON.stringify({ name, amount, currency, interval, description }) });
    console.log(`OPRETTET  ${plan.name}: ${created?.data?.uuid}`);
    drift++;
    continue;
  }

  const actual = storedAmount(found, INTERVAL_MONTHS[plan.interval]);
  if (actual === plan.amount) {
    console.log(`OK        ${plan.name}: ${actual} øre = ${plan.inclVat} kr. inkl.  (${found.uuid})`);
    continue;
  }

  drift++;
  const actualIncl = actual == null ? "ukendt" : (actual * 1.25 / 100).toFixed(2).replace(".", ",");
  console.log(
    `AFVIGER   ${plan.name}: Alunta har ${actual} øre (= ${actualIncl} kr. inkl.), ` +
    `forventet ${plan.amount} øre (= ${plan.inclVat} kr. inkl.)  (${found.uuid})`,
  );
  console.log(`          Rettes IKKE af scriptet. Har planen aktive abonnenter, kan prisen ikke redigeres —`);
  console.log(`          opret ny plan, opdatér Railway-env, flyt abonnenter, arkivér den gamle.`);
}

for (const name of RETIRED) {
  const found = byName.get(name);
  if (found) {
    drift++;
    console.log(`UDFASET   ${name} er stadig aktiv (${found.uuid}) — skal arkiveres når dens abonnenter er flyttet`);
  }
}

console.log("\nHusk: plan-UUID'erne skal ligge i Railway som ALUNTA_CZ_PRO_PLAN_ID_MONTHLY / ALUNTA_CZ_PRO_PLAN_ID_SEMIANNUAL.");
console.log("Skiftes en plan uden at env-nøglen følger med, sælger appen fortsat den gamle plan.");

if (drift > 0) {
  console.error(`\n${drift} afvigelse(r) mellem Alunta og den forventede opsætning.`);
  process.exit(1);
}
console.log("\nIngen afvigelser.");
