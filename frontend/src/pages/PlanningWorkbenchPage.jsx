// #7535 · Planlaegningssiden (Planning Workbench), trin 1. Erstatter paa sigt de fire faner
// (Udtagelse, Form, Strategi, Kalender) med én side: loebsliste, ugeoversigt, ruteprofil og
// trup-tabel, med en bjaelke for ugemte aendringer. Taktik (trin 2) og Peak form + mobil-ark
// (trin 3) kommer senere.
//
// Findes KUN bag kontakten planning_workbench (off|beta|on, standard off). Slukket: ruten sender
// videre til den nuvaerende planlaegningsside, som er uroert. Siden henter og gemmer gennem de
// eksisterende endpoints (se lib/planningWorkbenchData.js); der er ingen nye skrive-endpoints.
//
// Layout: T2 wide data (cap 1600 px). Spec: docs/superpowers/specs/2026-11-02-planning-workbench-design.md
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { PageHeader, Button, EmptyState, ErrorState, SkeletonLines, PageLoader, CalendarIcon, FlagIcon } from "../components/ui";
import { buttonClass } from "../components/ui/buttonStyles.js";
import WeekBoard from "../components/planning/WeekBoard.jsx";
import RaceList from "../components/planning/RaceList.jsx";
import RaceWorkbench from "../components/planning/RaceWorkbench.jsx";
import UnsavedBar from "../components/planning/UnsavedBar.jsx";
import { usePlanningWorkbenchFlag } from "../lib/usePlanningWorkbenchFlag.js";
import { loadSeasonOverview, loadRaceTerrain } from "../lib/planningWorkbenchData.js";
import {
  addDays,
  copenhagenToday,
  dateIndex,
  groupRacesByWeek,
  isRacePast,
  mondayOf,
  pickedCounts,
  raceReadiness,
  raceStartDate,
  replaceRaceEntries,
  visibleRaces,
} from "../lib/planningWorkbench.ts";

// Det spilleren sidst valgte huskes pr. browser (aldrig noget der skal overleve en ny enhed).
function readPref(key, fallback) {
  try {
    const raw = localStorage.getItem(`cz-planning-${key}`);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function writePref(key, value) {
  try {
    localStorage.setItem(`cz-planning-${key}`, JSON.stringify(value));
  } catch {
    // catch-ok: privat tilstand eller blokeret lager; valget gaelder bare for denne session.
  }
}

function Toggle({ pressed, onClick, children }) {
  return (
    <Button variant="secondary" size="sm" aria-pressed={pressed} onClick={onClick} className={pressed ? "border-cz-3 bg-cz-subtle" : ""}>
      {children}
    </Button>
  );
}

export default function PlanningWorkbenchPage() {
  const flag = usePlanningWorkbenchFlag();
  if (flag === null) return <PageLoader />;
  if (flag === false) return <Navigate to="/planning" replace />; // kontakten er slukket: den nye rute findes ikke
  return <Workbench />;
}

function Workbench() {
  const { t } = useTranslation("planning");
  const [searchParams, setSearchParams] = useSearchParams();
  const today = useMemo(() => copenhagenToday(), []);

  const [load, setLoad] = useState({ state: "loading", payload: null });
  const [entries, setEntries] = useState([]);
  const [terrain, setTerrain] = useState(() => new Map());
  const [showWeek, setShowWeek] = useState(() => readPref("week", false));
  const [showList, setShowList] = useState(() => readPref("list", true));
  const [profileHidden, setProfileHidden] = useState(() => readPref("profileHidden", false));
  const [scope, setScope] = useState("next7");
  const [showPast, setShowPast] = useState(false);
  const [weekMonday, setWeekMonday] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [pendingId, setPendingId] = useState(null);
  const [barBusy, setBarBusy] = useState(false);
  const workbenchRef = useRef(null);
  const anchorRef = useRef(null);
  const userPicked = useRef(false);

  const fetchSeason = useCallback(async () => {
    setLoad({ state: "loading", payload: null });
    try {
      const res = await loadSeasonOverview();
      if (!res.ok || !res.data) {
        setLoad({ state: "error", payload: null });
        return;
      }
      setLoad({ state: "ready", payload: res.data });
      setEntries(res.data.entries ?? []);
    } catch {
      setLoad({ state: "error", payload: null });
    }
  }, []);

  useEffect(() => {
    fetchSeason();
  }, [fetchSeason]);

  const payload = load.payload;
  const allRaces = useMemo(() => payload?.races ?? [], [payload]);
  const dates = useMemo(() => dateIndex(payload?.dayDates ?? []), [payload]);
  const withdrawn = useMemo(() => new Set(payload?.withdrawnRaceIds ?? []), [payload]);
  const counts = useMemo(() => pickedCounts(entries), [entries]);

  // Etape-striben i listen og ugeoversigten hentes for de kommende loeb (forbi-loeb vises ikke som standard).
  useEffect(() => {
    const ids = allRaces.filter((r) => !isRacePast(r)).map((r) => r.id);
    if (!ids.length) return undefined;
    let cancelled = false;
    loadRaceTerrain(ids).then((map) => {
      if (!cancelled) setTerrain(map);
    });
    return () => {
      cancelled = true;
    };
  }, [allRaces]);

  const listRaces = useMemo(() => visibleRaces(allRaces, dates, { scope, showPast, today }), [allRaces, dates, scope, showPast, today]);
  const boardRaces = useMemo(() => (showPast ? allRaces : allRaces.filter((r) => !isRacePast(r))), [allRaces, showPast]);

  // Det valgte loeb: ?race= i adressen, ellers det foerste kommende loeb der mangler en trup.
  const requestedId = searchParams.get("race");
  const selected = useMemo(() => {
    const byId = allRaces.find((r) => r.id === requestedId);
    if (byId) return byId;
    const upcoming = listRaces.length ? listRaces : allRaces.filter((r) => !isRacePast(r));
    return upcoming.find((r) => raceReadiness(r, counts.get(r.id) ?? 0, withdrawn).state === "missing") ?? upcoming[0] ?? null;
    // counts er bevidst ikke en afhaengighed: valget maa ikke hoppe naar en trup gemmes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRaces, requestedId, listRaces, withdrawn]);

  // Ugeoversigten starter i ugen for det valgte loeb (ellers dagens uge).
  const weekGroups = useMemo(() => groupRacesByWeek(boardRaces, dates), [boardRaces, dates]);
  const firstMonday = weekGroups[0]?.monday ?? null;
  const lastMonday = weekGroups[weekGroups.length - 1]?.monday ?? null;
  const activeMonday = useMemo(() => {
    if (weekMonday) return weekMonday;
    const start = selected ? raceStartDate(selected, dates) : null;
    return mondayOf(start ?? today);
  }, [weekMonday, selected, dates, today]);

  const selectRace = useCallback(
    (id) => {
      userPicked.current = true;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("race", id);
          return next;
        },
        { replace: true },
      );
      const race = allRaces.find((r) => r.id === id);
      const start = race ? raceStartDate(race, dates) : null;
      if (start) setWeekMonday(mondayOf(start));
    },
    [allRaces, dates, setSearchParams],
  );

  // Et klik paa et andet loeb med ugemte aendringer aabner bjaelken i stedet for at miste dem.
  const requestSelect = (id) => {
    if (selected && id === selected.id) return;
    if (dirty) {
      setPendingId(id);
      return;
    }
    selectRace(id);
  };

  // På en smal skaerm staar arbejdsfladen under listen: scroll den i syne naar et loeb vaelges.
  useEffect(() => {
    if (!userPicked.current || !selected) return;
    userPicked.current = false;
    if (typeof window !== "undefined" && window.matchMedia?.("(max-width: 1023px)").matches) {
      anchorRef.current?.scrollIntoView?.({ block: "start", behavior: "auto" });
    }
  }, [selected]);

  // Browserens egen advarsel ved luk/genindlaes, saa en ugemt trup aldrig forsvinder tavst.
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const pendingRace = pendingId ? allRaces.find((r) => r.id === pendingId) : null;
  const stay = () => setPendingId(null);
  const discardAndOpen = () => {
    workbenchRef.current?.discard();
    const id = pendingId;
    setPendingId(null);
    if (id) selectRace(id);
  };
  const saveAndOpen = async () => {
    setBarBusy(true);
    const ok = await workbenchRef.current?.save();
    setBarBusy(false);
    if (ok && pendingId) {
      const id = pendingId;
      setPendingId(null);
      selectRace(id);
    }
  };

  const onSaved = useCallback((raceId, next) => setEntries((cur) => replaceRaceEntries(cur, raceId, next)), []);
  const toggleWeek = () => {
    setShowWeek(!showWeek);
    writePref("week", !showWeek);
  };
  const toggleList = () => {
    setShowList(!showList);
    writePref("list", !showList);
  };
  const toggleProfile = () => {
    setProfileHidden(!profileHidden);
    writePref("profileHidden", !profileHidden);
  };

  const upcomingNeed = allRaces.filter(
    (r) => !isRacePast(r) && (raceStartDate(r, dates) ?? "9999") <= addDays(today, 8) && raceReadiness(r, counts.get(r.id) ?? 0, withdrawn).state === "missing",
  ).length;
  const subtitle =
    load.state === "ready"
      ? [
          payload?.season?.number != null ? t("subtitle.season", { number: payload.season.number }) : null,
          upcomingNeed > 0 ? t("subtitle.needSquad", { count: upcomingNeed }) : t("subtitle.allReady"),
        ]
          .filter(Boolean)
          .join(" · ")
      : undefined;

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <Toggle pressed={showWeek} onClick={toggleWeek}>
        {t("toggles.weekBoard")}
      </Toggle>
      <Toggle pressed={showList} onClick={toggleList}>
        {t("toggles.raceList")}
      </Toggle>
      <Link to="/planning?tab=calendar" className={buttonClass({ variant: "secondary", size: "sm" })}>
        <CalendarIcon size={14} aria-hidden="true" />
        {t("monthCalendar")}
      </Link>
    </div>
  );

  let content;
  if (load.state === "loading") {
    content = (
      <div className="rounded-cz border border-cz-border bg-cz-card p-4">
        <SkeletonLines lines={6} />
      </div>
    );
  } else if (load.state === "error") {
    content = (
      <ErrorState
        title={t("error.title")}
        description={t("error.description")}
        action={
          <Button variant="secondary" size="sm" onClick={fetchSeason}>
            {t("error.retry")}
          </Button>
        }
      />
    );
  } else if (payload?.enabled === false || !payload?.season) {
    content = (
      <EmptyState
        icon={<FlagIcon size={26} aria-hidden="true" />}
        title={t("notOpen.title")}
        description={t("notOpen.description")}
        action={
          <Link to="/planning" className={buttonClass({ variant: "secondary", size: "sm" })}>
            {t("notOpen.action")}
          </Link>
        }
      />
    );
  } else if (allRaces.length === 0) {
    content = (
      <EmptyState
        icon={<FlagIcon size={26} aria-hidden="true" />}
        title={t("noRaces.title")}
        description={t("noRaces.description")}
        action={
          <Link to="/planning?tab=calendar" className={buttonClass({ variant: "secondary", size: "sm" })}>
            {t("monthCalendar")}
          </Link>
        }
      />
    );
  } else {
    content = (
      <>
        {showWeek && (
          <WeekBoard
            races={boardRaces}
            dates={dates}
            monday={activeMonday}
            counts={counts}
            withdrawn={withdrawn}
            terrain={terrain}
            selectedId={selected?.id}
            onSelect={requestSelect}
            onWeekChange={(dir) => setWeekMonday(addDays(activeMonday, dir * 7))}
            canPrev={firstMonday != null && activeMonday > firstMonday}
            canNext={lastMonday != null && activeMonday < lastMonday}
          />
        )}
        {pendingRace && selected && (
          <UnsavedBar
            raceName={selected.name}
            nextName={pendingRace.name}
            busy={barBusy}
            onStay={stay}
            onDiscard={discardAndOpen}
            onSaveAndOpen={saveAndOpen}
          />
        )}
        <div className={`grid items-start gap-3.5 ${showList ? "lg:grid-cols-[320px_minmax(0,1fr)]" : ""}`}>
          {showList && (
            <RaceList
              races={listRaces}
              allRaces={allRaces}
              dates={dates}
              counts={counts}
              withdrawn={withdrawn}
              terrain={terrain}
              selectedId={selected?.id}
              onSelect={requestSelect}
              scope={scope}
              onScope={setScope}
              showPast={showPast}
              onShowPast={setShowPast}
              today={today}
            />
          )}
          <div ref={anchorRef} className="min-w-0 scroll-mt-4">
            {selected ? (
              <RaceWorkbench
                key={selected.id}
                ref={workbenchRef}
                race={selected}
                allRaces={allRaces}
                entries={entries}
                withdrawn={withdrawn}
                profileHidden={profileHidden}
                onToggleProfileHidden={toggleProfile}
                onDirtyChange={setDirty}
                onSaved={onSaved}
              />
            ) : (
              <EmptyState
                icon={<FlagIcon size={26} aria-hidden="true" />}
                title={t("noSelection.title")}
                description={t("noSelection.description")}
                action={
                  <Button variant="secondary" size="sm" onClick={() => setScope("season")}>
                    {t("raceList.scopeSeason")}
                  </Button>
                }
              />
            )}
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="mx-auto max-w-[1600px]" data-testid="planning-workbench-page">
      <PageHeader title={t("title")} subtitle={subtitle} actions={actions} />
      {content}
    </div>
  );
}
