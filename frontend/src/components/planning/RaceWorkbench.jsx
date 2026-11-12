// @ts-nocheck: nye komponenter (#7535) bygget paa de eksisterende JS-primitiver, hvis default-null-props checkJs-budgettet ikke kan udtrykke; logikken er i planningWorkbench.ts (strict).
// #7535 · Loebs-arbejdsfladen: loebshoved, ruteprofil og trup-tabellen for ET valgt loeb.
// Alt gemmes gennem det EKSISTERENDE udtagelses-endpoint (PUT /api/races/:id/selection), med
// samme klient-validering og samme serverfejl som udtagelsespanelet. Intet gemmes af sig selv:
// "Suggest squad" og "Copy squad from" fylder en kladde som spilleren gennemgaar og selv gemmer.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, EmptyState, ErrorState, SkeletonLines, FlagIcon } from "../ui";
import RouteProfile from "./RouteProfile.jsx";
import SquadTable from "./SquadTable.jsx";
import { ReadinessMark } from "./planningUi.jsx";
import { validateSelectionClient } from "../../lib/raceSelectionLogic.js";
import { riderBestRole } from "../../lib/riderRating.js";
import { useReloadBlock, RELOAD_BLOCK_REASONS } from "../../lib/reloadGate.js";
import { loadRaceSelection, saveRaceSelection, loadStageProfiles } from "../../lib/planningWorkbenchData.js";
import {
  DEFAULT_SQUAD_SORT,
  EMPTY_SELECTION,
  buildSquadRows,
  copySquadFrom,
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
} from "../../lib/planningWorkbench.ts";

function formatStart(iso, language) {
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

const RaceWorkbench = forwardRef(function RaceWorkbench(
  { race, allRaces, entries, withdrawn, profileHidden, onToggleProfileHidden, onDirtyChange, onSaved },
  ref,
) {
  const { t, i18n } = useTranslation("planning");
  const { t: tr } = useTranslation("races");
  const [state, setState] = useState("loading"); // loading | error | ready
  const [data, setData] = useState(null);
  const [saved, setSaved] = useState(EMPTY_SELECTION);
  const [sel, setSel] = useState(EMPTY_SELECTION);
  const [sort, setSort] = useState(DEFAULT_SQUAD_SORT);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error
  const [saveError, setSaveError] = useState(null); // { code, params }
  const [note, setNote] = useState(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [profiles, setProfiles] = useState([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const generation = useRef(0);
  const latest = useRef({});

  const dirty = state === "ready" && selectionDirty(sel, saved);
  useReloadBlock(dirty || saveState === "saving", RELOAD_BLOCK_REASONS.DIRTY);

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
      setData(body);
      setSaved(initial);
      setSel(initial);
      setState("ready");
    } catch {
      if (gen === generation.current) setState("error");
    }
  }, [race.id]);

  useEffect(() => {
    load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const stageTypes = useMemo(() => profiles.map((p) => p.profile_type).filter(Boolean), [profiles]);
  const rows = useMemo(
    () => (data?.riders ? buildSquadRows(data, stageTypes, (flat) => riderBestRole(flat)) : []),
    [data, stageTypes],
  );
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
    data?.withdrawn === true || // serveren afviser et gem for et afmeldt hold (409), saa fladen er laest
    data?.race?.status !== "scheduled";
  const clientErrors = state === "ready" && data?.size
    ? validateSelectionClient({ ...sel, size: data.size, sprintLeaderAllowed })
    : [];
  const blockReason = dirty && clientErrors.length ? tr(`selection.errors.${clientErrors[0]}`, { min: size.min, max: size.max }) : null;

  const edit = (next) => {
    setSel(next);
    setSaveState("idle");
    setSaveError(null);
    setNote(null);
  };

  const toggle = (riderId) => {
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

  const setRole = (riderId, role) => edit(setRiderRole(sel, riderId, role));

  const save = useCallback(async () => {
    const current = latest.current;
    if (current.readOnly || current.clientErrors?.length) return false;
    setSaveState("saving");
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
      setSaveState("saved");
      onSaved?.(race.id, entriesFromSelection(race.id, current.sel));
      return true;
    } catch {
      setSaveState("error");
      setSaveError({ code: "generic", params: {} });
      return false;
    }
  }, [race.id, onSaved]);

  const discard = useCallback(() => {
    setSel(latest.current.saved);
    setSaveState("idle");
    setSaveError(null);
    setNote(null);
  }, []);

  latest.current = { sel, saved, readOnly, clientErrors, sprintLeaderAllowed, size };
  useImperativeHandle(ref, () => ({ save, discard }), [save, discard]);

  const overlaps = overlappingRaces(race, allRaces, withdrawn);
  const copySources = allRaces
    .filter((r) => r.id !== race.id && !withdrawn.has(r.id))
    .map((r) => ({ race: r, riders: entries.filter((e) => e.raceId === r.id) }))
    .filter((s) => s.riders.length > 0);
  const start = formatStart(data?.race?.scheduled_for, i18n.language);
  const cls = tr(`classOption.${race.raceClass}`, { defaultValue: String(race.raceClass ?? "") });

  const suggest = () => {
    const proposal = suggestSquad({ rows, max: size.max, sprintLeaderAllowed });
    edit(proposal);
    setNote(t("race.suggested"));
  };

  const copyFrom = (source) => {
    const { selection, skipped } = copySquadFrom({ source: source.riders, rows, max: size.max, sprintLeaderAllowed });
    setCopyOpen(false);
    edit(selection);
    setNote(skipped > 0 ? t("race.copied", { name: source.race.name, skipped }) : t("race.copiedAll", { name: source.race.name }));
  };

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
          hasClassifications={race.stages > 1}
        />
        {rows.length === 0 ? (
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
          </div>
        ) : (
          <>
            <SquadTable
              rows={sortedRows}
              selection={sel}
              sort={sort}
              onSort={(key) => setSort((s) => nextSort(s, key))}
              profileCols={profileCols}
              max={size.max}
              readOnly={readOnly}
              sprintLeaderAllowed={sprintLeaderAllowed}
              onToggle={toggle}
              onRole={setRole}
            />
            <p className="border-t border-cz-border px-4 py-2.5 font-data text-xs tabular-nums text-cz-3">
              {t("squad.count", { shown: rows.length, selected: sel.riderIds.length, max: size.max })}
            </p>
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
            <span className="min-w-0 break-words">{race.name}</span>
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
        {state === "ready" && !readOnly && (
          <div className="relative flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setCopyOpen((v) => !v)} aria-expanded={copyOpen} disabled={saveState === "saving"}>
              {t("race.copyFrom")}
            </Button>
            <Button variant="secondary" size="sm" onClick={suggest} disabled={saveState === "saving" || rows.length === 0}>
              {t("race.suggest")}
            </Button>
            {dirty && (
              <Button variant="ghost" size="sm" onClick={discard} disabled={saveState === "saving"}>
                {t("race.discard")}
              </Button>
            )}
            <Button variant="primary" size="sm" onClick={save} loading={saveState === "saving"} disabled={!dirty || clientErrors.length > 0}>
              {t("race.save")}
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

      {(blockReason || note || saveState === "saved" || saveError || data?.lineup_locked || data?.withdrawn) && (
        <div className="border-b border-cz-border px-4 py-2 text-xs" role="status">
          {data?.lineup_locked && <p className="text-cz-2">{t("race.locked")}</p>}
          {data?.withdrawn && !data?.lineup_locked && <p className="text-cz-2">{t("race.withdrawn")}</p>}
          {blockReason && <p className="text-cz-danger">{blockReason}</p>}
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
