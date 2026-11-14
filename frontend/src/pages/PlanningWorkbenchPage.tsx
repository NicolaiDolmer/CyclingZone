// #7535 · Planlaegningssiden (Planning Workbench), trin 1. Erstatter paa sigt de fire faner
// (Udtagelse, Form, Strategi, Kalender) med én side: loebsliste, ugeoversigt, ruteprofil og
// trup-tabel, med en bjaelke for ugemte aendringer. Taktik (trin 2) og Peak form + mobil-ark
// (trin 3) kommer senere.
//
// Findes KUN bag kontakten planning_workbench (off|beta|on, standard off). Slukket: ruten sender
// videre til den nuvaerende planlaegningsside, som er uroert. Siden henter og gemmer gennem de
// eksisterende endpoints (se lib/planningWorkbenchData.ts); der er ingen nye skrive-endpoints.
//
// Layout: T2 wide data (cap 1600 px). Spec: docs/superpowers/specs/2026-11-02-planning-workbench-design.md
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { PageHeader, Button, EmptyState, ErrorState, SkeletonLines, PageLoader, CalendarIcon, FlagIcon, buttonClass } from "../components/planning/primitives.ts";
import WeekBoard from "../components/planning/WeekBoard.tsx";
import RaceList from "../components/planning/RaceList.tsx";
import RaceWorkbench, { type RaceWorkbenchHandle } from "../components/planning/RaceWorkbench.tsx";
import UnsavedBar from "../components/planning/UnsavedBar.tsx";
import SelectionDeadlineReminder from "../components/planning/SelectionDeadlineReminder.tsx";
import { useSelectionReminder, refreshSelectionReminder } from "../hooks/useSelectionReminder.ts";
import { usePlanningWorkbenchFlag } from "../lib/usePlanningWorkbenchFlag.ts";
import { seasonReferenceYear } from "../lib/riderAge.js";
import { loadSeasonOverview, loadRaceTerrain, loadRiderDetails, loadSeasonLoad, type RiderDetail, type SeasonLoad } from "../lib/planningWorkbenchData.ts";
import {
  addDays,
  copenhagenToday,
  dateIndex,
  groupRacesByWeek,
  isRacePast,
  mondayOf,
  pickedCounts,
  raceReadiness,
  raceEndDate,
  raceStartDate,
  replaceRaceEntries,
  visibleRaces,
  type DayDate,
  type RaceScope,
  type SeasonEntry,
  type SeasonRace,
} from "../lib/planningWorkbench.ts";

// Saesonmatrixens svar (GET /api/races/selection/season); siden laeser kun de felter den kender.
interface SeasonResponse {
  enabled?: boolean;
  season?: { number?: number } | null;
  races?: SeasonRace[];
  entries?: SeasonEntry[];
  riders?: { id: string }[];
  dayDates?: DayDate[];
  withdrawnRaceIds?: string[];
}

// Det spilleren sidst valgte huskes pr. browser (aldrig noget der skal overleve en ny enhed).
function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`cz-planning-${key}`);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: unknown) {
  try {
    localStorage.setItem(`cz-planning-${key}`, JSON.stringify(value));
  } catch {
    // catch-ok: privat tilstand eller blokeret lager; valget gaelder bare for denne session.
  }
}

function Toggle({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Button variant="secondary" size="sm" aria-pressed={pressed} onClick={onClick} className={pressed ? "border-cz-3 bg-cz-subtle" : ""}>
      {/* Til/fra ses paa knappen selv (wireframets kontakt): udfyldt firkant = vist, tom = skjult. */}
      <span
        aria-hidden="true"
        data-testid="planning-toggle-mark"
        className={`inline-block h-2.5 w-2.5 shrink-0 rounded-[2px] border ${pressed ? "border-cz-1 bg-cz-1" : "border-cz-3 bg-transparent"}`}
      />
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

  const [load, setLoad] = useState<{ state: "loading" | "error" | "ready"; payload: SeasonResponse | null }>({ state: "loading", payload: null });
  const [entries, setEntries] = useState<SeasonEntry[]>([]);
  const [terrain, setTerrain] = useState<Map<string, string[]>>(() => new Map());
  // Flag, U23 og skadesdato (riders + rider_condition) og saeson-belastningen (samme tal som /planning).
  const [riderDetails, setRiderDetails] = useState<Map<string, RiderDetail>>(() => new Map());
  const [seasonLoad, setSeasonLoad] = useState<Record<string, SeasonLoad>>({});
  // Ugeoversigten staar fremme som i wireframet (#7535); spillerens eget valg huskes derefter.
  const [showWeek, setShowWeek] = useState(() => readPref("week", true));
  const [showList, setShowList] = useState(() => readPref("list", true));
  const [profileHidden, setProfileHidden] = useState(() => readPref("profileHidden", false));
  const [scope, setScope] = useState<RaceScope>("next7");
  const [showPast, setShowPast] = useState(false);
  const [weekMonday, setWeekMonday] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [barBusy, setBarBusy] = useState(false);
  const workbenchRef = useRef<RaceWorkbenchHandle>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
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
  const allRaces = useMemo<SeasonRace[]>(() => payload?.races ?? [], [payload]);
  const dates = useMemo(() => dateIndex(payload?.dayDates ?? []), [payload]);
  // Et loeb holdet er meldt til igen ved at gemme en trup, staar ikke laengere som afmeldt.
  const [rejoined, setRejoined] = useState<Set<string>>(() => new Set());
  // Loeb holdet har meldt fra til her paa siden (knappen "Afmeld"), indtil sæsonoversigten hentes igen.
  const [withdrawnHere, setWithdrawnHere] = useState<Set<string>>(() => new Set());
  const withdrawn = useMemo(
    () => new Set<string>([...(payload?.withdrawnRaceIds ?? []), ...withdrawnHere].filter((id) => !rejoined.has(id))),
    [payload, rejoined, withdrawnHere],
  );
  const counts = useMemo(() => pickedCounts(entries), [entries]);
  // U23 foelger saesonens referenceaar, samme regel som holdsiden (riderAge.js).
  const seasonYear = useMemo(() => seasonReferenceYear(Number(payload?.season?.number)) as number | null, [payload]);

  const riderIdKey = (payload?.riders ?? []).map((r) => r.id).join(",");
  useEffect(() => {
    if (!riderIdKey) return undefined;
    let cancelled = false;
    loadRiderDetails(riderIdKey.split(",")).then((map) => {
      if (!cancelled) setRiderDetails(map);
    });
    return () => {
      cancelled = true;
    };
  }, [riderIdKey]);

  // Belastningen hentes igen efter hvert gem, ligesom dagvisningen henter brættet igen.
  const [loadVersion, setLoadVersion] = useState(0);
  useEffect(() => {
    if (load.state !== "ready") return undefined;
    let cancelled = false;
    loadSeasonLoad().then((next) => {
      if (!cancelled) setSeasonLoad(next);
    });
    return () => {
      cancelled = true;
    };
  }, [load.state, loadVersion]);

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
  const fallback = useMemo(() => {
    const upcoming = listRaces.length ? listRaces : allRaces.filter((r) => !isRacePast(r));
    return upcoming.find((r) => raceReadiness(r, counts.get(r.id) ?? 0, withdrawn).state === "missing") ?? upcoming[0] ?? null;
  }, [allRaces, listRaces, counts, withdrawn]);
  const selected: SeasonRace | null = allRaces.find((r) => r.id === requestedId) ?? fallback;
  // Foerste gang lander spilleren paa fallback-loebet; derefter staar valget i adressen og hopper aldrig, naar en trup gemmes.
  useEffect(() => {
    if (load.state !== "ready" || requestedId || !fallback) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("race", fallback.id);
        return next;
      },
      { replace: true },
    );
  }, [load.state, requestedId, fallback, setSearchParams]);

  // Ugeoversigten starter i ugen for det valgte loeb (ellers dagens uge).
  const weekGroups = useMemo(() => groupRacesByWeek(boardRaces, dates), [boardRaces, dates]);
  const firstMonday = weekGroups[0]?.monday ?? null;
  // Sidste uge man kan bladre til afgoeres af det seneste SLUTDATO (et etapeloeb kan fortsaette ind i en senere uge).
  const lastEnd = boardRaces.map((r) => raceEndDate(r, dates)).filter((d): d is string => !!d).sort().pop();
  const lastMonday = lastEnd ? mondayOf(lastEnd) : null;
  const activeMonday = useMemo(() => {
    if (weekMonday) return weekMonday;
    const start = selected ? raceStartDate(selected, dates) : null;
    return mondayOf(start ?? today);
  }, [weekMonday, selected, dates, today]);

  const selectRace = useCallback(
    (id: string) => {
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
  const requestSelect = (id: string) => {
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
    const handler = (e: BeforeUnloadEvent) => {
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

  const onSaved = useCallback((raceId: string, next: SeasonEntry[]) => {
    setEntries((cur) => replaceRaceEntries(cur, raceId, next));
    setRejoined((cur) => new Set(cur).add(raceId));
    refreshSelectionReminder();
    setLoadVersion((v) => v + 1);
  }, []);
  const onWithdrawnChange = useCallback((raceId: string, isOut: boolean) => {
    setWithdrawnHere((cur) => {
      const next = new Set(cur);
      if (isOut) next.add(raceId);
      else next.delete(raceId);
      return next;
    });
    setRejoined((cur) => {
      const next = new Set(cur);
      if (isOut) next.delete(raceId);
      else next.add(raceId);
      return next;
    });
    refreshSelectionReminder();
  }, []);
  // Samme fristboks som /planning: hvilke trupper mangler, og hvor lang tid er der til start.
  const { reminder } = useSelectionReminder();
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
            onWeekChange={(dir: -1 | 1) => setWeekMonday(addDays(activeMonday, dir * 7))}
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
                riderDetails={riderDetails}
                seasonLoad={seasonLoad}
                seasonYear={seasonYear}
                profileHidden={profileHidden}
                onToggleProfileHidden={toggleProfile}
                onDirtyChange={setDirty}
                onSaved={onSaved}
                onWithdrawnChange={onWithdrawnChange}
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
      <SelectionDeadlineReminder reminder={reminder} />
      {content}
    </div>
  );
}
