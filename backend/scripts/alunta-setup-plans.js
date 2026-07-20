// Engangs-opsætning af CZ Pro-planer i Alunta via API (#1903).
// Kør: node scripts/alunta-setup-plans.js  (fra backend/; kræver ALUNTA_API_TOKEN i .env)
//
// Idempotent: lister eksisterende planer først og springer over hvis en plan
// med samme navn allerede findes. Printer KUN navne + UUID'er (aldrig tokenet).
// Priser jf. ejer-beslutning 26/6 (#1903): 49 kr/md + 265 kr/6 mdr.
// amount er i mindste valuta-enhed (øre): 4900 = 49,00 kr.

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

const PLANS = [
  { name: "CZ Pro Monthly", amount: 4900, currency: "DKK", interval: "monthly", description: "Cycling Zone Pro, billed monthly." },
  { name: "CZ Pro 6 Months", amount: 26500, currency: "DKK", interval: "half-yearly", description: "Cycling Zone Pro, billed every 6 months." },
];

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", Accept: "application/json", ...opts.headers },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${path} -> ${res.status}: ${JSON.stringify(body)?.slice(0, 300)}`);
  return body;
}

const me = await api("/me");
console.log(`Forbundet til Alunta som: ${me?.data?.name ?? me?.data?.email ?? "ukendt"}`);

const existing = await api("/plans?per_page=100");
const existingByName = new Map((existing?.data ?? []).map((p) => [p.name, p]));

for (const plan of PLANS) {
  const found = existingByName.get(plan.name);
  if (found) {
    console.log(`SKIP  ${plan.name} findes allerede: ${found.uuid}`);
    continue;
  }
  const created = await api("/plans", { method: "POST", body: JSON.stringify(plan) });
  console.log(`CREATED  ${plan.name}: ${created?.data?.uuid}`);
}

console.log("\nNæste skridt: læg UUID'erne i Railway som ALUNTA_CZ_PRO_PLAN_ID_MONTHLY / ALUNTA_CZ_PRO_PLAN_ID_SEMIANNUAL.");
