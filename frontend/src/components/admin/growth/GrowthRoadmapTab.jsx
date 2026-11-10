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
//
// Grafen (#7789) står mellem nøgletallene og fanerne: vigtighed (vandret) mod idé-score (lodret),
// boble efter antal stemmere, pr. punkt eller kategori, med filter på aktive
// managere og division. Horisonten flyttes med ét klik fra panelet ved grafen.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { supabase } from "../../../lib/supabase";
import { apiFetch } from "../../../lib/apiFetch.ts";
import { useAdminAuth } from "../shared/useAdminAuth";
import {
  ADMIN_TABS, DEFAULT_ADMIN_TAB, DEFAULT_SORT, HORIZONS, HORIZON_LABELS, IDEA_TARGET, ISSUE_STATUSES,
  dontKnowTotal, fmtScore, filterIssueRows, filterItems, isAdminTab, isSplit, latestUpdateByIssue, mergeItemRows, movePatches,
  nextSort, nextSortOrder, ownOrder, patchRows, sortRows, statusPatch, tabCounts, tabRows, visibleIdeaCount, ROADMAP_STATUSES,
  CHART_SCOPES, UNKNOWN_DIVISION, categoryPoints, chartRows, filterVotes, itemPoints, mergeCategories, parseVotePayload,
  plottable, voterDivisions, votesForItems, distinctVoters, categoryOf, categoryLabel, isCategoryKey, totalScore,
} from "../../../lib/roadmapAdminModel.ts";
import RoadmapAdminChart from "./RoadmapAdminChart.tsx";
import {
  AREA_LABELS, FLAG_STAGE_LABELS, ISSUE_STATUS_LABELS, STATUS_LABELS,
  IssueFormModal, IssueUpdateModal, ItemFormModal, SplitItemModal,
} from "./RoadmapAdminForms.jsx";
import {
  Button, DataTable, ErrorState, HeroStats, Input, Section, SectionHeader, SectionStack, Segmented, Select, SkeletonLines,
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

// ── Grafen (#7789) ──────────────────────────────────────────────────────────
// Som spørgeskema-panelets idé-kvadrant: vigtighed (vandret) mod idé-score (lodret), boble efter
// antal stemmere, pr. punkt eller pr. kategori. Filtrene på aktive managere og
// division regnes på stemme-rækkerne (lib/roadmapAdminModel.ts). Vælg en boble
// for tallene og for at flytte horisonten med ét klik.
const CHART_VIEWS = [{ value: "items", label: "Punkter" }, { value: "categories", label: "Kategorier" }];
const EMPTY_CHART_FILTERS = { scope: "open", activeOnly: false, division: "", category: "" };
const divisionLabel = (d) => (d === UNKNOWN_DIVISION ? "Uden hold" : `Division ${d}`);

function ChartStat({ label, value }) {
  return (
    <div>
      <dt className="text-3xs uppercase tracking-[.08em] text-cz-3">{label}</dt>
      <dd className="mt-0.5 font-data text-sm font-semibold tabular-nums text-cz-1">{value}</dd>
    </div>
  );
}

function PointStats({ point, votersLabel = "Stemmere" }) {
  return (
    <dl className="grid grid-cols-3 gap-x-4 gap-y-3">
      <ChartStat label="Vigtighed" value={fmtScore(point.y)} />
      <ChartStat label="God idé" value={fmtScore(point.x)} />
      <ChartStat label={votersLabel} value={fmtInt(point.voters)} />
      <ChartStat label="Ved ikke" value={fmtInt(point.dontKnow)} />
      <ChartStat label="Uenighed" value={fmtScore(point.sd)} />
      {point.items !== undefined && <ChartStat label="Punkter" value={fmtInt(point.items)} />}
    </dl>
  );
}

function RoadmapChartSection({ rows, votePayload, loading, busy, onMoveHorizon, onToPlan, onEdit }) {
  const [view, setView] = useState("items");
  const [f, setF] = useState(EMPTY_CHART_FILTERS);
  const [selected, setSelected] = useState(/** @type {string | null} */ (null));
  const setFilter = (key, value) => { setF((prev) => ({ ...prev, [key]: value })); setSelected(null); };
  const canSegment = votePayload !== null;

  const divisions = useMemo(() => voterDivisions(votePayload), [votePayload]);
  const votes = useMemo(
    () => (votePayload ? filterVotes(votePayload, { activeOnly: f.activeOnly, division: f.division }) : null),
    [votePayload, f.activeOnly, f.division],
  );
  const scopeRows = useMemo(() => chartRows(rows, f.scope), [rows, f.scope]);
  const points = useMemo(() => {
    if (view === "categories") return categoryPoints(scopeRows, votes);
    const all = itemPoints(scopeRows, votes);
    return f.category ? all.filter((p) => p.category === f.category) : all;
  }, [view, scopeRows, votes, f.category]);
  const shown = useMemo(() => plottable(points), [points]);
  const hidden = points.length - shown.length;
  // Kun stemmer på de punkter, grafen viser (scope og kategori), tæller med.
  const shownItemIds = useMemo(() => {
    const inView = view === "categories" || !f.category
      ? scopeRows
      : scopeRows.filter((r) => categoryOf(r) === f.category);
    return inView.map((r) => r.item_id);
  }, [view, scopeRows, f.category]);
  const voterCount = votes ? distinctVoters(votesForItems(votes, shownItemIds)) : null;
  const point = shown.find((p) => p.key === selected) ?? null;
  const filtersActive = f.scope !== EMPTY_CHART_FILTERS.scope || f.activeOnly || f.division !== "" || f.category !== "";

  const switchView = (next) => { setView(next); setSelected(null); if (next === "categories") setF((prev) => ({ ...prev, category: "" })); };
  const showCategory = (category) => { setView("items"); setF((prev) => ({ ...prev, category })); setSelected(null); };

  const unit = view === "categories" ? "kategorier" : "punkter";
  const meta = loading ? "" : [
    `${fmtInt(shown.length)} ${unit}`,
    voterCount !== null ? `${fmtInt(voterCount)} stemmere` : null,
  ].filter(Boolean).join(" · ");

  // Kategorierne nummereres efter vigtighed; nummeret står i boblen og i listen.
  const ranked = useMemo(
    () => (view === "categories" ? [...shown].sort((a, b) => (b.y ?? 0) - (a.y ?? 0) || a.key.localeCompare(b.key, "da")) : []),
    [view, shown],
  );
  const labels = useMemo(() => new Map(ranked.map((p, i) => [p.key, String(i + 1)])), [ranked]);

  const row = point?.item;
  const panel = !point ? (
    view === "categories" && ranked.length > 0 ? (
      <ol className="divide-y divide-cz-border" aria-label="Kategorier efter vigtighed">
        {ranked.map((p, i) => (
          <li key={p.key}>
            <button type="button" onClick={() => setSelected(p.key)}
              className="flex w-full items-baseline gap-3 py-2 text-left hover:text-cz-1">
              <span className="w-4 shrink-0 font-data text-2xs tabular-nums text-cz-3">{i + 1}</span>
              <span className="min-w-0 grow text-sm text-cz-1">{p.label}</span>
              <span className="shrink-0 font-data text-xs tabular-nums text-cz-2">
                {fmtScore(p.y)} / {fmtScore(p.x)} · {fmtInt(p.voters)}
              </span>
            </button>
          </li>
        ))}
        {/* Uden stemme-rækker lægges punkternes stemmer sammen, så samme manager kan tælle flere gange. */}
        <li className="pt-2 text-2xs text-cz-3">
          Vigtighed / god idé · {canSegment ? "stemmere" : "stemmer"}. Vælg en kategori for detaljer.
        </li>
      </ol>
    ) : (
      <p className="text-sm text-cz-3">Vælg en boble for at se tallene og flytte horisonten.</p>
    )
  ) : (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-cz-1">{point.label}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-3xs uppercase tracking-[.06em] text-cz-3">
          {row ? (
            <>
              <span>{point.category}</span>
              <Tag>{STATUS_LABELS[row.status] ?? row.status}</Tag>
              {row.issue_ref ? <span className="font-data">#{row.issue_ref}</span> : null}
            </>
          ) : <span>Kategori</span>}
          {point.split && <StatusBadge state="closing">Deler spillerne</StatusBadge>}
        </div>
      </div>
      <PointStats point={point} votersLabel={!canSegment && !point.item ? "Stemmer" : "Stemmere"} />
      {row ? (
        <div className="space-y-2">
          <p className="text-3xs uppercase tracking-[.08em] text-cz-3">Flyt horisont</p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Horisont for ${point.label}`}>
            {HORIZONS.map((h) => {
              const current = (row.horizon ?? "unscheduled") === h;
              return (
                <Button key={h} variant="secondary" size="sm" type="button" aria-pressed={current}
                  className={current ? "border-cz-accent text-cz-accent-t" : ""}
                  disabled={busy !== null || current}
                  onClick={() => onMoveHorizon(row, h)}>
                  {HORIZON_LABELS[h]}
                </Button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {row.status === "active" && (
              <Button variant="secondary" size="sm" type="button" disabled={busy !== null} onClick={() => onToPlan(row)}>
                Til planen
              </Button>
            )}
            <Button variant="secondary" size="sm" type="button" onClick={() => onEdit(row)}>Ret punkt og kategori</Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" size="sm" type="button" onClick={() => showCategory(point.key)}>
          Vis punkterne i {point.label}
        </Button>
      )}
    </div>
  );

  return (
    <Section>
      <SectionHeader title="Vigtighed mod idé" meta={/** @type {any} */ (meta)} />
      <div className="mb-4 flex flex-wrap items-end gap-2" role="group" aria-label="Grafens filtre">
        <Segmented label="Vis" value={view} onChange={switchView} options={CHART_VIEWS} />
        <Select size="sm" aria-label="Hvilke punkter" value={f.scope} onChange={(e) => setFilter("scope", e.target.value)}>
          {CHART_SCOPES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </Select>
        <Select size="sm" aria-label="Managere" value={f.activeOnly ? "active" : ""} disabled={!canSegment}
          onChange={(e) => setFilter("activeOnly", e.target.value === "active")}>
          <option value="">Alle managere</option>
          <option value="active">Aktive (set de seneste 7 dage)</option>
        </Select>
        <Select size="sm" aria-label="Division" value={f.division} disabled={!canSegment}
          onChange={(e) => setFilter("division", e.target.value)}>
          <option value="">Alle divisioner</option>
          {divisions.map((d) => <option key={d} value={d}>{divisionLabel(d)}</option>)}
        </Select>
        {f.category && (
          <Button variant="secondary" size="sm" type="button" onClick={() => setFilter("category", "")}>
            Alle kategorier (nu {f.category})
          </Button>
        )}
        {filtersActive && (
          <Button variant="secondary" size="sm" type="button" onClick={() => { setF(EMPTY_CHART_FILTERS); setSelected(null); }}>
            Nulstil
          </Button>
        )}
      </div>
      {loading ? <TableSkeleton /> : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,600px)_minmax(0,1fr)]">
          <div>
            {shown.length === 0 ? (
              <div className="flex flex-col items-start gap-2 py-6">
                <p className="text-sm text-cz-3">Ingen {unit} med stemmer matcher.</p>
                {filtersActive && (
                  <Button variant="secondary" size="sm" type="button" onClick={() => { setF(EMPTY_CHART_FILTERS); setSelected(null); }}>
                    Nulstil filtrene
                  </Button>
                )}
              </div>
            ) : (
              <RoadmapAdminChart
                points={shown}
                selectedKey={selected}
                onSelect={(key) => setSelected((prev) => (prev === key ? null : key))}
                axisXLabel="Vigtighed"
                axisYLabel="God idé"
                cornerLabel="Byg først"
                labels={labels}
              />
            )}
            <p className="mt-2 text-xs text-cz-3">
              Boblens størrelse er antal stemmere. Stiplet kant: spillerne er uenige om vigtigheden.
              {hidden > 0 ? ` ${fmtInt(hidden)} ${unit} uden idé-score eller stemmer vises ikke.` : ""}
              {!canSegment ? " Filtrene på managere og division virker, når stemme-rækkerne kan hentes." : ""}
            </p>
          </div>
          <div className="border-t border-cz-border pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">{panel}</div>
        </div>
      )}
    </Section>
  );
}

export default function GrowthRoadmapTab() {
  const { getAuth } = useAdminAuth();
  const [stats, setStats] = useState(null);
  const [baseRows, setRows] = useState([]);
  // #7789: kategorien og stemme-rækkerne til grafen. Begge er null/tomme, indtil
  // migrationen er applied; så viser grafen viewets tal uden filtre.
  const [categories, setCategories] = useState(/** @type {{ id: string, category: string | null }[]} */ ([]));
  const [votePayload, setVotePayload] = useState(/** @type {import("../../../lib/roadmapAdminModel.ts").VotePayload | null} */ (null));
  const [issues, setIssues] = useState([]);
  const [updates, setUpdates] = useState([]);
  const [flags, setFlags] = useState([]);
  // #7971: skeleton kun ved første indlæsning. Senere genindlæsninger beholder de
  // gamle data på skærmen og opdaterer på plads, så siden ikke bliver kort og
  // scrollposition og åbne rækker bevares.
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const loadedRef = useRef(false);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(null);
  // { kind: "item" | "split" | "issue" | "update", row, focus? }
  const [modal, setModal] = useState(/** @type {any} */ (null));

  const load = useCallback(async () => {
    if (loadedRef.current) setRefreshing(true); else setLoading(true);
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
      loadedRef.current = true;
      setLoaded(true);
    } catch (e) {
      setLoadError(e.message || "Forbindelsen fejlede");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
    // Kontakterne er en bonus til Kontakt-kolonnen og formularen; fejler de,
    // virker resten af fanen stadig.
    try {
      const res = await apiFetch(`${API}/api/admin/feature-flags`, { headers: await getAuth() }, { source: "admin-roadmap-flags" });
      if (res.ok) setFlags(res.data?.flags ?? []);
    } catch { /* ignoreret, se ovenfor */ }
    // Grafens ekstra data (#7789) er også en bonus: før migrationen findes
    // hverken kolonnen eller RPC'en, og tabellerne skal virke alligevel.
    try {
      const [catRes, votesRes] = await Promise.all([
        supabase.from("roadmap_items").select("id, category"),
        apiFetch(`${API}/api/admin/roadmap/votes`, { headers: await getAuth() }, { source: "admin-roadmap-votes" }),
      ]);
      setCategories(catRes.error ? [] : /** @type {any} */ (catRes.data) ?? []);
      setVotePayload(votesRes.ok ? parseVotePayload(/** @type {any} */ (votesRes.data)?.votes) : null);
    } catch {
      setCategories([]);
      setVotePayload(null);
    }
  }, [getAuth]);

  useEffect(() => { load(); }, [load]);

  // Én skrivning ad gangen; fejl vises over tabellerne, succes genhenter alt.
  // `optimistic` (#7971): rækkeændringer, der lægges på skærmen med det samme, så
  // rækken ikke springer; fejler skrivningen, rulles de tilbage.
  async function run(key, fn, optimistic = []) {
    const before = baseRows;
    setBusy(key);
    setActionError("");
    if (optimistic.length > 0) setRows((prev) => patchRows(prev, optimistic));
    try {
      const results = await fn();
      const failed = (Array.isArray(results) ? results : [results]).find((r) => r?.error);
      if (failed) throw new Error(failed.error.message);
      await load();
    } catch (e) {
      if (optimistic.length > 0) setRows(before);
      setActionError(`Kunne ikke gemme: ${e.message || "ukendt fejl"}`);
    } finally {
      setBusy(null);
    }
  }

  const updateItem = (id, patch) => supabase.from("roadmap_items").update({ ...patch, updated_at: nowIso() }).eq("id", id);

  const rows = useMemo(() => mergeCategories(baseRows, categories), [baseRows, categories]);
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
      onChange={(e) => {
        const patch = statusPatch(e.target.value, nowIso());
        run(`status-${row.item_id}`, () => updateItem(row.item_id, patch), [{ item_id: row.item_id, ...patch }]);
      }}
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
      onChange={(e) => moveHorizon(row, e.target.value)}
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
      {isCategoryKey(row.category) && <span className="normal-case tracking-normal">{categoryLabel(row.category)}</span>}
      {row.approved === false && <Tag>Skjult</Tag>}
      {row.beta_soon && <Tag>Næste i beta</Tag>}
      {row.live_soon && <Tag>Snart for alle</Tag>}
      {row.issue_ref ? <span className="font-data">#{row.issue_ref}</span> : null}
    </>
  );

  const toPlan = (r) => {
    const patch = { status: "planned", horizon: "next_week", sort_order: nextSortOrder(plannedRows) };
    return run(`plan-${r.item_id}`, () => updateItem(r.item_id, patch), [{ item_id: r.item_id, ...patch }]);
  };

  const moveHorizon = (r, horizon) =>
    run(`hz-${r.item_id}`, () => updateItem(r.item_id, { horizon }), [{ item_id: r.item_id, horizon }]);

  const setApproved = (r, approved) =>
    run(`${approved ? "show" : "hide"}-${r.item_id}`, () => updateItem(r.item_id, { approved }), [{ item_id: r.item_id, approved }]);

  const move = (r, dir) => {
    const patches = movePatches(plannedRows, r.item_id, dir);
    return run(`${dir < 0 ? "up" : "down"}-${r.item_id}`,
      () => Promise.all(patches.map((p) => updateItem(p.item_id, { sort_order: p.sort_order }))), patches);
  };

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
    // #7971: samlet vurdering som i spørgeskemaet (God idé x Vigtighed), 1 decimal.
    total: { key: "total", header: "Samlet", sortKey: "total", numeric: true, compact: true, render: (r) => <Num>{fmtScore(totalScore(r.avg_idea, r.avg_importance), 1)}</Num> },
    votes: { key: "votes", header: "Stemmer", sortKey: "votes", numeric: true, compact: true, render: (r) => <Num>{fmtInt(r.votes)}</Num> },
    dontKnow: { key: "dontKnow", header: "Ved ikke", sortKey: "dontKnow", numeric: true, compact: true, render: (r) => <Num>{fmtInt(r.dont_know)}</Num> },
    // #7789: spredningen på vigtighed; over SPLIT_SD står "Deler spillerne" ved titlen.
    sd: { key: "sd", header: "Uenighed", mobileHeader: "Uenig.", sortKey: "sd", numeric: true, compact: true, render: (r) => <Num>{fmtScore(r.sd_importance)}</Num> },
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
      <RowButton disabled={busy !== null} onClick={() => toPlan(r)}>
        Til planen
      </RowButton>
      {r.approved === false ? (
        <RowButton disabled={busy !== null} onClick={() => setApproved(r, true)}>
          Vis på Vote
        </RowButton>
      ) : (
        <RowButton disabled={busy !== null} onClick={() => setApproved(r, false)}>
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
    ideas: [col.rank, col.title("Idé"), col.horizon, col.importance, col.idea, col.total, col.votes, col.dontKnow, col.issue, ideaActions],
    planned: [col.rank, col.title("Punkt", true), col.horizonEdit, col.importance, col.idea, col.total, col.votes, col.dontKnow, col.own, col.flag, statusActions],
    in_progress: [col.title("Punkt"), col.horizonEdit, col.importance, col.idea, col.total, col.votes, col.beta, col.flag, statusActions],
    shipped: [col.title("Punkt"), col.date, col.importance, col.votes, col.flag,
      col.actions((r) => (
        <>
          <div className="w-[104px]">{statusSelect(r)}</div>
          <RowButton onClick={() => setModal({ kind: "item", row: r })}>Ret</RowButton>
        </>
      ))],
    y2027: [col.rank, col.title("Punkt", true), col.statusEdit, col.importance, col.idea, col.total, col.votes, col.dontKnow, col.own, col.flag, horizonActions],
    votes: [col.rank, col.title("Punkt", true), col.status, col.horizon, col.votes, col.dontKnow, col.importance, col.idea, col.total, col.sd,
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
    ideas: ["importance", "idea", "total"],
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
          <Button variant="secondary" size="sm" loading={loading || refreshing} onClick={load}
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

      {(!loadError || loaded) && (
        <SectionStack>
          <Section>
            <HeroStats items={statItems} className="mt-0 border-t-0 pt-0" />
          </Section>

          <RoadmapChartSection
            rows={rows}
            votePayload={votePayload}
            loading={loading}
            busy={busy}
            onMoveHorizon={moveHorizon}
            onToPlan={toPlan}
            onEdit={(r) => setModal({ kind: "item", row: r })}
          />

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
