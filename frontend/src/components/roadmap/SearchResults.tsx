// #7666 (#6203) · Søgning på tværs af roadmappets faner. Ét kort med hits fra
// Plan, Beta, Vote, Known issues og Done; mærket siger hvor punktet står, og
// et tryk åbner den fane. Søgningen rammer både EN- og DA-titlen.
import { useTranslation } from "react-i18next";
import type { SearchHit } from "../../lib/roadmapModel.ts";
import { Button, CategoryTag, EmptyState, Section, SectionHeader } from "./roadmapUi.ts";
import { RowMeta, TitleCount, ROW, ROW_LIST } from "./RoadmapRows.tsx";
import { areaTitle, localTitle } from "./roadmapFormat.ts";
import { ChevronRightIcon, SearchIcon } from "../ui/index.js";

export interface SearchResultsProps {
  query: string;
  hits: SearchHit[];
  onOpen: (hit: SearchHit) => void;
  onClear: () => void;
}

export default function SearchResults({ query, hits, onOpen, onClear }: SearchResultsProps) {
  const { t, i18n } = useTranslation("roadmap");

  if (hits.length === 0) {
    return (
      <EmptyState
        icon={<SearchIcon size={26} aria-hidden="true" />}
        title={t("empty.search.title")}
        description={t("empty.search.description", { query: query.trim() })}
        action={<Button variant="secondary" size="sm" onClick={onClear}>{t("empty.search.action")}</Button>}
      />
    );
  }

  return (
    <Section>
      <SectionHeader title={<TitleCount label={t("search.title")} count={hits.length} />} />
      <ul className={ROW_LIST} aria-live="polite">
        {hits.map((hit) => (
          <li key={`${hit.where}-${hit.id}`}>
            <button
              type="button"
              onClick={() => onOpen(hit)}
              className={`${ROW} w-full flex items-start gap-3 text-start group`}
            >
              <span className="flex-1 min-w-0">
                <span className="block text-cz-1 text-sm leading-relaxed group-hover:underline">{localTitle(hit, i18n.language)}</span>
                <RowMeta>{areaTitle(t, hit.area)} · {t(`tabs.${hit.tab}`)}</RowMeta>
              </span>
              <span className="shrink-0 pt-0.5 inline-flex items-center gap-1.5">
                <CategoryTag>{t(`search.where.${hit.where}`)}</CategoryTag>
                <ChevronRightIcon size={13} aria-hidden="true" className="text-cz-3" />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}
