// Sæsonmatrix — rytter × løbsdag-gitteret i Season-visningen (#1146, ejer-
// godkendt design 27/8). SeasonView.jsx er ejeren af visningen (Z1 v0's
// tidslinje/bånde/legend består urørt) — dette er den udvidelse SeasonView.jsx
// selv annoncerede som P1. Egen data-hentning (GET /races/selection/season),
// egen kladde + "Save plan" (PUT /races/selection/bulk, #4316 — se PR-body for
// afhængighed). Read-only når `enabled && readOnly` (browser en anden sæson).
//
// LÅST KONTRAKT — se seasonMatrix.js's fil-header for de fulde punkter. Al
// geometri/kladde-logik bor DER (ren, testet); denne fil er render + IO.
import { useEffect, useMemo, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { authHeaders } from "../../lib/supabase"; // #4348: kanonisk kopi
import { reportLoadFailure } from "../../lib/actionTelemetry.js";
import { riderSuitability } from "../../lib/suitability.js";
import { fitTier } from "../../lib/raceHubLogic.js";
import { Spinner, EmptyState, ErrorState, Button, FlagIcon, LockIcon, AlertTriangleIcon } from "../ui";
import SeasonMatrixCellPopover from "./SeasonMatrixCellPopover.jsx";
import {
  ROLE_LETTER, buildDraftsFromEntries, roleOf, dirtyRaceIds, roleBadgeClass,
  buildDayColumns, buildDateBands, buildRaceHeaderGroups, buildRiderRowSegments, countProblems,
  raceCurrentCount, riderLoadDays, emptyRaceDraft,
  setRiderRole, removeRiderFromRace, conflictingEntryForRace, buildSaveError,
} from "../../lib/seasonMatrix.js";

const API = import.meta.env.VITE_API_URL;
const LENSES = ["entries", "routeMatch", "formPeak", "load"];
const FIT_TEXT = { strong: "text-cz-accent-t", average: "text-cz-2", poor: "text-cz-3" };

// Chunket save (defensivt — bulk-endpointets cap er 60 ændringer/kald, #4316).
const BULK_CHUNK = 60;

export default function SeasonMatrix({ seasonNumber, onOpenDay, onDirtyChange }) {
  const { t } = useTranslation("races");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null); // { kind } | null
  const [draftByRace, setDraftByRace] = useState(new Map());
  const [serverByRace, setServerByRace] = useState(new Map());
  const [lens, setLens] = useState("entries");
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  // saveError: { code, raceId, raceName, params } | null — spillertest-punkt 1
  // (Discord 29/8, begge testere ramte en tavs generisk fejl). buildSaveError
  // (seasonMatrix.js) navngiver ALTID det berørte løb når svaret leverer et
  // race_id, så banneret nedenfor OG den markerede kolonne (errorRaceId) peger
  // på PRÆCIS samme løb — ingen tavse fejl.
  const [saveError, setSaveError] = useState(null);
  const [peakPlans, setPeakPlans] = useState(null); // Map<riderId, plan[]> | null (lazy, kun formPeak-linsen)
  // Celle-popover (#4323) — erstatter klik-cyklussen. `popover` er `{ kind: "empty",
  // raceId, riderId } | { kind: "filled", raceId, riderId } | null` — akse-
  // konverteringen (kontrakt #7, seasonMatrix.js) gør en kolonne entydig ét løb,
  // så popoveren adresserer raceId direkte i BEGGE grene (ingen "day" længere).
  // `popoverAnchor` holder DEN celleknap der blev klikket, til positionering —
  // state (ikke en ref) fordi den læses under render (JSX'en nedenfor);
  // react-hooks/refs forbyder at læse ref.current under render (#3556-lint).
  // Fokus-retur er useModalA11y's eget ansvar — den fanger document.activeElement,
  // som ER cellen, ved åbning.
  const [popover, setPopover] = useState(null);
  const [popoverAnchor, setPopoverAnchor] = useState(null);

  const load = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) { setLoadError({ kind: "auth" }); reportLoadFailure("season_matrix", { kind: "auth" }); setLoading(false); return; }
    const qs = Number.isFinite(seasonNumber) ? `?season_number=${seasonNumber}` : "";
    try {
      const res = await fetch(`${API}/api/races/selection/season${qs}`, { headers });
      if (!res.ok) { setLoadError({ kind: "http", status: res.status }); reportLoadFailure("season_matrix", { kind: "http", status: res.status }); return; }
      let json;
      try { json = await res.json(); } catch (cause) { setLoadError({ kind: "parse" }); reportLoadFailure("season_matrix", { kind: "parse", cause }); return; }
      setData(json);
      const drafts = buildDraftsFromEntries(json.entries);
      setDraftByRace(drafts);
      setServerByRace(buildDraftsFromEntries(json.entries)); // separat kopi — draftByRace muteres, denne er sandheden
      setLoadError(null);
    } catch (cause) {
      setLoadError({ kind: "network" }); reportLoadFailure("season_matrix", { kind: "network", cause });
    } finally {
      setLoading(false);
    }
  }, [seasonNumber]);

  useEffect(() => { setLoading(true); setLoadError(null); load(); }, [load]);

  const races = useMemo(() => data?.races ?? [], [data]);
  const riders = useMemo(() => [...(data?.riders ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [data]);
  const raceById = useMemo(() => new Map(races.map((r) => [r.id, r])), [races]);
  // Akse-konvertering (kontrakt #7, ejer-låst 27-28/8, spillertest-punkt 6): ÉN
  // kolonne pr. (løb, løbsdag) — se seasonMatrix.js's fil-header for begrundelsen.
  const dayColumns = useMemo(() => buildDayColumns(races), [races]);
  const dayDatesMap = useMemo(() => new Map((data?.dayDates ?? []).map((d) => [d.gameDay, d.date])), [data]);
  const dateBands = useMemo(() => buildDateBands(dayColumns, dayDatesMap), [dayColumns, dayDatesMap]);
  // Race-navn-headeren: efter akse-konverteringen er hver kolonne entydigt ét
  // løb, så en enkelt header-række altid rækker (buildRaceHeaderGroups' egen
  // fil-header forklarer hvorfor den tidligere lane-pakning er fjernet).
  const raceLanes = useMemo(() => buildRaceHeaderGroups(dayColumns), [dayColumns]);
  const problems = useMemo(() => countProblems(races, draftByRace), [races, draftByRace]);
  const dirtyIds = useMemo(() => dirtyRaceIds(draftByRace, serverByRace), [draftByRace, serverByRace]);
  const dirtyIdSet = useMemo(() => new Set(dirtyIds), [dirtyIds]);
  const isDirty = dirtyIds.length > 0;

  // Ugemte ændringer bubbles op til SeasonView, som guarder sæson-skift/view-toggle
  // (samme boardDirty-mønster som RaceHubBoard.jsx, IKKE StrategyPage-mønsteret).
  useEffect(() => { onDirtyChange?.(isDirty); }, [isDirty, onDirtyChange]);
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // Form & peak-linsen henter GET /api/peak-plans lazily (kun når linsen vælges
  // første gang) — samme frontend-tilgængelige read Season Planner allerede bruger.
  useEffect(() => {
    if (lens !== "formPeak" || peakPlans != null) return;
    (async () => {
      const headers = await authHeaders();
      if (!headers) return;
      const qs = Number.isFinite(seasonNumber) ? `?season_number=${seasonNumber}` : "";
      try {
        const res = await fetch(`${API}/api/peak-plans${qs}`, { headers });
        if (!res.ok) { setPeakPlans(new Map()); return; }
        const json = await res.json();
        const byRider = new Map();
        for (const p of json.plans || []) {
          if (!byRider.has(p.riderId)) byRider.set(p.riderId, []);
          byRider.get(p.riderId).push(p);
        }
        setPeakPlans(byRider);
      } catch {
        setPeakPlans(new Map());
      }
    })();
  }, [lens, peakPlans, seasonNumber]);

  // Form & peak-linsen: tooltip-tekst for en dag inde i rytterens peak-vindue
  // (målløbets navn hvis kendt, ellers en generisk label; +"låst" hvis vinduet
  // rent faktisk er begyndt, #3094-semantikken fra riderPeakPlans.js).
  const peakTitle = useCallback((peak) => {
    if (!peak) return null;
    const raceName = raceById.get(peak.targetRaceId)?.name ?? null;
    const base = raceName ? t("matrix.peakWindow", { race: raceName }) : t("matrix.peakWindowNoTarget");
    return peak.locked ? `${base} (${t("matrix.peakLocked")})` : base;
  }, [raceById, t]);

  // Peak-vindue-dage pr. rytter (kun beregnet når data findes — formPeak-linsen).
  const peakDaysByRider = useMemo(() => {
    if (!peakPlans) return new Map();
    const dateToDay = new Map([...dayDatesMap.entries()].map(([day, date]) => [date, day]));
    const out = new Map();
    for (const [riderId, plans] of peakPlans) {
      const days = new Map(); // day -> plan
      for (const plan of plans) {
        for (const [date, day] of dateToDay) {
          if (date >= plan.windowStart && date <= plan.windowEnd) days.set(day, plan);
        }
      }
      out.set(riderId, days);
    }
    return out;
  }, [peakPlans, dayDatesMap]);

  if (loading) return <div className="flex justify-center py-8"><Spinner size={20} /></div>;
  if (loadError) {
    return (
      <div role="alert" className="mt-4">
        <ErrorState
          title={t("matrix.errorTitle")}
          description={loadError.kind === "auth" ? t("seasonView.errorSession") : t("seasonView.error")}
          action={<Button size="sm" variant="secondary" onClick={() => { setLoading(true); load(); }}>{t("seasonView.retry")}</Button>}
        />
      </div>
    );
  }
  if (!data?.enabled || !data?.season) return null;
  if (!races.length) {
    return <div className="mt-4"><EmptyState icon={<FlagIcon size={22} />} title={t("matrix.empty")} /></div>;
  }

  const readOnly = !!data.readOnly;

  function setRaceDraft(raceId, updater) {
    setDraftByRace((prev) => {
      const next = new Map(prev);
      next.set(raceId, updater(prev.get(raceId) || emptyRaceDraft()));
      return next;
    });
  }

  // Åbner celle-popoveren i stedet for den fjernede klik-cyklus (#4323). Åbner
  // OGSÅ i read-only tilstand — popoveren viser da kun årsagen (kontrakt 2e).
  function openCellPopover(e, info) {
    setPopoverAnchor(e.currentTarget);
    setSaveError(null);
    setPopover(info);
  }
  function closeCellPopover() {
    setPopover(null);
  }

  // Spillertest-punkt 1 (Discord 29/8, begge testere): en afvist "Gem plan"
  // skal forklare HVORFOR pr. berørt løb, ikke vise en generisk "prøv igen".
  // buildSaveError (seasonMatrix.js) oversætter/navngiver svaret; banneret
  // nedenfor OG den ramte kolonnes header (errorRaceId, i JSX'en) peger begge
  // på PRÆCIS samme løb.
  async function saveAll() {
    setSaving(true);
    setSaveError(null);
    const headers = await authHeaders();
    if (!headers) { setSaving(false); return; }
    const changes = dirtyIds.map((raceId) => {
      const d = draftByRace.get(raceId) || emptyRaceDraft();
      return {
        raceId, rider_ids: d.rider_ids, captain_id: d.captain_id, sprint_captain_id: d.sprint_captain_id,
        hunter_id: d.hunter_id, free_role_ids: d.free_role_ids,
      };
    });
    try {
      for (let i = 0; i < changes.length; i += BULK_CHUNK) {
        const chunk = changes.slice(i, i + BULK_CHUNK);
        const res = await fetch(`${API}/api/races/selection/bulk`, {
          method: "PUT", headers, body: JSON.stringify({ changes: chunk }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setSaveError(buildSaveError(body, races, riders));
          setSaving(false);
          return;
        }
      }
      await load();
    } catch {
      setSaveError({ code: "generic", raceId: null, raceName: null, params: {} });
    } finally {
      setSaving(false);
    }
  }

  const colWidth = 30;

  return (
    <div className="mt-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-data text-sm font-semibold text-cz-1">{t("matrix.heading")}</h2>
          <div className="flex gap-1.5" role="tablist" aria-label={t("matrix.heading")}>
            {LENSES.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={lens === key}
                onClick={() => setLens(key)}
                className={`text-2xs uppercase tracking-wide px-2.5 py-1 rounded-full border transition-colors ${
                  lens === key ? "bg-cz-accent text-cz-on-accent border-cz-accent" : "border-cz-border text-cz-2 hover:bg-cz-subtle"
                }`}
              >
                {t(`matrix.lens.${key}`)}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-pressed={problemsOnly}
            onClick={() => setProblemsOnly((v) => !v)}
            className={`inline-flex items-center gap-1 text-2xs uppercase tracking-wide px-2.5 py-1 rounded-full border transition-colors ${
              problemsOnly ? "bg-cz-danger/15 text-cz-danger border-cz-danger/40" : "border-cz-border text-cz-2 hover:bg-cz-subtle"
            }`}
          >
            <AlertTriangleIcon size={12} />
            {t("matrix.problemsOnly")}
          </button>
        </div>
        {!readOnly && (
          <div className="flex items-center gap-2">
            {saveError && (
              <span className="text-2xs text-cz-danger">
                {saveError.raceName
                  ? t("matrix.saveErrorNamed", {
                      race: saveError.raceName,
                      reason: t([`selection.errors.${saveError.code}`, "selection.errors.generic"], saveError.params),
                    })
                  : t([`selection.errors.${saveError.code}`, "selection.errors.generic"], saveError.params)}
              </span>
            )}
            {isDirty && (
              <Button size="sm" variant="primary" loading={saving} onClick={saveAll}>
                {t("matrix.saveCount", { count: dirtyIds.length })}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="rounded-cz border border-cz-border bg-cz-card overflow-x-auto">
        <table
          data-sort-exempt="rytter x loebsdag-gitter, ikke en sorterbar liste"
          className="border-collapse"
          style={{ tableLayout: "fixed", width: `${148 + dayColumns.length * colWidth}px` }}
        >
          {/* table-layout:fixed uden en colgroup ville lade race-navn-headeren (lange
              tekster) auto-udvide dag-kolonnerne — colgroup låser hver kolonnes bredde
              UANSET indhold, så en lang overskrift trunkerer i stedet for at sprænge
              gitteret. */}
          <colgroup>
            <col style={{ width: 148 }} />
            {dayColumns.map((col) => <col key={col.key} style={{ width: colWidth }} />)}
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={raceLanes.laneCount + 2} className="sticky left-0 z-sticky bg-cz-subtle border-b border-r border-cz-border px-3 py-1.5 text-left align-bottom" style={{ minWidth: 148 }}>
                <span className="text-2xs uppercase tracking-wide text-cz-3">{t("matrix.heading")}</span>
              </th>
              {dateBands.map((band, i) => (
                <th
                  key={`${band.date}-${i}`}
                  colSpan={band.days.length}
                  title={band.date ?? undefined}
                  className="border-b border-cz-border bg-cz-subtle px-1 py-1 text-2xs uppercase tracking-wide text-cz-3 font-semibold whitespace-nowrap overflow-hidden text-ellipsis"
                >
                  {band.date ? formatBandDate(band.date) : "—"}
                </th>
              ))}
            </tr>
            {raceLanes.map((laneGroups, laneIdx) => (
              <tr key={`lane-${laneIdx}`}>
                {laneGroups.map((g) => {
                  const race = raceById.get(g.raceId);
                  // Spillertest-punkt 1: den kolonne "Gem plan" afviste for, markeret
                  // direkte i gitteret — ikke kun i banneret ovenfor.
                  const hasError = saveError?.raceId === g.raceId;
                  return (
                    <th
                      key={g.raceId}
                      colSpan={g.colSpan}
                      title={race?.name}
                      className={`border-b px-1 py-1 text-3xs font-medium overflow-hidden whitespace-nowrap ${
                        hasError ? "border-cz-danger bg-cz-danger/10 text-cz-danger" : `border-cz-border ${race ? raceGroupTint(race) : ""}`
                      }`}
                    >
                      {race ? (
                        <span className="flex items-center justify-between gap-1">
                          {hasError && <AlertTriangleIcon size={10} className="shrink-0" aria-hidden="true" />}
                          <span className="truncate">{race.name}</span>
                          <span className="tabular-nums text-cz-3 shrink-0">
                            {t("matrix.squadCount", { count: raceCurrentCount(draftByRace, race.id), max: race.sizeMax })}
                          </span>
                        </span>
                      ) : null}
                    </th>
                  );
                })}
              </tr>
            ))}
            <tr>
              {dayColumns.map((col) => {
                // Etape-nummer INDEN i løbet, 1-baseret (kontrakt #7: col.stageIndex
                // er allerede udledt entydigt af KOLONNENS EGET løb — ingen races.find()-
                // opslag her længere, så tallet kan ikke længere tilhøre "det forkerte"
                // af flere løb der deler en kalenderdag).
                return (
                  <th key={col.key} className="border-b border-cz-border p-0" style={{ width: colWidth, minWidth: colWidth }}>
                    <button
                      type="button"
                      onClick={() => { const d = dayDatesMap.get(col.gameDay); if (d) onOpenDay?.(d); }}
                      title={t("matrix.dayAria", { index: col.stageIndex, date: dayDatesMap.get(col.gameDay) ?? "?" })}
                      className="w-full h-6 flex items-center justify-center text-3xs font-mono tabular-nums text-cz-3 hover:text-cz-accent-t hover:bg-cz-subtle"
                    >
                      {col.stageIndex}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {riders
              .filter((r) => !problemsOnly || problems.affectedRiderIds.has(r.id) || races.some((race) => problems.affectedRaceIds.has(race.id) && roleOf(draftByRace.get(race.id), r.id) != null))
              .map((rider) => {
                const segments = buildRiderRowSegments(dayColumns, races, draftByRace, rider.id);
                const loadDays = lens === "load" ? riderLoadDays(races, draftByRace, rider.id) : null;
                const peakDays = peakDaysByRider.get(rider.id);
                return (
                  <tr key={rider.id} className="group">
                    <td className="sticky left-0 z-sticky bg-cz-card group-hover:bg-cz-subtle border-r border-b border-cz-border px-3 py-1 text-left">
                      <span className="block text-xs font-medium text-cz-1 truncate">{rider.name}</span>
                      {loadDays != null && (
                        <span className="block font-data text-3xs tabular-nums text-cz-3">{t("matrix.loadSuffix", { count: loadDays })}</span>
                      )}
                    </td>
                    {segments.map((seg) => {
                      if (seg.kind === "empty") {
                        // Kontrakt #7: kolonnen er entydigt ét løb (seg.raceId), intet
                        // races.find()-opslag nødvendigt længere.
                        const race = raceById.get(seg.raceId);
                        const peak = peakDays?.get(seg.day);
                        const fit = lens === "routeMatch" && race && rider.abilities ? riderSuitability(rider.abilities, race.demandVector).score : null;
                        const isDraftCell = race && dirtyIdSet.has(race.id);
                        const hasError = race && saveError?.raceId === race.id;
                        return (
                          <td
                            key={seg.day}
                            className={`border-b p-0 ${peak ? "bg-cz-accent/10" : ""} ${
                              hasError ? "border-cz-danger outline outline-1 outline-offset-[-1px] outline-cz-danger"
                                : isDraftCell ? "border-cz-border outline outline-1 outline-offset-[-1px] outline-dashed outline-cz-accent-t" : "border-cz-border"
                            }`}
                            style={{ width: colWidth }}
                          >
                            <button
                              type="button"
                              disabled={!race}
                              onClick={(e) => race && openCellPopover(e, { kind: "empty", raceId: race.id, riderId: rider.id })}
                              title={[race ? t("matrix.cellEmptyAria", { rider: rider.name, race: race.name }) : null, peakTitle(peak)].filter(Boolean).join(" · ") || undefined}
                              className={`w-full h-7 flex items-center justify-center text-3xs tabular-nums ${race ? "hover:bg-cz-subtle cursor-pointer" : ""} ${fit != null ? FIT_TEXT[fitTier(fit)] : "text-transparent"}`}
                            >
                              {fit != null ? fit : "·"}
                            </button>
                          </td>
                        );
                      }
                      const { race, role, days } = seg;
                      const fit = lens === "routeMatch" && rider.abilities ? riderSuitability(rider.abilities, race.demandVector).score : null;
                      const restSet = new Set(race.restGameDays || []);
                      const peakHit = days.find((d) => peakDays?.has(d));
                      const peakInfo = peakHit ? peakTitle(peakDays.get(peakHit)) : null;
                      const isDraftCell = dirtyIdSet.has(race.id);
                      const hasError = saveError?.raceId === race.id;
                      return (
                        <td
                          key={race.id}
                          colSpan={seg.colSpan}
                          className={`border-b p-0 ${peakInfo ? "ring-1 ring-inset ring-cz-accent/60" : ""} ${
                            hasError ? "border-cz-danger outline outline-1 outline-offset-[-1px] outline-cz-danger"
                              : isDraftCell ? "border-cz-border outline outline-1 outline-offset-[-1px] outline-dashed outline-cz-accent-t" : "border-cz-border"
                          }`}
                          style={{ width: colWidth * seg.colSpan }}
                        >
                          <button
                            type="button"
                            onClick={(e) => openCellPopover(e, { kind: "filled", raceId: race.id, riderId: rider.id })}
                            title={[t("matrix.cellFilledAria", { rider: rider.name, race: race.name, role: t(`tacticsOrders.roleLabel.${role}`) }), peakInfo].filter(Boolean).join(" · ")}
                            className="w-full h-7 flex cursor-pointer hover:opacity-90"
                          >
                            {lens === "routeMatch" ? (
                              <span className={`flex-1 flex items-center justify-center gap-1 text-3xs font-semibold ${roleBadgeClass(role)}`}>
                                <span>{ROLE_LETTER[role]}</span>
                                {fit != null && <span className={`tabular-nums font-normal ${FIT_TEXT[fitTier(fit)]}`}>{fit}</span>}
                              </span>
                            ) : (
                              days.map((d, i) => (
                                <span key={d} className={`flex-1 flex items-center justify-center ${roleBadgeClass(role)} ${i === 0 ? "" : "border-l border-cz-card/40"}`}>
                                  {restSet.has(d) ? <LockIcon size={10} className="opacity-70" /> : (i === 0 ? <span className="text-3xs font-semibold">{ROLE_LETTER[role]}</span> : null)}
                                </span>
                              ))
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex items-center gap-1.5 font-data text-3xs">
        {problems.count === 0 ? (
          <span className="text-cz-success">{t("matrix.noProblems")}</span>
        ) : (
          <span className="text-cz-danger">{t("matrix.problemsCount", { count: problems.count })}</span>
        )}
      </div>

      {popover && (() => {
        const rider = riders.find((r) => r.id === popover.riderId);
        const race = raceById.get(popover.raceId);
        if (!rider || !race) return null;
        const fixed = popover.kind === "filled";
        const currentRole = roleOf(draftByRace.get(race.id), rider.id);
        // Akse-konvertering (kontrakt #7): popoveren adresserer raceId direkte —
        // ingen "hvilket løb"-vælger/candidates-liste længere (seasonMatrix.js's
        // fil-header forklarer hvorfor en kolonne nu entydigt er ét løb).
        // Fixed celle = rytterens EGET løb — samme løb er altid lovligt
        // (rolle-skift), ingen konflikt mulig her (conflictingEntryForRace
        // udelader eksplicit `race` selv). blocked-guarden kaldes alligevel,
        // så onSelectRole altid går gennem samme kode-sti som empty-cellen.
        // Refutations-fund #4323 (27/8, spillertest-punkt 2+3): for en TOM
        // celle vises løbet LÅST med navngivet årsag i stedet for tavst at
        // kunne vælges, hvis det overlapper rytterens eksisterende udtagelse
        // et andet sted (kontrakt #6).
        const conflict = !fixed ? conflictingEntryForRace(rider.id, race, races, draftByRace) : null;
        return (
          <SeasonMatrixCellPopover
            anchorEl={popoverAnchor}
            onClose={closeCellPopover}
            rider={rider}
            race={race}
            fixed={fixed}
            currentRole={currentRole}
            lockedReasonText={readOnly ? t("seasonView.readOnlyHint") : null}
            conflict={conflict}
            onSelectRole={(role) => {
              setRaceDraft(race.id, (d) => setRiderRole(d, rider.id, role, !!conflict));
              closeCellPopover();
            }}
            onRemove={fixed ? () => { setRaceDraft(race.id, (d) => removeRiderFromRace(d, rider.id)); closeCellPopover(); } : undefined}
          />
        );
      })()}
    </div>
  );
}

// "27 Aug"-datobånd-label, sprog-neutral kort form (samme mønster som SeasonView's fmt.range).
function formatBandDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(d).replace(/\./g, "").toUpperCase();
}

// Race-gruppe-header-tint: monument/GT skiller sig ud, samme signal som SeasonView's bandClasses.
function raceGroupTint(race) {
  if (race.raceClass === "Monuments") return "bg-cz-accent/10 text-cz-accent-t";
  if (race.raceClass === "TourFrance" || race.raceClass === "GiroVuelta") return "bg-cz-sidebar text-cz-sidebar-1";
  return "text-cz-2";
}
