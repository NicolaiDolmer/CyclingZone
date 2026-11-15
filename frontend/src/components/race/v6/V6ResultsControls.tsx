// #7860 · Resultater i v6: søgefelt og "Mit hold"-knap i resultattabellens hoved.
// Styret komponent: tilstanden ejes af tabellen, filtreringen bor i resultsControlsModel.
// Ingen guld: sidens ene primærknap bor andetsteds (TASTE). Hairline-kanter, 44 px på touch.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SearchIcon as SearchIconJs, XIcon as XIconJs } from "../../ui/icons/index.jsx";
import { isFiltering, type ResultsControlsState } from "./resultsControlsModel.ts";

interface IconProps { size?: number; className?: string; "aria-hidden"?: boolean | "true" }
const SearchIcon = SearchIconJs as unknown as (props: IconProps) => ReactNode;
const XIcon = XIconJs as unknown as (props: IconProps) => ReactNode;

const TOUCH = "[@media(max-width:640px),(pointer:coarse)]:min-h-11";

export interface V6ResultsControlsProps {
  state: ResultsControlsState;
  onChange: (next: ResultsControlsState) => void;
  hasMyTeam: boolean;
  /** Antal rækker efter filtrering og i alt; tælleren vises kun mens der filtreres. */
  shown: number;
  total: number;
  /** #7865: filtrerer tabellen selv lige nu? Mit hold kan ejes af holdvælgeren; uden = afledt af state. */
  counting?: boolean;
}

export default function V6ResultsControls({ state, onChange, hasMyTeam, shown, total, counting }: V6ResultsControlsProps) {
  const { t } = useTranslation("results");
  const filtering = counting ?? isFiltering(state);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2" data-results-controls="">
      <span className="relative inline-flex min-w-0 basis-full items-center sm:max-w-72 sm:flex-1 sm:basis-auto">
        <SearchIcon size={14} aria-hidden="true" className="pointer-events-none absolute start-2.5 text-cz-3" />
        <input
          type="search"
          value={state.query}
          onChange={(e) => onChange({ ...state, query: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Escape" && state.query) { e.preventDefault(); onChange({ ...state, query: "" }); } }}
          placeholder={t("raceResultsV6.searchPlaceholder")}
          aria-label={t("raceResultsV6.searchLabel")}
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          className={`w-full rounded-cz border border-cz-border bg-cz-card py-2 ps-8 pe-8 text-sm text-cz-1 placeholder:text-cz-3 transition-colors focus:border-cz-3 focus:outline-hidden focus:ring-1 focus:ring-cz-accent [&::-webkit-search-cancel-button]:hidden ${TOUCH}`}
        />
        {state.query && (
          <button
            type="button"
            onClick={() => onChange({ ...state, query: "" })}
            aria-label={t("raceResultsV6.clearSearch")}
            className="absolute end-1 inline-flex h-7 w-7 items-center justify-center rounded-cz text-cz-3 hover:text-cz-1 [@media(max-width:640px),(pointer:coarse)]:h-9 [@media(max-width:640px),(pointer:coarse)]:w-9"
          >
            <XIcon size={13} aria-hidden="true" />
          </button>
        )}
      </span>
      {hasMyTeam && (
        <button
          type="button"
          aria-pressed={state.mineOnly}
          onClick={() => onChange({ ...state, mineOnly: !state.mineOnly })}
          className={`inline-flex items-center rounded-cz border px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors focus:outline-hidden focus:ring-1 focus:ring-cz-accent ${TOUCH} ${
            state.mineOnly
              ? "border-cz-accent/30 bg-cz-accent/10 text-cz-accent-t"
              : "border-cz-border bg-cz-card text-cz-2 hover:text-cz-1"
          }`}
        >
          {t("raceResultsV6.myTeam")}
        </button>
      )}
      <span className="ms-auto font-data text-2xs tabular-nums text-cz-3" aria-live="polite">
        {filtering ? t("raceResultsV6.matchCount", { shown, total }) : ""}
      </span>
    </div>
  );
}

/** Tom tilstand når søgningen eller "Mit hold" ikke finder noget. */
export function V6ResultsNoMatch() {
  const { t } = useTranslation("results");
  return <p className="m-0 py-6 text-center text-sm text-cz-3">{t("raceResultsV6.noMatch")}</p>;
}
