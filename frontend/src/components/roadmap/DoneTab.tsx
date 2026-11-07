// #6150 · Done (spec §3.4): færdige punkter og rettede fejl i én liste,
// nyeste først, med dato og mærke (Feature = neutral, Fix = success).
// #7666 (#6923 pkt. 1): "Leveret de sidste 7 dage" står øverst i sit eget
// kort, og hvert punkt med en patch note kan foldes ud til noten. Kortet
// "Done" under viser resten, 30 ad gangen bag "Show more".
import { useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import {
  DONE_PAGE_SIZE, doneLimitFor, pickPatchNote, roadmapRowId, splitRecentDone,
  type DoneEntry, type PatchNoteRef, type RoadmapVote,
} from "../../lib/roadmapModel.ts";
import { hasScoredVote } from "../../lib/roadmapVoting.js";
import { Button, CategoryTag, EmptyState, Section, SectionHeader, SectionStack, StatusBadge } from "./roadmapUi.ts";
import { SkeletonRows, TitleCount, ROW, ROW_LIST } from "./RoadmapRows.tsx";
import { isDanish, localTitle, shortDate } from "./roadmapFormat.ts";
import { CheckIcon, ChevronRightIcon } from "../ui/index.js";

export interface DoneTabProps {
  loading: boolean;
  /** Hele listen, nyeste først (buildDoneList uden loft). */
  entries: DoneEntry[];
  /** Patch notes pr. GitHub-issue; null mens de hentes (eller hvis hentningen fejlede). */
  patchIndex: Map<number, PatchNoteRef[]> | null;
  onGoPlan: () => void;
  /** Egne stemmer pr. punkt (#7792): et leveret punkt med en stemme får "You voted". */
  votes?: Map<string, RoadmapVote>;
  /** Punktet et søgehit åbnede; listen viser mindst så langt ned. */
  revealId?: string | null;
  /** Til "de sidste 7 dage"; kan fastlåses i tests og billeder. */
  now?: Date;
}

function PatchNote({ note }: { note: PatchNoteRef }) {
  const { t, i18n } = useTranslation("roadmap");
  const da = isDanish(i18n.language);
  const title = (da ? note.title_da : note.title_en) || note.title_en || note.title_da;
  const body = (da ? note.body_da : note.body_en) || note.body_en || note.body_da;
  return (
    <details className="mt-1 group">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-cz-accent-t hover:underline">
        {t("done.patchNote", { date: shortDate(note.date, i18n.language) })}
        <ChevronRightIcon size={13} aria-hidden="true" className="transition-transform duration-150 group-open:rotate-90" />
      </summary>
      <div className="mt-1.5 text-xs leading-relaxed">
        <div className="font-medium text-cz-1">{title}</div>
        {body && <p className="mt-0.5 text-cz-2">{body}</p>}
        <Link to="/patch-notes" className="mt-1 inline-block font-medium text-cz-accent-t hover:underline">
          {t("done.allPatchNotes")}
        </Link>
      </div>
    </details>
  );
}

export default function DoneTab({ loading, entries, patchIndex, onGoPlan, votes, revealId, now }: DoneTabProps) {
  const { t, i18n } = useTranslation("roadmap");
  const [limit, setLimit] = useState(() => doneLimitFor(splitRecentDone(entries, now ?? new Date()).earlier, revealId));

  if (!loading && entries.length === 0) {
    return (
      <EmptyState
        icon={<CheckIcon size={26} aria-hidden="true" />}
        title={t("empty.done.title")}
        description={t("empty.done.description")}
        action={<Button variant="secondary" size="sm" onClick={onGoPlan}>{t("empty.done.action")}</Button>}
      />
    );
  }

  if (loading) {
    return (
      <Section aria-busy>
        <SectionHeader title={t("done.title")} meta={t("done.hint")} />
        <SkeletonRows />
      </Section>
    );
  }

  const { recent, earlier } = splitRecentDone(entries, now ?? new Date());

  const row = (entry: DoneEntry) => {
    const note = patchIndex ? pickPatchNote(patchIndex, entry.issue_ref, entry.date) : null;
    return (
      <li key={`${entry.kind}-${entry.id}`} id={roadmapRowId(entry.id)} className={`${ROW} flex items-start gap-3`}>
        <span className="w-14 shrink-0 font-data tabular-nums text-xs text-cz-3 pt-0.5">
          {shortDate(entry.date, i18n.language)}
        </span>
        <div className="flex-1 min-w-0">
          <span className="text-cz-1 text-sm leading-relaxed">{localTitle(entry, i18n.language)}</span>
          {note && <PatchNote note={note} />}
        </div>
        <span className="shrink-0 pt-0.5 flex flex-wrap items-center justify-end gap-1.5">
          {entry.kind === "feature" && hasScoredVote(votes?.get(entry.id)) && (
            <StatusBadge state="info">{t("done.youVoted")}</StatusBadge>
          )}
          {entry.kind === "fix"
            ? <StatusBadge state="won">{t("done.fix")}</StatusBadge>
            : <CategoryTag>{t("done.feature")}</CategoryTag>}
        </span>
      </li>
    );
  };

  return (
    <SectionStack>
      {recent.length > 0 && (
        <Section>
          <SectionHeader title={<TitleCount label={t("done.recent")} count={recent.length} />} />
          <ul className={ROW_LIST}>{recent.map(row)}</ul>
        </Section>
      )}

      {earlier.length > 0 && (
        <Section>
          <SectionHeader title={recent.length > 0 ? t("done.earlier") : t("done.title")} meta={t("done.hint")} />
          <ul className={ROW_LIST}>{earlier.slice(0, limit).map(row)}</ul>
          {earlier.length > limit && (
            <div className="mt-3">
              <Button variant="secondary" size="sm" onClick={() => setLimit((n) => n + DONE_PAGE_SIZE)}>
                {t("done.showMore")}
              </Button>
            </div>
          )}
        </Section>
      )}
    </SectionStack>
  );
}
