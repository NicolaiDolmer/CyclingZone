// #6181 · Preview-efterligning af saelgers laaste salg (kun bag VITE_PREVIEW_MOCK).
//
// Slukket som standard: preview-holdet har intet laast, saa siden ser ud som i
// prod med kontakten slukket. ?lockedSales=on viser to laaste salg (huskes i
// localStorage, ?lockedSales=off slaar det fra), saa visningen kan ses paa
// preview, foer kontakten taendes. Ryttere og loeb er preview-seedens egne.
//
// ?lockedSales=ran (dommerens punkt 8): det andet salg venter paa et loeb, hvis
// sidste etape laa foer i dag, men som ikke er gjort faerdigt. Backenden svarer
// saa daysLeft = null, og linjen viser kun loebets navn, aldrig "slutter i dag".
import { RIDERS, SEED_RACES } from "./seedData.js";

const STORAGE_KEY = "cz_mock_locked_sales_6181";

export type PreviewLockedSalesMode = "off" | "on" | "ran";

export function previewLockedSalesMode(): PreviewLockedSalesMode {
  try {
    const param = new URLSearchParams(window.location.search).get("lockedSales");
    if (param === "on") localStorage.setItem(STORAGE_KEY, "1");
    if (param === "ran") localStorage.setItem(STORAGE_KEY, "ran");
    if (param === "off") localStorage.setItem(STORAGE_KEY, "0");
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "1" ? "on" : stored === "ran" ? "ran" : "off";
  } catch {
    return "off";
  }
}

export function previewLockedSalesEnabled(): boolean {
  return previewLockedSalesMode() !== "off";
}

function riderRef(i: number) {
  const r = (RIDERS as Array<{ id: string; firstname: string; lastname: string }>)[i];
  return { id: r.id, name: `${r.firstname} ${r.lastname}` };
}

function raceRef(id: string) {
  const race = (SEED_RACES as Array<{ id: string; name: string }>).find((r) => r.id === id);
  return race ? { id: race.id, name: race.name } : null;
}

export function previewLockedSalesPayload(mode: boolean | PreviewLockedSalesMode = previewLockedSalesMode()) {
  const resolved: PreviewLockedSalesMode = mode === true ? "on" : mode === false ? "off" : mode;
  if (resolved === "off") return { total: 0, sales: [] };
  const live = raceRef("race-live-1");
  const sales = [
    { id: "preview-escrow-1", dealType: "transfer", riders: [riderRef(0)], race: live, endsAt: null, daysLeft: 2, amount: 1250000 },
    resolved === "ran"
      ? { id: "preview-escrow-2", dealType: "auction", riders: [riderRef(1)], race: raceRef("race-done-2"), endsAt: null, daysLeft: null, amount: 640000 }
      : { id: "preview-escrow-2", dealType: "auction", riders: [riderRef(1)], race: live, endsAt: null, daysLeft: 2, amount: 640000 },
  ];
  return { total: sales.reduce((s, x) => s + x.amount, 0), sales };
}
