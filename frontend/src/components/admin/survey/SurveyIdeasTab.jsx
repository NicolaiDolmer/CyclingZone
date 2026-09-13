import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { DataTable, Section, SectionHeader } from "../../ui";
import { optionGroup, optionLabel } from "../../../lib/survey.js";
import { DualBar, QuadrantChart, fmtInt, fmtNum, fmtPct } from "./surveyCharts.jsx";
import { questionByKey } from "./surveyLabels.js";

// #4943 · Idéerne: 20 forslag målt på to akser. Kvadrant-plottet svarer på
// "hvad skal bygges først" på et halvt sekund; tabellen under er tallene bag.
//
// Prioritetsscoren regnes i backend/lib/surveyResults.js (idé x vigtigt).
// Fladen sorterer kun, den regner ikke: to sorteringer af det samme tal må
// aldrig kunne give to forskellige rangfølger.

const SORTABLE = {
  priority: (o) => o.priority,
  idea: (o) => o.avgIdea,
  importance: (o) => o.avgImportance,
  dontKnow: (o) => o.dontKnowPct,
  veto: (o) => o.vetoPct,
  n: (o) => o.n,
};

export default function SurveyIdeasTab({ data }) {
  const { t, i18n } = useTranslation("admin");
  const language = i18n.language;
  const axes = questionByKey(data, "feature_axes");

  const [sort, setSort] = useState("priority");
  const [sortDir, setSortDir] = useState("desc");

  const rows = useMemo(() => {
    const list = [...(axes?.options ?? [])];
    const read = SORTABLE[sort] ?? SORTABLE.priority;
    list.sort((a, b) => {
      // Idéer uden tal ligger altid nederst, uanset retning: en tom række må
      // ikke kunne toppe listen bare fordi man vender sorteringen.
      const av = read(a);
      const bv = read(b);
      if (av == null && bv == null) return a.key.localeCompare(b.key);
      if (av == null) return 1;
      if (bv == null) return -1;
      return sortDir === "desc" ? bv - av : av - bv;
    });
    return list;
  }, [axes, sort, sortDir]);

  const points = useMemo(
    () => (axes?.options ?? [])
      .filter((option) => option.avgIdea != null && option.avgImportance != null)
      .map((option) => ({
        key: option.key,
        label: optionLabel(option, language),
        x: option.avgIdea,
        y: option.avgImportance,
        n: option.n,
        rank: option.rank,
      })),
    [axes, language],
  );

  function handleSort(key) {
    if (key === sort) {
      setSortDir((dir) => (dir === "desc" ? "asc" : "desc"));
      return;
    }
    setSort(key);
    setSortDir("desc");
  }

  const empty = <p className="text-[13px] text-cz-3">{t("surveyResults.ideas.empty")}</p>;

  const columns = [
    {
      key: "feature",
      header: t("surveyResults.ideas.columns.feature"),
      sticky: true,
      // Idé-teksten er en hel sætning. Uden en bredde-grænse voksede den
      // sticky kolonne til 760 px og skubbede prioritets-kolonnen ud over
      // kortets kant på 1280 px, altså præcis det tal man kom for.
      render: (row) => (
        <span className="flex items-baseline gap-2">
          <span className="font-data text-2xs tabular-nums text-cz-3">{row.rank ?? "—"}</span>
          <span className="block max-w-[300px] whitespace-normal lg:max-w-[420px]">
            {optionLabel(row, language)}
          </span>
        </span>
      ),
      subline: (row) => optionGroup(row, language),
    },
    {
      key: "bars",
      header: `${t("surveyResults.ideas.columns.idea")} / ${t("surveyResults.ideas.columns.importance")}`,
      render: (row) => (
        <DualBar
          primary={row.avgIdea}
          secondary={row.avgImportance}
          primaryTitle={`${t("surveyResults.ideas.columns.idea")} ${fmtNum(row.avgIdea, 2)}`}
          secondaryTitle={`${t("surveyResults.ideas.columns.importance")} ${fmtNum(row.avgImportance, 2)}`}
        />
      ),
    },
    { key: "idea", header: t("surveyResults.ideas.columns.idea"), numeric: true, sortKey: "idea", render: (row) => fmtNum(row.avgIdea, 2) },
    { key: "importance", header: t("surveyResults.ideas.columns.importance"), numeric: true, sortKey: "importance", render: (row) => fmtNum(row.avgImportance, 2) },
    { key: "priority", header: t("surveyResults.ideas.columns.priority"), numeric: true, sortKey: "priority", render: (row) => fmtNum(row.priority, 2) },
    { key: "veto", header: t("surveyResults.ideas.columns.veto"), numeric: true, sortKey: "veto", fold: true, foldValue: (row) => fmtPct(row.vetoPct), render: (row) => fmtPct(row.vetoPct) },
    { key: "dontKnow", header: t("surveyResults.ideas.columns.dontKnow"), numeric: true, sortKey: "dontKnow", fold: true, foldValue: (row) => fmtPct(row.dontKnowPct), render: (row) => fmtPct(row.dontKnowPct) },
    { key: "n", header: t("surveyResults.ideas.columns.n"), numeric: true, sortKey: "n", render: (row) => fmtInt(row.n) },
  ];

  return (
    <div className="space-y-[14px]">
      <Section>
        <SectionHeader title={t("surveyResults.ideas.quadrant")} meta={t("surveyResults.ideas.meta")} />
        {points.length === 0 ? empty : (
          <QuadrantChart
            points={points}
            axisXLabel={t("surveyResults.ideas.quadrantX")}
            axisYLabel={t("surveyResults.ideas.quadrantY")}
            cornerLabel={t("surveyResults.ideas.quadrantCorner")}
          />
        )}
      </Section>

      {/* Tabellen står i sin EGEN hairline-ramme (T2's tabel-recipe) og pakkes
          derfor ikke ind i et Section-kort: det ville være en kasse i en kasse. */}
      <div>
        <h2 className="mb-2 text-[15px] font-semibold text-cz-1">{t("surveyResults.ideas.title")}</h2>
        <DataTable
          label={t("surveyResults.ideas.title")}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.key}
          /* D-047 (#5102): de tre tal en idé rangeres paa. */
          mobileDefaults={["idea", "importance", "priority"]}
          sort={sort}
          sortDir={sortDir}
          onSort={handleSort}
          empty={empty}
          count={t("surveyResults.ideas.vetoHint")}
        />
      </div>
    </div>
  );
}
