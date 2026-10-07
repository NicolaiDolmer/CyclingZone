// #6150 · Vote-fanen (spec §3.2): idéer ejeren overvejer, med begge skalaer
// som i dag, men i to trin (ejer 4/10): først kun "Good idea?"; når den er
// valgt, eller der allerede er en stemme, folder "Important to you?" ud. Kun
// rækken selv vokser. Stemmen gemmes, når begge er valgt (buildVotePayload).
import { useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { engineCounts, type RoadmapItem } from "../../lib/roadmapModel.ts";
import { isValidScore } from "../../lib/roadmapVoting.js";
import { Button, EmptyState, Section, SectionHeader, Segmented } from "./roadmapUi.ts";
import ScoreScale from "./ScoreScale.tsx";
import { RowMeta, RowTitle, SaveNote, SkeletonRows, ROW, ROW_LIST } from "./RoadmapRows.tsx";
import { areaTitle, localTitle, type SaveState } from "./roadmapFormat.ts";
import { buttonClass } from "../ui/buttonStyles.js";
import { CheckIcon, MessageIcon } from "../ui/index.js";

export const FORUM_ROADMAP_PATH = "/forum?category=roadmap";

export interface VoteDraft { idea: number | null; importance: number | null }

export interface VoteTabProps {
  loading: boolean;
  /** Idéer efter filteret. */
  ideas: RoadmapItem[];
  /** Hvor mange idéer der findes i alt, før filteret. */
  ideasTotal: number;
  onlyUnrated: boolean;
  drafts: Record<string, VoteDraft>;
  saveState: Record<string, SaveState>;
  canVote: boolean;
  isNew: (item: RoadmapItem) => boolean;
  onScore: (item: RoadmapItem, axis: "idea" | "importance", value: number) => void;
  onShowAll: () => void;
}

export default function VoteTab(props: VoteTabProps) {
  const { t, i18n } = useTranslation("roadmap");
  const [area, setArea] = useState("all");
  const { loading, ideas, ideasTotal, onlyUnrated } = props;

  const forumLink = (
    <Link to={FORUM_ROADMAP_PATH} className="inline-flex items-center gap-1.5 text-xs font-medium text-cz-accent-t hover:underline">
      <MessageIcon size={13} aria-hidden="true" />
      {t("vote.forum")}
    </Link>
  );

  if (!loading && ideasTotal === 0) {
    return (
      <EmptyState
        icon={<MessageIcon size={26} aria-hidden="true" />}
        title={t("empty.voteNone.title")}
        description={t("empty.voteNone.description")}
        action={<Link to={FORUM_ROADMAP_PATH} className={buttonClass({ variant: "secondary", size: "sm" })}>{t("empty.voteNone.action")}</Link>}
      />
    );
  }

  const counts = engineCounts(ideas);
  // Et område der er tømt af filteret falder tilbage til "All".
  const activeArea = area === "all" || counts.some((c) => c.key === area) ? area : "all";
  const shown = activeArea === "all" ? ideas : ideas.filter((i) => i.engine === activeArea);
  const options = [
    { value: "all", label: <span>{t("vote.all")} <span className="tabular-nums">{ideas.length}</span></span> },
    ...counts.map((c) => ({
      value: c.key,
      label: <span>{areaTitle(t, c.key)} <span className="tabular-nums">{c.count}</span></span>,
    })),
  ];

  return (
    <Section aria-busy={loading || undefined}>
      {/* Telefon: titel og hint stakkes, så titlen aldrig brydes mod hintet. */}
      <SectionHeader
        title={t("vote.title")}
        meta={t("vote.hint")}
        className="flex-col gap-y-1 sm:flex-row sm:gap-y-3"
      />
      {loading ? (
        <SkeletonRows withScale />
      ) : ideas.length === 0 && onlyUnrated ? (
        <EmptyState
          icon={<CheckIcon size={26} aria-hidden="true" />}
          title={t("empty.vote.title")}
          description={t("empty.vote.description")}
          action={<Button variant="secondary" size="sm" onClick={props.onShowAll}>{t("empty.vote.action")}</Button>}
        />
      ) : (
        <>
          {counts.length > 1 && (
            // Én linje, der scroller vandret inde i rækken (spec §3.6): w-max
            // hindrer at segmenterne presses sammen og bryder over flere linjer.
            <div className="mb-2 max-w-full overflow-x-auto">
              <Segmented label={t("vote.areaLabel")} value={activeArea} onChange={setArea} options={options} className="w-max" />
            </div>
          )}
          <ul className={ROW_LIST}>
            {shown.map((item) => {
              const draft = props.drafts[item.id] ?? { idea: null, importance: null };
              const state = props.saveState[item.id];
              // Trin 2 folder ud, når "Good idea?" er besvaret (også fra en gemt stemme).
              const showImportance = isValidScore(draft.idea) || isValidScore(draft.importance);
              return (
                <li key={item.id} className={`${ROW} flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4`}>
                  <div className="flex-1 min-w-0">
                    <RowTitle isNew={props.isNew(item)} newLabel={t("labels.new")}>{localTitle(item, i18n.language)}</RowTitle>
                    <RowMeta>{areaTitle(t, item.engine)}</RowMeta>
                  </div>
                  {props.canVote && (
                    <div className="flex flex-col gap-1.5">
                      <ScoreScale
                        label={t("voting.idea")}
                        value={draft.idea}
                        disabled={state === "saving"}
                        onSelect={(n) => props.onScore(item, "idea", n)}
                      />
                      {showImportance && (
                        <ScoreScale
                          label={t("voting.importance")}
                          value={draft.importance}
                          disabled={state === "saving"}
                          onSelect={(n) => props.onScore(item, "importance", n)}
                        />
                      )}
                      <SaveNote state={state} savedLabel={t("voting.saved")} errorLabel={t("voting.error")} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      <div className="mt-4 pt-3 border-t border-cz-border">{forumLink}</div>
    </Section>
  );
}
