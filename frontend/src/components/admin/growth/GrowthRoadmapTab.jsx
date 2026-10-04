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
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { apiFetch } from "../../../lib/apiFetch.ts";
import { useAdminAuth } from "../shared/useAdminAuth";
import {
  IDEA_TARGET, fmtScore, ideaPool, isSplit, latestUpdateByIssue, mergeItemRows, movePatches, nextSortOrder,
  ownOrder, rankIdeas, rankIssues, rankPlan, statusPatch, visibleIdeaCount, ROADMAP_STATUSES,
} from "../../../lib/roadmapAdminModel.ts";
import {
  AREA_LABELS, FLAG_STAGE_LABELS, ISSUE_STATUS_LABELS, STATUS_LABELS,
  IssueFormModal, IssueUpdateModal, ItemFormModal, SplitItemModal,
} from "./RoadmapAdminForms.jsx";
import {
  Button, DataTable, ErrorState, HeroStats, Section, SectionHeader, SectionStack, Select, SkeletonLines, StatusBadge,
  ArrowDownIcon, ArrowUpIcon, PlusIcon, RefreshIcon,
} from "../../ui";

const API = import.meta.env.VITE_API_URL;

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

function Actions({ children }) {
  return <div className="flex flex-wrap items-center justify-end gap-1.5">{children}</div>;
}

function RowButton({ children, ...rest }) {
  return <Button variant="secondary" size="sm" type="button" {...rest}>{children}</Button>;
}

function TitleCell({ title, children }) {
  return (
    <div className="min-w-0">
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
        supabase.rpc("roadmap_admin_stats"),
        supabase.from("roadmap_item_scores").select("*"),
        supabase.from("roadmap_items").select("id, flag_key, beta_since, beta_soon, live_soon"),
        supabase.from("known_issue_scores").select("*"),
        supabase.from("known_issue_updates").select("issue_id, body_da, created_at")
          .order("created_at", { ascending: false }).limit(500),
      ]);
      const failed = [statsRes, scoresRes, itemsRes, issuesRes, updatesRes].find((r) => r.error);
      if (failed) throw new Error(failed.error.message);
      setStats((statsRes.data ?? [])[0] ?? null);
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

  const plan = useMemo(() => rankPlan(rows), [rows]);
  const order = useMemo(() => ownOrder(rows), [rows]);
  const ideas = useMemo(() => rankIdeas(rows), [rows]);
  const pool = useMemo(() => ideaPool(rows), [rows]);
  const inProgress = useMemo(() => rows.filter((r) => r.status === "in_progress")
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)), [rows]);
  const issueGroups = useMemo(() => rankIssues(issues), [issues]);
  const latest = useMemo(() => latestUpdateByIssue(updates), [updates]);
  const flagByKey = useMemo(() => new Map(flags.map((f) => [f.key, f])), [flags]);
  const plannedRows = useMemo(() => rows.filter((r) => r.status === "planned"), [rows]);

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

  const flagCell = (row) => {
    if (!row.flag_key) return <span className="text-cz-3">–</span>;
    const stage = flagByKey.get(row.flag_key)?.stage;
    return (
      <span className="font-data text-xs text-cz-2">
        {row.flag_key}{stage ? ` · ${FLAG_STAGE_LABELS[stage] ?? stage}` : ""}
      </span>
    );
  };

  const itemTags = (row) => (
    <>
      <span>{AREA_LABELS[row.engine] ?? row.engine}</span>
      {row.approved === false && <Tag>Skjult</Tag>}
      {row.horizon === "later" && row.status === "planned" && <Tag>Later</Tag>}
      {row.beta_soon && <Tag>Næste i beta</Tag>}
      {row.live_soon && <Tag>Snart for alle</Tag>}
      {row.issue_ref ? <span className="font-data">#{row.issue_ref}</span> : null}
    </>
  );

  const planColumns = [
    { key: "rank", header: "", compact: true, render: (_r, i) => <span className="font-data tabular-nums text-cz-3">{i + 1}</span> },
    {
      key: "title", header: "Punkt", sticky: true,
      render: (r) => (
        <TitleCell title={r.title_da || r.title_en}>
          {itemTags(r)}
          {isSplit(r.sd_importance) && <StatusBadge state="closing">Deler spillerne</StatusBadge>}
        </TitleCell>
      ),
    },
    { key: "importance", header: "Vigtighed", numeric: true, render: (r) => fmtScore(r.avg_importance) },
    { key: "votes", header: "Stemmer", numeric: true, render: (r) => fmtInt(r.votes) },
    { key: "own", header: "Din rækkefølge", mobileHeader: "Din", numeric: true, render: (r) => order.get(r.item_id) ?? "–" },
    { key: "flag", header: "Kontakt", fold: true, foldValue: (r) => r.flag_key ?? "", render: flagCell },
    {
      key: "actions", header: "", fold: true, foldValue: () => "",
      render: (r) => {
        const pos = order.get(r.item_id) ?? 0;
        return (
          <Actions>
            <RowButton aria-label="Flyt op" disabled={busy !== null || pos <= 1}
              onClick={() => run(`up-${r.item_id}`, () => Promise.all(movePatches(plannedRows, r.item_id, -1)
                .map((p) => updateItem(p.item_id, { sort_order: p.sort_order }))))}>
              <ArrowUpIcon size={14} aria-hidden="true" />
            </RowButton>
            <RowButton aria-label="Flyt ned" disabled={busy !== null || pos >= plannedRows.length}
              onClick={() => run(`down-${r.item_id}`, () => Promise.all(movePatches(plannedRows, r.item_id, 1)
                .map((p) => updateItem(p.item_id, { sort_order: p.sort_order }))))}>
              <ArrowDownIcon size={14} aria-hidden="true" />
            </RowButton>
            <div className="w-[118px]">{statusSelect(r)}</div>
            <RowButton disabled={busy !== null}
              onClick={() => run(`hz-${r.item_id}`, () => updateItem(r.item_id, { horizon: r.horizon === "later" ? "next" : "later" }))}>
              {r.horizon === "later" ? "Til Next" : "Til Later"}
            </RowButton>
            <RowButton onClick={() => setModal({ kind: "item", row: r })}>Ret</RowButton>
            <RowButton onClick={() => setModal({ kind: "split", row: r })}>Del</RowButton>
          </Actions>
        );
      },
    },
  ];

  const progressColumns = [
    { key: "title", header: "Punkt", sticky: true, render: (r) => <TitleCell title={r.title_da || r.title_en}>{itemTags(r)}</TitleCell> },
    {
      key: "beta", header: "I beta siden", numeric: true,
      render: (r) => (r.beta_since ? fmtDate(r.beta_since) : <span className="text-cz-3">–</span>),
    },
    { key: "flag", header: "Kontakt", render: flagCell },
    {
      key: "actions", header: "", fold: true, foldValue: () => "",
      render: (r) => (
        <Actions>
          <div className="w-[118px]">{statusSelect(r)}</div>
          <RowButton onClick={() => setModal({ kind: "item", row: r })}>Ret</RowButton>
          <RowButton onClick={() => setModal({ kind: "split", row: r })}>Del</RowButton>
        </Actions>
      ),
    },
  ];

  const ideaColumns = [
    { key: "rank", header: "", compact: true, render: (_r, i) => <span className="font-data tabular-nums text-cz-3">{i + 1}</span> },
    { key: "title", header: "Idé", sticky: true, render: (r) => <TitleCell title={r.title_da || r.title_en}>{itemTags(r)}</TitleCell> },
    { key: "idea", header: "God idé", numeric: true, render: (r) => fmtScore(r.avg_idea) },
    { key: "importance", header: "Vigtighed", numeric: true, render: (r) => fmtScore(r.avg_importance) },
    { key: "score", header: "Score", numeric: true, render: (r) => fmtScore(r.steering_score, 1) },
    { key: "votes", header: "Stemmer", numeric: true, render: (r) => fmtInt(r.votes) },
    {
      key: "actions", header: "", fold: true, foldValue: () => "",
      render: (r) => (
        <Actions>
          <RowButton disabled={busy !== null}
            onClick={() => run(`plan-${r.item_id}`, () => updateItem(r.item_id,
              { status: "planned", horizon: "next", sort_order: nextSortOrder(plannedRows) }))}>
            Til planen
          </RowButton>
          <RowButton disabled={busy !== null} onClick={() => run(`hide-${r.item_id}`, () => updateItem(r.item_id, { approved: false }))}>
            Tag af Vote
          </RowButton>
          <RowButton onClick={() => setModal({ kind: "item", row: r })}>Ret</RowButton>
          <RowButton onClick={() => setModal({ kind: "split", row: r })}>Del</RowButton>
        </Actions>
      ),
    },
  ];

  const poolColumns = [
    { key: "title", header: "Idé", sticky: true, render: (r) => <TitleCell title={r.title_da || r.title_en}>{itemTags(r)}</TitleCell> },
    { key: "votes", header: "Spillere bag", numeric: true, render: (r) => fmtInt(r.votes) },
    {
      key: "actions", header: "", fold: true, foldValue: () => "",
      render: (r) => (
        <Actions>
          <RowButton disabled={busy !== null} onClick={() => run(`show-${r.item_id}`, () => updateItem(r.item_id, { approved: true }))}>
            Vis på Vote
          </RowButton>
          <RowButton onClick={() => setModal({ kind: "item", row: r })}>Ret</RowButton>
        </Actions>
      ),
    },
  ];

  const issueColumns = [
    {
      key: "title", header: "Fejl", sticky: true,
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
    { key: "step", header: "Trin", render: (r) => <IssueStepBadge status={r.status} /> },
    { key: "reports", header: "Ramt", numeric: true, render: (r) => fmtInt(r.reports) },
    { key: "days", header: "Åben i", numeric: true, render: (r) => `${fmtInt(r.days_open)} dage` },
    {
      key: "actions", header: "", fold: true, foldValue: () => "",
      render: (r) => (
        <Actions>
          <RowButton onClick={() => setModal({ kind: "update", row: r, focus: "update" })}>Ny opdatering</RowButton>
          <RowButton onClick={() => setModal({ kind: "update", row: r, focus: "step" })}>Trin</RowButton>
          <RowButton onClick={() => setModal({ kind: "issue", row: r })}>Ret</RowButton>
        </Actions>
      ),
    },
  ];

  const statItems = [
    { label: "Har stemt", value: fmtInt(stats?.voters), sub: stats ? `af ${fmtInt(stats.managed_teams)} hold` : undefined },
    { label: "Aktive 14 dage", value: fmtInt(stats?.voters_14d) },
    { label: "Stemmer i alt", value: fmtInt(stats?.votes_total) },
    { label: "Har svaret på alt", value: fmtInt(stats?.voted_all) },
  ];

  const table = (props) => (loading ? <TableSkeleton /> : <DataTable rowKey={(r) => r.item_id ?? r.issue_id} {...props} />);

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
            <SectionHeader title="Planen, som spillerne vil have den" meta="Vigtighed 1-6" />
            {table({
              label: "Planen, som spillerne vil have den", columns: planColumns, rows: plan,
              mobileDefaults: ["importance", "votes", "own"], empty: "Ingen planlagte punkter endnu.",
            })}
          </Section>

          <Section>
            <SectionHeader title="I gang" meta={`${inProgress.length} punkter`} />
            {table({
              label: "I gang", columns: progressColumns, rows: inProgress,
              mobileDefaults: ["beta", "flag"], empty: "Intet er i gang lige nu.",
            })}
          </Section>

          <Section>
            <SectionHeader title="Idéer" meta="God idé × vigtighed" />
            {table({
              label: "Idéer", columns: ideaColumns, rows: ideas,
              mobileDefaults: ["idea", "importance", "score"], empty: "Ingen synlige idéer på Vote.",
            })}
          </Section>

          <Section>
            <SectionHeader title="Idé-pulje" meta={`Synlige idéer: ${visibleIdeaCount(rows)} (mål ca. ${IDEA_TARGET})`} />
            {table({
              label: "Idé-pulje", columns: poolColumns, rows: pool,
              mobileDefaults: ["votes"], empty: "Puljen er tom. Nye idéer oprettes skjult med Nyt punkt.",
            })}
          </Section>

          <Section>
            <SectionHeader title="Kendte fejl: bekræftet" meta="Flest ramte først" />
            {table({
              label: "Kendte fejl, bekræftet", columns: issueColumns, rows: issueGroups.confirmed,
              mobileDefaults: ["step", "reports", "days"], empty: "Ingen bekræftede, åbne fejl.",
            })}
          </Section>

          <Section>
            <SectionHeader title="Kendte fejl: meldt ind, tjekkes" meta="Flest ramte først" />
            {table({
              label: "Kendte fejl, meldt ind", columns: issueColumns, rows: issueGroups.checking,
              mobileDefaults: ["step", "reports", "days"], empty: "Intet meldt ind, der venter på et tjek.",
            })}
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
