// #6150 · Vote-fanen (spec §3.2): idéer ejeren overvejer, med begge skalaer
// som i dag, men i to trin (ejer 4/10): først kun "Good idea?"; når den er
// valgt, eller der allerede er en stemme, folder "Important to you?" ud. Kun
// rækken selv vokser. Stemmen gemmes, når begge er valgt (buildVotePayload).
import { useState, type ChangeEvent } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { roadmapRowId, type RoadmapItem, type RoadmapVote } from "../../lib/roadmapModel.ts";
import { categoryCounts, isDontKnow, isValidScore, resolveRoadmapCategory, roadmapCategoryLabel } from "../../lib/roadmapVoting.js";
import { Button, EmptyState, Section, SectionHeader } from "./roadmapUi.ts";
import ScoreScale, { DontKnowButton } from "./ScoreScale.tsx";
import { RowMeta, RowTitle, SaveNote, SkeletonRows, ROW, ROW_LIST } from "./RoadmapRows.tsx";
import { itemCategoryTitle, localTitle, type SaveState } from "./roadmapFormat.ts";
import { buttonClass } from "../ui/buttonStyles.js";
import { CheckIcon, MessageIcon, Select } from "../ui/index.js";

export const FORUM_ROADMAP_PATH = "/forum?category=roadmap";

export interface VoteDraft { idea: number | null; importance: number | null }

export interface VoteTabProps {
  loading: boolean;
  /** Idéer efter filteret. */
  ideas: RoadmapItem[];
  /** Hvor mange idéer der findes i alt, før filteret. */
  ideasTotal: number;
  /** Idéer uden spillerens svar: samme tal som på fanen (#7735). */
  unrated: number;
  onlyUnrated: boolean;
  drafts: Record<string, VoteDraft>;
  /** De gemte svar. Et Ved ikke står kun her, for en kladde har ingen tal at vise. */
  votes: Map<string, RoadmapVote>;
  saveState: Record<string, SaveState>;
  canVote: boolean;
  isNew: (item: RoadmapItem) => boolean;
  onScore: (item: RoadmapItem, axis: "idea" | "importance", value: number) => void;
  onDontKnow: (item: RoadmapItem) => void;
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

  const counts = categoryCounts(ideas);
  const activeArea = counts.some((entry) => entry.key === area) ? area : "all";
  const shown = activeArea === "all" ? ideas : ideas.filter((item) => resolveRoadmapCategory(item) === activeArea);

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
          {/* #7735: fanen tæller manglende svar, "Alle" tæller alle idéer. Linjen binder de to tal sammen. */}
          {props.canVote && props.unrated > 0 && (
            <p className="mb-2 text-xs text-cz-2 tabular-nums">{t("vote.unrated", { unrated: props.unrated, total: ideasTotal })}</p>
          )}
          {counts.length > 1 && (
            <div className="mb-2 w-full sm:max-w-xs">
              <Select size="sm" aria-label={t("vote.areaLabel")} value={activeArea} onChange={(event: ChangeEvent<HTMLSelectElement>) => setArea(event.target.value)}>
                <option value="all">{t("vote.all")} ({ideas.length})</option>
                {counts.map(({ key, count }) => (
                  <option key={key} value={key}>{roadmapCategoryLabel(key, i18n.language)} ({count})</option>
                ))}
              </Select>
            </div>
          )}
          <ul className={ROW_LIST}>
            {shown.map((item) => {
              const draft = props.drafts[item.id] ?? { idea: null, importance: null };
              const state = props.saveState[item.id];
              // Trin 2 folder ud, når "Good idea?" er besvaret (også fra en gemt stemme).
              const showImportance = isValidScore(draft.idea) || isValidScore(draft.importance);
              return (
                <li key={item.id} id={roadmapRowId(item.id)} className={`${ROW} flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4`}>
                  <div className="flex-1 min-w-0">
                    <RowTitle isNew={props.isNew(item)} newLabel={t("labels.new")}>{localTitle(item, i18n.language)}</RowTitle>
                    <RowMeta>{itemCategoryTitle(item, i18n.language)}</RowMeta>
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
                      {/* Et valgt tal er en ny stemme på vej, så knappen slukker straks. */}
                      <DontKnowButton
                        label={t("voting.dontKnow")}
                        pressed={!showImportance && isDontKnow(props.votes.get(item.id))}
                        disabled={state === "saving"}
                        onSelect={() => props.onDontKnow(item)}
                      />
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
