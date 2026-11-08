// Roadmap-hub, admin-fanen (#6151, spec §4): /admin/growth?tab=roadmap.
// Analysen og vedligeholdet bag /roadmap: nøgletal, planen som spillerne vil
// have den, idéer + idé-pulje, kendte fejl. Visuel reference: feltet "Bagved" i
// pr-screens/roadmap-4-10/roadmap-foer-efter.html.
//
// Data: roadmap_item_scores + known_issue_scores (security_invoker-views, kun
// admin ser de samlede tal), roadmap_admin_stats() (ét kald, ingen stemmerækker
// til klienten), roadmap_items (kontakt-felterne, som viewet ikke har) og de
// seneste known_issue_updates. Stadie-kontakterne kommer fra samme endpoint som
// FeatureFlagBoardSection.jsx. Efter hver skrivning genhentes alt.
//
// Filen er .jsx og ikke .tsx (hard rule 31): den typede Supabase-klient kender
// ikke spor 1's nye tabeller/kolonner (#6149) før typerne regenereres efter
// apply, og CI's typecheck mangler @types/react (som ui/Segmented.jsx). Al
// sortering og alle patches bor i lib/roadmapAdminModel.ts (typet + testet).
//
// Fanerne (#6204): Idéer, Planlagt, I gang, Færdigt, Kendte fejl, 2027 og
// Stemmer. Filtre (område, status, horisont, issue) og sortering på alle
// kolonner; udvælgelse, filtrering og sortering bor i roadmapAdminModel.ts.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { supabase } from "../../../lib/supabase";
import { apiFetch } from "../../../lib/apiFetch.ts";
import { useAdminAuth } from "../shared/useAdminAuth";
import {
  ADMIN_TABS, DEFAULT_ADMIN_TAB, DEFAULT_SORT, HORIZONS, HORIZON_LABELS, IDEA_TARGET, ISSUE_STATUSES,
  dontKnowTotal, fmtScore, filterIssueRows, filterItems, isAdminTab, isSplit, latestUpdateByIssue, mergeItemRows, movePatches,
  nextSort, nextSortOrder, ownOrder, sortRows, statusPatch, tabCounts, tabRows, visibleIdeaCount, ROADMAP_STATUSES,
} from "../../../lib/roadmapAdminModel.ts";
import {
  AREA_LABELS, FLAG_STAGE_LABELS, ISSUE_STATUS_LABELS, STATUS_LABELS,
  IssueFormModal, IssueUpdateModal, ItemFormModal, SplitItemModal,
} from "./RoadmapAdminForms.jsx";
import {
  Button, DataTable, ErrorState, HeroStats, Input, Section, SectionHeader, SectionStack, Select, SkeletonLines,
  StatusBadge, Tab, TabList, TabPanel, Tabs,
  ArrowDownIcon, ArrowUpIcon, PlusIcon, RefreshIcon,
} from "../../ui";

const API = import.meta.env.VITE_API_URL;
const UNBOUNDED = "[&>div>div]:max-h-none";

const nowIso = () => new Date().toISOString();
const fmtInt = (n) => (n === null || n === undefined ? "–" : Number(n).toLocaleString("da-DK"));
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("da-DK", { day: "numeric", month: "short" }) : "");

// Neutralt mærke (samme anatomi som StatusBadge, uden tone): "Skjult", "Later", "Tjekkes".
function Tag({ children }) {
  return (
    <span className="inline-flex items-center rounded-cz border border-cz-border px-1.5 py-px font-data text-3xs font-semibold uppercase tracking-[.08em] text-cz-3">
      {children}
    </span>
  );
}

function IssueStepBadge({ status }) {
  if (status === "fixing") return <StatusBadge state="info">{ISSUE_STATUS_LABELS.fixing}</StatusBadge>;
  if (status === "confirmed") return <StatusBadge state="closing">{ISSUE_STATUS_LABELS.confirmed}</StatusBadge>;
  if (status === "fixed") return <StatusBadge state="won">{ISSUE_STATUS_LABELS.fixed}</StatusBadge>;
  return <Tag>{ISSUE_STATUS_LABELS[status] ?? status}</Tag>;
}

// Handlingerne ombrydes aldrig (rækkerne blev ellers dobbelt så høje), så
// kolonnerne omkring dem skal holde sig smalle: ved 1440 px med sidebar er der
// ca. 1120 px til hele tabellen. Derfor er horisont og status vælgeren i sin egen
// kolonne, ikke et mærke plus en vælger, og alle kolonner uden titlen er `compact`.
function Actions({ children }) {
  return <div className="flex flex-nowrap items-center justify-end gap-1.5 whitespace-nowrap">{children}</div>;
}

// Tal og datoer i tal-kolonner ombrydes aldrig ("11 dage" på to linjer).
function Num({ children }) {
  return <span className="whitespace-nowrap tabular-nums">{children}</span>;
}

// Kontakt-nøglen er den længste tekst uden mellemrum. Den må bryde efter "_", så
// kolonnen har en fast bredde i stedet for at tage plads fra titlen.
function flagKeyParts(key) {
  const parts = key.split("_");
  return parts.flatMap((part, i) => (i === parts.length - 1 ? [part] : [`${part}_`, <wbr key={i} />]));
}

function RowButton({ children, ...rest }) {
  return <Button variant="secondary" size="sm" type="button" {...rest}>{children}</Button>;
}

// `whitespace-normal`: DataTable's navnecelle er nowrap på desktop, så den
// længste titel satte tabellens bredde og skubbede handlingerne ud over kortet.
// Titlen er den, der må ombryde; handlingerne og tallene gør aldrig.
function TitleCell({ title, children }) {
  return (
    <div className="min-w-0 whitespace-normal">
      <div className="text-cz-1">{title}</div>
      {children && <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-3xs uppercase tracking-[.06em] text-cz-3">{children}</div>}
    </div>
  );
}

function TableSkeleton() {
  return <div className="py-2"><SkeletonLines lines={4} /></div>;
}

export default function GrowthRoadmapTab() {
  const { getAuth } = useAdminAuth();
  const [stats, setStats] = useState(null);
  const [rows, setRows] = useState([]);
  const [issues, setIssues] = useState([]);
  const [updates, setUpdates] = useState([]);
  const [flags, setFlags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(null);
  // { kind: "item" | "split" | "issue" | "update", row, focus? }
  const [modal, setModal] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [statsRes, scoresRes, itemsRes, issuesRes, updatesRes] = await Promise.all([
        apiFetch(`${API}/api/admin/roadmap/stats`, { headers: await getAuth() }, { source: "admin-roadmap-stats" }),
        supabase.from("roadmap_item_scores").select("*"),
        supabase.from("roadmap_items")
          .select("id, flag_key, beta_since, beta_soon, live_soon, created_at, updated_at, shipped_at"),
        supabase.from("known_issue_scores").select("*"),
        supabase.from("known_issue_updates").select("issue_id, body_da, created_at")
          .order("created_at", { ascending: false }).limit(500),
      ]);
      if (!statsRes.ok) throw new Error(statsRes.data?.error || "Forbindelsen fejlede");
      const failed = [scoresRes, itemsRes, issuesRes, updatesRes].find((r) => r.error);
      if (failed) throw new Error(failed.error.message);
      setStats(statsRes.data?.stats ?? null);
      setRows(mergeItemRows(scoresRes.data ?? [], itemsRes.data ?? []));
      setIssues(issuesRes.data ?? []);
      setUpdates(updatesRes.data ?? []);
    } catch (e) {
      setLoadError(e.message || "Forbindelsen fejlede");
    } finally {
      setLoading(false);
    }
    // Kontakterne er en bonus til Kontakt-kolonnen og formularen; fejler de,
    // virker resten af fanen stadig.
    try {
      const res = await apiFetch(`${API}/api/admin/feature-flags`, { headers: await getAuth() }, { source: "admin-roadmap-flags" });
      if (res.ok) setFlags(res.data?.flags ?? []);
    } catch { /* ignoreret, se ovenfor */ }
  }, [getAuth]);

  useEffect(() => { load(); }, [load]);

  // Én skrivning ad gangen; fejl vises over tabellerne, succes genhenter alt.
  async function run(key, fn) {
    setBusy(key);
    setActionError("");
    try {
      const results = await fn();
      const failed = (Array.isArray(results) ? results : [results]).find((r) => r?.error);
      if (failed) throw new Error(failed.error.message);
      await load();
    } catch (e) {
      setActionError(`Kunne ikke gemme: ${e.message || "ukendt fejl"}`);
    } finally {
      setBusy(null);
    }
  }

  const updateItem = (id, patch) => supabase.from("roadmap_items").update({ ...patch, updated_at: nowIso() }).eq("id", id);

  const order = useMemo(() => ownOrder(rows), [rows]);
  const latest = useMemo(() => latestUpdateByIssue(updates), [updates]);
  const flagByKey = useMemo(() => new Map(flags.map((f) => [f.key, f])), [flags]);
  const plannedRows = useMemo(() => rows.filter((r) => r.status === "planned"), [rows]);
  const counts = useMemo(() => tabCounts(rows, issues), [rows, issues]);

  // Fanen og sorteringen er pr. fane; filtrene nulstilles ved fanevalg, fordi
  // en status eller horisont fra en anden fane kan give en tom tabel.
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get("view");
  const tab = isAdminTab(view) ? view : DEFAULT_ADMIN_TAB;
  const [sorts, setSorts] = useState({});
  const [filters, setFilters] = useState({ area: "", status: "", horizon: "", issue: "" });
  const sort = sorts[tab] ?? DEFAULT_SORT[tab];
  const onSort = (key) => setSorts((prev) => ({ ...prev, [tab]: nextSort(prev[tab] ?? DEFAULT_SORT[tab], key) }));
  const setTab = (next) => {
    setFilters({ area: "", status: "", horizon: "", issue: "" });
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set("view", next);
      return p;
    }, { replace: true });
  };
  const setFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));
  const filtersActive = Object.values(filters).some((v) => v.trim() !== "");

  const isIssues = tab === "issues";
  const visibleRows = useMemo(() => {
    if (isIssues) {
      // Uden trin-filter vises kun de åbne fejl; vælger man Rettet eller
      // Lukket uden fund, vises de lukkede.
      const base = filters.status ? issues : issues.filter((r) => !["fixed", "dismissed"].includes(r.status));
      return sortRows(filterIssueRows(base, filters), sort);
    }
    return sortRows(filterItems(tabRows(rows, tab), filters), sort);
  }, [isIssues, issues, rows, tab, filters, sort]);

  const closeModal = () => setModal(null);
  const savedModal = () => { setModal(null); load(); };

  const statusSelect = (row) => (
    <Select
      size="sm"
      aria-label={`Status for ${row.title_da || row.title_en}`}
      value={row.status}
      disabled={busy !== null}
      onChange={(e) => run(`status-${row.item_id}`, () => updateItem(row.item_id, statusPatch(e.target.value, nowIso())))}
    >
      {ROADMAP_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
    </Select>
  );

  const horizonSelect = (row) => (
    <Select
      size="sm"
      aria-label={`Horisont for ${row.title_da || row.title_en}`}
      value={row.horizon ?? "unscheduled"}
      disabled={busy !== null}
      onChange={(e) => run(`hz-${row.item_id}`, () => updateItem(row.item_id, { horizon: e.target.value }))}
    >
      {HORIZONS.map((h) => <option key={h} value={h}>{HORIZON_LABELS[h]}</option>)}
    </Select>
  );

  const flagCell = (row) => {
    if (!row.flag_key) return <span className="text-cz-3">–</span>;
    const stage = flagByKey.get(row.flag_key)?.stage;
    return (
      <span className="block w-[96px] whitespace-normal font-data text-xs text-cz-2">
        {flagKeyParts(row.flag_key)}{stage ? ` · ${FLAG_STAGE_LABELS[stage] ?? stage}` : ""}
      </span>
    );
  };

  const itemTags = (row) => (
    <>
      <span>{AREA_LABELS[row.engine] ?? row.engine}</span>
      {row.approved === false && <Tag>Skjult</Tag>}
      {row.beta_soon && <Tag>Næste i beta</Tag>}
      {row.live_soon && <Tag>Snart for alle</Tag>}
      {row.issue_ref ? <span className="font-data">#{row.issue_ref}</span> : null}
    </>
  );

  const move = (r, dir) => run(`${dir < 0 ? "up" : "down"}-${r.item_id}`, () => Promise.all(movePatches(plannedRows, r.item_id, dir)
    .map((p) => updateItem(p.item_id, { sort_order: p.sort_order }))));

  // Kolonne-ordbog: hver fane sætter sine kolonner sammen af de samme dele, så
  // overskrifter, tal og sorteringsnøgler er ens på tværs af fanerne.
  const col = {
    rank: { key: "rank", header: "", compact: true, render: (_r, i) => <span className="font-data tabular-nums text-cz-3">{i + 1}</span> },
    title: (header, extra) => ({
      key: "title", header, sortKey: "title", sticky: true, compact: true,
      render: (r) => (
        <TitleCell title={r.title_da || r.title_en}>
          {itemTags(r)}
          {extra && isSplit(r.sd_importance) && <StatusBadge state="closing">Deler spillerne</StatusBadge>}
        </TitleCell>
      ),
    }),
    status: { key: "status", header: "Status", sortKey: "status", compact: true, render: (r) => <Tag>{STATUS_LABELS[r.status] ?? r.status}</Tag> },
    horizon: {
      key: "horizon", header: "Horisont", sortKey: "horizon", compact: true,
      render: (r) => <Tag>{HORIZON_LABELS[r.horizon] ?? r.horizon ?? "–"}</Tag>,
    },
    // Samme kolonner som vælgere, på de faner hvor man retter dem. `fold`: en
    // vælger er for bred til 390 px, så på mobil står værdien i navnecellens
    // underlinje og titlen beholder pladsen.
    statusEdit: {
      key: "status", header: "Status", sortKey: "status", compact: true, fold: true,
      foldValue: (r) => STATUS_LABELS[r.status] ?? r.status,
      render: (r) => <div className="w-[104px]">{statusSelect(r)}</div>,
    },
    horizonEdit: {
      key: "horizon", header: "Horisont", sortKey: "horizon", compact: true, fold: true,
      foldValue: (r) => HORIZON_LABELS[r.horizon] ?? r.horizon ?? "",
      render: (r) => <div className="w-[128px]">{horizonSelect(r)}</div>,
    },
    idea: { key: "idea", header: "God idé", sortKey: "idea", numeric: true, compact: true, render: (r) => <Num>{fmtScore(r.avg_idea)}</Num> },
    importance: { key: "importance", header: "Vigtighed", mobileHeader: "Vigt.", sortKey: "importance", numeric: true, compact: true, render: (r) => <Num>{fmtScore(r.avg_importance)}</Num> },
    score: { key: "score", header: "Score", sortKey: "score", numeric: true, compact: true, render: (r) => <Num>{fmtScore(r.steering_score, 1)}</Num> },
    votes: { key: "votes", header: "Stemmer", sortKey: "votes", numeric: true, compact: true, render: (r) => <Num>{fmtInt(r.votes)}</Num> },
    dontKnow: { key: "dontKnow", header: "Ved ikke", sortKey: "dontKnow", numeric: true, compact: true, render: (r) => <Num>{fmtInt(r.dont_know)}</Num> },
    own: {
      key: "own", header: "Din rækkefølge", mobileHeader: "Din", sortKey: "own", numeric: true, compact: true,
      render: (r) => {
        const pos = order.get(r.item_id) ?? 0;
        if (r.status !== "planned") return <span className="text-cz-3">–</span>;
        // Pilene står ved nummeret, de flytter: det holder handlingskolonnen
        // smal. På mobil står de over hinanden; side om side tog de 116 px af
        // 326 px og knuste titlen til et par tegn pr. linje.
        return (
          <div className="flex flex-nowrap items-center justify-end gap-1.5">
            <Num>{pos || "–"}</Num>
            <div className="flex flex-col gap-1 sm:flex-row sm:gap-1.5">
              <RowButton aria-label="Flyt op" disabled={busy !== null || pos <= 1} onClick={() => move(r, -1)}>
                <ArrowUpIcon size={14} aria-hidden="true" />
              </RowButton>
              <RowButton aria-label="Flyt ned" disabled={busy !== null || pos >= plannedRows.length} onClick={() => move(r, 1)}>
                <ArrowDownIcon size={14} aria-hidden="true" />
              </RowButton>
            </div>
          </div>
        );
      },
    },
    flag: { key: "flag", header: "Kontakt", sortKey: "flag", compact: true, fold: true, foldValue: (r) => (r.flag_key ? flagKeyParts(r.flag_key) : ""), render: flagCell },
    beta: {
      key: "beta", header: "I beta siden", sortKey: "beta", numeric: true, compact: true,
      render: (r) => (r.beta_since ? <Num>{fmtDate(r.beta_since)}</Num> : <span className="text-cz-3">–</span>),
    },
    date: {
      key: "date", header: "Dato", sortKey: "date", numeric: true, compact: true,
      render: (r) => {
        const d = r.shipped_at ?? r.updated_at ?? r.created_at;
        return d ? <Num>{fmtDate(d)}</Num> : <span className="text-cz-3">–</span>;
      },
    },
    issue: {
      key: "issue", header: "Issue", sortKey: "issue", numeric: true, compact: true,
      render: (r) => (r.issue_ref ? <Num>#{r.issue_ref}</Num> : <span className="text-cz-3">–</span>),
    },
    actions: (render) => ({ key: "actions", header: "", compact: true, fold: true, foldValue: () => "", render: (r) => <Actions>{render(r)}</Actions> }),
  };

  const editSplit = (r) => (
    <>
      <RowButton onClick={() => setModal({ kind: "item", row: r })}>Ret</RowButton>
      <RowButton onClick={() => setModal({ kind: "split", row: r })}>Del</RowButton>
    </>
  );

  const ideaActions = col.actions((r) => (
    <>
      <RowButton disabled={busy !== null}
        onClick={() => run(`plan-${r.item_id}`, () => updateItem(r.item_id,
          { status: "planned", horizon: "next_week", sort_order: nextSortOrder(plannedRows) }))}>
        Til planen
      </RowButton>
      {r.approved === false ? (
        <RowButton disabled={busy !== null} onClick={() => run(`show-${r.item_id}`, () => updateItem(r.item_id, { approved: true }))}>
          Vis på Vote
        </RowButton>
      ) : (
        <RowButton disabled={busy !== null} onClick={() => run(`hide-${r.item_id}`, () => updateItem(r.item_id, { approved: false }))}>
          Tag af Vote
        </RowButton>
      )}
      {editSplit(r)}
    </>
  ));

  const statusActions = col.actions((r) => (
    <>
      <div className="w-[104px]">{statusSelect(r)}</div>
      {editSplit(r)}
    </>
  ));

  const horizonActions = col.actions((r) => (
    <>
      <div className="w-[128px]">{horizonSelect(r)}</div>
      {editSplit(r)}
    </>
  ));

  const itemColumnsByTab = {
    ideas: [col.rank, col.title("Idé"), col.horizon, col.idea, col.importance, col.score, col.votes, col.dontKnow, col.issue, ideaActions],
    planned: [col.rank, col.title("Punkt", true), col.horizonEdit, col.importance, col.votes, col.dontKnow, col.own, col.flag, statusActions],
    in_progress: [col.title("Punkt"), col.horizonEdit, col.votes, col.beta, col.flag, statusActions],
    shipped: [col.title("Punkt"), col.date, col.importance, col.votes, col.flag,
      col.actions((r) => (
        <>
          <div className="w-[104px]">{statusSelect(r)}</div>
          <RowButton onClick={() => setModal({ kind: "item", row: r })}>Ret</RowButton>
        </>
      ))],
    y2027: [col.rank, col.title("Punkt", true), col.statusEdit, col.importance, col.votes, col.dontKnow, col.own, col.flag, horizonActions],
    votes: [col.rank, col.title("Punkt"), col.status, col.horizon, col.votes, col.dontKnow, col.idea, col.importance, col.score,
      col.actions((r) => <RowButton onClick={() => setModal({ kind: "item", row: r })}>Ret</RowButton>)],
  };

  const issueColumns = [
    col.rank,
    {
      key: "title", header: "Fejl", sortKey: "title", sticky: true, compact: true,
      render: (r) => {
        const last = latest.get(r.issue_id);
        return (
          <TitleCell title={r.title_da || r.title_en}>
            <span>{AREA_LABELS[r.area] ?? r.area}</span>
            {r.published === false && <Tag>Skjult</Tag>}
            {r.issue_ref ? <span className="font-data">#{r.issue_ref}</span> : null}
            {last && <span className="normal-case tracking-normal">Opdateret {fmtDate(last.created_at)}</span>}
          </TitleCell>
        );
      },
    },
    { key: "step", header: "Trin", sortKey: "status", render: (r) => <IssueStepBadge status={r.status} /> },
    { key: "reports", header: "Ramt", sortKey: "reports", numeric: true, render: (r) => <Num>{fmtInt(r.reports)}</Num> },
    { key: "days", header: "Åben i", sortKey: "days", numeric: true, render: (r) => <Num>{fmtInt(r.days_open)} dage</Num> },
    col.actions((r) => (
      <>
        <RowButton onClick={() => setModal({ kind: "update", row: r, focus: "update" })}>Ny opdatering</RowButton>
        <RowButton onClick={() => setModal({ kind: "update", row: r, focus: "step" })}>Trin</RowButton>
        <RowButton onClick={() => setModal({ kind: "issue", row: r })}>Ret</RowButton>
      </>
    )),
  ];

  const MOBILE_DEFAULTS = {
    ideas: ["idea", "importance", "score"],
    planned: ["importance", "votes", "own"],
    in_progress: ["beta", "votes"],
    shipped: ["date", "votes"],
    issues: ["step", "reports", "days"],
    y2027: ["importance", "votes", "own"],
    votes: ["votes", "importance"],
  };
  const EMPTY = {
    ideas: "Ingen idéer matcher.",
    planned: "Ingen planlagte punkter matcher.",
    in_progress: "Intet er i gang lige nu.",
    shipped: "Intet færdigt matcher.",
    issues: "Ingen kendte fejl matcher.",
    y2027: "Intet er sat til 2027 endnu.",
    votes: "Ingen punkter med stemmer matcher.",
  };
  const META = {
    ideas: `Synlige idéer: ${visibleIdeaCount(rows)} (mål ca. ${IDEA_TARGET})`,
    planned: "Vigtighed 1-6",
    in_progress: `${counts.in_progress} punkter`,
    shipped: `${counts.shipped} punkter`,
    issues: "Flest ramte først",
    y2027: `${counts.y2027} punkter`,
    votes: "Flest stemmer først",
  };
  const activeLabel = ADMIN_TABS.find((t) => t.key === tab)?.label ?? "";

  const statItems = [
    { label: "Har stemt", value: fmtInt(stats?.voters), sub: stats ? `af ${fmtInt(stats.managed_teams)} hold` : undefined },
    { label: "Aktive 14 dage", value: fmtInt(stats?.voters_14d) },
    { label: "Stemmer i alt", value: fmtInt(stats?.votes_total), sub: stats ? `${fmtInt(dontKnowTotal(rows))} Ved ikke` : undefined },
    { label: "Har svaret på alt", value: fmtInt(stats?.voted_all) },
  ];

  // Status-filteret findes kun hvor fanen ikke allerede er afgrænset til én
  // status: Stemmer og 2027 (alle statusser) og Kendte fejl (trin).
  const statusOptions = isIssues
    ? ISSUE_STATUSES.map((s) => [s, ISSUE_STATUS_LABELS[s]])
    : tab === "votes" || tab === "y2027" ? ROADMAP_STATUSES.map((s) => [s, STATUS_LABELS[s]]) : null;

  // DataTable's SCROLLER lægger på desktop et loft på 100dvh - 240px med egen
  // lodret scroll (#4747), så lange lister blev skåret midt i en række. Her
  // scroller SIDEN, aldrig tabellen. `[&>div>div]` rammer SCROLLER-div'en
  // (className > WRAP > SCROLLER) og vinder på specificitet over
  // media-query-loftet; vandret scroll er uændret.
  const table = loading ? <TableSkeleton /> : (
    <DataTable
      rowKey={(r) => r.item_id ?? r.issue_id}
      className={UNBOUNDED}
      label={activeLabel}
      columns={isIssues ? issueColumns : itemColumnsByTab[tab]}
      rows={visibleRows}
      sort={sort.key}
      sortDir={sort.dir}
      onSort={onSort}
      mobileDefaults={MOBILE_DEFAULTS[tab]}
      empty={filtersActive ? "Ingen rækker matcher filtrene." : EMPTY[tab]}
    />
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-cz-3 text-sm">
          Analyse og vedligehold bag /roadmap. Skjulte rækker ser kun du. Refs #6151.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" iconLeft={<PlusIcon size={14} aria-hidden="true" />}
            onClick={() => setModal({ kind: "item", row: null })}>
            Nyt punkt
          </Button>
          <Button variant="secondary" size="sm" iconLeft={<PlusIcon size={14} aria-hidden="true" />}
            onClick={() => setModal({ kind: "issue", row: null })}>
            Ny fejl
          </Button>
          <Button variant="secondary" size="sm" loading={loading} onClick={load}
            iconLeft={<RefreshIcon size={14} aria-hidden="true" />}>
            Genindlæs
          </Button>
        </div>
      </div>

      {loadError && (
        <ErrorState
          title="Kunne ikke hente roadmap-data"
          description={`Intet er ændret. ${loadError}`}
          action={<Button variant="secondary" size="sm" onClick={load}>Prøv igen</Button>}
        />
      )}
      <p aria-live="polite" className="text-xs text-cz-danger empty:hidden">{actionError}</p>

      {!loadError && (
        <SectionStack>
          <Section>
            <HeroStats items={statItems} className="mt-0 border-t-0 pt-0" />
          </Section>

          <Section>
            <Tabs value={tab} onChange={setTab}>
              <TabList label="Roadmap-faner">
                {ADMIN_TABS.map((t) => (
                  <Tab key={t.key} value={t.key}>
                    {t.label} <span className="ms-1 font-data text-xs tabular-nums text-cz-3">{loading ? "" : counts[t.key]}</span>
                  </Tab>
                ))}
              </TabList>
              {ADMIN_TABS.map((t) => (
                <TabPanel key={t.key} value={t.key} className="space-y-3 pt-4">
                  <SectionHeader title={t.label} meta={META[t.key]} />
                  <div className="flex flex-wrap items-end gap-2" role="group" aria-label="Filtre">
                    <Select size="sm" aria-label="Filtrer på område" value={filters.area} onChange={(e) => setFilter("area", e.target.value)}>
                      <option value="">Alle områder</option>
                      {Object.entries(AREA_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                    {statusOptions && (
                      <Select size="sm" aria-label="Filtrer på status" value={filters.status} onChange={(e) => setFilter("status", e.target.value)}>
                        <option value="">{isIssues ? "Alle åbne trin" : "Alle statusser"}</option>
                        {statusOptions.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </Select>
                    )}
                    {!isIssues && (
                      <Select size="sm" aria-label="Filtrer på horisont" value={filters.horizon} onChange={(e) => setFilter("horizon", e.target.value)}>
                        <option value="">Alle horisonter</option>
                        {HORIZONS.map((h) => <option key={h} value={h}>{HORIZON_LABELS[h]}</option>)}
                      </Select>
                    )}
                    <div className="w-[120px]">
                      <Input size="sm" inputMode="numeric" aria-label="Filtrer på issue-nummer" placeholder="Issue #"
                        value={filters.issue} onChange={(e) => setFilter("issue", e.target.value)} />
                    </div>
                    {filtersActive && (
                      <Button variant="secondary" size="sm" type="button"
                        onClick={() => setFilters({ area: "", status: "", horizon: "", issue: "" })}>
                        Nulstil filtre
                      </Button>
                    )}
                  </div>
                  {t.key === tab && table}
                </TabPanel>
              ))}
            </Tabs>
          </Section>
        </SectionStack>
      )}

      <ItemFormModal
        open={modal?.kind === "item"}
        item={modal?.kind === "item" ? modal.row : null}
        flags={flags}
        planned={plannedRows}
        onClose={closeModal}
        onSaved={savedModal}
      />
      <SplitItemModal open={modal?.kind === "split"} item={modal?.kind === "split" ? modal.row : null}
        onClose={closeModal} onSaved={savedModal} />
      <IssueFormModal open={modal?.kind === "issue"} issue={modal?.kind === "issue" ? modal.row : null}
        onClose={closeModal} onSaved={savedModal} />
      <IssueUpdateModal open={modal?.kind === "update"} issue={modal?.kind === "update" ? modal.row : null}
        focus={modal?.focus} onClose={closeModal} onSaved={savedModal} />
    </div>
  );
}
