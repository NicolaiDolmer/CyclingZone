// #6855 (ejer-design 18/10): Kontrakter-fanen på holdsiden.
//
// Alle ryttere der kan forlænges, grupperet efter udløb ("Udløber denne
// sæson" øverst, så én gruppe pr. udløbssæson, ryttere ved loftet nedtonet
// til sidst). Afkrydsning pr. række, ét fælles valg af 1/2/3 sæsoner i bunden
// (kan rettes pr. rytter), én gold primary "Forlæng N kontrakter", og et
// opsummeringsvindue før noget skrives.
//
// INGEN NYE TAL: løn nu, ny løn, hvor langt hver rytter kan forlænges og den
// aktuelle sæson kommer fra backendens quote (contractBatchExtension.js, samme
// regler som enkelt-forlængelsen). Skrivningen sker i ét atomisk kald.
//
// Sorteringen står i URL'en (csort/cdir), så den overlever et klik ind på en
// rytter og tilbage. Ren logik: contractsTabModel.ts (node --test).
//
// TASTE: T2-tabeller (DataTable, dense), hairlines, én gold primary pr. view
// (bundlinjens knap; vinduet er sin egen flade), stroke-ikoner, tabulære tal.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode, MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { buttonClass } from "../ui/buttonStyles.js";
import {
  Button as ButtonJs,
  Modal as ModalJs,
  SkeletonLines as SkeletonLinesJs,
  ChevronRightIcon as ChevronRightIconJs,
  BriefcaseIcon as BriefcaseIconJs,
  RefreshIcon as RefreshIconJs,
} from "../ui/index.js";
import { DataTable, EmptyState, ErrorState, RiderLink, Segmented, Select, type DataTableColumn } from "../squad/squadUi.ts";
import ScoutablePotentialeJs from "../rider/ScoutablePotentiale.jsx";
import { authHeaders } from "../../lib/supabase";
import { apiFetch } from "../../lib/apiFetch.ts";
import { resolveApiError } from "../../lib/apiError.js";
import { formatNumber } from "../../lib/intl";
import { statPlateStyle } from "../../lib/statColor";
import { riderOverallRating } from "../../lib/riderRating";
import { scoutSortValue } from "../../lib/scouting";
import { getRiderMarketValue } from "../../lib/marketValues.js";
import { getRiderAge } from "../../lib/riderAge.js";
import {
  SEASON_CHOICES,
  CONTRACTS_SORT_PARAM,
  CONTRACTS_DIR_PARAM,
  readContractsSort,
  writeSortParams,
  cycleSort,
  groupByExpiry,
  effectiveSeasons,
  seasonOptions,
  requestedSeasons,
  buildItems,
  selectionTotals,
  type ContractRow,
  type ContractGroup,
  type ContractsSortKey,
  type Selection,
} from "./contractsTabModel.ts";

// Kit-primitiverne er .jsx uden egne typer; kontrakten skrives ned her (samme
// greb som PromotionPendingPanel.tsx / squadUi.ts).
interface ButtonProps {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  disabled?: boolean;
  loading?: boolean;
  iconLeft?: ReactNode;
  onClick?: () => void;
  children: ReactNode;
  "data-testid"?: string;
}
interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  closeLabel?: string;
  titleId?: string;
  children: ReactNode;
}
interface IconProps { size?: number; className?: string; "aria-hidden"?: boolean | "true" }
interface PotentialeProps { rider: object; scouting: unknown; labelAsTitle?: boolean; hideLevel?: boolean }
const Button = ButtonJs as unknown as (props: ButtonProps) => ReactNode;
const Modal = ModalJs as unknown as (props: ModalProps) => ReactNode;
const SkeletonLines = SkeletonLinesJs as unknown as (props: { lines?: number; className?: string }) => ReactNode;
const ChevronRightIcon = ChevronRightIconJs as unknown as (props: IconProps) => ReactNode;
const BriefcaseIcon = BriefcaseIconJs as unknown as (props: IconProps) => ReactNode;
const RefreshIcon = RefreshIconJs as unknown as (props: IconProps) => ReactNode;
const ScoutablePotentiale = ScoutablePotentialeJs as unknown as (props: PotentialeProps) => ReactNode;

const API = import.meta.env.VITE_API_URL;

export interface ContractsTabRider {
  id: string;
  firstname?: string | null;
  lastname?: string | null;
  birthdate?: string | null;
  salary?: number | null;
  contract_end_season?: number | null;
  is_academy?: boolean | null;
  [key: string]: unknown;
}

interface ScoutingLike { estimateFor: (riderId: string) => unknown }

interface Props {
  riders: ContractsTabRider[];
  scouting: ScoutingLike;
  seasonYear: number | null | undefined;
  onChanged?: () => void;
}

interface QuoteRider {
  riderId: string;
  requestedSeasons: number;
  grantedSeasons: number;
  maxSeasons: number;
  capped: boolean;
  currentSalary: number;
  newSalary: number;
  currentEndSeason: number | null;
  newEndSeason: number;
}
interface QuoteError { riderId: string; errorCode: string; errorParams?: Record<string, unknown> }
interface QuoteResponse {
  currentSeason: number;
  maxSeason: number;
  riders: QuoteRider[];
  errors: QuoteError[];
  totals: { selectedSalaryBefore: number; selectedSalaryAfter: number; teamSalaryBefore: number; teamSalaryAfter: number };
  salaryCap?: { active: boolean; withinCap: boolean; cap: number | null };
}
interface ApiErrorBody { error?: string; errorCode?: string; errorParams?: Record<string, unknown>; errors?: QuoteError[] }

type Base =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; currentSeason: number; byId: Map<string, { newSalary: number | null; maxSeasons: number }> };

type Summary =
  | { status: "loading" }
  | { status: "error"; message: string; errors: QuoteError[] }
  | { status: "ready"; data: QuoteResponse };

// Fuld literal sti ("/api/..."), så feature-liveness-audittens Detector B kan matche kaldet.
async function postJson(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: unknown }> {
  const headers = await authHeaders();
  if (!headers) return { ok: false, status: 401, data: { errorCode: "session_expired" } };
  const res = await apiFetch(`${API}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  if (res.networkError) return { ok: false, status: 0, data: { errorCode: "network" } };
  return { ok: res.ok, status: res.status, data: res.data };
}

function riderName(r: ContractsTabRider): string {
  return `${r.firstname ?? ""} ${r.lastname ?? ""}`.trim();
}

export default function ContractsTab({ riders, scouting, seasonYear, onChanged }: Props) {
  const { t } = useTranslation(["team", "errors"]);
  // resolveApiError tager en løs (key, params) => string; i18nexts TFunction er strengere typet.
  const tr = (key: string, params?: object): string => String(t(key, (params ?? {}) as Record<string, unknown>));
  const [searchParams, setSearchParams] = useSearchParams();
  const sort = readContractsSort(searchParams);
  const [base, setBase] = useState<Base>({ status: "loading" });
  const [selection, setSelection] = useState<Selection>({});
  const [common, setCommon] = useState<number>(1);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Quoten hentes for alle ryttere med 1 sæson: løn efter forlængelse er den
  // samme uanset antal sæsoner, og maxSeasons fortæller hvor langt han kan.
  // Nøglen ændrer sig når en kontrakt ændrer sig (efter en forlængelse).
  const quoteKey = riders.map((r) => `${r.id}:${r.contract_end_season ?? "-"}:${r.salary ?? "-"}`).join("|");
  const loadBase = useCallback(async () => {
    if (riders.length === 0) {
      setBase({ status: "ready", currentSeason: 0, byId: new Map() });
      return;
    }
    setBase({ status: "loading" });
    try {
      const res = await postJson("/api/riders/extend-contracts/quote", {
        items: riders.map((r) => ({ riderId: r.id, seasons: 1 })),
      });
      if (!res.ok) { setBase({ status: "error" }); return; }
      const data = res.data as QuoteResponse;
      const byId = new Map<string, { newSalary: number | null; maxSeasons: number }>();
      for (const q of data.riders ?? []) byId.set(q.riderId, { newSalary: q.newSalary, maxSeasons: q.maxSeasons });
      for (const e of data.errors ?? []) {
        if (e.errorCode === "contract_extension_cap_reached") byId.set(e.riderId, { newSalary: null, maxSeasons: 0 });
      }
      setBase({ status: "ready", currentSeason: data.currentSeason, byId });
    } catch {
      setBase({ status: "error" }); // netværk: fejltilstand med "Prøv igen"
    }
    // quoteKey dækker rytter-listen; riders selv skifter reference hver render.
  }, [quoteKey]);

  useEffect(() => { loadBase(); }, [loadBase]);

  const rows: ContractRow[] = useMemo(() => {
    if (base.status !== "ready") return [];
    const out: ContractRow[] = [];
    for (const r of riders) {
      const q = base.byId.get(r.id);
      if (!q) continue; // ikke forlængbar (fx afvist af backenden af anden grund)
      const ovr = riderOverallRating(r) as number | null;
      const potential = scoutSortValue(scouting.estimateFor(r.id)) as number | null;
      out.push({
        id: r.id,
        name: riderName(r),
        ovr: Number.isFinite(ovr) ? ovr : null,
        potential: Number.isFinite(potential) ? potential : null,
        age: (getRiderAge(r.birthdate, seasonYear) as number | null) ?? null,
        endSeason: r.contract_end_season ?? null,
        salary: Number(r.salary ?? 0),
        newSalary: q.newSalary,
        value: Number(getRiderMarketValue(r)) || null,
        maxSeasons: q.maxSeasons,
      });
    }
    return out;
  }, [base, riders, scouting, seasonYear]);

  const ridersById = useMemo(() => new Map(riders.map((r) => [r.id, r])), [riders]);
  const rowsById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const groups = base.status === "ready" ? groupByExpiry(rows, base.currentSeason, sort) : [];
  const totals = selectionTotals(rows, selection);

  // Rensning: en valgt rytter der ikke længere kan forlænges (eller er væk) fjernes.
  useEffect(() => {
    setSelection((prev) => {
      const next: Selection = {};
      let changed = false;
      for (const [id, own] of Object.entries(prev)) {
        const row = rowsById.get(id);
        if (row && row.maxSeasons > 0) next[id] = own;
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [rowsById]);

  function handleSort(key: string) {
    const next = cycleSort(sort, key as ContractsSortKey);
    setSearchParams((prev) => writeSortParams(prev, CONTRACTS_SORT_PARAM, CONTRACTS_DIR_PARAM, next), { replace: true });
  }

  function toggle(row: ContractRow) {
    if (row.maxSeasons <= 0) return;
    setNotice(null);
    setSelection((prev) => {
      const next = { ...prev };
      if (row.id in next) delete next[row.id];
      else next[row.id] = null;
      return next;
    });
  }

  function toggleGroup(group: ContractGroup, checked: boolean) {
    setNotice(null);
    setSelection((prev) => {
      const next = { ...prev };
      for (const row of group.rows) {
        if (row.maxSeasons <= 0) continue;
        if (checked) { if (!(row.id in next)) next[row.id] = null; }
        else delete next[row.id];
      }
      return next;
    });
  }

  function setOwnSeasons(riderId: string, seasons: number) {
    setSelection((prev) => ({ ...prev, [riderId]: seasons === common ? null : seasons }));
  }

  function changeCommon(next: string) {
    const n = Number(next);
    setCommon(n);
    // Egne rettelser der nu er lig det fælles valg folder tilbage til "følger fælles".
    setSelection((prev) => {
      const out: Selection = {};
      for (const [id, own] of Object.entries(prev)) out[id] = own === n ? null : own;
      return out;
    });
  }

  async function openSummary() {
    setSummary({ status: "loading" });
    try {
      const res = await postJson("/api/riders/extend-contracts/quote", { items: buildItems(selection, common) });
      if (!res.ok) {
        const body = (res.data ?? {}) as ApiErrorBody;
        setSummary({ status: "error", message: resolveApiError(body, tr, t("contracts.summary.loadError")), errors: [] });
        return;
      }
      setSummary({ status: "ready", data: res.data as QuoteResponse });
    } catch {
      setSummary({ status: "error", message: t("contracts.summary.loadError"), errors: [] });
    }
  }

  async function confirmExtend() {
    setSaving(true);
    try {
      const items = buildItems(selection, common);
      const res = await postJson("/api/riders/extend-contracts", { items });
      const body = (res.data ?? {}) as ApiErrorBody;
      if (!res.ok) {
        setSummary({
          status: "error",
          message: resolveApiError(body, tr, t("contracts.summary.saveError")),
          errors: Array.isArray(body.errors) ? body.errors : [],
        });
        // Kunne en tilbagerulning ikke gennemføres, er nogle kontrakter ændret: hent friske tal.
        if (body.errorCode === "contract_batch_partial") onChanged?.();
        return;
      }
      setSummary(null);
      setSelection({});
      setNotice(t("contracts.done", { count: items.length }));
      onChanged?.();
    } catch {
      setSummary({ status: "error", message: t("contracts.summary.saveError"), errors: [] });
    } finally {
      setSaving(false);
    }
  }

  function errorLine(e: QuoteError): string {
    const who = ridersById.get(e.riderId);
    const name = who ? riderName(who) : e.riderId;
    return `${name}: ${resolveApiError({ errorCode: e.errorCode, errorParams: e.errorParams }, tr, e.errorCode)}`;
  }

  function contractLabel(endSeason: number | null): string {
    if (endSeason == null) return t("contracts.noContract");
    if (base.status === "ready" && endSeason < base.currentSeason) return t("squad.headers.contractExpired");
    return t("squad.headers.contractUntil", { season: endSeason });
  }

  function seasonsLabel(n: number, atMax: boolean): string {
    return atMax ? t("contracts.seasonsMax", { count: n }) : t("contracts.seasonsCount", { count: n });
  }

  const columns: DataTableColumn<ContractRow>[] = [
    {
      key: "name",
      header: t("squad.headers.rider"),
      sticky: true,
      sortKey: "name",
      render: (row) => {
        const selectable = row.maxSeasons > 0;
        return (
          <span className="inline-flex items-center gap-2 min-w-0">
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0 rounded-[3px] accent-cz-accent"
              checked={row.id in selection}
              disabled={!selectable}
              aria-label={t("contracts.selectRider", { name: row.name })}
              onClick={(e: MouseEvent) => e.stopPropagation()}
              onChange={() => toggle(row)}
            />
            <RiderLink id={row.id} stopPropagation className="text-cz-1 hover:text-cz-accent-t transition-colors">
              {row.name}
            </RiderLink>
          </span>
        );
      },
    },
    {
      key: "rating",
      header: t("squad.headers.rating"),
      sortKey: "ovr",
      numeric: true,
      compact: true,
      render: (row) => (row.ovr != null ? (
        <span className="inline-flex items-center justify-center min-w-[30px] px-1.5 py-0.5 rounded-cz font-semibold" style={statPlateStyle(row.ovr)}>
          {row.ovr}
        </span>
      ) : <span className="text-cz-3">-</span>),
    },
    {
      key: "potential",
      header: t("squad.headers.potential"),
      sortKey: "potential",
      compact: true,
      render: (row) => {
        const r = ridersById.get(row.id);
        return r ? <ScoutablePotentiale rider={r} scouting={scouting} labelAsTitle hideLevel /> : null;
      },
    },
    {
      key: "age",
      header: t("squad.headers.age"),
      sortKey: "age",
      numeric: true,
      compact: true,
      fold: true,
      foldValue: (row) => String(row.age ?? "-"),
      render: (row) => <span className="text-cz-2">{row.age ?? "-"}</span>,
    },
    {
      key: "contract",
      header: t("squad.headers.contract"),
      sortKey: "contract",
      compact: true,
      render: (row) => <span className="text-cz-2 whitespace-nowrap">{contractLabel(row.endSeason)}</span>,
    },
    {
      key: "seasons",
      header: t("contracts.headers.seasons"),
      compact: true,
      render: (row) => {
        if (!(row.id in selection) || row.maxSeasons <= 0) return <span className="text-cz-3">-</span>;
        const requested = requestedSeasons(selection, row.id, common);
        const granted = effectiveSeasons(requested, row.maxSeasons);
        const options = seasonOptions(row.maxSeasons);
        return (
          <span onClick={(e: MouseEvent) => e.stopPropagation()}>
            <Select
              size="sm"
              className="min-w-24"
              value={String(granted)}
              aria-label={t("contracts.seasonsFor", { name: row.name })}
              onChange={(e) => setOwnSeasons(row.id, Number(e.target.value))}
            >
              {options.map((o) => (
                <option key={o.value} value={String(o.value)}>{seasonsLabel(o.value, o.atMax)}</option>
              ))}
            </Select>
          </span>
        );
      },
    },
    {
      key: "salary",
      header: t("contracts.headers.salary"),
      mobileLabel: t("squad.headers.salary"),
      sortKey: "salary",
      numeric: true,
      compact: true,
      render: (row) => (
        <span className="inline-flex items-center justify-end gap-1 whitespace-nowrap">
          <span className="text-cz-2">{formatNumber(row.salary)}</span>
          {row.newSalary != null && (
            <>
              <ChevronRightIcon size={12} className="text-cz-3" aria-hidden="true" />
              <span className="text-cz-1">{formatNumber(row.newSalary)}</span>
            </>
          )}
        </span>
      ),
    },
    {
      key: "value",
      header: t("squad.headers.value"),
      sortKey: "value",
      numeric: true,
      compact: true,
      render: (row) => <span className="text-cz-2">{row.value != null ? formatNumber(row.value) : "-"}</span>,
    },
  ];

  if (base.status === "loading") {
    return (
      <div className="rounded-cz border border-cz-border bg-cz-card p-5" data-testid="contracts-loading">
        <SkeletonLines lines={5} />
      </div>
    );
  }
  if (base.status === "error") {
    return (
      <ErrorState
        title={t("contracts.loadErrorTitle")}
        description={t("contracts.loadErrorBody")}
        action={<Button variant="secondary" size="sm" iconLeft={<RefreshIcon size={14} aria-hidden="true" />} onClick={loadBase}>{t("contracts.retry")}</Button>}
      />
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<BriefcaseIcon size={26} aria-hidden="true" />}
        title={t("contracts.emptyTitle")}
        description={t("contracts.emptyBody")}
        action={<Link to="/riders" className={`${buttonClass({ variant: "secondary", size: "sm" })} inline-flex`}>{t("squad.emptyStateCta")}</Link>}
      />
    );
  }

  const summaryData = summary?.status === "ready" ? summary.data : null;
  const blocked = Boolean(summaryData && (summaryData.errors.length > 0 || summaryData.salaryCap?.withinCap === false));
  const signedDelta = `${totals.salaryDelta > 0 ? "+" : ""}${formatNumber(totals.salaryDelta)}`;

  return (
    <div data-testid="contracts-tab">
      <div className="flex flex-col gap-[14px]">
        {groups.map((group) => {
          const selectable = group.rows.filter((r) => r.maxSeasons > 0);
          const allChecked = selectable.length > 0 && selectable.every((r) => r.id in selection);
          const title = group.kind === "expiring"
            ? t("contracts.group.expiring")
            : group.kind === "atCap"
              ? t("contracts.group.atCap")
              : t("contracts.group.season", { season: group.season });
          return (
            <div key={group.key} className={group.kind === "atCap" ? "opacity-60" : undefined} data-testid={`contracts-group-${group.key}`}>
              <DataTable
                label={title}
                columns={columns}
                rows={group.rows}
                rowKey={(row) => row.id}
                dense
                mobileDefaults={["seasons", "salary", "rating"]}
                sort={sort.sort}
                sortDir={sort.dir}
                onSort={handleSort}
                rowProps={(row) => (row.maxSeasons > 0 ? { onClick: () => toggle(row), className: "cursor-pointer" } : {})}
                toolbar={
                  <label className="inline-flex items-center gap-2 text-sm font-semibold text-cz-1">
                    {group.kind !== "atCap" && (
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded-[3px] accent-cz-accent"
                        checked={allChecked}
                        onChange={(e) => toggleGroup(group, e.target.checked)}
                        aria-label={t("contracts.selectGroup", { group: title })}
                      />
                    )}
                    <span>{title}</span>
                    <span className="font-data text-2xs uppercase tracking-[.08em] text-cz-3 tabular-nums">{group.rows.length}</span>
                    {group.kind === "atCap" && <span className="text-xs font-normal text-cz-3">{t("contracts.group.atCapHint")}</span>}
                  </label>
                }
              />
            </div>
          );
        })}
      </div>

      {/* Bundlinjen: antal valgte + lønsum-ændring pr. sæson + fælles valg + ÉN gold primary. */}
      <div className="sticky bottom-20 md:bottom-2 z-sticky mt-4 flex flex-wrap items-center gap-3 rounded-cz border border-cz-border bg-cz-card px-4 py-3" data-testid="contracts-bar">
        <div className="w-full min-w-0 text-sm sm:w-auto sm:flex-1" role="status">
          {totals.count > 0 ? (
            <span className="text-cz-1">
              {t("contracts.bar.selected", { count: totals.count })}
              <span className="text-cz-3"> · </span>
              <span className="font-data tabular-nums">{t("contracts.bar.salaryDelta", { value: signedDelta })}</span>
            </span>
          ) : (
            <span className={notice ? "text-cz-success" : "text-cz-3"}>{notice ?? t("contracts.bar.none")}</span>
          )}
        </div>
        <span className="text-xs text-cz-3">{t("contracts.bar.seasonsLabel")}</span>
        <Segmented
          label={t("contracts.bar.seasonsLabel")}
          value={String(common)}
          onChange={changeCommon}
          options={SEASON_CHOICES.map((n) => ({ value: String(n), label: String(n) }))}
        />
        <Button size="sm" disabled={totals.count === 0} onClick={openSummary} data-testid="contracts-extend">
          {t("contracts.bar.extend", { count: totals.count })}
        </Button>
      </div>

      <Modal
        open={summary != null}
        onClose={() => { if (!saving) setSummary(null); }}
        title={t("contracts.summary.title")}
        titleId="contracts-summary-title"
        closeLabel={t("contracts.summary.cancel")}
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="sm" disabled={saving} onClick={() => setSummary(null)}>{t("contracts.summary.cancel")}</Button>
            <Button size="sm" loading={saving} disabled={!summaryData || blocked} onClick={confirmExtend} data-testid="contracts-confirm">
              {t("contracts.summary.confirm", { count: summaryData?.riders.length ?? totals.count })}
            </Button>
          </>
        }
      >
        {summary?.status === "loading" && <SkeletonLines lines={4} />}
        {summary?.status === "error" && (
          <div className="space-y-2" role="alert">
            <p className="text-cz-danger">{summary.message}</p>
            {summary.errors.length > 0 && (
              <ul className="list-disc ps-5 text-cz-2">
                {summary.errors.map((e) => <li key={e.riderId}>{errorLine(e)}</li>)}
              </ul>
            )}
          </div>
        )}
        {summaryData && (
          <div className="space-y-4">
            <table className="w-full border-collapse text-sm" data-testid="contracts-summary-table">
              <thead>
                <tr className="text-2xs uppercase tracking-[.06em] text-cz-3">
                  <th className="py-2 pe-3 text-start font-medium">{t("squad.headers.rider")}</th>
                  <th className="py-2 pe-3 text-start font-medium">{t("contracts.headers.seasons")}</th>
                  <th className="py-2 pe-3 text-start font-medium">{t("contracts.headers.newContract")}</th>
                  <th className="py-2 text-end font-medium">{t("contracts.headers.salary")}</th>
                </tr>
              </thead>
              <tbody>
                {summaryData.riders.map((q) => {
                  const who = ridersById.get(q.riderId);
                  return (
                    <tr key={q.riderId} className="border-t border-cz-border">
                      <td className="py-2 pe-3 text-cz-1">{who ? riderName(who) : q.riderId}</td>
                      <td className="py-2 pe-3 font-data tabular-nums text-cz-2">{seasonsLabel(q.grantedSeasons, q.capped)}</td>
                      <td className="py-2 pe-3 text-cz-2 whitespace-nowrap">{t("squad.headers.contractUntil", { season: q.newEndSeason })}</td>
                      <td className="py-2 text-end font-data tabular-nums whitespace-nowrap">
                        <span className="text-cz-2">{formatNumber(q.currentSalary)}</span>
                        <ChevronRightIcon size={12} className="mx-1 inline text-cz-3" aria-hidden="true" />
                        <span className="text-cz-1">{formatNumber(q.newSalary)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {summaryData.errors.length > 0 && (
              <ul className="list-disc ps-5 text-cz-danger" role="alert">
                {summaryData.errors.map((e) => <li key={e.riderId}>{errorLine(e)}</li>)}
              </ul>
            )}
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-cz-border pt-3">
              <dt className="text-cz-2">{t("contracts.summary.teamSalary")}</dt>
              <dd className="text-end font-data tabular-nums whitespace-nowrap">
                <span className="text-cz-2">{formatNumber(summaryData.totals.teamSalaryBefore)}</span>
                <ChevronRightIcon size={12} className="mx-1 inline text-cz-3" aria-hidden="true" />
                <span className="text-cz-1 font-semibold">{formatNumber(summaryData.totals.teamSalaryAfter)}</span>
              </dd>
              <dt className="text-cz-2">{t("contracts.summary.salaryCap")}</dt>
              <dd className={`text-end ${summaryData.salaryCap?.withinCap === false ? "text-cz-danger" : "text-cz-2"}`} data-testid="contracts-cap-status">
                {!summaryData.salaryCap?.active
                  ? t("contracts.summary.noCap")
                  : summaryData.salaryCap.withinCap
                    ? t("contracts.summary.withinCap")
                    : t("contracts.summary.overCap", { cap: formatNumber(summaryData.salaryCap.cap ?? 0) })}
              </dd>
            </dl>
          </div>
        )}
      </Modal>
    </div>
  );
}
