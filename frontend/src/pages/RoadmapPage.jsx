// Roadmap-hub (#5387, spor 2 #6150): /roadmap i fem faner (Plan, Beta, Vote,
// Known issues, Done). Denne fil er en tynd skal: sidehoved, faner, hentning og
// filter-tilstand. Fanerne i components/roadmap/ er rene visningskomponenter
// uden egen hentning; al afledt logik bor i lib/roadmapModel.ts.
//
// Uændrede beslutninger: spillere ser kun deres egen stemme (11/6, #1599),
// EN først og DA under. #7666 (ejer 4/11): planen står nu pr. horisont med
// datoer på ugerne, og en søgning går på tværs af alle fem faner (#6203). Admin-kontrollerne (markér
// bygget, opret-formular) er flyttet til /admin/growth?tab=roadmap (spor 3),
// så den offentlige side ikke bærer admin-kode og ikke kalder is_admin().
//
// Ruten er offentlig: udloggede kan læse alt, men ser ingen skalaer og ingen
// "Affects me too"-knapper.

import { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { Link, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { supabase, authHeaders } from "../lib/supabase";
import { apiFetch } from "../lib/apiFetch.ts";
import { lazyWithRetry } from "../lib/lazyWithRetry.js";
import { useDocumentHead } from "../hooks/useDocumentHead.js";
import { documentLang } from "../i18n/languages.js";
import {
  ROADMAP_ITEM_COLUMNS,
  isValidScore,
  buildVotePayload,
  buildImportancePayload,
  buildDontKnowPayload,
  votesByItemId,
} from "../lib/roadmapVoting.js";
import {
  parseTab,
  partitionItems,
  planRanks,
  isRated,
  countUnrated,
  splitIssues,
  buildDoneList,
  splitRecentDone,
  latestIssueUpdates,
  patchNotesByIssue,
  searchRoadmap,
  normalizeSearch,
  roadmapRowId,
  SEARCH_MIN_CHARS,
} from "../lib/roadmapModel.ts";
import { loadPatches } from "../lib/patchNotes.js";
import {
  isRoadmapItemNew, latestRoadmapCreatedAt, readLastSeenRoadmap, writeLastSeenRoadmap,
} from "../lib/roadmapUnread.ts"; // #5673: gul prik ved nye punkter
import { PageHeader, Checkbox, Input, Tabs, TabList, Tab, TabPanel } from "../components/ui";
import { buttonClass } from "../components/ui/buttonStyles.js";
import PlanTab from "../components/roadmap/PlanTab.tsx";
import BetaTab from "../components/roadmap/BetaTab.tsx";
import VoteTab from "../components/roadmap/VoteTab.tsx";
import KnownIssuesTab from "../components/roadmap/KnownIssuesTab.tsx";
import DoneTab from "../components/roadmap/DoneTab.tsx";
import SearchResults from "../components/roadmap/SearchResults.tsx";

// Feedback-fladen (samme modal som sidebarens "Kontakt") til Known issues'
// tomme tilstand. Lazy: de fleste besøg åbner den aldrig.
const FeedbackModal = lazyWithRetry(() => import("../components/FeedbackModal.jsx"));

const API = import.meta.env.VITE_API_URL;
export const ONLY_UNRATED_KEY = "cz_roadmap_only_unrated";
// #7666: issue_ref kobler et færdigt punkt til sin patch note.
const ITEM_COLUMNS = `${ROADMAP_ITEM_COLUMNS}, issue_ref`;
const KNOWN_ISSUE_BASE_COLUMNS = "id, area, status, title_en, title_da, sort_order, created_at, updated_at, closed_at, issue_ref";
// confirmed_at/fixing_at kommer med #7666-migrationen. Indtil den er applied,
// fejler querien med dem, og så hentes uden (tidslinjen viser trinnet uden dato).
const KNOWN_ISSUE_COLUMNS = `${KNOWN_ISSUE_BASE_COLUMNS}, confirmed_at, fixing_at`;

/** @returns {Promise<{ data: import("../lib/roadmapModel.ts").KnownIssue[] | null }>} */
async function fetchKnownIssues() {
  /** @param {string} columns */
  const query = (columns) => supabase.from("known_issues").select(columns).eq("published", true).order("sort_order");
  const result = await query(KNOWN_ISSUE_COLUMNS);
  // Kolonnelisten er en skabelonstreng, så supabase-js kan ikke udlede rækketypen.
  return /** @type {any} */ (result.error ? await query(KNOWN_ISSUE_BASE_COLUMNS) : result);
}

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
    lang: documentLang(i18n.language),
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
  const [votesLoaded, setVotesLoaded] = useState(false);
  const [drafts, setDrafts] = useState({}); // item_id → { idea, importance } (Vote-fanen)
  const [saveState, setSaveState] = useState({}); // item_id → "saving" | "saved" | "error"
  // Punkter spilleren har bedømt i DETTE besøg bliver stående, så "Saved" kan
  // ses og et valg kan rettes; filteret skjuler dem først ved næste besøg.
  const [ratedThisVisit, setRatedThisVisit] = useState(() => new Set());
  const [reports, setReports] = useState(() => new Set());
  const [reportError, setReportError] = useState(() => new Set());
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // ?q= åbner siden med en søgning (et link fra Discord eller Hjælp kan pege på et emne).
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  // Det hit spilleren sidst åbnede. Bliver stående, så en fold ikke lukker ved
  // næste render; revealedNonce sørger for, at der kun scrolles én gang pr. tryk.
  const [reveal, setReveal] = useState(/** @type {import("../lib/roadmapModel.ts").RoadmapReveal | null} */ (null));
  const revealedNonce = useRef(0);
  // #7666: patch notes pr. GitHub-issue. Hentes først når Done åbnes (filen er
  // stor og caches af CDN'en); null = ikke hentet, tomt Map = fejlede.
  const [patchIndex, setPatchIndex] = useState(
    /** @type {Map<number, import("../lib/roadmapModel.ts").PatchNoteRef[]> | null} */ (null),
  );

  useEffect(() => {
    if (tab !== "done" || patchIndex) return;
    let cancelled = false;
    loadPatches()
      .then((data) => { if (!cancelled) setPatchIndex(patchNotesByIssue(data)); })
      .catch(() => { if (!cancelled) setPatchIndex(new Map()); });
    return () => {
      cancelled = true;
    };
  }, [tab, patchIndex]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Fejl på known_issues behandles som tom liste, så en manglende tabel
      // aldrig vælter Plan/Vote.
      const [{ data: itemData }, { data: issueData }, { data: updateData }, { data: auth }] = await Promise.all([
        supabase.from("roadmap_items").select(ITEM_COLUMNS)
          .eq("approved", true).in("status", ["active", "planned", "in_progress", "shipped"]).order("sort_order"),
        fetchKnownIssues(),
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
      setVotesLoaded(true);
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
  const showVoteCounts = canVote && votesLoaded;
  const votingLoading = loading || (canVote && !votesLoaded);
  const onlyUnrated = canVote && onlyUnratedPref;

  const parts = useMemo(() => partitionItems(items), [items]);
  const issueParts = useMemo(() => splitIssues(issues), [issues]);
  const updatesByIssue = useMemo(() => latestIssueUpdates(updates), [updates]);
  const doneEntries = useMemo(() => buildDoneList(parts.shipped, issues, Infinity), [parts.shipped, issues]);
  const recentDoneCount = useMemo(() => splitRecentDone(doneEntries).recent.length, [doneEntries]);
  const counts = countUnrated(items ?? [], votes);
  const rankById = useMemo(() => planRanks(parts.planGroups), [parts.planGroups]);
  const searching = normalizeSearch(query).length >= SEARCH_MIN_CHARS;
  const hits = useMemo(
    () => (searching ? searchRoadmap(query, items, issues) : []),
    [searching, query, items, issues],
  );

  const visible = (list) => (onlyUnrated
    ? list.filter((it) => ratedThisVisit.has(it.id) || !isRated(it, votes.get(it.id)))
    : list);
  // Filteret rammer kun planlagte punkter; det der er i gang, har ingen skala.
  const planGroups = parts.planGroups
    .map((g) => ({ ...g, items: g.items.filter((it) => it.status !== "planned" || visible([it]).length > 0) }))
    .filter((g) => g.items.length > 0);
  const decidedTotal = parts.planGroups.reduce((n, g) => n + g.items.length, 0);
  const plannedTotal = parts.planGroups.reduce((n, g) => n + g.items.filter((it) => it.status === "planned").length, 0);

  // Et hit skal kunne findes på fanen: et punkt spilleren allerede har bedømt,
  // holdes synligt trods "kun ubedømte" (samme greb som et punkt bedømt i dette besøg).
  // Fanen får id'et og monteres på ny (se revealKey), så dens områdefilter står
  // på "alle", den rigtige fold er åben, og Done viser langt nok ned.
  function openFromSearch(hit) {
    if (hit.where === "planned" || hit.where === "idea") markRated(hit.id);
    setReveal((prev) => ({ id: hit.id, tab: hit.tab, nonce: (prev?.nonce ?? 0) + 1 }));
    setQuery("");
    setTab(hit.tab);
  }

  const revealId = (panel) => (reveal && reveal.tab === panel ? reveal.id : null);
  const revealKey = (panel) => (reveal && reveal.tab === panel ? reveal.nonce : panel);

  // Fanen skifter via routeren og kan lande en render senere end reveal, så
  // effekten venter, til hit'ets fane er den aktive.
  useEffect(() => {
    if (!reveal || reveal.tab !== tab || reveal.nonce === revealedNonce.current) return;
    if (votingLoading && (tab === "plan" || tab === "vote")) return;
    revealedNonce.current = reveal.nonce;
    document.getElementById(roadmapRowId(reveal.id))?.scrollIntoView({ block: "center" });
  }, [reveal, tab, votingLoading]);

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

  // #7788: Ved ikke gælder hele punktet og gemmes straks, på begge faner.
  async function markDontKnow(item) {
    if (!userId) return;
    markRated(item.id);
    setSaveState((prev) => ({ ...prev, [item.id]: "saving" }));
    const { error } = await supabase.from("roadmap_votes")
      .upsert(buildDontKnowPayload({ itemId: item.id, userId, now: new Date() }), { onConflict: "user_id,item_id" });
    if (!error) {
      setVotes((prev) => new Map(prev).set(item.id, { item_id: item.id, idea_score: null, importance_score: null }));
      setDrafts((prev) => ({ ...prev, [item.id]: { idea: null, importance: null } }));
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
        actions={showVoteCounts ? (
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

      {/* #6203: én søgning på tværs af fanerne, som på Patch notes. Fanerne
          står skjult (ikke afmonteret) mens der søges, så deres tilstand bevares. */}
      <div className="mb-4">
        <Input
          type="search"
          size="sm"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t("search.ariaLabel")}
          placeholder={t("search.placeholder")}
          className="w-full sm:max-w-sm"
        />
      </div>

      {searching && (
        <SearchResults query={query} hits={hits} onOpen={openFromSearch} onClear={() => setQuery("")} />
      )}

      <div className={searching ? "hidden" : undefined}>
      <Tabs value={tab} onChange={setTab}>
        <TabList label={t("tabs.label")} className="mb-4">
          <Tab value="plan"><TabLabel label={t("tabs.plan")} count={showVoteCounts ? counts.plan : 0} /></Tab>
          <Tab value="beta"><TabLabel label={t("tabs.beta")} count={parts.inBeta.length} /></Tab>
          <Tab value="vote"><TabLabel label={t("tabs.vote")} count={showVoteCounts ? counts.vote : 0} /></Tab>
          <Tab value="issues"><TabLabel label={t("tabs.issues")} count={issueParts.confirmed.length} /></Tab>
          <Tab value="done"><TabLabel label={t("tabs.done")} count={recentDoneCount} /></Tab>
        </TabList>

        <TabPanel value="plan">
          <PlanTab
            key={revealKey("plan")}
            revealId={revealId("plan")}
            loading={votingLoading}
            groups={planGroups}
            decidedTotal={decidedTotal}
            plannedTotal={plannedTotal}
            rankById={rankById}
            onlyUnrated={onlyUnrated}
            votes={votes}
            saveState={saveState}
            canVote={canVote}
            isNew={isNew}
            onRate={rateImportance}
            onDontKnow={markDontKnow}
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
            key={revealKey("vote")}
            loading={votingLoading}
            ideas={visible(parts.ideas)}
            ideasTotal={parts.ideas.length}
            unrated={counts.vote}
            onlyUnrated={onlyUnrated}
            drafts={drafts}
            votes={votes}
            saveState={saveState}
            canVote={canVote}
            isNew={isNew}
            onScore={handleScore}
            onDontKnow={markDontKnow}
            onShowAll={() => setOnlyUnrated(false)}
          />
        </TabPanel>
        <TabPanel value="issues">
          <KnownIssuesTab
            key={revealKey("issues")}
            revealId={revealId("issues")}
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
          <DoneTab
            key={revealKey("done")}
            revealId={revealId("done")}
            loading={loading}
            entries={doneEntries}
            patchIndex={patchIndex}
            onGoPlan={() => setTab("plan")}
            votes={votes}
          />
        </TabPanel>
      </Tabs>
      </div>

      {feedbackOpen && (
        <Suspense fallback={null}>
          <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
