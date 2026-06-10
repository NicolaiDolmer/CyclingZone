/**
 * RiderFilters — shared filter/sort component used on all rider pages
 * Props:
 *   filters: object with current filter state
 *   onChange: (key, value) => void
 *   onReset: () => void
 *   showTeamFilter: bool (default true)
 *   compact: bool — fewer rows, for sidepanels
 *   teams: array
 *   nationalities: string[] — ISO codes present in the current dataset
 *
 * i18n: bruger `riderFilters` namespace (cross-page shared component).
 * Stat-labels (FL/BJ/...) er internationale forkortelser — oversættes ikke.
 * Refs #487.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCountryName } from "../lib/countryUtils";
import { Flag } from "./Flag";
import { formatNumber } from "../lib/intl";
import { RIDER_TYPE_KEYS } from "../lib/riderTypeKeys";
// Kanonisk nøgleliste bor i lib/riderRating.js (ren .js → node --test-venlig).
// Re-eksporteres her for bagudkompatibilitet med eksisterende imports.
import { STAT_KEYS } from "../lib/riderRating";

export { STAT_KEYS };

export const STAT_LABELS_MAP = {
  stat_fl:"FL", stat_bj:"BJ", stat_kb:"KB", stat_bk:"BAK", stat_tt:"TT",
  stat_prl:"PRL", stat_bro:"BRO", stat_sp:"SP", stat_acc:"ACC",
  stat_ned:"NED", stat_udh:"UDH", stat_mod:"MOD", stat_res:"RES", stat_ftr:"FTR",
};

const STAT_DEFAULT_MIN = 50;
const STAT_DEFAULT_MAX = 85;

function makeStatDefaults() {
  const d = {};
  for (const k of STAT_KEYS) {
    d[`${k}_min`] = STAT_DEFAULT_MIN;
    d[`${k}_max`] = STAT_DEFAULT_MAX;
  }
  return d;
}

export const DEFAULT_FILTERS = {
  q: "",
  sort: "value",
  sort_dir: "desc",
  nationality_code: "",
  rider_type: "",
  min_value: "",
  max_value: "",
  min_salary: "",
  max_salary: "",
  min_age: "",
  max_age: "",
  min_auction_price: "",
  max_auction_price: "",
  u25: false,
  u23: false,
  free_agent: false,
  team_id: "",
  ...makeStatDefaults(),
};

// #960: alle ikke-stat filter-nøgler, i samme rækkefølge som chips'ene nedenfor.
// Bruges både til "har aktivt filter"-tjek og til "Nulstil alt (N)"-tælleren.
const BASIC_FILTER_KEYS = [
  "q", "nationality_code", "rider_type", "min_value", "max_value", "min_salary", "max_salary",
  "min_age", "max_age",
  "min_auction_price", "max_auction_price", "u25", "u23", "free_agent", "team_id",
];

function isStatActive(filters, key) {
  return (
    (parseInt(filters[`${key}_min`]) ?? STAT_DEFAULT_MIN) > STAT_DEFAULT_MIN ||
    (parseInt(filters[`${key}_max`]) ?? STAT_DEFAULT_MAX) < STAT_DEFAULT_MAX
  );
}

// ── Stat range slider (stacked min + max) ────────────────────────────────────
function DualStatSlider({ statKey, label, filters, onChange }) {
  const minKey = `${statKey}_min`;
  const maxKey = `${statKey}_max`;
  const valMin = parseInt(filters[minKey]) ?? STAT_DEFAULT_MIN;
  const valMax = parseInt(filters[maxKey]) ?? STAT_DEFAULT_MAX;
  const active = valMin > STAT_DEFAULT_MIN || valMax < STAT_DEFAULT_MAX;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-cz-3 text-[10px] uppercase tracking-wider">{label}</label>
        <span className={`text-[10px] font-mono font-bold ${active ? "text-cz-accent-t" : "text-cz-3"}`}>
          {valMin}-{valMax}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <input
          type="range" min={50} max={85} step={1} value={valMin}
          onChange={e => onChange(minKey, Math.min(parseInt(e.target.value), valMax))}
          className="w-full cursor-pointer accent-cz-3"
        />
        <input
          type="range" min={50} max={85} step={1} value={valMax}
          onChange={e => onChange(maxKey, Math.max(parseInt(e.target.value), valMin))}
          className="w-full cursor-pointer accent-amber-500"
        />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function RiderFilters({
  filters, onChange, onReset,
  showTeamFilter = true, compact = false, teams = [], nationalities = [],
  showAuctionPriceFilter = false,
}) {
  const { t, i18n } = useTranslation("riderFilters");
  const { t: tTypes } = useTranslation("riderTypes");
  const [statsOpen, setStatsOpen] = useState(false);
  const countryLocale = i18n.language;
  const sortedNationalities = useMemo(
    () => [...nationalities].sort((a, b) => getCountryName(a, countryLocale).localeCompare(getCountryName(b, countryLocale), countryLocale)),
    [nationalities, countryLocale],
  );

  const activeStatKeys = STAT_KEYS.filter(k => isStatActive(filters, k));
  const hasActiveStats = activeStatKeys.length > 0;

  const hasBasicActive = BASIC_FILTER_KEYS.some(k => filters[k]);

  const hasActiveFilters = hasBasicActive || hasActiveStats;

  // #960: tæl aktive filtre (matcher antallet af chips nedenfor) til "Nulstil alt (N)".
  const activeBasicCount = BASIC_FILTER_KEYS.filter(k => filters[k]).length;
  const activeFilterCount = activeBasicCount + activeStatKeys.length;

  function resetStat(key) {
    onChange(`${key}_min`, STAT_DEFAULT_MIN);
    onChange(`${key}_max`, STAT_DEFAULT_MAX);
  }

  return (
    <>
      {/* ── Filter panel ── */}
      <div className="bg-cz-card border border-cz-border rounded-xl p-4 mb-3">
        <div className="flex items-center justify-between gap-3 mb-3">
          <p className="text-cz-2 text-xs uppercase tracking-wider font-semibold">{t("panel.label")}</p>
          {/* #960: altid synlig så brugeren lærer den findes; deaktiveret/grå
              indtil mindst ét filter er sat, og viser så tælleren. */}
          <button
            type="button"
            data-testid="filter-reset"
            onClick={onReset}
            disabled={!hasActiveFilters}
            className={`text-xs transition-colors flex-shrink-0 ${
              hasActiveFilters
                ? "text-cz-3 hover:text-cz-1 cursor-pointer"
                : "text-cz-3/40 cursor-not-allowed"
            }`}
          >
            {hasActiveFilters ? t("panel.resetCount", { count: activeFilterCount }) : t("panel.resetAll")}
          </button>
        </div>

        <div className={`grid gap-2 ${compact ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"}`}>
          {/* Name */}
          <div>
            <label className="block text-cz-3 text-[10px] uppercase tracking-wider mb-1">{t("fields.name")}</label>
            <input type="text" data-testid="filter-name" value={filters.q} onChange={e => onChange("q", e.target.value)}
              placeholder={t("fields.namePlaceholder")}
              className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2
                text-cz-1 text-sm placeholder-cz-3 focus:outline-none focus:border-cz-accent" />
          </div>

          {/* Country */}
          <div>
            <label className="block text-cz-3 text-[10px] uppercase tracking-wider mb-1">{t("fields.country")}</label>
            <select value={filters.nationality_code} onChange={e => onChange("nationality_code", e.target.value)}
              className="w-full bg-cz-subtle border border-cz-border rounded-lg px-2 py-2
                text-cz-1 text-sm focus:outline-none focus:border-cz-accent">
              <option value="">{t("fields.countryAll")}</option>
              {sortedNationalities.map(code => (
                <option key={code} value={code}>{getCountryName(code, countryLocale)}</option>
              ))}
            </select>
          </div>

          {/* Rider type (#49) */}
          <div>
            <label className="block text-cz-3 text-[10px] uppercase tracking-wider mb-1">{tTypes("filter.label")}</label>
            <select value={filters.rider_type} onChange={e => onChange("rider_type", e.target.value)}
              className="w-full bg-cz-subtle border border-cz-border rounded-lg px-2 py-2
                text-cz-1 text-sm focus:outline-none focus:border-cz-accent">
              <option value="">{tTypes("filter.all")}</option>
              {RIDER_TYPE_KEYS.map(key => (
                <option key={key} value={key}>{tTypes(`types.${key}`)}</option>
              ))}
            </select>
          </div>

          {/* UCI range */}
          <div>
            <label className="block text-cz-3 text-[10px] uppercase tracking-wider mb-1">{t("fields.valueRange")}</label>
            <div className="flex gap-1">
              <input type="number" value={filters.min_value} onChange={e => onChange("min_value", e.target.value)}
                placeholder={t("fields.min")}
                className="w-full bg-cz-subtle border border-cz-border rounded-lg px-2 py-2
                  text-cz-1 text-sm placeholder-cz-3 focus:outline-none focus:border-cz-accent" />
              <input type="number" value={filters.max_value} onChange={e => onChange("max_value", e.target.value)}
                placeholder={t("fields.max")}
                className="w-full bg-cz-subtle border border-cz-border rounded-lg px-2 py-2
                  text-cz-1 text-sm placeholder-cz-3 focus:outline-none focus:border-cz-accent" />
            </div>
          </div>

          {/* Salary range */}
          <div>
            <label className="block text-cz-3 text-[10px] uppercase tracking-wider mb-1">{t("fields.salaryRange")}</label>
            <div className="flex gap-1">
              <input type="number" value={filters.min_salary} onChange={e => onChange("min_salary", e.target.value)}
                placeholder={t("fields.min")}
                className="w-full bg-cz-subtle border border-cz-border rounded-lg px-2 py-2
                  text-cz-1 text-sm placeholder-cz-3 focus:outline-none focus:border-cz-accent" />
              <input type="number" value={filters.max_salary} onChange={e => onChange("max_salary", e.target.value)}
                placeholder={t("fields.max")}
                className="w-full bg-cz-subtle border border-cz-border rounded-lg px-2 py-2
                  text-cz-1 text-sm placeholder-cz-3 focus:outline-none focus:border-cz-accent" />
            </div>
          </div>

          {/* Age range */}
          <div>
            <label className="block text-cz-3 text-[10px] uppercase tracking-wider mb-1">{t("fields.ageRange")}</label>
            <div className="flex gap-1">
              <input type="number" value={filters.min_age} onChange={e => onChange("min_age", e.target.value)}
                placeholder={t("fields.min")} min={16} max={45}
                className="w-full bg-cz-subtle border border-cz-border rounded-lg px-2 py-2
                  text-cz-1 text-sm placeholder-cz-3 focus:outline-none focus:border-cz-accent" />
              <input type="number" value={filters.max_age} onChange={e => onChange("max_age", e.target.value)}
                placeholder={t("fields.max")} min={16} max={45}
                className="w-full bg-cz-subtle border border-cz-border rounded-lg px-2 py-2
                  text-cz-1 text-sm placeholder-cz-3 focus:outline-none focus:border-cz-accent" />
            </div>
          </div>

          {/* Højeste bud (auction-only) */}
          {showAuctionPriceFilter && (
            <div>
              <label className="block text-cz-3 text-[10px] uppercase tracking-wider mb-1">{t("fields.bidRange")}</label>
              <div className="flex gap-1">
                <input type="number" value={filters.min_auction_price} onChange={e => onChange("min_auction_price", e.target.value)}
                  placeholder={t("fields.min")}
                  className="w-full bg-cz-subtle border border-cz-border rounded-lg px-2 py-2
                    text-cz-1 text-sm placeholder-cz-3 focus:outline-none focus:border-cz-accent" />
                <input type="number" value={filters.max_auction_price} onChange={e => onChange("max_auction_price", e.target.value)}
                  placeholder={t("fields.max")}
                  className="w-full bg-cz-subtle border border-cz-border rounded-lg px-2 py-2
                    text-cz-1 text-sm placeholder-cz-3 focus:outline-none focus:border-cz-accent" />
              </div>
            </div>
          )}

          {/* Potentiale-filter fjernet (#1162): potentialet er skjult information —
              man kan ikke filtrere på en værdi man ikke har scoutet, og et
              server-filter på den rå kolonne var en oracle-lækage. */}

          {/* Team */}
          {showTeamFilter && teams.length > 0 && (
            <div>
              <label className="block text-cz-3 text-[10px] uppercase tracking-wider mb-1">{t("fields.team")}</label>
              <select value={filters.team_id} onChange={e => onChange("team_id", e.target.value)}
                className="w-full bg-cz-subtle border border-cz-border rounded-lg px-2 py-2
                  text-cz-1 text-sm focus:outline-none focus:border-cz-accent">
                <option value="">{t("fields.teamAll")}</option>
                {teams.map(tm => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
              </select>
            </div>
          )}

          {/* Toggles */}
          <div className={`grid grid-cols-3 gap-2 items-end ${compact ? "sm:col-span-2" : ""}`}>
            {[{ key: "free_agent", label: t("toggles.freeAgent") }, { key: "u25", label: t("toggles.u25") }, { key: "u23", label: t("toggles.u23") }].map(({ key, label }) => (
              <button key={key} onClick={() => onChange(key, !filters[key])}
                className={`px-2 py-2 rounded-lg text-xs font-medium transition-all border
                  ${filters[key]
                    ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/40"
                    : "bg-cz-subtle text-cz-3 border-cz-border hover:text-cz-1 hover:border-cz-border"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Evne-filtre (dual sliders) */}
        <div className="mt-3 pt-3 border-t border-cz-border">
          <button onClick={() => setStatsOpen(o => !o)}
            className="flex items-center gap-2 text-cz-3 hover:text-cz-2 text-xs transition-colors">
            <span className={`transition-transform duration-150 inline-block ${statsOpen ? "rotate-90" : ""}`}>▶</span>
            <span className="uppercase tracking-wider font-medium">{t("stats.section")}</span>
            {hasActiveStats && (
              <span className="bg-cz-accent/10 text-cz-accent-t text-[10px] px-1.5 py-0.5 rounded-full">
                {t("stats.active", { count: activeStatKeys.length })}
              </span>
            )}
          </button>

          {statsOpen && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-4 mt-4">
              {STAT_KEYS.map(key => (
                <DualStatSlider
                  key={key}
                  statKey={key}
                  label={STAT_LABELS_MAP[key]}
                  filters={filters}
                  onChange={onChange}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Active filter chips (between panel and table) ── */}
      {hasActiveFilters && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {filters.q && <Chip t={t} label={`"${filters.q}"`} onRemove={() => onChange("q", "")} />}
          {filters.nationality_code && (
            <Chip
              t={t}
              label={<><Flag code={filters.nationality_code} /> {getCountryName(filters.nationality_code, countryLocale)}</>}
              onRemove={() => onChange("nationality_code", "")}
            />
          )}
          {filters.rider_type && <Chip t={t} label={tTypes(`types.${filters.rider_type}`)} onRemove={() => onChange("rider_type", "")} />}
          {filters.min_value && <Chip t={t} label={t("chips.value.min", { amount: formatNumber(parseInt(filters.min_value)) })} onRemove={() => onChange("min_value", "")} />}
          {filters.max_value && <Chip t={t} label={t("chips.value.max", { amount: formatNumber(parseInt(filters.max_value)) })} onRemove={() => onChange("max_value", "")} />}
          {filters.min_salary && <Chip t={t} label={t("chips.salary.min", { amount: formatNumber(parseInt(filters.min_salary)) })} onRemove={() => onChange("min_salary", "")} />}
          {filters.max_salary && <Chip t={t} label={t("chips.salary.max", { amount: formatNumber(parseInt(filters.max_salary)) })} onRemove={() => onChange("max_salary", "")} />}
          {filters.min_age && <Chip t={t} label={t("chips.age.min", { value: filters.min_age })} onRemove={() => onChange("min_age", "")} />}
          {filters.max_age && <Chip t={t} label={t("chips.age.max", { value: filters.max_age })} onRemove={() => onChange("max_age", "")} />}
          {filters.min_auction_price && <Chip t={t} label={t("chips.bid.min", { amount: formatNumber(parseInt(filters.min_auction_price)) })} onRemove={() => onChange("min_auction_price", "")} />}
          {filters.max_auction_price && <Chip t={t} label={t("chips.bid.max", { amount: formatNumber(parseInt(filters.max_auction_price)) })} onRemove={() => onChange("max_auction_price", "")} />}
          {filters.u25 && <Chip t={t} label={t("toggles.u25")} onRemove={() => onChange("u25", false)} />}
          {filters.u23 && <Chip t={t} label={t("toggles.u23")} onRemove={() => onChange("u23", false)} />}
          {filters.free_agent && <Chip t={t} label={t("toggles.freeAgent")} onRemove={() => onChange("free_agent", false)} />}
          {filters.team_id && <Chip t={t} label={t("chips.teamSelected")} onRemove={() => onChange("team_id", "")} />}
          {activeStatKeys.map(key => {
            const min = parseInt(filters[`${key}_min`]) ?? STAT_DEFAULT_MIN;
            const max = parseInt(filters[`${key}_max`]) ?? STAT_DEFAULT_MAX;
            return (
              <Chip
                t={t}
                key={key}
                label={t("chips.statRange", { label: STAT_LABELS_MAP[key], min, max })}
                onRemove={() => resetStat(key)}
              />
            );
          })}
        </div>
      )}
    </>
  );
}

function Chip({ t, label, onRemove }) {
  const ariaLabel = typeof label === "string" ? t("chips.remove", { label }) : undefined;
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={ariaLabel}
      className="inline-flex items-center gap-1.5 bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30
        text-xs px-3 min-h-[44px] rounded-full font-medium hover:bg-cz-accent/20 transition-colors"
    >
      {label}
      <span aria-hidden="true" className="text-base leading-none">×</span>
    </button>
  );
}
