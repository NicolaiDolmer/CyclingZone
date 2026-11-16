// #7535 · Loebs-arbejdsfladen: loebshoved, ruteprofil og trup-tabellen for ET valgt loeb.
// Alt gemmes gennem det EKSISTERENDE udtagelses-endpoint (PUT /api/races/:id/selection), med
// samme klient-validering og samme serverfejl som udtagelsespanelet. Intet gemmes af sig selv:
// "Suggest squad" og "Copy squad from" fylder en kladde som spilleren gennemgaar og selv gemmer.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Segmented,
  EmptyState,
  ErrorState,
  SkeletonLines,
  FlagIcon,
  validateSelectionClient,
  riderBestRole,
  useReloadBlock,
  RELOAD_BLOCK_REASONS,
  partialSquadOutlook,
  rememberSelectionDraft,
  readSelectionDraft,
  forgetSelectionDraft,
  reconcileSelectionDraft,
} from "./primitives.ts";
import RouteProfile from "./RouteProfile.tsx";
import SquadTable from "./SquadTable.tsx";
import TacticsView from "./TacticsView.tsx";
import PeakView, { usePeakBoard } from "./PeakView.tsx";
import { ReadinessMark } from "./planningUi.tsx";
import { loadRaceSelection, saveRaceSelection, setRaceWithdrawal, loadStageProfiles, loadAfterRaceFatigue, type StageProfileRow, type RiderDetail, type SeasonLoad } from "../../lib/planningWorkbenchData.ts";
import { deadlineCountdown } from "../../lib/selectionReminder.ts";
import {
  DEFAULT_SQUAD_SORT,
  EMPTY_SELECTION,
  buildSquadRows,
  clearSquad,
  copySquadFrom,
  settleBulkSave,
  entriesFromSelection,
  nextSort,
  overlappingRaces,
  profileColumns,
  selectionDirty,
  selectionFromServer,
  setRiderRole,
  sortSquadRows,
  suggestSquad,
  toPutBody,
  saveLabelKey,
  withAfterRace,
  WORKBENCH_VIEWS,
  type WorkbenchView,
  type RoleKey,
  type Selection,
  type SeasonEntry,
  type SeasonRace,
  type SquadSortKey,
  type WriteGate,
} from "../../lib/planningWorkbench.ts";

function formatStart(iso: string | null | undefined, language: string): string | null {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat(language, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Copenhagen",
    }).format(new Date(iso));
  } catch {
    return null;
  }
}

/** Timer til start (null naar tidspunktet mangler eller er passeret). Samme enheder som paamindelsen paa /planning. */
function hoursUntil(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || ms <= nowMs) return null;
  return (ms - nowMs) / 3_600_000;
}

export interface RaceWorkbenchHandle {
  save: () => Promise<boolean>;
  discard: () => void;
  /**
   * Sidens Handlinger-kladde er gemt for `raceId` med den SENDTE udtagelse. Svarer true, naar det er
   * fladens eget loeb (fladen styrer saa selv sin huskede kladde); et andet loeb roeres ikke.
   */
  markSaved: (raceId: string, submitted: Selection) => boolean;
  /** Hent rytternes tilgaengelighed (bindinger) igen efter et gem andetsteds; kladden roeres ikke. */
  refreshAvailability: () => Promise<void>;
  /** Har fladen ugemte aendringer lige nu? */
  isDirty: () => boolean;
}

interface RaceWorkbenchProps {
  race: SeasonRace;
  allRaces: SeasonRace[];
  entries: SeasonEntry[];
  withdrawn: Set<string>;
  /** Nation, foedselsdato og skade pr. rytter (tom indtil hentet). */
  riderDetails?: Map<string, RiderDetail>;
  /** Saeson-belastning pr. rytter, samme tal som /planning (tom indtil hentet). */
  seasonLoad?: Record<string, SeasonLoad>;
  /** Saesonens referenceaar til U23 (null = ukendt, intet maerke). */
  seasonYear?: number | null;
  profileHidden: boolean;
  onToggleProfileHidden: () => void;
  /** Loebssidens fulde ruteprofil i stedet for det kompakte kort ("Vis fuld profil"). */
  profileFull?: boolean;
  onToggleProfileFull?: () => void;
  /**
   * Spilleren aendrer loebets trup selv paa fladen: loebet forlader sidens Handlinger-kladde (spillerens
   * eget valg vinder; fladen viser altid den gemte trup plus spillerens egne aendringer).
   */
  onEdit?: (raceId: string) => void;
  /**
   * Sidens skrive-laas (ét sted ejer "der er et kald i gang"). Fladens gem og afmelding koerer
   * gennem den, og mens den holdes, er fladen laast.
   */
  gate: WriteGate;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: (raceId: string, entries: SeasonEntry[]) => void;
  onWithdrawnChange?: (raceId: string, withdrawn: boolean) => void;
  /** Visningen under ruteprofilen: Trup | Taktik | Formtop (siden husker valget). */
  view?: WorkbenchView;
  onView?: (view: WorkbenchView) => void;
  /** I dag (Europe/Copenhagen) og loebets startdato, til Formtop-visningen. */
  today?: string;
  raceStart?: string | null;
  /** Mobil-arket: hovedet staar i arket selv, saa fladen viser ikke sit eget navn igen. */
  inSheet?: boolean;
}

interface SaveError {
  code: string;
  params: Record<string, unknown>;
}

// Serverens svar fra GET /api/races/:id/selection; siden laeser kun de felter den kender.
type SelectionResponse = any;

const RaceWorkbench = forwardRef<RaceWorkbenchHandle, RaceWorkbenchProps>(function RaceWorkbench(
  {
    race,
    allRaces,
    entries,
    withdrawn,
    riderDetails,
    seasonLoad,
    seasonYear = null,
    profileHidden,
    onToggleProfileHidden,
    profileFull = false,
    onToggleProfileFull,
    onEdit,
    gate,
    onDirtyChange,
    onSaved,
    onWithdrawnChange,
    view = "squad",
    onView,
    today = "",
    raceStart = null,
    inSheet = false,
  },
  ref,
) {
  const { t, i18n } = useTranslation("planning");
  const { t: tr } = useTranslation("races");
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [data, setData] = useState<SelectionResponse>(null);
  const [saved, setSaved] = useState<Selection>(EMPTY_SELECTION);
  const [sel, setSel] = useState<Selection>(EMPTY_SELECTION);
  const [sort, setSort] = useState(DEFAULT_SQUAD_SORT);
  // Visningen af sidste gem (besked). "Gemmer" er IKKE en visnings-tilstand: det er sidens skrive-laas,
  // som kun det kald der tog den kan slippe (en anvendt kladde kan derfor aldrig loese noget op).
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle");
  const writing = useSyncExternalStore(gate.subscribe, gate.current);
  const locked = writing !== null;
  const saving = writing === "save";
  const withdrawBusy = writing === "withdraw";
  const [saveError, setSaveError] = useState<SaveError | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [profiles, setProfiles] = useState<StageProfileRow[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  // Ruteprofilens etape (0-baseret); Taktik foelger den, saa der kun er én etapevaelger.
  const [stageIndex, setStageIndex] = useState(0);
  // "Efter loebet": serverens skoen med motorens model; null = slukket model eller ukendt.
  const [afterRace, setAfterRace] = useState<Record<string, number> | null>(null);
  const generation = useRef(0);
  const latest = useRef<{ ready: boolean; sel: Selection; saved: Selection; readOnly: boolean; clientErrors: string[]; sprintLeaderAllowed: boolean; size: { min: number; max: number } } | null>(null);

  const dirty = state === "ready" && selectionDirty(sel, saved);
  useReloadBlock(dirty || locked, RELOAD_BLOCK_REASONS.DIRTY);

  const load = useCallback(async () => {
    const gen = ++generation.current;
    setState("loading");
    setSaveState("idle");
    setSaveError(null);
    setNote(null);
    setCopyOpen(false);
    setSort(DEFAULT_SQUAD_SORT);
    setSel(EMPTY_SELECTION);
    setSaved(EMPTY_SELECTION);
    setProfilesLoading(true);
    setStageIndex(0);
    setAfterRace(null);
    loadAfterRaceFatigue(race.id).then((map) => {
      if (gen === generation.current) setAfterRace(map);
    });
    loadStageProfiles(race.id).then((rows) => {
      if (gen !== generation.current) return;
      setProfiles(rows);
      setProfilesLoading(false);
    });
    try {
      const res = await loadRaceSelection(race.id);
      if (gen !== generation.current) return;
      if (!res.ok) {
        setState("error");
        return;
      }
      const body = res.data ?? {};
      // En tilbagetrukket trup er ikke holdets udtagelse: samme regel som udtagelsespanelet.
      const server = body.withdrawn && !body.did_not_start && !body.lineup_locked ? null : body.selection;
      const initial = selectionFromServer(server);
      // Et ugemt udkast overlever en navigation vaek fra siden (kladden er ikke gemt, men heller ikke tabt).
      const draft = readSelectionDraft(race.id);
      const restored: Selection = draft ? reconcileSelectionDraft(draft, body.riders) : initial;
      const wasRestored = draft != null && selectionDirty(restored, initial);
      setData(body);
      setSaved(initial);
      setSel(wasRestored ? restored : initial);
      if (wasRestored) setNote(t("race.restored"));
      setState("ready");
    } catch {
      if (gen === generation.current) setState("error");
    }
  }, [race.id, t]);

  useEffect(() => {
    load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // Et ugemt udkast huskes (overlever en navigation); en ren flade glemmer det.
  useEffect(() => {
    if (state !== "ready") return;
    if (dirty) rememberSelectionDraft(race.id, sel);
    else forgetSelectionDraft(race.id);
  }, [state, dirty, sel, race.id]);

  const stageTypes = useMemo(
    () => profiles.map((p) => p.profile_type).filter((type): type is string => typeof type === "string" && type.length > 0),
    [profiles],
  );
  const rows = useMemo(
    () => (data?.riders ? withAfterRace(buildSquadRows(data, stageTypes, (flat) => riderBestRole(flat)), afterRace) : []),
    [data, stageTypes, afterRace],
  );
  const peak = usePeakBoard({ active: view === "peak", raceId: race.id, today, gate });
  const sortedRows = useMemo(() => sortSquadRows(rows, sort, sel), [rows, sort, sel]);
  const profileCols = useMemo(() => profileColumns(stageTypes), [stageTypes]);

  const size = data?.size ?? { min: 1, max: race.sizeMax };
  const sprintLeaderAllowed = data?.sprint_leader_allowed === true;
  const readOnly =
    state !== "ready" ||
    data?.enabled === false ||
    data?.eligible === false ||
    data?.did_not_start === true ||
    data?.lineup_locked === true ||
    data?.race?.status !== "scheduled";
  const clientErrors = state === "ready" && data?.size
    ? validateSelectionClient({ ...sel, size: data.size, sprintLeaderAllowed })
    : [];
  const selectedRows = rows.filter((r) => sel.riderIds.includes(r.id));
  const fitSelected = selectedRows.filter((r) => !r.injured).length;
  const freeLeft = rows.filter((r) => r.selectable && !sel.riderIds.includes(r.id)).length;
  // Samme regel og samme tekster som udtagelsespanelet: hvad sker der med de tomme pladser?
  const outlook =
    state === "ready" && !readOnly
      ? partialSquadOutlook({ selected: fitSelected, injured: selectedRows.length - fitSelected, free: freeLeft, fieldMax: size.max })
      : null;
  const outlookWarns = outlook?.kind === "willNotStart" || outlook?.kind === "startsShort";
  const outlookText = !outlook
    ? null
    : outlook.kind === "willNotStart"
      ? tr(outlook.emptySelection ? "selection.willNotStartEmpty" : "selection.willNotStart", { min: outlook.min })
      : outlook.kind === "startsShort"
        ? tr("selection.startsShort", { injured: outlook.injured, starters: outlook.starters })
        : sel.riderIds.length > 0
          ? tr(outlook.kind === "assistantFills" ? "selection.partialHint" : "selection.partialHintShort", { open: outlook.open, free: outlook.free })
          : null;
  const blockReason = dirty && clientErrors.length ? tr(`selection.errors.${clientErrors[0]}`, { min: size.min, max: size.max }) : null;

  const edit = (next: Selection) => {
    // Mens et kald koerer, aendres kladden ikke: svaret afstemmes altid mod det, der blev sendt.
    if (gate.current()) return;
    onEdit?.(race.id);
    setSel(next);
    setSaveState("idle");
    setSaveError(null);
    setNote(null);
  };

  const toggle = (riderId: string) => {
    const has = sel.riderIds.includes(riderId);
    if (!has && sel.riderIds.length >= size.max) return;
    const base = has ? setRiderRole(sel, riderId, "rider") : sel;
    const riderIds = has ? base.riderIds.filter((id) => id !== riderId) : [...sel.riderIds, riderId];
    edit({
      ...base,
      riderIds,
      freeRoleIds: base.freeRoleIds.filter((id) => riderIds.includes(id)),
    });
  };

  const setRole = (riderId: string, role: RoleKey) => edit(setRiderRole(sel, riderId, role));

  // Gem koerer gennem sidens skrive-laas: holdes den (et andet gem, en afmelding, sidens masse-gem
  // eller et dobbeltklik), sendes intet. Det SENDTE oejebliksbillede er det, der bliver det gemte.
  const save = useCallback(async () => {
    const current = latest.current;
    if (!current || current.readOnly || current.clientErrors.length > 0) return false;
    const result = await gate.run("save", async () => {
      setSaveError(null);
      try {
        const res = await saveRaceSelection(race.id, toPutBody(current.sel, current.sprintLeaderAllowed));
        if (!res.ok) {
          const body = res.data ?? {};
          const conflict = Array.isArray(body.conflicts) ? body.conflicts[0] : null;
          setSaveState("error");
          setSaveError(
            conflict
              ? { code: "selection_rider_bound_named", params: { rider: conflict.rider_name ?? "", race: conflict.race_name ?? conflict.bound_race_name ?? "" } }
              : { code: body.error || "generic", params: { min: current.size.min, max: current.size.max } },
          );
          return false;
        }
        setSaved(current.sel);
        setData((d: SelectionResponse) => (d ? { ...d, withdrawn: false } : d)); // et gem melder holdet til igen
        setSaveState("saved");
        onSaved?.(race.id, entriesFromSelection(race.id, current.sel)); // siden tager loebet ud af sin kladde
        return true;
      } catch {
        setSaveState("error");
        setSaveError({ code: "generic", params: {} });
        return false;
      }
    });
    return result.ran ? result.value : false;
  }, [gate, race.id, onSaved]);

  const discard = useCallback(() => {
    if (!latest.current || gate.current()) return;
    forgetSelectionDraft(race.id);
    setSel(latest.current.saved);
    setSaveState("idle");
    setSaveError(null);
    setNote(null);
  }, [gate, race.id]);

  // Afstemningen sker mod det SENDTE (loebs-id + udtagelse), ikke mod det fladen viser nu: et andet
  // loeb roeres ikke, og aendringer lavet mens kaldet koerte, forbliver en ugemt kladde.
  const markSaved = useCallback((raceId: string, submitted: Selection) => {
    const current = latest.current;
    if (!current || !current.ready) return false;
    const result = settleBulkSave({ raceId: race.id, sel: current.sel, saved: current.saved }, { raceId, sel: submitted });
    if (!result.mine) return false;
    setSaved(result.saved);
    setSel(result.sel);
    setSaveError(null);
    if (!result.dirty) {
      forgetSelectionDraft(race.id);
      setSaveState("saved");
    }
    return true;
  }, [race.id]);

  // Et gem af andre loeb kan frigive ryttere, der stod som bundet her: hent kun rytterlisten igen.
  const refreshAvailability = useCallback(async () => {
    const gen = generation.current;
    try {
      const res = await loadRaceSelection(race.id);
      if (gen !== generation.current || !res.ok || !res.data) return;
      setData(res.data);
    } catch {
      // catch-ok: tilgaengeligheden er blot den forrige, til fladen hentes igen; intet er tabt.
    }
  }, [race.id]);

  const isDirty = useCallback(() => {
    const current = latest.current;
    return !!current && current.ready && selectionDirty(current.sel, current.saved);
  }, []);

  latest.current = { ready: state === "ready", sel, saved, readOnly, clientErrors, sprintLeaderAllowed, size };
  useImperativeHandle(ref, () => ({ save, discard, markSaved, refreshAvailability, isDirty }), [save, discard, markSaved, refreshAvailability, isDirty]);

  // Afmeld / deltag igen: samme endpoint, samme guards og samme tekster som loebstavlen paa /planning.
  // En afmelding smider en ugemt kladde (som tavlen), og fladen genindlaeses fra serveren bagefter.
  // Kaldet holder sidens skrive-laas, til fladen er hentet igen (saa intet anvendes paa en gammel flade).
  const toggleWithdrawal = (withdraw: boolean) =>
    gate.run("withdraw", async () => {
      setSaveError(null);
      try {
        const res = await setRaceWithdrawal(race.id, withdraw);
        if (!res.ok) {
          const body = res.data ?? {};
          // "Deltag igen" kan afvises fordi en rytter nu koerer et overlappende loeb: vis hvem og hvor (som et gem).
          const conflict = Array.isArray(body.conflicts) ? body.conflicts[0] : null;
          setSaveState("error");
          setSaveError(
            conflict
              ? { code: "selection_rider_bound_named", params: { rider: conflict.rider_name ?? "", race: conflict.race_name ?? conflict.bound_race_name ?? "" } }
              : { code: body.error || "generic", params: { min: size.min, max: size.max } },
          );
          return;
        }
        if (withdraw) forgetSelectionDraft(race.id);
        onWithdrawnChange?.(race.id, withdraw);
        await load();
      } catch {
        setSaveState("error");
        setSaveError({ code: "generic", params: {} });
      }
    });

  const clearSelection = () => {
    // Kun en kladde: intet gemmes foer spilleren selv trykker Gem (laaste Train now-ryttere bliver staaende).
    edit(clearSquad(sel, rows.filter((r) => r.trainNowLocked).map((r) => r.id)));
  };

  const overlaps = overlappingRaces(race, allRaces, withdrawn);
  const copySources = allRaces
    .filter((r) => r.id !== race.id && !withdrawn.has(r.id))
    .map((r) => ({ race: r, riders: entries.filter((e) => e.raceId === r.id) }))
    .filter((s) => s.riders.length > 0);
  const start = formatStart(data?.race?.scheduled_for, i18n.language);
  // Nedtaelling til start ("om 12 t"), som paamindelsen og loebssiden viser den. Kun for et aabent loeb.
  const hoursLeft = data?.race?.status === "scheduled" && !data?.lineup_locked ? hoursUntil(data?.race?.scheduled_for, Date.now()) : null;
  const countdown = hoursLeft != null ? (() => {
    const { unit, value } = deadlineCountdown(hoursLeft);
    return unit === "past" ? null : tr(`selectionReminder.in.${unit}`, { count: value });
  })() : null;
  const isWithdrawn = data?.withdrawn === true && !data?.lineup_locked && !data?.did_not_start;
  const canWithdraw = state === "ready" && !readOnly && !isWithdrawn && data?.eligible !== false;
  const cls = tr(`classOption.${race.raceClass}`, { defaultValue: String(race.raceClass ?? "") });

  const suggest = () => {
    const proposal = suggestSquad({ rows, max: size.max, sprintLeaderAllowed, current: sel });
    edit(proposal);
    setNote(t("race.suggested"));
  };

  const copyFrom = (source: { race: SeasonRace; riders: SeasonEntry[] }) => {
    const { selection, skipped } = copySquadFrom({ source: source.riders, rows, max: size.max, sprintLeaderAllowed, current: sel });
    setCopyOpen(false);
    edit(selection);
    setNote(skipped > 0 ? t("race.copied", { name: source.race.name, skipped }) : t("race.copiedAll", { name: source.race.name }));
  };

  // Samme to handlinger som loebstavlens fod paa /planning: ryd udtagelsen og afmeld / deltag igen.
  const raceActions =
    canWithdraw || (isWithdrawn && !readOnly) ? (
      <div className="flex flex-wrap items-center gap-1">
        {canWithdraw && sel.riderIds.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearSelection} disabled={locked}>
            {tr("racehub.column.clearSelection")}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => toggleWithdrawal(!isWithdrawn)}
          loading={withdrawBusy}
          disabled={locked}
          data-testid="planning-withdraw"
        >
          {isWithdrawn ? tr("racehub.column.reenter") : tr("racehub.column.withdraw")}
        </Button>
      </div>
    ) : null;

  let body;
  if (state === "loading") {
    body = (
      <div className="p-4">
        <SkeletonLines lines={6} />
      </div>
    );
  } else if (state === "error") {
    body = (
      <div className="p-4">
        <ErrorState
          title={t("error.title")}
          description={t("error.description")}
          action={
            <Button variant="secondary" size="sm" onClick={load}>
              {t("error.retry")}
            </Button>
          }
        />
      </div>
    );
  } else if (data?.eligible === false) {
    body = (
      <div className="p-4">
        <p className="text-sm font-semibold text-cz-1">{tr("selection.wrongPool.title")}</p>
        <p className="mt-0.5 text-xs text-cz-3">{tr("selection.wrongPool.note")}</p>
      </div>
    );
  } else if (data?.did_not_start) {
    body = (
      <div className="p-4">
        <p className="text-sm font-semibold text-cz-1">{tr("racehub.status.didNotStart")}</p>
        <p className="mt-0.5 text-xs text-cz-warning">{tr("racehub.column.didNotStartNote", { min: 6 })}</p>
      </div>
    );
  } else {
    body = (
      <>
        <RouteProfile
          raceId={race.id}
          profiles={profiles}
          loading={profilesLoading}
          hidden={profileHidden}
          onToggleHidden={onToggleProfileHidden}
          full={profileFull}
          onToggleFull={onToggleProfileFull}
          hasClassifications={race.stages > 1}
          index={stageIndex}
          onIndex={setStageIndex}
        />
        {/* Visningsvaelgeren under profilen (spec): Trup | Taktik | Formtop. Den kanoniske Segmented. */}
        {onView && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5" data-testid="planning-view-switch">
            <Segmented
              label={t("views.label")}
              value={view}
              onChange={(next: WorkbenchView) => onView(next)}
              options={WORKBENCH_VIEWS.map((v) => ({ value: v, label: t(`views.${v}`) }))}
            />
          </div>
        )}
        {view === "tactics" ? (
          <TacticsView
            raceId={race.id}
            profiles={profiles}
            stageIndex={stageIndex}
            isStageRace={race.stages > 1}
            squadDirty={dirty}
            savedCount={saved.riderIds.length}
            onShowSquad={() => onView?.("squad")}
          />
        ) : view === "peak" ? (
          <PeakView peak={peak} raceName={race.name} raceStart={raceStart} locked={locked} compactMobile={inSheet} />
        ) : rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={<FlagIcon size={26} aria-hidden="true" />}
              title={t("squad.empty.title")}
              description={t("squad.empty.description")}
              action={
                <Button variant="secondary" size="sm" onClick={load}>
                  {t("error.retry")}
                </Button>
              }
            />
            {/* Afmeld / deltag igen er loebets handlinger og staar ogsaa her, selv uden ryttere i tabellen. */}
            {raceActions && <div className="mt-3 flex justify-end">{raceActions}</div>}
          </div>
        ) : (
          <>
            {/* Én linje kontekst om tallene, samme tekst som loebstavlen paa /planning (P9). */}
            <p className="border-t border-cz-border px-4 py-2 text-2xs leading-snug text-cz-3">
              {tr("racehub.column.numbersExplanation")}
              {afterRace != null && <span className="hidden sm:inline"> {t("squad.afterRaceNote")}</span>}
            </p>
            <SquadTable
              rows={sortedRows}
              selection={sel}
              sort={sort}
              onSort={(key: SquadSortKey) => setSort((current) => nextSort(current, key))}
              profileCols={profileCols}
              max={size.max}
              readOnly={readOnly || locked}
              sprintLeaderAllowed={sprintLeaderAllowed}
              onToggle={toggle}
              onRole={setRole}
              details={riderDetails}
              seasonLoad={seasonLoad}
              seasonYear={seasonYear}
              showAfterRace={afterRace != null}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-cz-border px-4 py-1.5">
              <p className="py-1 font-data text-xs tabular-nums text-cz-3">
                {t("squad.count", { shown: rows.length, selected: sel.riderIds.length, max: size.max })}
              </p>
              {raceActions}
            </div>
          </>
        )}
      </>
    );
  }

  return (
    <section
      aria-label={race.name}
      data-testid="planning-workbench"
      className="min-w-0 rounded-cz border border-cz-border bg-cz-card"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-cz-border px-4 py-3.5">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-cz-1">
            {/* I mobil-arket staar navnet i arkets hoved (med pilene); her kun for skaermlaesere. */}
            <span className={inSheet ? "sr-only" : "min-w-0 break-words"}>{race.name}</span>
            {dirty && (
              <span className="inline-flex items-center gap-1.5 font-data text-2xs font-semibold uppercase tracking-wide text-cz-warning" data-testid="planning-unsaved-marker">
                <ReadinessMark state="missing" />
                {t("race.unsaved")}
              </span>
            )}
          </h2>
          <p className="mt-0.5 font-data text-2xs uppercase tracking-wide text-cz-3">
            {[
              start ? t("race.starts", { when: start }) : null,
              countdown,
              cls || null,
              race.stages > 1 ? t("raceList.stages", { count: race.stages }) : t("raceList.oneDay"),
              state === "ready" ? t("race.picked", { picked: sel.riderIds.length, max: size.max }) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {overlaps.length > 0 && (
            <p className="mt-1 text-2xs text-cz-warning">{t("raceList.sharesDays", { races: overlaps.map((o) => o.name).join(", ") })}</p>
          )}
        </div>
        {state === "ready" && !readOnly && view === "peak" && (
          // Formtop: én guld-knap, teksten foelger visningen. Maalet er det aabne loeb.
          <div className="flex flex-wrap items-center gap-2">
            {peak.checked.size > 0 && (
              <Button variant="ghost" size="sm" onClick={() => peak.setChecked(new Set())} disabled={locked}>
                {t("peak.clear")}
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={peak.apply}
              loading={writing === "peak"}
              disabled={locked || peak.pairs.length === 0}
              data-testid="planning-peak-apply"
            >
              {t(saveLabelKey("peak"), { count: peak.pairs.length })}
            </Button>
          </div>
        )}
        {state === "ready" && !readOnly && view === "tactics" && dirty && (
          // Taktik-fanen har selv guld-knappen ("Gem taktik"); en ugemt trup kan gemmes her som sekundaer.
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={discard} disabled={locked}>
              {t("race.discard")}
            </Button>
            <Button variant="secondary" size="sm" onClick={save} loading={saving} disabled={locked || clientErrors.length > 0}>
              {t(saveLabelKey("squad"))}
            </Button>
          </div>
        )}
        {state === "ready" && !readOnly && view === "squad" && (
          <div className="relative flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setCopyOpen((v) => !v)} aria-expanded={copyOpen} disabled={locked}>
              {t("race.copyFrom")}
            </Button>
            <Button variant="secondary" size="sm" onClick={suggest} disabled={locked || rows.length === 0}>
              {t("race.suggest")}
            </Button>
            {dirty && (
              <Button variant="ghost" size="sm" onClick={discard} disabled={locked}>
                {t("race.discard")}
              </Button>
            )}
            <Button variant="primary" size="sm" onClick={save} loading={saving} disabled={!dirty || locked || clientErrors.length > 0}>
              {t(saveLabelKey("squad"))}
            </Button>
            {copyOpen && (
              <div
                role="dialog"
                aria-label={t("copy.title")}
                className="absolute end-0 top-full z-dropdown mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-cz border border-cz-border bg-cz-card p-1.5 shadow-overlay"
              >
                {copySources.length === 0 ? (
                  <p className="px-2.5 py-2 text-[13px] text-cz-2">{t("copy.none")}</p>
                ) : (
                  <ul className="max-h-64 overflow-y-auto">
                    {copySources.map((s) => (
                      <li key={s.race.id}>
                        <button
                          type="button"
                          onClick={() => copyFrom(s)}
                          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-cz px-2.5 py-1.5 text-left text-[13px] text-cz-1 hover:bg-cz-subtle sm:min-h-0"
                        >
                          <span className="min-w-0 truncate">{s.race.name}</span>
                          <span className="shrink-0 font-data text-2xs tabular-nums text-cz-3">{t("copy.riders", { count: s.riders.length })}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </header>

      {(blockReason || note || outlookText || saveState === "saved" || saveError || data?.lineup_locked || data?.withdrawn) && (
        <div className="border-b border-cz-border px-4 py-2 text-xs" role="status">
          {data?.lineup_locked && <p className="text-cz-2">{t("race.locked")}</p>}
          {data?.withdrawn && !data?.lineup_locked && <p className="text-cz-2">{t("race.withdrawn")}</p>}
          {blockReason && <p className="text-cz-danger">{blockReason}</p>}
          {outlookText && <p className={outlookWarns ? "text-cz-warning" : "text-cz-2"}>{outlookText}</p>}
          {saveError && (
            <p className="text-cz-danger" role="alert">
              {tr([`selection.errors.${saveError.code}`, "selection.errors.generic"], saveError.params)}
            </p>
          )}
          {saveState === "saved" && !dirty && <p className="text-cz-success">{t("race.saved")}</p>}
          {note && <p className="text-cz-2">{note}</p>}
        </div>
      )}

      {body}
    </section>
  );
});

export default RaceWorkbench;
