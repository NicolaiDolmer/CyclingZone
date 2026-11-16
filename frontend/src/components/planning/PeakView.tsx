// #7535 runde 3 · Formtop-visningen paa planlaegningssiden. Spilleren krydser ryttere af og trykker
// "Apply to selected"; maalet er altid det aabne loeb (JeppeK 2/11). Ingen formkurve.
//
// Samme data og samme kald som /planning's Form-fane: board'et (GET /api/peak-plans/board) giver
// rating, form, traethed og rytternes mål; "Apply" er Form-fanens masse-kald (POST /api/peak-plans/bulk)
// og "Fjern" dens fjern (DELETE /api/peak-plans/:id). Serveren afgoer reglerne (maks mål pr. rytter,
// loeb der er startet, seniortruppen); skippede par siges hoejt. Maalets vaerdi og payback (formdykket
// efter toppen) er Form-fanens egen linje (PeakValue), ingen kopi af tallene.
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SortableTh, Flag, PeakValue, Button, SkeletonLines, ErrorState, AlertTriangleIcon } from "./primitives.ts";
import { formatShortDate } from "./planningUi.tsx";
import { loadPeakBoard, applyPeaks, removePeak } from "../../lib/planningWorkbenchData.ts";
import {
  buildPeakRows,
  groupPeakRows,
  peakApplyPairs,
  peakTargetOpen,
  sortPeakRows,
  type PeakBoardRace,
  type PeakBoardRider,
  type PeakRow,
  type PeakSortKey,
  type WriteGate,
} from "../../lib/planningWorkbench.ts";

interface PeakBoard {
  enabled: boolean;
  riders: PeakBoardRider[];
  races: PeakBoardRace[];
  maxPerRider: number;
  paybackDays: number;
  today: string | null;
}

export interface PeakState {
  state: "idle" | "loading" | "error" | "ready";
  board: PeakBoard | null;
  checked: Set<string>;
  toggle: (id: string) => void;
  setChecked: (ids: Set<string>) => void;
  message: { tone: "ok" | "danger"; text: string } | null;
  /** Anvend formtoppen paa de afkrydsede ryttere (gennem sidens skrive-laas). */
  apply: () => Promise<void>;
  remove: (planId: string) => Promise<void>;
  reload: () => void;
  pairs: Array<{ riderId: string; raceId: string }>;
  rows: PeakRow[];
  targetOpen: boolean;
}

export interface PeakBoardData {
  state: "idle" | "loading" | "error" | "ready";
  board: PeakBoard | null;
  reload: () => void;
}

/**
 * Board'et hentes ÉN gang for siden (ejervalg 16/11): det giver formtoppen i Trup (punkt 7), formtop-
 * maerket i loebslisten (punkt 3) og Formtop-visningen. Hentes igen efter hvert anvend og fjern.
 */
export function usePeakBoardData(active: boolean): PeakBoardData {
  const [state, setState] = useState<PeakBoardData["state"]>("idle");
  const [board, setBoard] = useState<PeakBoard | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    setState((s) => (s === "ready" ? s : "loading"));
    loadPeakBoard()
      .then((res) => {
        if (cancelled) return;
        if (!res.ok || !res.data) {
          setState("error");
          return;
        }
        const d = res.data;
        setBoard({
          enabled: d.enabled === true,
          riders: Array.isArray(d.riders) ? d.riders : [],
          races: Array.isArray(d.races) ? d.races : [],
          maxPerRider: Number(d.maxPerRider ?? 2),
          paybackDays: Number(d.paybackDays ?? 7),
          today: d.today ?? null,
        });
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [active, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return useMemo(() => ({ state, board, reload }), [state, board, reload]);
}

/** Formtop-visningens tilstand for det aabne loeb; afkrydsningen nulstilles ved nyt loeb. */
export function usePeakBoard({ data, raceId, today, gate }: { data: PeakBoardData; raceId: string; today: string; gate: WriteGate }): PeakState {
  const { t } = useTranslation("planning");
  const { t: tp } = useTranslation("planner");
  const { state, board, reload } = data;
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [message, setMessage] = useState<PeakState["message"]>(null);

  useEffect(() => {
    setChecked(new Set());
    setMessage(null);
  }, [raceId]);

  const day = board?.today ?? today;
  const rows = useMemo(
    () => (board ? buildPeakRows({ riders: board.riders, races: board.races, raceId, maxPerRider: board.maxPerRider, today: day }) : []),
    [board, raceId, day],
  );
  const race = board?.races.find((r) => r.id === raceId) ?? null;
  const targetOpen = peakTargetOpen(race, day);
  const pairs = useMemo(() => (targetOpen ? peakApplyPairs(rows, checked, raceId) : []), [targetOpen, rows, checked, raceId]);

  const errorText = useCallback(
    (code: string | undefined) => tp([`error.${code || "generic"}`, "error.generic"], { max: board?.maxPerRider ?? 2 }),
    [tp, board],
  );

  const apply = useCallback(async () => {
    if (!pairs.length) return;
    await gate.run("peak", async () => {
      setMessage(null);
      try {
        const res = await applyPeaks(pairs);
        const data = res.data ?? {};
        if (!res.ok || data.ok === false) {
          setMessage({ tone: "danger", text: errorText(data.error) });
          return;
        }
        const skipped = Array.isArray(data.skipped) ? data.skipped.length : 0;
        setMessage(
          skipped
            ? { tone: "danger", text: t("peak.appliedPartial", { created: data.created ?? 0, skipped }) }
            : { tone: "ok", text: t("peak.applied", { count: data.created ?? pairs.length }) },
        );
        setChecked(new Set());
        reload();
      } catch {
        setMessage({ tone: "danger", text: errorText("generic") });
      }
    });
  }, [pairs, gate, errorText, t, reload]);

  const remove = useCallback(
    async (planId: string) => {
      await gate.run("peak", async () => {
        setMessage(null);
        try {
          const res = await removePeak(planId);
          if (!res.ok || res.data?.ok === false) {
            setMessage({ tone: "danger", text: errorText(res.data?.error) });
            return;
          }
          setMessage({ tone: "ok", text: t("peak.removed") });
          reload();
        } catch {
          setMessage({ tone: "danger", text: errorText("generic") });
        }
      });
    },
    [gate, errorText, t, reload],
  );

  const toggle = useCallback((id: string) => {
    setChecked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return {
    state,
    board,
    checked,
    toggle,
    setChecked,
    message,
    apply,
    remove,
    reload,
    pairs,
    rows,
    targetOpen,
  };
}

export default function PeakView({
  peak,
  raceName,
  raceStart,
  locked,
  compactMobile = false,
  selectedIds = [],
  onPick,
  canPick,
}: {
  peak: PeakState;
  raceName: string;
  /** Loebets startdato (YYYY-MM-DD) til linjen over tabellen. */
  raceStart: string | null;
  locked: boolean;
  compactMobile?: boolean;
  /** Truppen som spilleren ser den (gemt plus kladde): udtagne staar oeverst (punkt 6 B). */
  selectedIds?: readonly string[];
  /** "Udtag til loebet" ved advarslen: tager rytteren ind i trup-kladden (intet gemmes af sig selv). */
  onPick?: (riderId: string) => void;
  canPick?: (riderId: string) => boolean;
}) {
  const { t, i18n } = useTranslation("planning");
  const { t: tp } = useTranslation("planner");
  const [sort, setSort] = useState<{ key: PeakSortKey; dir: "asc" | "desc" }>({ key: "form", dir: "desc" });
  const groups = useMemo(() => groupPeakRows(sortPeakRows(peak.rows, sort), selectedIds), [peak.rows, sort, selectedIds]);
  const onSort = (key: PeakSortKey) =>
    setSort((cur) => (cur.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" || key === "start" ? "asc" : "desc" }));

  if (peak.state === "idle" || peak.state === "loading") {
    return (
      <div className="border-t border-cz-border p-4">
        <SkeletonLines lines={5} />
      </div>
    );
  }
  if (peak.state === "error" || !peak.board) {
    return (
      <div className="border-t border-cz-border p-4">
        <ErrorState
          title={t("error.title")}
          description={t("error.description")}
          action={
            <Button variant="secondary" size="sm" onClick={peak.reload}>
              {t("error.retry")}
            </Button>
          }
        />
      </div>
    );
  }
  if (!peak.board.enabled) {
    return (
      <div className="border-t border-cz-border px-4 py-5">
        <p className="text-sm font-semibold text-cz-1">{tp("empty.title")}</p>
        <p className="mt-0.5 text-xs text-cz-2">{tp("empty.description")}</p>
      </div>
    );
  }

  const selectableCount = peak.rows.filter((r) => r.state === "open").length;
  const th = (key: PeakSortKey, label: string, { numeric = true, mobile = false }: { numeric?: boolean; mobile?: boolean } = {}) => (
    <SortableTh
      key={key}
      sortKey={key}
      sort={sort.key}
      sortDir={sort.dir}
      onSort={onSort}
      className={`bg-cz-subtle px-1.5 py-2 font-data text-2xs font-semibold uppercase tracking-normal text-cz-3 sm:tracking-wide ${numeric ? "text-right" : "text-left"} ${mobile ? "" : "hidden sm:table-cell"}`}
    >
      {label}
    </SortableTh>
  );

  return (
    <div className="border-t border-cz-border" data-testid="planning-peak">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cz-border px-4 py-2">
        <p className="text-xs text-cz-2">
          {peak.targetOpen
            ? t("peak.target", { race: raceName, date: raceStart ? formatShortDate(raceStart, i18n.language) : "" })
            : t("peak.targetClosed", { race: raceName })}
        </p>
        <p className="font-data text-2xs tabular-nums text-cz-3">{t("peak.selected", { count: peak.pairs.length })}</p>
      </div>
      {peak.message && (
        <p className={`border-b border-cz-border px-4 py-2 text-xs ${peak.message.tone === "danger" ? "text-cz-danger" : "text-cz-success"}`} role="status">
          {peak.message.text}
        </p>
      )}
      <div className="overflow-x-clip sm:overflow-x-auto">
        <table data-sortable className="w-full border-collapse">
          <thead>
            {/* Hver kolonne sorterer: th() bygger en SortableTh med onSort (guard: tableSortIntent.test.js). */}
            <tr>
              <th className="hidden bg-cz-subtle px-1.5 py-2 ps-4 text-left font-data text-2xs font-semibold uppercase tracking-wide text-cz-3 sm:table-cell">
                <span className="sr-only">{t("squad.pick")}</span>
              </th>
              {th("name", t("squad.rider"), { numeric: false, mobile: true })}
              {th("rating", t("squad.rating"))}
              {th("form", t("squad.form"), { mobile: true })}
              {th("fatigue", t("squad.fatigue"), { mobile: true })}
              {th("target", t("peak.col.target"), { numeric: false, mobile: !compactMobile })}
              {th("start", t("peak.col.start"))}
            </tr>
          </thead>
          {/* Udtagne ryttere oeverst (punkt 6 B), hver gruppe i den valgte sortering. */}
          {[
            { key: "inSquad", label: t("peak.group.inSquad", { count: groups.inSquad.length }), rows: groups.inSquad },
            { key: "outside", label: t("peak.group.outside", { count: groups.outside.length }), rows: groups.outside },
          ]
            .filter((g) => g.rows.length > 0)
            .map((group) => (
          <tbody key={group.key} data-testid={`planning-peak-group-${group.key}`}>
            <tr className="border-t border-cz-border">
              <th colSpan={7} scope="colgroup" className="bg-cz-subtle px-4 py-1.5 text-left font-data text-2xs font-semibold uppercase tracking-wide text-cz-3">
                {group.label}
              </th>
            </tr>
            {group.rows.map((row) => {
              const checked = peak.checked.has(row.id);
              const disabled = locked || !peak.targetOpen || row.state !== "open";
              const warn = groups.warn.has(row.id);
              return (
                <Fragment key={row.id}>
                <tr data-testid="planning-peak-row" className={`border-t border-cz-border sm:h-[46px] ${checked ? "bg-cz-subtle" : ""}`}>
                  <td className="hidden px-1.5 py-[7px] ps-4 sm:table-cell">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-cz-accent disabled:cursor-not-allowed"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => peak.toggle(row.id)}
                      aria-label={t("squad.pickRider", { name: row.name })}
                    />
                  </td>
                  <td className="w-full px-1.5 py-[7px] text-left sm:w-auto">
                    <div className="flex items-center gap-1">
                      <label className={`-ms-2 flex h-11 w-11 shrink-0 items-center justify-center sm:hidden ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}>
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-cz-accent disabled:cursor-not-allowed"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => peak.toggle(row.id)}
                          aria-label={t("squad.pickRider", { name: row.name })}
                        />
                      </label>
                      <span className="inline-flex min-w-0 items-center gap-1.5">
                        {row.nationality && <Flag code={row.nationality} className="shrink-0 text-2xs" />}
                        <span className="text-[13.5px] font-medium text-cz-1 sm:whitespace-nowrap">{row.name}</span>
                      </span>
                    </div>
                  </td>
                  <td className="hidden px-1.5 py-[7px] text-right font-data text-[13px] tabular-nums sm:table-cell">{row.rating ?? <span className="text-cz-3">-</span>}</td>
                  <td className="whitespace-nowrap px-1.5 py-[7px] text-right font-data text-[13px] tabular-nums">{row.form ?? <span className="text-cz-3">-</span>}</td>
                  <td className="whitespace-nowrap px-1.5 py-[7px] text-right font-data text-[13px] tabular-nums">{row.fatigue ?? <span className="text-cz-3">-</span>}</td>
                  <td className={`px-1.5 py-[7px] text-left text-xs ${compactMobile ? "hidden sm:table-cell" : ""}`}>
                    <TargetCell row={row} board={peak.board as PeakBoard} locked={locked} onRemove={peak.remove} />
                  </td>
                  <td className="hidden whitespace-nowrap px-1.5 py-[7px] pe-4 text-right font-data text-xs tabular-nums text-cz-2 sm:table-cell">
                    {row.next ? (
                      <span title={row.next.name}>
                        {formatShortDate(row.next.date, i18n.language)}
                        <span className="ms-1.5 text-cz-3">{t("peak.inDays", { count: row.next.days })}</span>
                      </span>
                    ) : (
                      <span className="text-cz-3">-</span>
                    )}
                  </td>
                </tr>
                {warn && (
                  // Formtoppen rammer det aabne loeb, men rytteren er ikke udtaget: toppen gaar til spilde.
                  <tr data-testid="planning-peak-warning" className="bg-cz-warning-bg">
                    <td colSpan={7} className="px-4 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="flex min-w-0 items-start gap-1.5 text-xs text-cz-1">
                          <AlertTriangleIcon size={14} className="mt-px shrink-0 text-cz-warning" aria-hidden="true" />
                          <span>{t("peak.notPicked", { name: row.name, race: raceName })}</span>
                        </p>
                        {onPick && canPick?.(row.id) && (
                          <Button variant="secondary" size="sm" disabled={locked} onClick={() => onPick(row.id)}>
                            {t("peak.pickForRace")}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
            ))}
        </table>
      </div>
      <p className="border-t border-cz-border px-4 py-2 font-data text-xs tabular-nums text-cz-3">
        {t("peak.count", { shown: peak.rows.length, open: selectableCount, max: peak.board.maxPerRider })}
      </p>
    </div>
  );
}

function TargetCell({ row, board, locked, onRemove }: { row: PeakRow; board: PeakBoard; locked: boolean; onRemove: (planId: string) => void }) {
  const { t } = useTranslation("planning");
  const { t: tp } = useTranslation("planner");
  const months = tp("months", { returnObjects: true }) as unknown;
  const others = row.targets.filter((p) => p !== row.here);
  return (
    <div className="flex flex-col gap-0.5">
      {row.here && (
        <div className="flex items-start gap-2" data-testid="planning-peak-here">
          <div className="min-w-0">
            <span className="font-semibold text-cz-accent-t">{t("peak.here")}</span>
            {/* Form-fanens egen linje: maalets vaerdi, payback efter toppen og en kollision med et andet loeb. */}
            <PeakValue peak={row.here} paybackDays={board.paybackDays} months={Array.isArray(months) ? months : undefined} />
          </div>
          {row.here.id && !row.here.locked && (
            <Button variant="ghost" size="sm" disabled={locked} onClick={() => onRemove(String(row.here?.id))}>
              {t("peak.remove")}
            </Button>
          )}
        </div>
      )}
      {others.map((p) => (
        <span key={String(p.id ?? p.targetRaceId)} className="truncate text-cz-2" title={String(p.targetRaceName ?? "")}>
          {p.targetRaceName ?? "-"}
        </span>
      ))}
      {!row.here && row.state === "full" && <span className="text-2xs text-cz-3">{t("peak.full", { max: board.maxPerRider })}</span>}
      {!row.here && row.state === "notSenior" && <span className="text-2xs text-cz-3">{t("peak.notSenior")}</span>}
      {!row.here && !others.length && row.state === "open" && <span className="text-cz-3">-</span>}
    </div>
  );
}
