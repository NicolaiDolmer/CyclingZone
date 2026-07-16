import { useState, useCallback } from "react";

// Toggleable dashboard-moduler (#1005). Rækkefølgen styrer customize-panelets
// checkbox-rækkefølge. defaultVisible = synlig for nye/eksisterende brugere indtil
// de aktivt skjuler modulet. De 4 StatCards og alle kontekstuelle banners/nudges
// holdes UDENFOR customize (allerede conditional/dismissible).
// #1536: "Næste træk" (nextActions) + forecast gjort valgfrie efter Discord-feedback.
export const DASHBOARD_MODULES = [
  { id: "nextActions",    defaultVisible: true },
  { id: "forecast",       defaultVisible: true },
  // #2466: "How your team did" — resultat-push for holdets seneste løb. Nyt
  // modul defaulter til synligt for ALLE (også eksisterende localStorage-layouts,
  // jf. merge-mod-defaults i loadLayout).
  { id: "myLatestResult", defaultVisible: true },
  { id: "auctions",      defaultVisible: true },
  { id: "transfers",     defaultVisible: true },
  { id: "races",         defaultVisible: true },
  { id: "divStandings",  defaultVisible: true },
  { id: "board",         defaultVisible: true },
  { id: "recentResults", defaultVisible: true },
  { id: "riderRanking",  defaultVisible: true },
];

const STORAGE_KEY = "cz-dashboard-layout";

export function defaultLayout() {
  const out = {};
  DASHBOARD_MODULES.forEach(m => { out[m.id] = m.defaultVisible; });
  return out;
}

// Merge-mod-defaults (samme mønster som RiderRankingsPage.loadColumnVisibility):
// tom/manglende localStorage betyder IKKE "intet synligt", og et nyt modul tilføjet
// senere defaulter til synligt for eksisterende brugere — i modsætning til et rå Set.
export function loadLayout() {
  const defaults = defaultLayout();
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    DASHBOARD_MODULES.forEach(m => {
      if (typeof parsed[m.id] === "boolean") defaults[m.id] = parsed[m.id];
    });
    return defaults;
  } catch {
    return defaults;
  }
}

function persist(layout) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // localStorage kan være disabled (privacy mode); accepter tab af persistens
  }
}

export default function useDashboardLayout() {
  const [visible, setVisible] = useState(loadLayout);

  const toggleModule = useCallback(id => {
    setVisible(prev => {
      const next = { ...prev, [id]: !prev[id] };
      persist(next);
      return next;
    });
  }, []);

  const resetToDefault = useCallback(() => {
    const def = defaultLayout();
    persist(def);
    setVisible(def);
  }, []);

  const isVisible = useCallback(id => visible[id] !== false, [visible]);

  return { visible, isVisible, toggleModule, resetToDefault };
}
