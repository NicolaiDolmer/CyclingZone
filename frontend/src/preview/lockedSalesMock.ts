// #6181 · Preview-efterligning af saelgers laaste salg (kun bag VITE_PREVIEW_MOCK).
//
// Slukket som standard: preview-holdet har intet laast, saa siden ser ud som i
// prod med kontakten slukket. ?lockedSales=on viser to laaste salg (huskes i
// localStorage, ?lockedSales=off slaar det fra), saa visningen kan ses paa
// preview, foer kontakten taendes. Ryttere og loeb er preview-seedens egne.
import { RIDERS, SEED_RACES } from "./seedData.js";

const STORAGE_KEY = "cz_mock_locked_sales_6181";

export function previewLockedSalesEnabled(): boolean {
  try {
    const param = new URLSearchParams(window.location.search).get("lockedSales");
    if (param === "on") localStorage.setItem(STORAGE_KEY, "1");
    if (param === "off") localStorage.setItem(STORAGE_KEY, "0");
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function riderRef(i: number) {
  const r = (RIDERS as Array<{ id: string; firstname: string; lastname: string }>)[i];
  return { id: r.id, name: `${r.firstname} ${r.lastname}` };
}

export function previewLockedSalesPayload(enabled = previewLockedSalesEnabled()) {
  if (!enabled) return { total: 0, sales: [] };
  const race = (SEED_RACES as Array<{ id: string; name: string }>).find((r) => r.id === "race-live-1");
  const sales = [
    { id: "preview-escrow-1", dealType: "transfer", riders: [riderRef(0)], race: race ? { id: race.id, name: race.name } : null, endsAt: null, daysLeft: 2, amount: 1250000 },
    { id: "preview-escrow-2", dealType: "auction", riders: [riderRef(1)], race: race ? { id: race.id, name: race.name } : null, endsAt: null, daysLeft: 2, amount: 640000 },
  ];
  return { total: sales.reduce((s, x) => s + x.amount, 0), sales };
}
