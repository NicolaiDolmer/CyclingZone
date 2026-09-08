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
//
// `.limit(1)` + `[0]` frem for `.maybeSingle()`: scope'et ER unikt (surveys.slug er UNIQUE og (survey_id, user_id) er survey_completions primærnøgle),
// men check-maybesingle-unique-scope.mjs kan ikke opløse en tabel der ikke
// findes i database/schema-snapshot.json endnu, og den fejler loudly frem for
// at springe over (#4496). Tabellerne oprettes af denne PRs egen migration;
// snapshottet får dem først ved næste refresh efter merge.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
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
  resolveSurveyView,
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
  EyeIcon,
} from "../components/ui";
import { buttonClass } from "../components/ui/buttonStyles.js";

const AUTOSAVE_DEBOUNCE_MS = 400;
const QUESTION_COLUMNS =
  "id, sort_order, key, kind, label_en, label_da, help_en, help_da, options, required";

// Endepunkts-etiketterne hører til skalaen, ikke til spørgsmålsteksten, så de
// bor i i18n frem for i databasens label-kolonner.
const SCALE_ENDS = {
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
  // open | preview | closed — se resolveSurveyView i lib/survey.js.
  const [view, setView] = useState("closed");
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
  const writeChainsRef = useRef(new Map());
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
    // Nulstil ALT der hænger på det forrige slug. Uden det kan en klient-side
    // navigation fra ét skema til et andet vise det gamle skemas spørgsmål og
    // svar, hvis den nye indlæsning ender i en tidlig retur (CodeRabbit-review
    // på #4943).
    setQuestions([]);
    setAnswers({});
    setSaveState({});
    setCompleted(false);
    setEditing(false);
    (async () => {
      // is_admin-RPC'en er samme admin-gate som RoadmapPage bruger. Den er
      // billig og svarer false for alle andre, saa den kan koere sammen med
      // skema-opslaget uden at koste et ekstra rundtur for spilleren.
      const [{ data: surveyRows, error: surveyError }, { data: auth }, { data: adminRaw }] = await Promise.all([
        supabase.from("surveys").select("id, slug, title_en, title_da, status, closes_at").eq("slug", slug).limit(1),
        supabase.auth.getUser(),
        supabase.rpc("is_admin"),
      ]);
      if (cancelled) return;
      if (surveyError) {
        setStatus("error");
        return;
      }
      const surveyRow = surveyRows?.[0] ?? null;
      if (!surveyRow) {
        setStatus("notFound");
        return;
      }
      setSurvey(surveyRow);

      const uid = auth?.user?.id ?? null;
      setUserId(uid);
      const nextView = resolveSurveyView({ status: surveyRow.status, isAdmin: adminRaw === true });
      // Uden en bruger vises ALDRIG formularen. Ruten er login-gated, så det
      // her er en session der er faldet væk midt i navigationen: en tom
      // formular med en klikbar Send-knap ville love en aflevering der aldrig
      // kan gennemføres (handleSubmit returnerer uden userId).
      setView(uid ? nextView : "closed");
      if (nextView === "closed" || !uid) {
        setStatus("ready");
        return;
      }

      // Kladde-preview (#4943): hent KUN spoergsmaalene. Der findes hverken
      // svar eller gennemfoerelser paa en kladde, og et opslag der alligevel
      // returnerede noget ville vise ejeren en tilstand spillerne aldrig faar.
      if (nextView === "preview") {
        const { data: draftQuestions, error: draftError } = await supabase
          .from("survey_questions")
          .select(QUESTION_COLUMNS)
          .eq("survey_id", surveyRow.id)
          .order("sort_order");
        if (cancelled) return;
        if (draftError) {
          setStatus("error");
          return;
        }
        setQuestions(sortQuestions(draftQuestions ?? []));
        setStatus("ready");
        return;
      }

      const [questionRes, responseRes, completionRes, teamRes] = await Promise.all([
        supabase.from("survey_questions").select(QUESTION_COLUMNS).eq("survey_id", surveyRow.id).order("sort_order"),
        supabase.from("survey_responses").select("question_key, value").eq("survey_id", surveyRow.id).eq("user_id", uid),
        supabase
          .from("survey_completions")
          .select("completed_at")
          .eq("survey_id", surveyRow.id)
          .eq("user_id", uid)
          .limit(1),
        supabase.from("teams").select("id").eq("user_id", uid).maybeSingle(),
      ]);
      if (cancelled) return;
      // En tabt spoergsmaals-query maa ALDRIG blive til "skemaet har nul
      // spoergsmaal": saa er intet paakraevet, Send bliver klikbar, og
      // spilleren afleverer en tom besvarelse han tror er komplet.
      if (questionRes.error || responseRes.error || completionRes.error) {
        setStatus("error");
        return;
      }
      const { data: questionRows } = questionRes;
      const { data: responseRows } = responseRes;
      const { data: completionRows } = completionRes;
      const { data: teamRow } = teamRes;
      setQuestions(sortQuestions(questionRows ?? []));
      setAnswers(answersByQuestionKey(responseRows));
      setCompleted(Boolean(completionRows?.[0]));
      setTeamId(teamRow?.id ?? null);
      setStatus("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const isPreview = view === "preview";

  const writeOne = useCallback(
    async (question, value) => {
      // Kladde-preview skriver ALDRIG. RLS afviser alligevel en insert mod et
      // skema der ikke er 'open', men en afvist skrivning ville vise ejeren en
      // roed "svaret blev ikke gemt"-tilstand paa hvert eneste klik.
      if (isPreview) return true;
      if (!survey || !userId) return false;
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
      return !error;
    },
    [isPreview, survey, userId, teamId]
  );

  // Skrivningerne serialiseres PR. SPOERGSMAAL. To hurtige klik paa samme
  // skala giver to upserts, og uden en koe kan den foerste (1) lande efter den
  // anden (2): sidens tilstand siger 2, databasen siger 1. Koeen er pr. noegle,
  // saa to forskellige spoergsmaal stadig skrives parallelt.
  const persist = useCallback(
    (question, value) => {
      const chains = writeChainsRef.current;
      const run = () => writeOne(question, value);
      const next = (chains.get(question.key) ?? Promise.resolve(true)).then(run, run);
      chains.set(question.key, next);
      return next;
    },
    [writeOne]
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
      // Preview: svaret bliver staaende paa skaermen saa hele formularen kan
      // proeves af, men der startes ingen autosave-timer.
      if (isPreview) return;

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
    [isPreview, persist]
  );

  async function handleSubmit() {
    // Send-knappen er deaktiveret i preview; det her er baeltet til selerne.
    if (isPreview) return;
    if (!survey || !userId) return;
    setSubmitting(true);
    setSubmitError(false);

    // Skriv alt hvad der stadig venter i en debounce-timer FØR gennemførelsen,
    // så "Send" aldrig kan lande før det sidste svar. Kun de spørgsmål der
    // faktisk har en ventende timer skrives: alt andet er allerede gemt, og en
    // blind gen-skrivning af alle 12 ville sende en DELETE for hvert ubesvaret
    // spørgsmål ved hvert klik på Send.
    const timers = timersRef.current;
    const pendingKeys = [...timers.keys()];
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    const written = await Promise.all(
      questions
        .filter((question) => pendingKeys.includes(question.key))
        .map((question) => persist(question, answers[question.key] ?? null))
    );
    // En fejlet svar-skrivning maa ikke blive til en gennemfoert besvarelse:
    // tak-fladen ville sige at alt er landet, mens et svar mangler i databasen.
    if (written.some((ok) => ok === false)) {
      setSubmitting(false);
      setSubmitError(true);
      return;
    }

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

  if (view === "closed") {
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

      {/* Kladde-bjaelke (#4943): hairline, ingen skygge, stroke-ikon. Én kort
          linje — hvad fladen er, hvem der ser den, og at intet gemmes. */}
      {isPreview && (
        <div
          role="status"
          className="mb-4 flex items-start gap-2 rounded-cz border border-cz-border bg-cz-subtle px-3 py-2 text-[13px] leading-relaxed text-cz-2"
        >
          <EyeIcon size={14} aria-hidden="true" className="mt-[3px] shrink-0 text-cz-3" />
          <span>{t("preview.notice")}</span>
        </div>
      )}

      {/* introAccount ("dine svar gemmes på din konto") skjules i preview:
          kladde-bjælken lige ovenfor siger det modsatte, og to linjer der
          modsiger hinanden er værre end én linje mindre. */}
      <p className={`text-sm leading-relaxed text-cz-2 ${isPreview ? "mb-4" : "mb-1"}`}>{t("page.introLead")}</p>
      {!isPreview && <p className="mb-4 text-sm leading-relaxed text-cz-2">{t("page.introAccount")}</p>}

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
            <Button
              size="sm"
              loading={submitting}
              disabled={isPreview || missing.length > 0}
              onClick={handleSubmit}
            >
              {submitting ? t("submit.sending") : t("submit.cta")}
            </Button>
            <span aria-live="polite" className="text-xs text-cz-2">
              {isPreview && t("preview.submitDisabled")}
              {!isPreview && missing.length > 0 && t("submit.missing", { count: missing.length })}
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
