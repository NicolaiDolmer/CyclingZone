import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, EmptyState, FilterBar, MessageIcon } from "../../ui";
import { questionLabel } from "../../../lib/survey.js";
import { fmtInt } from "./surveyCharts.jsx";
import { segmentLabel, textQuestions } from "./surveyLabels.js";

// #4943 · Fritekst-svarene fra alle fire tekst-spørgsmål i én liste.
//
// Hvorfor ét filter og ikke fire lister under hinanden: de fire spørgsmål
// besvares af de samme managere om det samme, og den interessante læsning er
// "hvad skrev de om mobilen", ikke "hvad skrev de i spørgsmål 3". Filteret
// giver stadig ét spørgsmål ad gangen for den der vil læse dem systematisk.
//
// Konteksten pr. svar er hold, division og sprog. IKKE email eller brugernavn:
// et screenshot af fladen skal kunne deles uden at flytte persondata med.
export default function SurveyTextTab({ data, questionKeys = null }) {
  const { t, i18n } = useTranslation("admin");
  const language = i18n.language;

  const questions = useMemo(() => {
    const all = textQuestions(data);
    return questionKeys ? all.filter((q) => questionKeys.includes(q.key)) : all;
  }, [data, questionKeys]);

  const [questionFilter, setQuestionFilter] = useState("all");
  const [search, setSearch] = useState("");

  const answers = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = [];
    for (const question of questions) {
      if (questionFilter !== "all" && question.key !== questionFilter) continue;
      for (const answer of question.answers ?? []) {
        if (needle && !answer.text.toLowerCase().includes(needle)) continue;
        rows.push({ ...answer, questionKey: question.key, questionLabel: questionLabel(question, language) });
      }
    }
    // Nyeste først på tværs af spørgsmålene, ikke grupperet pr. spørgsmål.
    rows.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
    return rows;
  }, [questions, questionFilter, search, language]);

  const total = useMemo(
    () => questions.reduce((sum, question) => sum + (question.answers?.length ?? 0), 0),
    [questions],
  );

  return (
    <div className="space-y-4">
      <FilterBar
        className="mb-0"
        search={{
          value: search,
          onChange: (event) => setSearch(event.target.value),
          placeholder: t("surveyResults.text.searchPlaceholder"),
          ariaLabel: t("surveyResults.text.search"),
          testId: "survey-text-search",
        }}
        filters={[{
          key: "question",
          value: questionFilter,
          onChange: (event) => setQuestionFilter(event.target.value),
          ariaLabel: t("surveyResults.text.question"),
          options: [
            { value: "all", label: t("surveyResults.text.allQuestions") },
            ...questions.map((question) => ({ value: question.key, label: questionLabel(question, language) })),
          ],
        }]}
        meta={t("surveyResults.text.count", { shown: fmtInt(answers.length), total: fmtInt(total) })}
      />

      {answers.length === 0 ? (
        <EmptyState
          icon={<MessageIcon size={26} aria-hidden="true" />}
          title={t("surveyResults.text.empty")}
          description={t("surveyResults.empty.description")}
          action={
            <Button variant="secondary" size="sm" onClick={() => { setSearch(""); setQuestionFilter("all"); }}>
              {t("surveyResults.text.emptyAction")}
            </Button>
          }
        />
      ) : (
        <ul className="rounded-cz border border-cz-border bg-cz-card" data-testid="survey-text-list">
          {answers.map((answer, index) => (
            <li
              key={`${answer.questionKey}-${answer.at}-${index}`}
              className={`px-4 py-3.5 sm:px-5 ${index > 0 ? "border-t border-cz-border" : ""}`}
            >
              <p className="font-data text-2xs uppercase tracking-[.08em] text-cz-3">{answer.questionLabel}</p>
              <p className="mt-1.5 whitespace-pre-wrap text-[13.5px] text-cz-1">{answer.text}</p>
              <p className="mt-2 font-data text-3xs uppercase tracking-[.06em] text-cz-3 tabular-nums">
                {[
                  answer.teamName || t("surveyResults.text.noTeam"),
                  answer.division == null
                    ? null
                    : t("surveyResults.text.division", { value: answer.division }),
                  segmentLabel(t, answer.language),
                  answer.at ? new Date(answer.at).toLocaleString("da-DK", { dateStyle: "short", timeStyle: "short" }) : null,
                ].filter(Boolean).join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
