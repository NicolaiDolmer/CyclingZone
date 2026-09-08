import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { useAdminAuth, readAdminJson, adminErrorMessage } from "../components/admin/shared/useAdminAuth";
import {
  Button, EmptyState, ErrorState, PageHeader, PageLoader, Select,
  Tabs, TabList, Tab, TabPanel, InboxIcon,
} from "../components/ui";
import SurveyOverviewTab from "../components/admin/survey/SurveyOverviewTab.jsx";
import SurveyIdeasTab from "../components/admin/survey/SurveyIdeasTab.jsx";
import SurveyPicksTab from "../components/admin/survey/SurveyPicksTab.jsx";
import SurveyTextTab from "../components/admin/survey/SurveyTextTab.jsx";
import SurveyProTab from "../components/admin/survey/SurveyProTab.jsx";
import SurveySegmentsTab from "../components/admin/survey/SurveySegmentsTab.jsx";

// #4943 · Ejerens flade til at følge svarene på et in-app spørgeskema.
//
// T2 (wide data, cap 1600px) og OVERBLIK FØRST + FANER UD (ejer-regel 2/9):
// første skærm er svarprocent, svar over tid, tilfredshed og fog of war;
// idéerne, problemerne, fritekst, Pro og segmenterne bor i hver sin fane.
//
// Generisk på slug: ruten er /admin/surveys/:slug, så det næste skema kan
// læses af den samme flade uden en ny side. Alt indhold (spørgsmål, valg,
// grupper) kommer fra databasen; kun fladens chrome er i18n.
//
// ADGANG ER DOBBELT-GATED. Ruten redirecter ikke-admins til dashboardet, OG
// endpointet (requireAdmin i backend/routes/api.js) svarer 403. Redirecten
// alene er kosmetik: den kan omgås ved at kalde API'et direkte, og fladen
// viser hver eneste fritekst-besvarelse med holdnavn.

const API = import.meta.env.VITE_API_URL;

const TABS = ["overview", "ideas", "worst", "text", "pro", "segments"];
const SEGMENTS = ["division", "language", "active"];

export default function AdminSurveyResultsPage() {
  const { slug } = useParams();
  const { t } = useTranslation("admin");
  const { getAuth } = useAdminAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [adminStatus, setAdminStatus] = useState("checking"); // checking | admin | not_admin
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notFound, setNotFound] = useState(false);

  const activeTab = TABS.includes(searchParams.get("tab")) ? searchParams.get("tab") : "overview";
  const segment = SEGMENTS.includes(searchParams.get("segment")) ? searchParams.get("segment") : "";

  const setParam = useCallback((key, value) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value); else next.delete(key);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { if (!cancelled) setAdminStatus("not_admin"); return; }
      const { data: userData } = await supabase
        .from("users").select("role").eq("id", session.user.id).maybeSingle();
      if (!cancelled) setAdminStatus(userData?.role === "admin" ? "admin" : "not_admin");
    })();
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const auth = await getAuth();
      const query = segment ? `?segment=${encodeURIComponent(segment)}` : "";
      const res = await fetch(
        `${API}/api/admin/surveys/${encodeURIComponent(slug)}/results${query}`,
        { headers: auth },
      );
      const json = await readAdminJson(res);
      if (res.status === 404) { setNotFound(true); return; }
      if (!res.ok) { setError(adminErrorMessage(json, res)); return; }
      setData(json);
    } catch (err) {
      setError(err.message || "Forbindelsen fejlede");
    } finally {
      setLoading(false);
    }
  }, [getAuth, slug, segment]);

  useEffect(() => {
    if (adminStatus === "admin") load();
  }, [adminStatus, load]);

  if (adminStatus === "checking") return <PageLoader label={t("surveyResults.loading")} minHeight="40vh" />;
  if (adminStatus === "not_admin") return <Navigate to="/dashboard" replace />;

  const survey = data?.survey;
  const status = survey?.status ?? "draft";

  const header = (
    <PageHeader
      title={t("surveyResults.title")}
      subtitle={t(`surveyResults.subtitle.${status}`)}
      actions={
        <>
          <Select
            size="sm"
            value={segment}
            onChange={(event) => setParam("segment", event.target.value)}
            aria-label={t("surveyResults.segment.label")}
            title={t("surveyResults.segment.hint")}
            data-testid="survey-segment-select"
          >
            <option value="">{t("surveyResults.segment.none")}</option>
            {SEGMENTS.map((value) => (
              <option key={value} value={value}>{t(`surveyResults.segment.${value}`)}</option>
            ))}
          </Select>
          <Button variant="primary" size="sm" onClick={load} disabled={loading}>
            {t("surveyResults.reload")}
          </Button>
        </>
      }
    />
  );

  return (
    <div className="mx-auto max-w-[1600px]">
      {header}

      {notFound && (
        <EmptyState
          icon={<InboxIcon size={26} aria-hidden="true" />}
          title={t("surveyResults.notFound.title")}
          description={t("surveyResults.notFound.description")}
          action={<Button variant="secondary" size="sm" onClick={() => navigate("/admin")}>{t("surveyResults.notFound.action")}</Button>}
        />
      )}

      {error && !notFound && (
        <ErrorState
          title={t("surveyResults.error.title")}
          description={error === "Admin only" ? t("surveyResults.error.forbidden") : t("surveyResults.error.description")}
          action={<Button variant="secondary" size="sm" onClick={load}>{t("surveyResults.error.retry")}</Button>}
        />
      )}

      {!data && loading && !notFound && !error && (
        <PageLoader label={t("surveyResults.loading")} minHeight="30vh" />
      )}

      {data && !notFound && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {/* Status som uppercase meta-label og ikke StatusBadge: badgens
                STATUS_TONE-nøgler er auktions-tilstande (live/won/outbid), og
                et skema er ikke en af dem. Et nyt tone-navn i den delte
                primitiv hører til i en PR om primitiven, ikke her. */}
            <span className="font-data text-2xs uppercase tracking-[.08em] text-cz-2">
              {t(`surveyResults.status.${status}`)}
            </span>
            <span className="font-data text-xs text-cz-3 tabular-nums">{survey?.slug}</span>
            {data.orphanQuestionKeys?.length > 0 && (
              <span className="text-xs text-cz-3">
                {t("surveyResults.orphan", {
                  n: data.orphanQuestionKeys.length,
                  keys: data.orphanQuestionKeys.join(", "),
                })}
              </span>
            )}
          </div>

          {data.totals.started === 0 ? (
            <EmptyState
              icon={<InboxIcon size={26} aria-hidden="true" />}
              title={t("surveyResults.empty.title")}
              description={t("surveyResults.empty.description")}
              action={<Button variant="secondary" size="sm" onClick={load}>{t("surveyResults.empty.action")}</Button>}
            />
          ) : (
            <Tabs value={activeTab} onChange={(tab) => setParam("tab", tab)}>
              <TabList label={t("surveyResults.title")} className="mb-4">
                <Tab value="overview">{t("surveyResults.tabs.overview")}</Tab>
                <Tab value="ideas">{t("surveyResults.tabs.ideas")}</Tab>
                <Tab value="worst">{t("surveyResults.tabs.worst")}</Tab>
                <Tab value="text">{t("surveyResults.tabs.text")}</Tab>
                <Tab value="pro">{t("surveyResults.tabs.pro")}</Tab>
                <Tab value="segments">{t("surveyResults.tabs.segments")}</Tab>
              </TabList>

              <TabPanel value="overview"><SurveyOverviewTab data={data} /></TabPanel>
              <TabPanel value="ideas"><SurveyIdeasTab data={data} /></TabPanel>
              <TabPanel value="worst">
                <SurveyPicksTab
                  data={data}
                  questionKey="works_worst"
                  title={t("surveyResults.worst.title")}
                  meta={t("surveyResults.worst.meta")}
                  emptyLabel={t("surveyResults.worst.empty")}
                  testId="survey-worst"
                />
              </TabPanel>
              <TabPanel value="text"><SurveyTextTab data={data} /></TabPanel>
              <TabPanel value="pro"><SurveyProTab data={data} /></TabPanel>
              <TabPanel value="segments"><SurveySegmentsTab data={data} /></TabPanel>
            </Tabs>
          )}
        </>
      )}
    </div>
  );
}
