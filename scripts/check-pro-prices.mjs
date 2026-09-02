#!/usr/bin/env node
// #4645 — pris-forward-guard: prisen spilleren SER på /pro og prisen Alunta
// TRÆKKER lever to steder uden nogen kobling. 2/9 stod pro.json på 265 kr og
// Alunta på 295 kr — den første 6-mdr-kunde betalte 30 kr for meget (krediteret
// samme dag, se .claude/learnings/2026-09-02-halvaarspris-fejlregning-kunde-
// betalte-30-kr-for-meget.md). Rod-årsag: alunta-setup-plans.js's egen
// drift-tjek sammenlignede kun Alunta mod SIN EGEN konstant — aldrig mod det
// spilleren rent faktisk ser.
//
// Denne guard læser BEGGE sider uden netværk (ingen Alunta-kald):
//   1. backend/scripts/lib/aluntaPlanCatalog.js — planernes forventede
//      øre-beløb (samme kilde alunta-setup-plans.js's egen Alunta-drift-tjek
//      bruger, #4005).
//   2. frontend/public/locales/{en,da}/pro.json — det spilleren rent faktisk
//      ser (monthlyPrice/semiannualPrice).
// og fejler hvis round(amount_ekskl_moms * 1.25) / 100 ikke matcher BÅDE
// planens egen inclVat-deklaration OG det viste tal i begge sprog.
//
// Rabatpåstande (BILLING_STACK.md "~10% rabat") REGNES her, håndskrives ikke —
// se printRabat() nedenfor.
//
// Brug:
//   node scripts/check-pro-prices.mjs        — læser de ægte repo-filer, exit 1 ved drift
// Test af selve regnestykket (fixture-data, ingen filsystem-afhængighed):
//   node --test scripts/check-pro-prices.test.mjs

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── Pur beregning (importeres af check-pro-prices.test.mjs) ─────────────────

// PUR: øre EKSKL. moms -> kr. INKL. moms, afrundet til nærmeste øre/hele krone
// (Alunta selv gemmer heltal-øre, så resultatet her har op til 2 decimaler).
export function computeInclVatMajor(amountMinorExclVat) {
  return Math.round(amountMinorExclVat * 1.25) / 100;
}

// PUR: dansk decimaltal ("6,49", "295,00") eller heltal-streng ("265") -> Number.
function parseDanishAmount(str) {
  if (str == null) return null;
  const n = Number(String(str).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// PUR: en pro.json prisstreng ("49 kr/mo", "265 kr", "49 kr/md") -> ledende tal.
export function parseDisplayedAmount(str) {
  const m = String(str ?? "").match(/(\d+(?:[.,]\d+)?)/);
  return m ? parseDanishAmount(m[1]) : null;
}

const PRO_JSON_KEY_BY_INTERVAL = { monthly: "monthlyPrice", "half-yearly": "semiannualPrice" };

// PUR: ét plan-katalog-element -> selv-konsistens (amount vs. dets egen
// inclVat-deklaration) + evt. sammenligning mod et vist beløb (pro.json).
export function checkPlanPrice(plan, { displayedAmount = null } = {}) {
  const computed = computeInclVatMajor(plan.amount);
  const declared = parseDanishAmount(plan.inclVat);
  const selfConsistent = declared != null && Math.abs(computed - declared) < 0.005;
  const displayMatch = displayedAmount == null ? null : Math.abs(computed - displayedAmount) < 0.005;
  return { name: plan.name, currency: plan.currency, interval: plan.interval, amount: plan.amount, computed, declared, selfConsistent, displayedAmount, displayMatch };
}

// PUR: hele kataloget mod pro.json for hvert sprog. Kun DKK-planer tjekkes mod
// pro.json — den viser i dag ingen EUR-pris (#4074/#4608 endnu ikke merget);
// EUR-planer får stadig selv-konsistens-tjekket.
export function checkAllPrices({ plans, proJsonByLocale }) {
  return plans.map((plan) => {
    const key = plan.currency === "DKK" ? PRO_JSON_KEY_BY_INTERVAL[plan.interval] : null;
    const perLocale = {};
    if (key) {
      for (const [locale, json] of Object.entries(proJsonByLocale ?? {})) {
        perLocale[locale] = parseDisplayedAmount(json?.[key]);
      }
    }
    const seen = Object.values(perLocale).filter((v) => v != null);
    const displayedAmount = seen.length ? seen[0] : null;
    const localeMismatches = Object.entries(perLocale)
      .filter(([, v]) => v != null && displayedAmount != null && Math.abs(v - displayedAmount) >= 0.005)
      .map(([locale]) => locale);
    return { ...checkPlanPrice(plan, { displayedAmount }), perLocale, localeMismatches };
  });
}

export function hasDrift(results) {
  return results.some((r) => !r.selfConsistent || r.displayMatch === false || r.localeMismatches.length > 0);
}

// PUR: rabat-procent for et interval-par (kortere periode antaget månedlig) —
// erstatter håndskrevne rabatpåstande i docs (BILLING_STACK.md).
export function computeDiscountPct({ monthsInPeriod, periodPrice, monthlyPrice }) {
  const flatTotal = monthsInPeriod * monthlyPrice;
  if (flatTotal <= 0) return null;
  return Math.round((1 - periodPrice / flatTotal) * 1000) / 10; // én decimal
}

// ── I/O (kun i CLI-tilstand, ikke ved import fra testen) ─────────────────────

function fmt(n) {
  return n == null ? "?" : n.toFixed(2).replace(".", ",");
}

async function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(__dirname, "..");

  const { PLANS } = await import(new URL("../backend/scripts/lib/aluntaPlanCatalog.js", import.meta.url));
  const proEn = JSON.parse(readFileSync(join(repoRoot, "frontend/public/locales/en/pro.json"), "utf8"));
  const proDa = JSON.parse(readFileSync(join(repoRoot, "frontend/public/locales/da/pro.json"), "utf8"));

  const results = checkAllPrices({ plans: PLANS, proJsonByLocale: { en: proEn, da: proDa } });

  let drift = 0;
  for (const r of results) {
    const bits = [];
    if (!r.selfConsistent) {
      bits.push(`AFVIGER selv-konsistens: ${r.amount} øre ekskl. => ${fmt(r.computed)} beregnet, men katalog siger ${r.declared ?? "?"}`);
    }
    if (r.displayMatch === false) {
      bits.push(`AFVIGER vist pris: beregnet ${fmt(r.computed)}, pro.json viser ${fmt(r.displayedAmount)}`);
    }
    if (r.localeMismatches.length) {
      bits.push(`AFVIGER mellem sprog: ${r.localeMismatches.join(", ")} viser et andet tal end de øvrige`);
    }
    if (bits.length) {
      drift += bits.length;
      console.error(`DRIFT     ${r.name} (${r.currency}): ${bits.join(" · ")}`);
    } else {
      console.log(`OK        ${r.name} (${r.currency}): ${r.amount} øre ekskl. = ${fmt(r.computed)} inkl.${r.displayedAmount != null ? ` (pro.json: ${fmt(r.displayedAmount)})` : ""}`);
    }
  }

  // Rabatpåstand — regnet, ikke håndskrevet (postmortem-læring 1: "6 x 49 = 294").
  const monthly = results.find((r) => r.currency === "DKK" && r.interval === "monthly");
  const semiannual = results.find((r) => r.currency === "DKK" && r.interval === "half-yearly");
  if (monthly && semiannual) {
    const pct = computeDiscountPct({ monthsInPeriod: 6, periodPrice: semiannual.computed, monthlyPrice: monthly.computed });
    console.log(`\nRabat 6 mdr. vs. 6× månedlig: ${pct}% (${fmt(semiannual.computed)} kr. mod 6 × ${fmt(monthly.computed)} kr. = ${fmt(6 * monthly.computed)} kr.)`);
  }

  if (drift > 0) {
    console.error(`\n${drift} pris-afvigelse(r) mellem plankatalog og pro.json.`);
    process.exit(1);
  }
  console.log("\nIngen pris-afvigelser.");
}

// Kør kun i CLI-tilstand — check-pro-prices.test.mjs importerer de pure
// funktioner ovenfor uden at trigge fil-I/O.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main();
