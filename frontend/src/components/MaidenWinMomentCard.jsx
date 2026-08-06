import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
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
const MAX_EVENTS = 3;

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
  const [events, setEvents] = useState(null); // null = loading, [] = empty
  const [seenIds, setSeenIds] = useState(() => readSeenIds());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: myTeam } = await supabase.from("teams").select("id").eq("user_id", user.id).single();
        if (!myTeam) return;
        // pagination-safe: rider_career_events er lav-volumen pr. hold
        // (career-firsts er sjældne pr. definition) — limit() er alligevel
        // eksplicit sat for at holde payloaden lille.
        const { data, error } = await supabase
          .from("rider_career_events")
          .select("id, event_type, rider_id, rider_name, team_name, race_id, params, occurred_at")
          .eq("team_id", myTeam.id)
          .order("occurred_at", { ascending: false })
          .limit(MAX_EVENTS);
        if (cancelled) return;
        if (error) {
          // Ærlig degradering: tabellen kan mangle i vinduet mellem merge og
          // ejerens manuelle migration-apply (#2642-rammerne) — samme holdning
          // som RaceDetailPage's moments-fetch. Ingen fejlbanner, blot intet kort.
          console.warn("rider_career_events fetch failed (table may not be migrated yet):", error.message);
          setEvents([]);
          return;
        }
        setEvents(data || []);
      } catch {
        if (!cancelled) setEvents([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

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
