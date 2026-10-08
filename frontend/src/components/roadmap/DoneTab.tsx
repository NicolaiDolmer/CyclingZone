// #6150 · Done (spec §3.4): færdige punkter og rettede fejl i én liste,
// nyeste først, med dato og mærke (Feature = neutral, Fix = success). De 30
// nyeste vises, resten bag "Show more".
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DONE_PAGE_SIZE, type DoneEntry } from "../../lib/roadmapModel.ts";
import { Button, CategoryTag, EmptyState, Section, SectionHeader, StatusBadge } from "./roadmapUi.ts";
import { SkeletonRows, ROW, ROW_LIST } from "./RoadmapRows.tsx";
import { localTitle, shortDate } from "./roadmapFormat.ts";
import { CheckIcon } from "../ui/index.js";

export interface DoneTabProps {
  loading: boolean;
  /** Hele listen, nyeste først (buildDoneList uden loft). */
  entries: DoneEntry[];
  onGoPlan: () => void;
}

export default function DoneTab({ loading, entries, onGoPlan }: DoneTabProps) {
  const { t, i18n } = useTranslation("roadmap");
  const [limit, setLimit] = useState(DONE_PAGE_SIZE);

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

  return (
    <Section aria-busy={loading || undefined}>
      <SectionHeader title={t("done.title")} meta={t("done.hint")} />
      {loading ? (
        <SkeletonRows />
      ) : (
        <>
          <ul className={ROW_LIST}>
            {entries.slice(0, limit).map((entry) => (
              <li key={`${entry.kind}-${entry.id}`} className={`${ROW} flex items-start gap-3`}>
                <span className="w-14 shrink-0 font-data tabular-nums text-xs text-cz-3 pt-0.5">
                  {shortDate(entry.date, i18n.language)}
                </span>
                <span className="flex-1 min-w-0 text-cz-1 text-sm leading-relaxed">{localTitle(entry, i18n.language)}</span>
                <span className="shrink-0 pt-0.5">
                  {entry.kind === "fix"
                    ? <StatusBadge state="won">{t("done.fix")}</StatusBadge>
                    : <CategoryTag>{t("done.feature")}</CategoryTag>}
                </span>
              </li>
            ))}
          </ul>
          {entries.length > limit && (
            <div className="mt-3">
              <Button variant="secondary" size="sm" onClick={() => setLimit((n) => n + DONE_PAGE_SIZE)}>
                {t("done.showMore")}
              </Button>
            </div>
          )}
        </>
      )}
    </Section>
  );
}
