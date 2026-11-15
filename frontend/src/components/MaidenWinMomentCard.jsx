import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCareerFirstsData } from "../data/dashboardCards.ts";
import CareerFirstMomentRow from "./CareerFirstMomentRow";
import { Card } from "./ui";

// #3398 (Maiden Win Engine) — dashboard-fladen for career-first-momentkort
// ("MAIDEN VICTORY — Jonas Krogh, 21, wins his first race in club colours").
// Selvstændig komponentfil MED egen fetch (samme mønster som GlobalRankWidget:
// auth.getUser() → teams-opslag → egen let query), for at holde
// DashboardPage-diffet minimalt (parallel agent #3397 rører også dashboardet).
//
// Datakilde: rider_career_events (backend/lib/careerFirsts.js persisterer ved
// finalization). RLS tillader SELECT for alle authenticated — men kortet viser
// KUN egne rytteres momenter (team_id-filter), matcher #3310's "dit hold"-linse.
//
// Rene editorial moment-kort, ingen konfetti her — fejring (item 4, #3398-
// scope) lever i MyLatestResultCard (samme "din seneste kamp"-datastrøm som
// allerede driver dens isNew-badge). Dette kort er det VARIGE artefakt.
// Selve rækkevisningen er DELT med RaceDetailPage.jsx — se CareerFirstMomentRow.jsx.

// #2593-mønster (localStorage, ikke server-persisteret "seen" — v1-forenkling,
// se PR-body): et momentkort ses højst ét NYT-badge pr. event-id pr. enhed.
const SEEN_KEY = "cz_maiden_win_seen_ids";

function readSeenIds() {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function markSeen(ids) {
  try {
    const existing = readSeenIds();
    for (const id of ids) existing.add(id);
    // Loft mod ubegrænset vækst — kun de seneste 200 id'er er interessante.
    const trimmed = [...existing].slice(-200);
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(trimmed));
  } catch {
    // best-effort — badge kan blot dukke op igen, ingen død funktionalitet
  }
}

export default function MaidenWinMomentCard() {
  const { t } = useTranslation("dashboard");
  // #6494: null = loading, [] = empty; read through the shared scope.
  const events = useCareerFirstsData();
  const [seenIds, setSeenIds] = useState(() => readSeenIds());

  useEffect(() => {
    if (!events?.length) return;
    const unseen = events.map((e) => e.id).filter((id) => !seenIds.has(id));
    if (!unseen.length) return;
    const timer = setTimeout(() => {
      markSeen(unseen);
      setSeenIds(readSeenIds());
    }, 3000); // badge er synlig et kort øjeblik før det markeres set, samme takt som ConfettiModal's auto-close
    return () => clearTimeout(timer);
  }, [events, seenIds]);

  if (!events || events.length === 0) return null;

  return (
    <Card className="p-5 mb-4">
      <h2 className="font-semibold text-cz-1 text-sm mb-1">{t("dashboard:cards.maidenWin.title")}</h2>
      <div className="flex flex-col">
        {events.map((event) => (
          <CareerFirstMomentRow key={event.id} event={event} t={t} isNew={!seenIds.has(event.id)} />
        ))}
      </div>
    </Card>
  );
}
