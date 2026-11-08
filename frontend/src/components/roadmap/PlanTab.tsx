// #6150 · Plan-fanen (spec §3.1): det besluttede, i ejerens rækkefølge.
// #7666/#7895: grupperet efter horisont (denne uge, næste uge, sæson 5, sæson 6,
// Q1 2027 ...), så spilleren kan se HVORNÅR noget kommer. Ugerne står
// med datoer. Det der bygges nu, står øverst i sin horisont med et "I gang"-
// mærke og har ingen skala (det der er i beta, står kun på Beta-fanen, #6160);
// planlagte punkter har én ("Important to you?"). Kvartaler og år er foldet.
import { useTranslation } from "react-i18next";
import {
  holdsItem, horizonLabelKey, isFoldedHorizon, roadmapRowId, weekRange,
  type PlanGroup, type RoadmapHorizon, type RoadmapItem, type RoadmapVote,
} from "../../lib/roadmapModel.ts";
import { CollapsibleSection, EmptyState, Section, SectionHeader, Button, StatusBadge } from "./roadmapUi.ts";
import ScoreScale, { DontKnowButton } from "./ScoreScale.tsx";
import { isDontKnow } from "../../lib/roadmapVoting.js";
import { RowMeta, RowTitle, SaveNote, SkeletonRows, ROW, ROW_LIST } from "./RoadmapRows.tsx";
import { areaTitle, dateRange, localTitle, type SaveState } from "./roadmapFormat.ts";
import { CheckIcon, ClipboardIcon } from "../ui/index.js";

export interface PlanTabProps {
  loading: boolean;
  /** Horisont-grupper efter filteret "kun ubedømte" (i gang/beta filtreres aldrig væk). */
  groups: PlanGroup[];
  /** Ejerens nummer pr. planlagt punkt (fra den ufiltrerede liste), så filteret ikke omnummererer. */
  rankById: Map<string, number>;
  /** Hvor mange besluttede punkter (i gang + planlagt) der findes i alt, før filteret. */
  decidedTotal: number;
  /** Hvor mange planlagte punkter der findes i alt, før filteret. */
  plannedTotal: number;
  onlyUnrated: boolean;
  votes: Map<string, RoadmapVote>;
  saveState: Record<string, SaveState>;
  canVote: boolean;
  isNew: (item: RoadmapItem) => boolean;
  onRate: (item: RoadmapItem, value: number) => void;
  onDontKnow: (item: RoadmapItem) => void;
  onShowAll: () => void;
  onGoVote: () => void;
  /** Punktet et søgehit åbnede; dets fold står åben. */
  revealId?: string | null;
  /** Til ugernes datoer; kan fastlåses i tests og billeder. */
  now?: Date;
}


export default function PlanTab(props: PlanTabProps) {
  const { t, i18n } = useTranslation("roadmap");
  const lang = i18n.language;
  const { loading, groups, decidedTotal, plannedTotal, onlyUnrated } = props;
  const now = props.now ?? new Date();

  if (loading) {
    return (
      <Section aria-busy>
        <SectionHeader title={t("plan.title")} />
        <SkeletonRows withScale />
      </Section>
    );
  }

  if (decidedTotal === 0) {
    return (
      <EmptyState
        icon={<ClipboardIcon size={26} aria-hidden="true" />}
        title={t("empty.planNone.title")}
        description={t("empty.planNone.description")}
        action={<Button variant="secondary" size="sm" onClick={props.onGoVote}>{t("empty.planNone.action")}</Button>}
      />
    );
  }

  const horizonDates = (horizon: RoadmapHorizon): string => {
    if (horizon === "this_week" || horizon === "next_week") {
      const { start, end } = weekRange(now, horizon === "this_week" ? 0 : 1);
      return dateRange(start, end, lang);
    }
    return "";
  };

  const renderRow = (item: RoadmapItem) => {
    const planned = item.status === "planned";
    const vote = props.votes.get(item.id);
    const state = props.saveState[item.id];
    return (
      <li key={item.id} id={roadmapRowId(item.id)} className={`${ROW} flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4`}>
        <div className="flex-1 min-w-0 flex gap-3">
          <span className="w-5 shrink-0 font-data tabular-nums text-xs text-cz-3 pt-0.5 text-right">
            {planned ? props.rankById.get(item.id) ?? "" : ""}
          </span>
          <div className="min-w-0">
            {!planned && <div className="mb-1"><StatusBadge state="info">{t("plan.badgeInProgress")}</StatusBadge></div>}
            <RowTitle isNew={props.isNew(item)} newLabel={t("labels.new")}>{localTitle(item, lang)}</RowTitle>
            <RowMeta>{areaTitle(t, item.engine)}</RowMeta>
          </div>
        </div>
        {planned && props.canVote && (
          <div className="ps-8 sm:ps-0 sm:w-auto flex flex-col gap-1">
            <ScoreScale
              label={t("voting.importance")}
              value={vote?.importance_score}
              disabled={state === "saving"}
              onSelect={(n) => props.onRate(item, n)}
            />
            <DontKnowButton
              label={t("voting.dontKnow")}
              pressed={isDontKnow(vote)}
              disabled={state === "saving"}
              onSelect={() => props.onDontKnow(item)}
            />
            <SaveNote state={state} savedLabel={t("voting.saved")} errorLabel={t("voting.error")} />
          </div>
        )}
      </li>
    );
  };

  const horizonTitle = (horizon: RoadmapHorizon): string => {
    const { key, values } = horizonLabelKey(horizon);
    return t(key, values);
  };
  const near = groups.filter((g) => !isFoldedHorizon(g.horizon));
  const far = groups.filter((g) => isFoldedHorizon(g.horizon));
  const plannedVisible = groups.reduce((n, g) => n + g.items.filter((i) => i.status === "planned").length, 0);
  const allRated = onlyUnrated && plannedTotal > 0 && plannedVisible === 0;

  return (
    <Section>
      <SectionHeader title={t("plan.title")} meta={t("plan.plannedHint")} />
      <div className="flex flex-col gap-5">
        {near.map((g) => {
          const dates = horizonDates(g.horizon);
          return (
            <section key={g.horizon} aria-labelledby={`roadmap-horizon-${g.horizon}`}>
              <div className="flex items-baseline justify-between gap-3 pb-2 border-b border-cz-border">
                <h3 id={`roadmap-horizon-${g.horizon}`} className="text-sm font-semibold text-cz-1">
                  {horizonTitle(g.horizon)}
                  {dates && <span className="ms-2 font-data tabular-nums text-xs font-normal text-cz-3">{dates}</span>}
                </h3>
                <span className="font-data tabular-nums text-xs text-cz-3">{g.items.length}</span>
              </div>
              <ul className={ROW_LIST}>{g.items.map(renderRow)}</ul>
            </section>
          );
        })}

        {allRated && (
          <EmptyState
            icon={<CheckIcon size={26} aria-hidden="true" />}
            title={t("empty.plan.title")}
            description={t("empty.plan.description")}
            action={<Button variant="secondary" size="sm" onClick={props.onShowAll}>{t("empty.plan.action")}</Button>}
          />
        )}

        {far.map((g) => (
          <CollapsibleSection
            key={g.horizon}
            defaultOpen={holdsItem(g.items, props.revealId)}
            title={horizonTitle(g.horizon)}
            meta={<span className="tabular-nums">{g.items.length}</span>}
          >
            <ul className={ROW_LIST}>{g.items.map(renderRow)}</ul>
          </CollapsibleSection>
        ))}
      </div>
    </Section>
  );
}
