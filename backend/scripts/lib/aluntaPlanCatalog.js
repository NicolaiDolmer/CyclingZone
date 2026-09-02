// #4645 — CZ Pro-plankatalogets SSOT-data, udtrukket fra alunta-setup-plans.js
// (#4005/#1903) til sin egen fil så den kan LÆSES uden netværk.
//
// alunta-setup-plans.js selv kører top-level API-kald ved import (henter /me
// + /plans mod Alunta) — det gør filen uegnet at importere fra en ren,
// netværksfri guard som scripts/check-pro-prices.mjs (#4645). PLANS/RETIRED er
// derfor flyttet HERTIL uændret; alunta-setup-plans.js importerer dem tilbage,
// så der stadig kun findes ÉT sted planerne er skrevet.
//
// amount = øre EKSKL. moms. inclVat er kun til menneskelig kontrol i outputtet
// og bruges af check-pro-prices.mjs til at verificere at round(amount*1.25)/100
// matcher BÅDE inclVat-feltet HER og den viste pris i pro.json (#4645 — se
// docs/BILLING_STACK.md §9a).

export const PLANS = [
  {
    name: "CZ Pro 1 month",
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
export const RETIRED = ["CZ Pro Monthly"];

export const INTERVAL_MONTHS = { monthly: 1, quarterly: 3, "half-yearly": 6, yearly: 12 };
