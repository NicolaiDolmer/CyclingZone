// #7535 · Planlaegningssiden (Planning Workbench), trin 1. Erstatter paa sigt de fire faner
// (Udtagelse, Form, Strategi, Kalender) med én side: loebsliste, ugeoversigt, ruteprofil og
// trup-tabel, med en bjaelke for ugemte aendringer. Runde 3: visningerne Trup | Taktik | Formtop under
// ruteprofilen, kolonnen "Efter loebet" og mobil-arket (loebslisten foerst, loebet som bundark).
//
// Findes KUN bag kontakten planning_workbench (off|beta|on, standard off). Slukket: ruten sender
// videre til den nuvaerende planlaegningsside, som er uroert. Siden henter og gemmer gennem de
// eksisterende endpoints (se lib/planningWorkbenchData.ts). Handlinger-menuen (variant B) har to nye
// kald: assistentens forslag til mange loeb (laeser kun) og afmelding af mange loeb (alt eller intet).
//
// Layout: T2 wide data (cap 1600 px). Spec: docs/superpowers/specs/2026-11-02-planning-workbench-design.md
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { PageHeader, Button, EmptyState, ErrorState, SkeletonLines, PageLoader, CalendarIcon, FlagIcon, buttonClass, forgetSelectionDraft } from "../components/planning/primitives.ts";
import WeekBoard from "../components/planning/WeekBoard.tsx";
import RaceList from "../components/planning/RaceList.tsx";
import RaceWorkbench, { type RaceWorkbenchHandle } from "../components/planning/RaceWorkbench.tsx";
import UnsavedBar from "../components/planning/UnsavedBar.tsx";
import RaceSheet from "../components/planning/RaceSheet.tsx";
import { usePeakBoardData } from "../components/planning/PeakView.tsx";
import { BulkMenu, BulkDraftBar, BulkRowMark, BulkOpenRaceNote, CheckedCount, type BulkPlan } from "../components/planning/BulkActions.tsx";
import SelectionDeadlineReminder from "../components/planning/SelectionDeadlineReminder.tsx";
import { useSelectionReminder, refreshSelectionReminder } from "../hooks/useSelectionReminder.ts";
import { usePlanningWorkbenchFlag } from "../lib/usePlanningWorkbenchFlag.ts";
import { seasonReferenceYear } from "../lib/riderAge.js";
import {
  loadSeasonOverview,
  loadRaceTerrain,
  loadRiderDetails,
  loadSeasonLoad,
  saveRaceSelectionsBulk,
  proposeAssistantSquads,
  withdrawRacesBulk,
  SELECTION_BULK_MAX,
  type RiderDetail,
  type SeasonLoad,
} from "../lib/planningWorkbenchData.ts";
import {
  addDays,
  adjacentRace,
  isWorkbenchView,
  normalizeMobileColumns,
  peakCountsByRace,
  type MobileColumn,
  type WorkbenchView,
  actionTargets,
  capToRoom,
  createBulkStore,
  createWriteGate,
  draftSummary,
  entriesFromSelection,
  entriesWithDraft,
  raceSwitchStep,
  scopeRaces,
  withdrawnWithDraft,
  BULK_KINDS,
  BULK_SCOPES,
  EMPTY_DRAFT,
  type BulkFailure,
  type BulkKind,
  type BulkScope,
  type BulkStore,
  type TrainNowLocks,
  type WriteGate,
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
  trainNowLockByRace?: TrainNowLocks;
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

// Smal skaerm (under lg): loebslisten er foerste skaerm, og loebet aabner som bundark (spec "Mobile").
const NARROW_QUERY = "(max-width: 1023px)";
function subscribeNarrow(cb: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(NARROW_QUERY);
  mq.addEventListener?.("change", cb);
  return () => mq.removeEventListener?.("change", cb);
}
function readNarrow() {
  return typeof window !== "undefined" && !!window.matchMedia?.(NARROW_QUERY).matches;
}
function useNarrow() {
  return useSyncExternalStore(subscribeNarrow, readNarrow, () => false);
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
  const { t: tr } = useTranslation("races");
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
  // "Skjul profil" huskes for alle loeb (punkt 4 D). Mobil-arket har sit eget valg, foldet som standard
  // (punkt 2, kompakt), saa rytterne staar tidligt paa en lille skaerm.
  const [profileHidden, setProfileHidden] = useState(() => readPref("profileHidden", false));
  const [sheetProfileHidden, setSheetProfileHidden] = useState(() => readPref("sheetProfileHidden", true));
  // Mobilens tal-kolonner i trup-tabellen (chip-raekken); spillerens valg huskes.
  const [mobileColumns, setMobileColumns] = useState<MobileColumn[]>(() => normalizeMobileColumns(readPref<unknown>("mobileColumns", null)));
  const changeMobileColumns = useCallback((next: MobileColumn[]) => {
    setMobileColumns(next);
    writePref("mobileColumns", next);
  }, []);
  // Visningen under ruteprofilen (Trup | Taktik | Formtop): spillerens sidste valg huskes.
  const [view, setView] = useState<WorkbenchView>(() => {
    const saved = readPref<unknown>("view", "squad");
    return isWorkbenchView(saved) ? saved : "squad";
  });
  const changeView = useCallback((next: WorkbenchView) => {
    setView(next);
    writePref("view", next);
  }, []);
  const narrow = useNarrow();
  // Mobil-arket er aabent, naar spilleren har trykket paa et loeb (aldrig af sig selv ved indlaesning).
  const [sheetOpen, setSheetOpen] = useState(false);
  // Arket kraever en liste at vaelge fra: er baade listen og ugeoversigten skjult, staar loebet paa siden.
  const useSheet = narrow && (showList || showWeek);
  const useSheetRef = useRef(useSheet);
  useSheetRef.current = useSheet;
  // Sidens skrive-laas: ÉT sted ejer "der er et kald i gang" (fladens gem, afmeld, masse-gem, assistenten).
  // Alle veje der sender eller anvender noget (gem, Handlinger, Fortryd, Gem, loebsskift) laeser den,
  // og kun det kald der tog den, kan slippe den.
  const [gate] = useState<WriteGate>(() => createWriteGate());
  const writing = useSyncExternalStore(gate.subscribe, gate.current);
  // "Handlinger" (ejer 14/11, variant B): kladden over mange loeb, indtil spilleren gemmer eller fortryder.
  const [bulk] = useState<BulkStore>(() =>
    createBulkStore({ gate, api: { propose: proposeAssistantSquads, saveSelections: saveRaceSelectionsBulk, withdraw: withdrawRacesBulk } }),
  );
  const bulkState = useSyncExternalStore(bulk.subscribe, bulk.get);
  const draft = bulkState.stack[bulkState.stack.length - 1] ?? EMPTY_DRAFT;
  const [bulkScope, setBulkScope] = useState<BulkScope>("next");
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  // Et afmeldt aabent loeb hentes igen (fladen monteres paa ny), naar kladdens afmelding er gemt.
  const [workbenchVersion, setWorkbenchVersion] = useState(0);
  const [scope, setScope] = useState<RaceScope>("next7");
  const [showPast, setShowPast] = useState(false);
  const [weekMonday, setWeekMonday] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  // Et loebsskift, der kom mens et skrivekald koerte: udfoeres, naar kaldet er faerdigt.
  const [queuedId, setQueuedId] = useState<string | null>(null);
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
  const locks = useMemo<TrainNowLocks>(() => payload?.trainNowLockByRace ?? {}, [payload]);
  // Listen og ugeoversigten viser kladden: et ryddet loeb staar som 0/6, et afmeldt som afmeldt, foer noget er gemt.
  const shownEntries = useMemo(() => entriesWithDraft(entries, draft, locks), [entries, draft, locks]);
  const shownWithdrawn = useMemo(() => withdrawnWithDraft(withdrawn, draft), [withdrawn, draft]);
  const counts = useMemo(() => pickedCounts(shownEntries), [shownEntries]);
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
    return upcoming.find((r) => raceReadiness(r, counts.get(r.id) ?? 0, shownWithdrawn).state === "missing") ?? upcoming[0] ?? null;
  }, [allRaces, listRaces, counts, shownWithdrawn]);
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
      setCloseAsk(false);
      setSheetOpen(true);
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

  // Et klik paa et andet loeb med ugemte aendringer aabner bjaelken i stedet for at miste dem. Mens et
  // skrivekald koerer, saettes skiftet i koe (svaret skal lande paa den flade, der sendte det).
  const selectedId = selected?.id ?? null;
  const requestSelect = useCallback(
    (id: string) => {
      const step = raceSwitchStep({
        same: id === selectedId,
        writing: gate.current(),
        dirty: workbenchRef.current?.isDirty() ?? dirty,
      });
      // Paa en smal skaerm aabner et tryk altid arket (ogsaa paa det valgte loeb eller med bjaelken for ugemte aendringer).
      setSheetOpen(true);
      if (step === "queue") setQueuedId(id);
      else if (step === "ask") setPendingId(id);
      else if (step === "go") selectRace(id);
    },
    [selectedId, gate, dirty, selectRace],
  );
  useEffect(() => {
    if (writing || !queuedId) return;
    setQueuedId(null);
    requestSelect(queuedId);
  }, [writing, queuedId, requestSelect]);

  // På en smal skaerm staar arbejdsfladen under listen: scroll den i syne naar et loeb vaelges.
  useEffect(() => {
    if (!userPicked.current || !selected) return;
    userPicked.current = false;
    if (useSheetRef.current) return; // arket viser loebet; listen bliver staaende bagved
    if (typeof window !== "undefined" && window.matchMedia?.("(max-width: 1023px)").matches) {
      anchorRef.current?.scrollIntoView?.({ block: "start", behavior: "auto" });
    }
  }, [selected]);

  // Browserens egen advarsel ved luk/genindlaes, saa en ugemt trup eller kladde aldrig forsvinder tavst.
  const hasDraft = draft.kinds.size > 0;
  useEffect(() => {
    if (!dirty && !hasDraft) return undefined;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, hasDraft]);

  // Mobil-arket lukkes (kryds, Escape, baggrund, stryg ned): en ugemt trup eller taktik-kladde ville
  // forsvinde med fladen, saa spilleren spoerges foerst (Bliv her / Kassér / Gem og luk).
  const [closeAsk, setCloseAsk] = useState(false);
  const requestCloseSheet = () => {
    if (gate.current()) return;
    if (workbenchRef.current?.isDirty()) setCloseAsk(true);
    else setSheetOpen(false);
  };
  const discardAndClose = () => {
    if (gate.current()) return;
    workbenchRef.current?.discard();
    setCloseAsk(false);
    setSheetOpen(false);
  };
  const saveAndClose = async () => {
    const ok = await workbenchRef.current?.save();
    if (ok) {
      setCloseAsk(false);
      setSheetOpen(false);
    }
  };

  const pendingRace = pendingId ? allRaces.find((r) => r.id === pendingId) : null;
  const stay = () => setPendingId(null);
  const discardAndOpen = () => {
    if (gate.current()) return;
    workbenchRef.current?.discard();
    const id = pendingId;
    setPendingId(null);
    if (id) selectRace(id);
  };
  const saveAndOpen = async () => {
    // Gemmet tager selv sidens skrive-laas: holdes den, sendes intet, og bjaelken bliver staaende.
    const ok = await workbenchRef.current?.save();
    if (ok && pendingId) {
      const id = pendingId;
      setPendingId(null);
      selectRace(id);
    }
  };

  // Spilleren har selv taget over paa fladen (aendret, gemt eller afmeldt): loebet forlader kladden.
  const dropFromDraft = useCallback((raceId: string) => bulk.drop([raceId]), [bulk]);

  const onSaved = useCallback((raceId: string, next: SeasonEntry[]) => {
    setEntries((cur) => replaceRaceEntries(cur, raceId, next));
    setRejoined((cur) => new Set(cur).add(raceId));
    bulk.drop([raceId]);
    refreshSelectionReminder();
    setLoadVersion((v) => v + 1);
  }, [bulk]);

  // ── Handlinger (variant B) ─────────────────────────────────────────────────
  // Omfanget og hvad hver handling ville aendre lige nu, i kladdens visning og inden for ét gems loft.
  const scopeCtx = useMemo(() => ({ allRaces, listRaces, checked, withdrawn: shownWithdrawn }), [allRaces, listRaces, checked, shownWithdrawn]);
  const scopeCounts = useMemo(
    () => Object.fromEntries(BULK_SCOPES.map((s) => [s, scopeRaces(s, scopeCtx).length])) as Record<BulkScope, number>,
    [scopeCtx],
  );
  const nextName = useMemo(() => scopeRaces("next", scopeCtx)[0]?.name ?? null, [scopeCtx]);
  const plans = useMemo(() => {
    const races = scopeRaces(bulkScope, scopeCtx);
    return Object.fromEntries(
      BULK_KINDS.map((kind) => {
        const targets = actionTargets(kind, races, { entries: shownEntries, withdrawn: shownWithdrawn, locks });
        const cap = capToRoom(targets.map((r) => r.id), draft, SELECTION_BULK_MAX);
        return [kind, { ids: cap.ids, count: cap.ids.length, capped: cap.capped }];
      }),
    ) as Record<BulkKind, BulkPlan & { ids: string[] }>;
  }, [bulkScope, scopeCtx, shownEntries, shownWithdrawn, locks, draft]);

  // En handling lander i kladden; assistenten spoerges gennem sidens skrive-laas (det laeser kun).
  const runAction = async (kind: BulkKind) => {
    const outcome = await bulk.run(kind, plans[kind].ids, { entries, locks, withdrawn });
    if (outcome === "done" && bulkScope === "checked") setChecked(new Set());
  };
  const toggleCheck = useCallback((id: string) => {
    setChecked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Gem kladden: trupperne i ét atomisk kald og afmeldingerne i ét (alt eller intet, PLANNING_CENTER_RULES
  // §1). Kaldet holder sidens skrive-laas, til den aabne flade har afstemt og hentet sin tilgaengelighed.
  const saveDraft = () =>
    bulk.save({ entries, locks }, async ({ selections, withdrawn: out }) => {
      setEntries((cur) => {
        let next = cur;
        for (const [raceId, sel] of selections) next = replaceRaceEntries(next, raceId, entriesFromSelection(raceId, sel));
        return next;
      });
      if (out.length) {
        setWithdrawnHere((cur) => new Set([...cur, ...out]));
        setRejoined((cur) => new Set([...cur].filter((id) => !out.includes(id))));
      }
      // Den aabne flade afstemmer selv sit eget loeb mod det sendte; de andre loebs huskede kladder er foraeldede.
      const view = workbenchRef.current;
      for (const [raceId, sel] of selections) if (!view?.markSaved(raceId, sel)) forgetSelectionDraft(raceId);
      for (const raceId of out) forgetSelectionDraft(raceId);
      if (selectedId && out.includes(selectedId)) setWorkbenchVersion((v) => v + 1);
      refreshSelectionReminder();
      setLoadVersion((v) => v + 1);
      // Ryttere bundet i et ryddet loeb er nu fri: den aabne flade henter deres tilgaengelighed igen.
      await view?.refreshAvailability();
    });

  const failureText = (failure: BulkFailure): string => {
    const body = failure.body ?? {};
    const conflict = Array.isArray(body.conflicts) ? body.conflicts[0] : null;
    const message = conflict
      ? tr("selection.errors.selection_rider_bound_named", { rider: conflict.rider_name ?? "", race: conflict.race_name ?? conflict.bound_race_name ?? "" })
      : tr([`selection.errors.${body.error || "generic"}`, "selection.errors.generic"]);
    if (failure.step === "assist") return t("bulk.assistError", { error: message });
    if (failure.partial) return t("bulk.draft.errorWithdraw", { error: message });
    const failed = allRaces.find((r) => r.id === body.race_id);
    return failed ? t("bulk.draft.errorIn", { race: failed.name, error: message }) : t("bulk.draft.error", { error: message });
  };
  const bulkMessage = bulkState.failure ? failureText(bulkState.failure) : bulkState.emptyAssist ? t("bulk.assistNone") : null;

  const onWithdrawnChange = useCallback((raceId: string, isOut: boolean) => {
    bulk.drop([raceId]);
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
  }, [bulk]);
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
    if (useSheet) {
      setSheetProfileHidden(!sheetProfileHidden);
      writePref("sheetProfileHidden", !sheetProfileHidden);
      return;
    }
    setProfileHidden(!profileHidden);
    writePref("profileHidden", !profileHidden);
  };
  // Formtop-board'et én gang for siden: formtop i Trup, maerket i loebslisten og Formtop-visningen.
  const peakData = usePeakBoardData(load.state === "ready");
  const peakCounts = useMemo(() => peakCountsByRace(peakData.board?.riders), [peakData.board]);

  const upcomingNeed = allRaces.filter(
    (r) => !isRacePast(r) && (raceStartDate(r, dates) ?? "9999") <= addDays(today, 8) && raceReadiness(r, counts.get(r.id) ?? 0, shownWithdrawn).state === "missing",
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

  const unsavedBar =
    pendingRace && selected ? (
      <UnsavedBar
        raceName={selected.name}
        nextName={pendingRace.name}
        busy={writing !== null}
        onStay={stay}
        onDiscard={discardAndOpen}
        onSaveAndOpen={saveAndOpen}
      />
    ) : null;

  // Mobil-arkets pile foelger loebslisten, som spilleren ser den (filter og omfang); ellers alle kommende.
  const sheetRaces = listRaces.length ? listRaces : boardRaces;
  const sheetIndex = sheetRaces.findIndex((r) => r.id === selected?.id);
  const prevRace = adjacentRace(sheetRaces, selected?.id, -1);
  const nextRace = adjacentRace(sheetRaces, selected?.id, 1);

  const workbenchPane = (
    <>
      {selected && <BulkOpenRaceNote kind={draft.kinds.get(selected.id) ?? null} />}
      {selected ? (
        <RaceWorkbench
          key={`${selected.id}:${workbenchVersion}`}
          ref={workbenchRef}
          race={selected}
          allRaces={allRaces}
          entries={shownEntries}
          withdrawn={shownWithdrawn}
          riderDetails={riderDetails}
          seasonLoad={seasonLoad}
          seasonYear={seasonYear}
          profileHidden={useSheet ? sheetProfileHidden : profileHidden}
          onToggleProfileHidden={toggleProfile}
          peakData={peakData}
          mobileColumns={mobileColumns}
          onMobileColumns={changeMobileColumns}
          onEdit={dropFromDraft}
          gate={gate}
          onDirtyChange={setDirty}
          onSaved={onSaved}
          onWithdrawnChange={onWithdrawnChange}
          view={view}
          onView={changeView}
          today={today}
          raceStart={raceStartDate(selected, dates)}
          inSheet={useSheet}
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
    </>
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
            withdrawn={shownWithdrawn}
            terrain={terrain}
            selectedId={selected?.id}
            onSelect={requestSelect}
            onWeekChange={(dir: -1 | 1) => setWeekMonday(addDays(activeMonday, dir * 7))}
            canPrev={firstMonday != null && activeMonday > firstMonday}
            canNext={lastMonday != null && activeMonday < lastMonday}
          />
        )}
        {!useSheet && unsavedBar}
        <BulkDraftBar
          summary={draftSummary(draft, entries)}
          hasDraft={hasDraft}
          busy={writing === "bulk"}
          locked={writing !== null}
          message={bulkMessage}
          messageTone={bulkState.failure ? "danger" : "neutral"}
          onUndo={() => bulk.undo()}
          onSave={saveDraft}
        />
        <div className={`grid items-start gap-3.5 ${showList ? "lg:grid-cols-[296px_minmax(0,1fr)]" : ""}`}>
          {showList && (
            <RaceList
              races={listRaces}
              allRaces={allRaces}
              dates={dates}
              counts={counts}
              withdrawn={shownWithdrawn}
              terrain={terrain}
              peakCounts={peakCounts}
              selectedId={selected?.id}
              onSelect={requestSelect}
              scope={scope}
              onScope={setScope}
              showPast={showPast}
              onShowPast={setShowPast}
              today={today}
              headerAction={
                <>
                  {bulkScope === "checked" && <CheckedCount count={checked.size} onClear={() => setChecked(new Set())} />}
                  <BulkMenu
                    scope={bulkScope}
                    onScope={setBulkScope}
                    scopeCounts={scopeCounts}
                    nextName={nextName}
                    plans={plans}
                    max={SELECTION_BULK_MAX}
                    locked={writing !== null}
                    assisting={writing === "assist"}
                    onRun={runAction}
                  />
                </>
              }
              checks={bulkScope === "checked" ? { checked, onToggle: toggleCheck } : null}
              rowMark={(raceId: string) => <BulkRowMark kind={draft.kinds.get(raceId) ?? null} />}
            />
          )}
          {!useSheet && (
            <div ref={anchorRef} className="min-w-0 scroll-mt-4">
              {workbenchPane}
            </div>
          )}
        </div>
        {useSheet && sheetOpen && selected && (
          <RaceSheet
            title={selected.name}
            position={sheetIndex >= 0 ? t("sheet.position", { n: sheetIndex + 1, total: sheetRaces.length }) : null}
            onPrev={prevRace ? () => requestSelect(prevRace.id) : null}
            onNext={nextRace ? () => requestSelect(nextRace.id) : null}
            onClose={requestCloseSheet}
          >
            {unsavedBar}
            {closeAsk && !pendingRace && (
              <UnsavedBar
                raceName={selected.name}
                busy={writing !== null}
                onStay={() => setCloseAsk(false)}
                onDiscard={discardAndClose}
                onSaveAndOpen={saveAndClose}
                saveLabelKey="unsavedBar.saveAndClose"
              />
            )}
            {workbenchPane}
          </RaceSheet>
        )}
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

