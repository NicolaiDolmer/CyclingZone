// In-app spørgeskema (#4943) — /survey/:slug.
//
// Ejer-beslutning 7/9: skemaet bygges i spillet i stedet for Google Forms,
// fordi et link ud af spillet koster svar (roadmap-afstemningen får 30-35
// stemmer pr. punkt, den eksterne NPS-prompt fik 9).
//
// Skabelon: T1 standard content (max-w-4xl), docs/design/PAGE_TEMPLATES.md.
// Sidens ene guld-primære element er Send-knappen; skalatrinnene bruger
// Segmented-primitivets guld-tekst-på-10 %-flade (TASTE fork 3).
//
// AUTOSAVE frem for en submit-knap der gemmer alt: et spørgeskema med 12
// spørgsmål tabes af en lukket fane, og et tabt svar kommer aldrig igen.
// Hvert svar upsertes 400 ms efter sidste ændring (survey_responses har
// UNIQUE (survey_id, user_id, question_key)), så "Send" kun markerer
// gennemført i survey_completions. Det er også dét der gør at spilleren kan
// rette sine svar indtil skemaet lukker.
//
// Ren logik (normalisering, progress, sektioner) ligger i lib/survey.js og er
// unit-testet med node:test.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { supabase } from "../lib/supabase";
import {
  answersByQuestionKey,
  buildResponsePayload,
  computeProgress,
  groupQuestionsIntoSections,
  missingRequired,
  normalizeAnswer,
  questionHelp,
  questionLabel,
  sortQuestions,
} from "../lib/survey.js";
import SurveyQuestion from "../components/survey/SurveyQuestion.jsx";
import {
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  ProgressMeter,
  Section,
  SectionHeader,
  SectionStack,
  SkeletonLines,
  ClipboardIcon,
  CheckIcon,
} from "../components/ui";
import { buttonClass } from "../components/ui/buttonStyles.js";

const AUTOSAVE_DEBOUNCE_MS = 400;
const QUESTION_COLUMNS =
  "id, sort_order, key, kind, label_en, label_da, help_en, help_da, options, required";

// Endepunkts-etiketterne hører til skalaen, ikke til spørgsmålsteksten, så de
// bor i i18n frem for i databasens label-kolonner.
const SCALE_ENDS = {
  nps: { lowKey: "scale.npsLow", highKey: "scale.npsHigh" },
  satisfaction: { lowKey: "scale.satisfactionLow", highKey: "scale.satisfactionHigh" },
};

function SurveySkeleton() {
  return (
    <SectionStack>
      {[0, 1, 2].map((i) => (
        <Section key={i}>
          <SectionHeader title={<span className="inline-block h-3 w-40 rounded-[4px] bg-cz-subtle" />} />
          <SkeletonLines lines={4} />
        </Section>
      ))}
    </SectionStack>
  );
}

function RoadmapEmptyState({ icon, title, body, action }) {
  return (
    <EmptyState
      icon={icon}
      title={title}
      description={body}
      action={
        <Link to="/roadmap" className={buttonClass({ variant: "secondary", size: "sm" })}>
          {action}
        </Link>
      }
    />
  );
}

export default function SurveyPage() {
  const { slug } = useParams();
  const { t, i18n } = useTranslation("survey");
  const language = i18n.language;

  const [status, setStatus] = useState("loading"); // loading | ready | notFound | error
  const [survey, setSurvey] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [userId, setUserId] = useState(null);
  const [teamId, setTeamId] = useState(null);
  const [answers, setAnswers] = useState({});
  const [saveState, setSaveState] = useState({}); // question_key → saving | saved | error
  const [completed, setCompleted] = useState(false);
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);

  const timersRef = useRef(new Map());
  // Date.now() må ikke kaldes under render (react-hooks/purity), så starttiden
  // sættes i den effekt der alligevel kører én gang ved mount.
  const startedAtRef = useRef(0);

  // Debounce-timere skal ryddes ved unmount, ellers skriver en afmonteret side.
  useEffect(() => {
    startedAtRef.current = Date.now();
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    (async () => {
      const [{ data: surveyRow, error: surveyError }, { data: auth }] = await Promise.all([
        supabase.from("surveys").select("id, slug, title_en, title_da, status, closes_at").eq("slug", slug).maybeSingle(),
        supabase.auth.getUser(),
      ]);
      if (cancelled) return;
      if (surveyError) {
        setStatus("error");
        return;
      }
      if (!surveyRow) {
        setStatus("notFound");
        return;
      }
      setSurvey(surveyRow);

      const uid = auth?.user?.id ?? null;
      setUserId(uid);
      if (surveyRow.status !== "open" || !uid) {
        setStatus("ready");
        return;
      }

      const [{ data: questionRows }, { data: responseRows }, { data: completionRow }, { data: teamRow }] =
        await Promise.all([
          supabase.from("survey_questions").select(QUESTION_COLUMNS).eq("survey_id", surveyRow.id).order("sort_order"),
          supabase.from("survey_responses").select("question_key, value").eq("survey_id", surveyRow.id).eq("user_id", uid),
          supabase
            .from("survey_completions")
            .select("completed_at")
            .eq("survey_id", surveyRow.id)
            .eq("user_id", uid)
            .maybeSingle(),
          supabase.from("teams").select("id").eq("user_id", uid).maybeSingle(),
        ]);
      if (cancelled) return;
      setQuestions(sortQuestions(questionRows ?? []));
      setAnswers(answersByQuestionKey(responseRows));
      setCompleted(Boolean(completionRow));
      setTeamId(teamRow?.id ?? null);
      setStatus("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const persist = useCallback(
    async (question, value) => {
      if (!survey || !userId) return;
      setSaveState((prev) => ({ ...prev, [question.key]: "saving" }));
      const { error } = value
        ? await supabase.from("survey_responses").upsert(
            buildResponsePayload({
              surveyId: survey.id,
              userId,
              teamId,
              questionKey: question.key,
              value,
            }),
            { onConflict: "survey_id,user_id,question_key" }
          )
        : await supabase
            .from("survey_responses")
            .delete()
            .eq("survey_id", survey.id)
            .eq("user_id", userId)
            .eq("question_key", question.key);
      setSaveState((prev) => ({ ...prev, [question.key]: error ? "error" : "saved" }));
    },
    [survey, userId, teamId]
  );

  const handleChange = useCallback(
    (question, raw) => {
      let value = null;
      try {
        value = normalizeAnswer(question, raw);
      } catch {
        // En ugyldig værdi kan kun komme fra en kontrol der er ude af trit med
        // spørgsmålets type. Behold det viste svar, skriv ikke skrald.
        return;
      }
      setAnswers((prev) => {
        const next = { ...prev };
        if (value) next[question.key] = value;
        else delete next[question.key];
        return next;
      });
      setSubmitError(false);

      const timers = timersRef.current;
      clearTimeout(timers.get(question.key));
      timers.set(
        question.key,
        setTimeout(() => {
          timers.delete(question.key);
          persist(question, value);
        }, AUTOSAVE_DEBOUNCE_MS)
      );
    },
    [persist]
  );

  async function handleSubmit() {
    if (!survey || !userId) return;
    setSubmitting(true);
    setSubmitError(false);

    // Skriv alt hvad der stadig venter i en debounce-timer FØR gennemførelsen,
    // så "Send" aldrig kan lande før det sidste svar.
    const timers = timersRef.current;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    const pending = questions.map((question) => persist(question, answers[question.key] ?? null));
    await Promise.all(pending);

    const startedAt = startedAtRef.current || Date.now();
    const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    const { error } = await supabase.from("survey_completions").upsert(
      { survey_id: survey.id, user_id: userId, completed_at: new Date().toISOString(), seconds_spent: seconds },
      { onConflict: "survey_id,user_id" }
    );
    setSubmitting(false);
    if (error) {
      setSubmitError(true);
      return;
    }
    setCompleted(true);
    setEditing(false);
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }

  const sections = useMemo(() => groupQuestionsIntoSections(questions), [questions]);
  const progress = useMemo(() => computeProgress(questions, answers), [questions, answers]);
  const missing = useMemo(() => missingRequired(questions, answers), [questions, answers]);

  const title = survey ? (language?.startsWith("da") ? survey.title_da : survey.title_en) : "";

  if (status === "loading") {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title="" subtitle={t("page.subtitle")} />
        <SurveySkeleton />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title={t("error.title")} />
        <Section>
          <ErrorState
            title={t("error.title")}
            description={t("error.body")}
            action={
              <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
                {t("error.retry")}
              </Button>
            }
          />
        </Section>
      </div>
    );
  }

  if (status === "notFound") {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title={t("notFound.title")} />
        <Section>
          <RoadmapEmptyState
            icon={<ClipboardIcon size={26} aria-hidden="true" />}
            title={t("notFound.title")}
            body={t("notFound.body")}
            action={t("notFound.roadmap")}
          />
        </Section>
      </div>
    );
  }

  if (survey.status !== "open") {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title={title} />
        <Section>
          <RoadmapEmptyState
            icon={<CheckIcon size={26} aria-hidden="true" />}
            title={t("closed.title")}
            body={t("closed.body")}
            action={t("closed.roadmap")}
          />
        </Section>
      </div>
    );
  }

  if (completed && !editing) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title={title} />
        <Section>
          <SectionHeader title={t("thanks.title")} />
          <p className="text-sm leading-relaxed text-cz-2">{t("thanks.body")}</p>
          <p className="mt-2 text-sm leading-relaxed text-cz-2">{t("thanks.editable")}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-cz-border pt-4">
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              {t("thanks.edit")}
            </Button>
            <Link to="/roadmap" className="text-xs font-medium text-cz-accent-t hover:underline">
              {t("thanks.roadmap")}
            </Link>
          </div>
        </Section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={title} subtitle={t("page.subtitle")} />

      <p className="mb-1 text-sm leading-relaxed text-cz-2">{t("page.introLead")}</p>
      <p className="mb-4 text-sm leading-relaxed text-cz-2">{t("page.introAccount")}</p>

      <div className="sticky top-0 z-sticky -mx-4 mb-4 bg-cz-bg px-4 py-2 sm:-mx-8 sm:px-8">
        <ProgressMeter
          value={progress.percent}
          label={t("progress.label")}
          ariaLabel={t("progress.aria")}
          showValue
        />
      </div>

      <SectionStack>
        {sections.map((section) => (
          <Section key={section.id}>
            <SectionHeader title={t(`sections.${section.id}`)} />
            <div className="flex flex-col gap-4">
              {section.questions.map((question) => {
                const ends = SCALE_ENDS[question.key];
                return (
                  <SurveyQuestion
                    key={question.key}
                    question={question}
                    label={questionLabel(question, language)}
                    help={questionHelp(question, language)}
                    value={answers[question.key] ?? null}
                    language={language}
                    saveState={saveState[question.key]}
                    disabled={submitting}
                    onChange={(raw) => handleChange(question, raw)}
                    scaleEnds={ends ? { low: t(ends.lowKey), high: t(ends.highKey) } : null}
                  />
                );
              })}
            </div>
          </Section>
        ))}

        <Section>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" loading={submitting} disabled={missing.length > 0} onClick={handleSubmit}>
              {submitting ? t("submit.sending") : t("submit.cta")}
            </Button>
            <span aria-live="polite" className="text-xs text-cz-2">
              {missing.length > 0 && t("submit.missing", { count: missing.length })}
              {missing.length === 0 && submitError && (
                <span className="text-cz-danger">{t("submit.error")}</span>
              )}
            </span>
          </div>
        </Section>
      </SectionStack>
    </div>
  );
}
