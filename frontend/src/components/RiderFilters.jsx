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
import { useMemo, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getCountryName } from "../lib/countryUtils";
import { Flag } from "./Flag";
import { Card, ChevronRightIcon } from "./ui";
import { formatNumber } from "../lib/intl";
import { RIDER_TYPE_KEYS } from "../lib/riderTypeKeys";
// Kanonisk nøgleliste bor i lib/riderRating.js (ren .js → node --test-venlig),
// som nu re-eksporterer de 15 CZ-evne-keys fra lib/abilities.js (#1529).
// Re-eksporteres her for bagudkompatibilitet med eksisterende imports.
import { STAT_KEYS } from "../lib/riderRating";
import { ABILITY_SHORT } from "../lib/abilities";

export { STAT_KEYS };

// Korte slider-/kolonne-labels pr. evne (CLM/TT/...). Internationale forkortelser
// — oversættes ikke (#487).
export const STAT_LABELS_MAP = ABILITY_SHORT;

// Evner spænder 1-99 (vs PCM's klumpede 50-85). Slider-baseline = fuld skala.
const STAT_DEFAULT_MIN = 0;
const STAT_DEFAULT_MAX = 99;

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
  // #2522: transfer-markedets asking_price (seller-satte pris) — adskilt fra
  // min/max_auction_price (auktionens NUVÆRENDE bud), som er en anden pris-akse.
  min_asking_price: "",
  max_asking_price: "",
  u25: false,
  u23: false,
  free_agent: false,
  // #2238: default false = ryttere på AI-hold skjules (man kan ikke købe/auktionere
  // dem). true = vis dem alligevel. Fri-agenter påvirkes aldrig (owner_is_ai=false).
  show_ai: false,
  team_id: "",
  ...makeStatDefaults(),
};

// #960: alle ikke-stat filter-nøgler, i samme rækkefølge som chips'ene nedenfor.
// Bruges både til "har aktivt filter"-tjek og til "Nulstil alt (N)"-tælleren.
const BASIC_FILTER_KEYS = [
  "q", "nationality_code", "rider_type", "min_value", "max_value", "min_salary", "max_salary",
  "min_age", "max_age",
  "min_auction_price", "max_auction_price", "min_asking_price", "max_asking_price",
  "u25", "u23", "free_agent", "show_ai", "team_id",
];

function isStatActive(filters, key) {
  return (
    (parseInt(filters[`${key}_min`]) ?? STAT_DEFAULT_MIN) > STAT_DEFAULT_MIN ||
    (parseInt(filters[`${key}_max`]) ?? STAT_DEFAULT_MAX) < STAT_DEFAULT_MAX
  );
}

// #261: klem en tal-værdi ind i [0, 99] og respekter min≤max-invarianten.
// Tomt/ugyldigt input falder tilbage til grænseværdien, så slider og input
// aldrig kommer i en umulig tilstand.
function clampStat(raw, { fallback, floor = STAT_DEFAULT_MIN, ceil = STAT_DEFAULT_MAX }) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, floor), ceil);
}

// ── Stat range slider + number inputs (delt state) ───────────────────────────
function DualStatSlider({ statKey, label, filters, onChange, t }) {
  const minKey = `${statKey}_min`;
  const maxKey = `${statKey}_max`;
  const propMin = parseInt(filters[minKey]) ?? STAT_DEFAULT_MIN;
  const propMax = parseInt(filters[maxKey]) ?? STAT_DEFAULT_MAX;

  // #164: hold lokal thumb-state under drag, så slideren følger glat uden at
  // trigge en fetch pr. tick (RidersPage re-fetcher på hvert filter-skift, så
  // listen "hoppede" mens man trak). Parent-onChange kaldes FØRST ved release
  // (pointer-up / touch-end / key-up) — svarer til MUI's onChangeCommitted.
  // Synkronisér fra props når de ændres udefra (fx Nulstil-knappen ELLER det
  // modsatte input/slider, jf. #261's to-vejs-sync — begge deler _min/_max).
  const [localMin, setLocalMin] = useState(propMin);
  const [localMax, setLocalMax] = useState(propMax);
  useEffect(() => { setLocalMin(propMin); }, [propMin]);
  useEffect(() => { setLocalMax(propMax); }, [propMax]);

  const active = localMin > STAT_DEFAULT_MIN || localMax < STAT_DEFAULT_MAX;

  const commitMin = v => { if (v !== propMin) onChange(minKey, v); };
  const commitMax = v => { if (v !== propMax) onChange(maxKey, v); };

  // #261: tal-input committer sin clampede værdi til samme _min/_max-nøgle som
  // slideren. Slideren re-synces via propMin/propMax-effekten ovenfor, så de to
  // kontroller altid viser samme tal (to-vejs sync).
  const commitMinInput = raw => {
    const v = clampStat(raw, { fallback: STAT_DEFAULT_MIN, ceil: localMax });
    setLocalMin(v);
    commitMin(v);
  };
  const commitMaxInput = raw => {
    const v = clampStat(raw, { fallback: STAT_DEFAULT_MAX, floor: localMin });
    setLocalMax(v);
    commitMax(v);
  };

  const numberInputClass =
    "w-full bg-cz-subtle border border-cz-border rounded-cz px-2 py-1 " +
    "text-cz-1 text-xs font-mono text-center placeholder-cz-3 " +
    "focus:outline-none focus:border-cz-accent";

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-cz-3 text-[10px] uppercase tracking-wider">{label}</label>
        <span className={`text-[10px] font-mono font-bold ${active ? "text-cz-accent-t" : "text-cz-3"}`}>
          {localMin}-{localMax}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <input
          type="range" min={0} max={99} step={1} value={localMin}
          onChange={e => setLocalMin(Math.min(parseInt(e.target.value), localMax))}
          onMouseUp={e => commitMin(Math.min(parseInt(e.target.value), localMax))}
          onTouchEnd={e => commitMin(Math.min(parseInt(e.target.value), localMax))}
          onKeyUp={e => commitMin(Math.min(parseInt(e.target.value), localMax))}
          className="w-full cursor-pointer accent-cz-3"
        />
        <input
          type="range" min={0} max={99} step={1} value={localMax}
          onChange={e => setLocalMax(Math.max(parseInt(e.target.value), localMin))}
          onMouseUp={e => commitMax(Math.max(parseInt(e.target.value), localMin))}
          onTouchEnd={e => commitMax(Math.max(parseInt(e.target.value), localMin))}
          onKeyUp={e => commitMax(Math.max(parseInt(e.target.value), localMin))}
          className="w-full cursor-pointer accent-amber-500"
        />
      </div>
      {/* #261: præcise tal-inputs som supplement til slideren — deler _min/_max.
          Committer ved blur og Enter, så man kan taste "45" uden en fetch pr.
          ciffer. localMin/localMax holder visningen live mens man taster. */}
      <div className="flex items-center gap-1 mt-1">
        <input
          type="number" inputMode="numeric" min={0} max={99} step={1}
          data-testid={`stat-min-${statKey}`}
          aria-label={t("stats.minInput", { label })}
          value={localMin}
          onChange={e => setLocalMin(e.target.value)}
          onBlur={e => commitMinInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { commitMinInput(e.target.value); e.target.blur(); } }}
          className={numberInputClass}
        />
        <span aria-hidden="true" className="text-cz-3 text-xs">–</span>
        <input
          type="number" inputMode="numeric" min={0} max={99} step={1}
          data-testid={`stat-max-${statKey}`}
          aria-label={t("stats.maxInput", { label })}
          value={localMax}
          onChange={e => setLocalMax(e.target.value)}
          onBlur={e => commitMaxInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { commitMaxInput(e.target.value); e.target.blur(); } }}
          className={numberInputClass}
        />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function RiderFilters({
  filters, onChange, onReset,
  showTeamFilter = true, compact = false, teams = [], nationalities = [],
  showAuctionPriceFilter = false, showAskingPriceFilter = false, showAiToggle = false,
}) {
  const { t, i18n } = useTranslation("riderFilters");
  const { t: tTypes } = useTranslation("riderTypes");
  const [statsOpen, setStatsOpen] = useState(false);
  // #2464: på mobil fyldte panelet ~40% af skærmen før første rytter — kollapset
  // som default bag en disclosure (samme mønster som evne-sliderne, statsOpen).
  // Desktop (sm+) er uændret: altid udfoldet. Aktive filter-chips renderes uden
  // for panelet og forbliver synlige selv når panelet er kollapset.
  const [panelOpen, setPanelOpen] = useState(false);
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
      <Card className="p-4 mb-3">
        <div className="flex items-center justify-between gap-3 sm:mb-3">
          <p className="hidden sm:block text-cz-2 text-xs uppercase tracking-wider font-semibold">{t("panel.label")}</p>
          {/* #2464: mobil-disclosure — erstatter den statiske label under sm. */}
          <button
            type="button"
            data-testid="filter-panel-toggle"
            onClick={() => setPanelOpen(o => !o)}
            aria-expanded={panelOpen}
            className="sm:hidden flex items-center gap-2 min-h-[44px] text-cz-2 text-xs uppercase tracking-wider font-semibold"
          >
            <ChevronRightIcon size={12} aria-hidden="true"
              className={`transition-transform duration-150 ${panelOpen ? "rotate-90" : ""}`} />
            {t("panel.label")}
            {activeFilterCount > 0 && (
              <span className="bg-cz-accent/10 text-cz-accent-t text-[10px] px-1.5 py-0.5 rounded-full normal-case tracking-normal">
                {t("stats.active", { count: activeFilterCount })}
              </span>
            )}
          </button>
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

        {/* #2464: kollapsbart indhold — skjult på mobil indtil disclosure åbnes. */}
        <div className={`${panelOpen ? "block" : "hidden"} sm:block mt-3 sm:mt-0`}>
        <div className={`grid gap-2 ${compact ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"}`}>
          {/* Name */}
          <div>
            <label className="block text-cz-3 text-[10px] uppercase tracking-wider mb-1">{t("fields.name")}</label>
            <input type="text" data-testid="filter-name" value={filters.q} onChange={e => onChange("q", e.target.value)}
              placeholder={t("fields.namePlaceholder")}
              className="w-full bg-cz-subtle border border-cz-border rounded-cz px-3 py-2
                text-cz-1 text-sm placeholder-cz-3 focus:outline-none focus:border-cz-accent" />
          </div>

          {/* Country */}
          <div>
            <label className="block text-cz-3 text-[10px] uppercase tracking-wider mb-1">{t("fields.country")}</label>
            <select value={filters.nationality_code} onChange={e => onChange("nationality_code", e.target.value)}
              className="w-full bg-cz-subtle border border-cz-border rounded-cz px-2 py-2
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
              className="w-full bg-cz-subtle border border-cz-border rounded-cz px-2 py-2
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
                className="w-full bg-cz-subtle border border-cz-border rounded-cz px-2 py-2
                  text-cz-1 text-sm placeholder-cz-3 focus:outline-none focus:border-cz-accent" />
              <input type="number" value={filters.max_value} onChange={e => onChange("max_value", e.target.value)}
                placeholder={t("fields.max")}
                className="w-full bg-cz-subtle border border-cz-border rounded-cz px-2 py-2
                  text-cz-1 text-sm placeholder-cz-3 focus:outline-none focus:border-cz-accent" />
            </div>
          </div>

          {/* Salary range */}
          <div>
            <label className="block text-cz-3 text-[10px] uppercase tracking-wider mb-1">{t("fields.salaryRange")}</label>
            <div className="flex gap-1">
              <input type="number" value={filters.min_salary} onChange={e => onChange("min_salary", e.target.value)}
                placeholder={t("fields.min")}
                className="w-full bg-cz-subtle border border-cz-border rounded-cz px-2 py-2
                  text-cz-1 text-sm placeholder-cz-3 focus:outline-none focus:border-cz-accent" />
              <input type="number" value={filters.max_salary} onChange={e => onChange("max_salary", e.target.value)}
                placeholder={t("fields.max")}
                className="w-full bg-cz-subtle border border-cz-border rounded-cz px-2 py-2
                  text-cz-1 text-sm placeholder-cz-3 focus:outline-none focus:border-cz-accent" />
            </div>
          </div>

          {/* Age range */}
          <div>
            <label className="block text-cz-3 text-[10px] uppercase tracking-wider mb-1">{t("fields.ageRange")}</label>
            <div className="flex gap-1">
              <input type="number" value={filters.min_age} onChange={e => onChange("min_age", e.target.value)}
                placeholder={t("fields.min")} min={16} max={45}
                className="w-full bg-cz-subtle border border-cz-border rounded-cz px-2 py-2
                  text-cz-1 text-sm placeholder-cz-3 focus:outline-none focus:border-cz-accent" />
              <input type="number" value={filters.max_age} onChange={e => onChange("max_age", e.target.value)}
                placeholder={t("fields.max")} min={16} max={45}
                className="w-full bg-cz-subtle border border-cz-border rounded-cz px-2 py-2
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
                  className="w-full bg-cz-subtle border border-cz-border rounded-cz px-2 py-2
                    text-cz-1 text-sm placeholder-cz-3 focus:outline-none focus:border-cz-accent" />
                <input type="number" value={filters.max_auction_price} onChange={e => onChange("max_auction_price", e.target.value)}
                  placeholder={t("fields.max")}
                  className="w-full bg-cz-subtle border border-cz-border rounded-cz px-2 py-2
                    text-cz-1 text-sm placeholder-cz-3 focus:outline-none focus:border-cz-accent" />
              </div>
            </div>
          )}

          {/* Salgspris (transfer-marked-only, #2522) — asking_price sat af sælger,
              adskilt fra auktionens nuværende-bud-filter ovenfor. */}
          {showAskingPriceFilter && (
            <div>
              <label className="block text-cz-3 text-[10px] uppercase tracking-wider mb-1">{t("fields.askingPriceRange")}</label>
              <div className="flex gap-1">
                <input type="number" data-testid="filter-asking-price-min" value={filters.min_asking_price} onChange={e => onChange("min_asking_price", e.target.value)}
                  placeholder={t("fields.min")}
                  className="w-full bg-cz-subtle border border-cz-border rounded-cz px-2 py-2
                    text-cz-1 text-sm placeholder-cz-3 focus:outline-none focus:border-cz-accent" />
                <input type="number" data-testid="filter-asking-price-max" value={filters.max_asking_price} onChange={e => onChange("max_asking_price", e.target.value)}
                  placeholder={t("fields.max")}
                  className="w-full bg-cz-subtle border border-cz-border rounded-cz px-2 py-2
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
                className="w-full bg-cz-subtle border border-cz-border rounded-cz px-2 py-2
                  text-cz-1 text-sm focus:outline-none focus:border-cz-accent">
                <option value="">{t("fields.teamAll")}</option>
                {teams.map(tm => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
              </select>
            </div>
          )}

          {/* Toggles. #2238: show_ai (default false = skjul AI-hold-ryttere) vises KUN
              på rytter-databasen (showAiToggle) — de andre lister har ingen AI-ryttere.
              3 knapper → cols-3; med show_ai → 4 knapper i cols-2. */}
          <div className={`grid ${showAiToggle ? "grid-cols-2" : "grid-cols-3"} gap-2 items-end ${compact ? "sm:col-span-2" : ""}`}>
            {[
              { key: "free_agent", label: t("toggles.freeAgent") },
              { key: "u25", label: t("toggles.u25") },
              { key: "u23", label: t("toggles.u23") },
              ...(showAiToggle ? [{ key: "show_ai", label: t("toggles.showAi") }] : []),
            ].map(({ key, label }) => (
              <button key={key} onClick={() => onChange(key, !filters[key])}
                className={`px-2 py-2 rounded-cz text-xs font-medium transition-all border
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
            <ChevronRightIcon size={12} aria-hidden="true"
              className={`transition-transform duration-150 ${statsOpen ? "rotate-90" : ""}`} />
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
                  t={t}
                />
              ))}
            </div>
          )}
        </div>
        </div>
      </Card>

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
          {showAskingPriceFilter && filters.min_asking_price && <Chip t={t} label={t("chips.askingPrice.min", { amount: formatNumber(parseInt(filters.min_asking_price)) })} onRemove={() => onChange("min_asking_price", "")} />}
          {showAskingPriceFilter && filters.max_asking_price && <Chip t={t} label={t("chips.askingPrice.max", { amount: formatNumber(parseInt(filters.max_asking_price)) })} onRemove={() => onChange("max_asking_price", "")} />}
          {filters.u25 && <Chip t={t} label={t("toggles.u25")} onRemove={() => onChange("u25", false)} />}
          {filters.u23 && <Chip t={t} label={t("toggles.u23")} onRemove={() => onChange("u23", false)} />}
          {filters.free_agent && <Chip t={t} label={t("toggles.freeAgent")} onRemove={() => onChange("free_agent", false)} />}
          {showAiToggle && filters.show_ai && <Chip t={t} label={t("toggles.showAi")} onRemove={() => onChange("show_ai", false)} />}
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
