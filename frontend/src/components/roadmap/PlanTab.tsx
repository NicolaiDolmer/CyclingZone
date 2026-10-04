// #6150 · Plan-fanen (spec §3.1): det besluttede, i ejerens rækkefølge.
// "In progress" har ingen skala; "Planned" har én ("Important to you?"), og
// punkter med horizon = later ligger bag en fold. Ingen datoer.
import { useTranslation } from "react-i18next";
import type { RoadmapItem, RoadmapVote } from "../../lib/roadmapModel.ts";
import { CollapsibleSection, EmptyState, Section, SectionHeader, SectionStack, Button } from "./roadmapUi.ts";
import ScoreScale from "./ScoreScale.tsx";
import { RowMeta, RowTitle, SaveNote, SkeletonRows, ROW, ROW_LIST } from "./RoadmapRows.tsx";
import { areaTitle, localTitle, type SaveState } from "./roadmapFormat.ts";
import { CheckIcon, ClipboardIcon } from "../ui/index.js";

export interface PlanTabProps {
  loading: boolean;
  inProgress: RoadmapItem[];
  plannedNext: RoadmapItem[];
  plannedLater: RoadmapItem[];
  /** Ejerens nummer pr. punkt (fra den ufiltrerede liste), så filteret ikke omnummererer. */
  rankById: Map<string, number>;
  /** Hvor mange planlagte punkter der findes i alt, før filteret. */
  plannedTotal: number;
  onlyUnrated: boolean;
  votes: Map<string, RoadmapVote>;
  saveState: Record<string, SaveState>;
  canVote: boolean;
  isNew: (item: RoadmapItem) => boolean;
  onRate: (item: RoadmapItem, value: number) => void;
  onShowAll: () => void;
  onGoVote: () => void;
}

export default function PlanTab(props: PlanTabProps) {
  const { t, i18n } = useTranslation("roadmap");
  const { loading, inProgress, plannedNext, plannedLater, plannedTotal, onlyUnrated } = props;

  if (loading) {
    return (
      <SectionStack>
        <Section aria-busy><SectionHeader title={t("plan.inProgress")} /><SkeletonRows /></Section>
        <Section aria-busy><SectionHeader title={t("plan.planned")} /><SkeletonRows withScale /></Section>
      </SectionStack>
    );
  }

  const plannedVisible = plannedNext.length + plannedLater.length;
  if (inProgress.length === 0 && plannedTotal === 0) {
    return (
      <EmptyState
        icon={<ClipboardIcon size={26} aria-hidden="true" />}
        title={t("empty.planNone.title")}
        description={t("empty.planNone.description")}
        action={<Button variant="secondary" size="sm" onClick={props.onGoVote}>{t("empty.planNone.action")}</Button>}
      />
    );
  }

  const renderPlanned = (item: RoadmapItem) => {
    const vote = props.votes.get(item.id);
    const state = props.saveState[item.id];
    return (
      <li key={item.id} className={`${ROW} flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4`}>
        <div className="flex-1 min-w-0 flex gap-3">
          <span className="w-5 shrink-0 font-data tabular-nums text-xs text-cz-3 pt-0.5 text-right">
            {props.rankById.get(item.id) ?? ""}
          </span>
          <div className="min-w-0">
            <RowTitle isNew={props.isNew(item)} newLabel={t("labels.new")}>{localTitle(item, i18n.language)}</RowTitle>
            <RowMeta>{areaTitle(t, item.engine)}</RowMeta>
          </div>
        </div>
        {props.canVote && (
          <div className="ps-8 sm:ps-0 sm:w-auto flex flex-col gap-1">
            <ScoreScale
              label={t("voting.importance")}
              value={vote?.importance_score}
              disabled={state === "saving"}
              onSelect={(n) => props.onRate(item, n)}
            />
            <SaveNote state={state} savedLabel={t("voting.saved")} errorLabel={t("voting.error")} />
          </div>
        )}
      </li>
    );
  };

  return (
    <SectionStack>
      {inProgress.length > 0 && (
        <Section>
          <SectionHeader title={t("plan.inProgress")} meta={<span className="tabular-nums">{inProgress.length}</span>} />
          <ul className={ROW_LIST}>
            {inProgress.map((item) => (
              <li key={item.id} className={ROW}>
                <RowTitle isNew={props.isNew(item)} newLabel={t("labels.new")}>{localTitle(item, i18n.language)}</RowTitle>
                <RowMeta>{areaTitle(t, item.engine)}</RowMeta>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {plannedTotal > 0 && (
        <Section>
          <SectionHeader title={t("plan.planned")} meta={t("plan.plannedHint")} />
          {plannedVisible === 0 && onlyUnrated ? (
            <EmptyState
              icon={<CheckIcon size={26} aria-hidden="true" />}
              title={t("empty.plan.title")}
              description={t("empty.plan.description")}
              action={<Button variant="secondary" size="sm" onClick={props.onShowAll}>{t("empty.plan.action")}</Button>}
            />
          ) : (
            <>
              {plannedNext.length > 0 && <ul className={ROW_LIST}>{plannedNext.map(renderPlanned)}</ul>}
              {plannedLater.length > 0 && (
                <CollapsibleSection
                  className="mt-3"
                  title={t("plan.later", { count: plannedLater.length })}
                >
                  <ul className={ROW_LIST}>{plannedLater.map(renderPlanned)}</ul>
                </CollapsibleSection>
              )}
            </>
          )}
        </Section>
      )}
    </SectionStack>
  );
}
