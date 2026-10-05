// Roadmap-hub (#5387, spor 2 #6150): /roadmap i fem faner (Plan, Beta, Vote,
// Known issues, Done). Denne fil er en tynd skal: sidehoved, faner, hentning og
// filter-tilstand. Fanerne i components/roadmap/ er rene visningskomponenter
// uden egen hentning; al afledt logik bor i lib/roadmapModel.ts.
//
// Uændrede beslutninger: spillere ser kun deres egen stemme (11/6, #1599),
// ingen datoer på planen, EN først og DA under. Admin-kontrollerne (markér
// bygget, opret-formular) er flyttet til /admin/growth?tab=roadmap (spor 3),
// så den offentlige side ikke bærer admin-kode og ikke kalder is_admin().
//
// Ruten er offentlig: udloggede kan læse alt, men ser ingen skalaer og ingen
// "Affects me too"-knapper.

import { useEffect, useMemo, useState, Suspense } from "react";
import { Link, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { supabase, authHeaders } from "../lib/supabase";
import { apiFetch } from "../lib/apiFetch.ts";
import { lazyWithRetry } from "../lib/lazyWithRetry.js";
import { useDocumentHead } from "../hooks/useDocumentHead.js";
import {
  ROADMAP_ITEM_COLUMNS,
  isValidScore,
  buildVotePayload,
  buildImportancePayload,
  votesByItemId,
} from "../lib/roadmapVoting.js";
import {
  parseTab,
  partitionItems,
  isRated,
  countUnrated,
  splitIssues,
  buildDoneList,
  latestIssueUpdates,
} from "../lib/roadmapModel.ts";
import {
  isRoadmapItemNew, latestRoadmapCreatedAt, readLastSeenRoadmap, writeLastSeenRoadmap,
} from "../lib/roadmapUnread.ts"; // #5673: gul prik ved nye punkter
import { PageHeader, Checkbox, Tabs, TabList, Tab, TabPanel } from "../components/ui";
import { buttonClass } from "../components/ui/buttonStyles.js";
import PlanTab from "../components/roadmap/PlanTab.tsx";
import BetaTab from "../components/roadmap/BetaTab.tsx";
import VoteTab from "../components/roadmap/VoteTab.tsx";
import KnownIssuesTab from "../components/roadmap/KnownIssuesTab.tsx";
import DoneTab from "../components/roadmap/DoneTab.tsx";

// Feedback-fladen (samme modal som sidebarens "Kontakt") til Known issues'
// tomme tilstand. Lazy: de fleste besøg åbner den aldrig.
const FeedbackModal = lazyWithRetry(() => import("../components/FeedbackModal.jsx"));

const API = import.meta.env.VITE_API_URL;
export const ONLY_UNRATED_KEY = "cz_roadmap_only_unrated";
const KNOWN_ISSUE_COLUMNS = "id, area, status, title_en, title_da, sort_order, created_at, updated_at, closed_at";

function readOnlyUnrated() {
  try {
    return localStorage.getItem(ONLY_UNRATED_KEY) !== "0";
  } catch {
    return true;
  }
}

function writeOnlyUnrated(value) {
  try {
    localStorage.setItem(ONLY_UNRATED_KEY, value ? "1" : "0");
  } catch {
    /* ignore: valget huskes bare ikke */
  }
}

function TabLabel({ label, count }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {label}
      {count > 0 && <span className="font-data tabular-nums text-cz-3">{count}</span>}
    </span>
  );
}

export default function RoadmapPage() {
  const { t, i18n } = useTranslation("roadmap");
  // Per-route head (#5494). Ruten ligger bag <I18nReadyGate ns="roadmap">.
  useDocumentHead({
    title: t("meta.title"),
    description: t("meta.description"),
    canonical: "https://cyclingzone.org/roadmap",
    lang: i18n.language?.startsWith("da") ? "da" : "en",
  });

  const [searchParams, setSearchParams] = useSearchParams();
  const tab = parseTab(searchParams.get("tab"));
  const setTab = (next) => setSearchParams({ tab: next }, { replace: true });

  const [userId, setUserId] = useState(null);
  const [items, setItems] = useState(null); // null = ikke hentet endnu (skeleton)
  const [issues, setIssues] = useState([]);
  const [updates, setUpdates] = useState([]);
  const [betaState, setBetaState] = useState(null);
  // #5673: lastSeen SOM DEN VAR ved ankomst, fanget ÉN gang ved mount, FØR
  // hentningen nedenfor overskriver nøglen. Prikkerne bliver stående dette besøg.
  const [lastSeenBeforeVisit] = useState(() => readLastSeenRoadmap());
  const [onlyUnratedPref, setOnlyUnratedPref] = useState(() => readOnlyUnrated());
  const [votes, setVotes] = useState(() => new Map());
  const [drafts, setDrafts] = useState({}); // item_id → { idea, importance } (Vote-fanen)
  const [saveState, setSaveState] = useState({}); // item_id → "saving" | "saved" | "error"
  // Punkter spilleren har bedømt i DETTE besøg bliver stående, så "Saved" kan
  // ses og et valg kan rettes; filteret skjuler dem først ved næste besøg.
  const [ratedThisVisit, setRatedThisVisit] = useState(() => new Set());
  const [reports, setReports] = useState(() => new Set());
  const [reportError, setReportError] = useState(() => new Set());
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Fejl på known_issues behandles som tom liste, så en manglende tabel
      // aldrig vælter Plan/Vote.
      const [{ data: itemData }, { data: issueData }, { data: updateData }, { data: auth }] = await Promise.all([
        supabase.from("roadmap_items").select(ROADMAP_ITEM_COLUMNS)
          .eq("approved", true).in("status", ["active", "planned", "in_progress", "shipped"]).order("sort_order"),
        supabase.from("known_issues").select(KNOWN_ISSUE_COLUMNS)
          .eq("published", true).order("sort_order"),
        supabase.from("known_issue_updates")
          .select("id, issue_id, body_en, body_da, created_at").order("created_at", { ascending: false }),
        supabase.auth.getUser(),
      ]);
      if (cancelled) return;
      const all = [...(itemData ?? []), ...(issueData ?? [])];
      setItems(itemData ?? []);
      setIssues(issueData ?? []);
      setUpdates(updateData ?? []);
      // #5673: besøg nulstiller nav-prikken (Layout.jsx genberegner den).
      writeLastSeenRoadmap(latestRoadmapCreatedAt(all));
      const uid = auth?.user?.id ?? null;
      setUserId(uid);

      // Privacy (#1599): hent KUN egne stemmer og egne reports. Anonyme har ingen.
      // .eq filtrerer i querien; votesByItemId(uid) er forsvars-lag 2 mod
      // en evt. admin-RLS-undtagelse der returnerer andres rows.
      if (!uid) return;
      const [{ data: voteData }, { data: reportData }] = await Promise.all([
        supabase.from("roadmap_votes").select("item_id, idea_score, importance_score, user_id").eq("user_id", uid),
        supabase.from("known_issue_reports").select("issue_id, user_id").eq("user_id", uid),
      ]);
      if (cancelled) return;
      const byItem = votesByItemId(voteData, uid);
      setVotes(byItem);
      setDrafts(Object.fromEntries(
        [...byItem].map(([itemId, vote]) => [itemId, { idea: vote.idea_score, importance: vote.importance_score }]),
      ));
      setReports(new Set((reportData ?? []).filter((r) => r.user_id === uid).map((r) => r.issue_id)));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Beta-fanens knap (#5259): samme udledning som Indstillinger. Fejler kaldet,
  // står knappen "Join the beta", og ansøgningen viser den rigtige tilstand.
  useEffect(() => {
    if (!userId || !API) return;
    let cancelled = false;
    (async () => {
      try {
        const headers = await authHeaders({ json: false });
        if (!headers) return;
        const res = await apiFetch(`${API}/api/me/beta-access`, { headers }, { source: "roadmap-beta-access" });
        if (!cancelled && res.ok && res.data?.state) setBetaState(res.data.state);
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const loading = items === null;
  const canVote = !!userId;
  const onlyUnrated = canVote && onlyUnratedPref;

  const parts = useMemo(() => partitionItems(items), [items]);
  const issueParts = useMemo(() => splitIssues(issues), [issues]);
  const updatesByIssue = useMemo(() => latestIssueUpdates(updates), [updates]);
  const doneEntries = useMemo(() => buildDoneList(parts.shipped, issues, Infinity), [parts.shipped, issues]);
  const counts = countUnrated(items ?? [], votes);
  const rankById = useMemo(() => new Map(parts.plannedNext.map((it, i) => [it.id, i + 1])), [parts.plannedNext]);

  const visible = (list) => (onlyUnrated
    ? list.filter((it) => ratedThisVisit.has(it.id) || !isRated(it, votes.get(it.id)))
    : list);
  const isNew = (item) => isRoadmapItemNew(item.created_at, lastSeenBeforeVisit);

  function setOnlyUnrated(value) {
    setOnlyUnratedPref(value);
    setRatedThisVisit(new Set());
    writeOnlyUnrated(value);
  }

  function markRated(itemId) {
    setRatedThisVisit((prev) => (prev.has(itemId) ? prev : new Set(prev).add(itemId)));
  }

  // Plan-fanen: kun "Important to you?". idea_score sendes ikke og bevares.
  async function rateImportance(item, value) {
    if (!userId) return;
    markRated(item.id);
    setVotes((prev) => new Map(prev).set(item.id, {
      ...(prev.get(item.id) ?? { item_id: item.id, idea_score: null }),
      importance_score: value,
    }));
    setSaveState((prev) => ({ ...prev, [item.id]: "saving" }));
    const { error } = await supabase.from("roadmap_votes")
      .upsert(buildImportancePayload({ itemId: item.id, userId, importanceScore: value }), { onConflict: "user_id,item_id" });
    setSaveState((prev) => ({ ...prev, [item.id]: error ? "error" : "saved" }));
  }

  // Vote-fanen: gem først når begge akser er valgt (uændret fra #954).
  async function handleScore(item, axis, value) {
    const draft = { idea: null, importance: null, ...(drafts[item.id] ?? {}), [axis]: value };
    setDrafts((prev) => ({ ...prev, [item.id]: draft }));
    markRated(item.id);
    if (!isValidScore(draft.idea) || !isValidScore(draft.importance) || !userId) return;

    setSaveState((prev) => ({ ...prev, [item.id]: "saving" }));
    const { error } = await supabase.from("roadmap_votes").upsert(
      buildVotePayload({ itemId: item.id, userId, ideaScore: draft.idea, importanceScore: draft.importance }),
      { onConflict: "user_id,item_id" }
    );
    if (!error) {
      setVotes((prev) => new Map(prev).set(item.id, { item_id: item.id, idea_score: draft.idea, importance_score: draft.importance }));
    }
    setSaveState((prev) => ({ ...prev, [item.id]: error ? "error" : "saved" }));
  }

  // Known issues: "Affects me too" / "I see this too". Et nyt tryk fortryder.
  async function toggleReport(issue) {
    if (!userId) return;
    const has = reports.has(issue.id);
    const flip = (set, add) => {
      const next = new Set(set);
      if (add) next.add(issue.id); else next.delete(issue.id);
      return next;
    };
    setReports((prev) => flip(prev, !has));
    setReportError((prev) => flip(prev, false));
    const q = supabase.from("known_issue_reports");
    const { error } = has
      ? await q.delete().eq("issue_id", issue.id).eq("user_id", userId)
      : await q.insert({ issue_id: issue.id, user_id: userId });
    if (error) {
      setReports((prev) => flip(prev, has));
      setReportError((prev) => flip(prev, true));
    }
  }

  const issuesEmptyAction = canVote ? (
    <button type="button" onClick={() => setFeedbackOpen(true)} className={buttonClass({ variant: "secondary", size: "sm" })}>
      {t("empty.issues.action")}
    </button>
  ) : (
    <Link to="/login" className={buttonClass({ variant: "secondary", size: "sm" })}>{t("empty.issues.loginAction")}</Link>
  );

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title={t("page.title")}
        subtitle={t("page.subtitle")}
        actions={canVote ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Checkbox
              id="roadmap-only-unrated"
              label={t("filter.onlyUnrated")}
              checked={onlyUnratedPref}
              onChange={(e) => setOnlyUnrated(e.target.checked)}
            />
            <span className="font-data tabular-nums text-xs text-cz-3">
              {t("filter.rated", { rated: counts.rated, total: counts.total })}
            </span>
          </div>
        ) : null}
      />

      {!canVote && !loading && (
        <p className="mb-4 text-cz-2 text-sm">
          {t("loginToVote.text")}{" "}
          <Link to="/login" className="font-medium text-cz-accent-t hover:underline">{t("loginToVote.link")}</Link>
        </p>
      )}

      <Tabs value={tab} onChange={setTab}>
        <TabList label={t("tabs.label")} className="mb-4">
          <Tab value="plan"><TabLabel label={t("tabs.plan")} count={canVote ? counts.plan : 0} /></Tab>
          <Tab value="beta"><TabLabel label={t("tabs.beta")} count={parts.inBeta.length} /></Tab>
          <Tab value="vote"><TabLabel label={t("tabs.vote")} count={canVote ? counts.vote : 0} /></Tab>
          <Tab value="issues"><TabLabel label={t("tabs.issues")} count={issueParts.confirmed.length} /></Tab>
          <Tab value="done"><TabLabel label={t("tabs.done")} count={0} /></Tab>
        </TabList>

        <TabPanel value="plan">
          <PlanTab
            loading={loading}
            inProgress={parts.inProgress}
            plannedNext={visible(parts.plannedNext)}
            plannedLater={visible(parts.plannedLater)}
            plannedTotal={parts.plannedNext.length + parts.plannedLater.length}
            rankById={rankById}
            onlyUnrated={onlyUnrated}
            votes={votes}
            saveState={saveState}
            canVote={canVote}
            isNew={isNew}
            onRate={rateImportance}
            onShowAll={() => setOnlyUnrated(false)}
            onGoVote={() => setTab("vote")}
          />
        </TabPanel>
        <TabPanel value="beta">
          <BetaTab
            loading={loading}
            inBeta={parts.inBeta}
            comingToBeta={parts.comingToBeta}
            betaState={betaState}
            isLoggedIn={canVote}
            isNew={isNew}
            onGoPlan={() => setTab("plan")}
          />
        </TabPanel>
        <TabPanel value="vote">
          <VoteTab
            loading={loading}
            ideas={visible(parts.ideas)}
            ideasTotal={parts.ideas.length}
            onlyUnrated={onlyUnrated}
            drafts={drafts}
            saveState={saveState}
            canVote={canVote}
            isNew={isNew}
            onScore={handleScore}
            onShowAll={() => setOnlyUnrated(false)}
          />
        </TabPanel>
        <TabPanel value="issues">
          <KnownIssuesTab
            loading={loading}
            confirmed={issueParts.confirmed}
            checking={issueParts.checking}
            recentlyFixed={issueParts.recentlyFixed}
            recentlyDismissed={issueParts.recentlyDismissed}
            updatesByIssue={updatesByIssue}
            reports={reports}
            reportError={reportError}
            canReport={canVote}
            onToggleReport={toggleReport}
            emptyAction={issuesEmptyAction}
          />
        </TabPanel>
        <TabPanel value="done">
          <DoneTab loading={loading} entries={doneEntries} onGoPlan={() => setTab("plan")} />
        </TabPanel>
      </Tabs>

      {feedbackOpen && (
        <Suspense fallback={null}>
          <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
