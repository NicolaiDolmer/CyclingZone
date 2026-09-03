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
import { Card, ChevronRightIcon, FilterBar, Input, Select, XIcon } from "./ui";
import { parseAmountInput } from "../lib/amountInput.js";

// #3495: filter-chippen viste tidligere parseInt(filters.min_x) — samme
// faktor-1000-fejl som beløbsfelterne, hvis brugeren har tastet fx "150.000".
function parsedFilterAmount(raw) {
  const parsed = parseAmountInput(raw);
  return parsed.valid ? parsed.value : 0;
}
import { labelClass } from "./ui/fieldStyles.js";
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
  // #3191: transfer-markedets %-afvigelse mellem asking_price og estimeret
  // markedsværdi (samme akse som ValueDeltaBadge/computeValueDeviationPct) —
  // signeret: negativ = under vurdering, positiv = over. Egen filter-akse,
  // adskilt fra min/max_asking_price ovenfor (kroner) og min/max_value (selve
  // vurderingen) — dette er FORHOLDET mellem de to.
  min_value_deviation_pct: "",
  max_value_deviation_pct: "",
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
  "min_value_deviation_pct", "max_value_deviation_pct",
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

// ── Min/max-talfelt (delt af panel- og bar-layoutet) ─────────────────────────
// #4628: de seks min/max-felter (vaerdi, loen, alder, bud, salgspris, afvigelse)
// var seks naesten-identiske JSX-blokke. Samlet i én komponent, saa panelet og
// FilterBar'ens "More filters" viser NOEJAGTIG de samme felter uden en anden kopi.
function RangeField({ label, minKey, maxKey, filters, onChange, t, testIdPrefix = null, min, max }) {
  return (
    <div>
      <label className={labelClass()}>{label}</label>
      <div className="flex gap-1">
        <Input
          type="number" min={min} max={max}
          data-testid={testIdPrefix ? `${testIdPrefix}-min` : undefined}
          value={filters[minKey]}
          onChange={e => onChange(minKey, e.target.value)}
          placeholder={t("fields.min")}
        />
        <Input
          type="number" min={min} max={max}
          data-testid={testIdPrefix ? `${testIdPrefix}-max` : undefined}
          value={filters[maxKey]}
          onChange={e => onChange(maxKey, e.target.value)}
          placeholder={t("fields.max")}
        />
      </div>
    </div>
  );
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

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-cz-3 text-3xs uppercase tracking-wider">{label}</label>
        <span className={`text-3xs font-mono font-bold ${active ? "text-cz-accent-t" : "text-cz-3"}`}>
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
          className="w-full cursor-pointer accent-cz-accent"
        />
      </div>
      {/* #261: præcise tal-inputs som supplement til slideren — deler _min/_max.
          Committer ved blur og Enter, så man kan taste "45" uden en fetch pr.
          ciffer. localMin/localMax holder visningen live mens man taster. */}
      <div className="flex items-center gap-1 mt-1">
        <Input
          size="sm" type="number" inputMode="numeric" min={0} max={99} step={1}
          data-testid={`stat-min-${statKey}`}
          aria-label={t("stats.minInput", { label })}
          value={localMin}
          onChange={e => setLocalMin(e.target.value)}
          onBlur={e => commitMinInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { commitMinInput(e.target.value); e.target.blur(); } }}
          className="text-center font-mono"
        />
        <span aria-hidden="true" className="text-cz-3 text-xs">–</span>
        <Input
          size="sm" type="number" inputMode="numeric" min={0} max={99} step={1}
          data-testid={`stat-max-${statKey}`}
          aria-label={t("stats.maxInput", { label })}
          value={localMax}
          onChange={e => setLocalMax(e.target.value)}
          onBlur={e => commitMaxInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { commitMaxInput(e.target.value); e.target.blur(); } }}
          className="text-center font-mono"
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
  showValueDeviationFilter = false,
  // #4628 (slice 6 af #4622, TASTE fork 1) — "bar" er T2-standarden: soegefelt +
  // maks 3 selects paa ÉN linje, resten bag "More filters" lukket som default
  // (docs/design/PAGE_TEMPLATES.md#t2-wide-data-page). "panel" er det gamle
  // 8-12-felts-kort, som Auktioner og Oenskelisten stadig bruger indtil de
  // migreres. Ingen felter forsvinder i "bar" — de flytter bag folden.
  layout = "panel",
  // Valgfri hoejre-stillet meta-linje i baren (fx "463 riders").
  meta = null,
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

  // #4628: felt-definitionerne bygges ÉN gang og genbruges af begge layouts, saa
  // "bar" og "panel" per konstruktion viser de samme filtre. De to selects der
  // staar i selve baren (land + ryttertype) er ogsaa de to foerste i panelets grid.
  const countryOptions = [
    { value: "", label: t("fields.countryAll") },
    ...sortedNationalities.map(code => ({ value: code, label: getCountryName(code, countryLocale) })),
  ];
  const typeOptions = [
    { value: "", label: tTypes("filter.all") },
    ...RIDER_TYPE_KEYS.map(key => ({ value: key, label: tTypes(`types.${key}`) })),
  ];

  // De to selects i selve baren. FilterBar kaster i dev over 3 — land og
  // ryttertype er de to man filtrerer paa foerst; resten bor bag folden.
  const barFilters = [
    {
      key: "nationality_code",
      value: filters.nationality_code,
      onChange: e => onChange("nationality_code", e.target.value),
      ariaLabel: t("fields.country"),
      options: countryOptions,
    },
    {
      key: "rider_type",
      value: filters.rider_type,
      onChange: e => onChange("rider_type", e.target.value),
      ariaLabel: tTypes("filter.label"),
      options: typeOptions,
    },
  ];

  // #2238: "Vis AI-ryttere" er en boolean og hoerer i FilterBar's checkbox-slot,
  // ikke i toggle-gitteret — derfor droppes den fra toggleKeys i bar-layoutet.
  const extraCheckbox = showAiToggle
    ? {
      id: "filter-show-ai",
      label: t("toggles.showAi"),
      checked: Boolean(filters.show_ai),
      onChange: e => onChange("show_ai", e.target.checked),
    }
    : null;

  const optionNodes = options => options.map(o => <option key={o.value} value={o.value}>{o.label}</option>);

  const countrySelect = (
    <Select value={filters.nationality_code} onChange={e => onChange("nationality_code", e.target.value)}
      aria-label={t("fields.country")}>
      {optionNodes(countryOptions)}
    </Select>
  );

  const typeSelect = (
    <Select value={filters.rider_type} onChange={e => onChange("rider_type", e.target.value)}
      aria-label={tTypes("filter.label")}>
      {optionNodes(typeOptions)}
    </Select>
  );

  const teamSelect = showTeamFilter && teams.length > 0 ? (
    <Select value={filters.team_id} onChange={e => onChange("team_id", e.target.value)} aria-label={t("fields.team")}>
      <option value="">{t("fields.teamAll")}</option>
      {teams.map(tm => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
    </Select>
  ) : null;

  const rangeFields = [
    { key: "value", label: t("fields.valueRange"), minKey: "min_value", maxKey: "max_value" },
    { key: "salary", label: t("fields.salaryRange"), minKey: "min_salary", maxKey: "max_salary" },
    { key: "age", label: t("fields.ageRange"), minKey: "min_age", maxKey: "max_age", min: 16, max: 45 },
    ...(showAuctionPriceFilter
      ? [{ key: "bid", label: t("fields.bidRange"), minKey: "min_auction_price", maxKey: "max_auction_price" }]
      : []),
    // #2522: asking_price (saelgerens pris) — egen akse, adskilt fra auktionens nuvaerende bud.
    ...(showAskingPriceFilter
      ? [{ key: "askingPrice", label: t("fields.askingPriceRange"), minKey: "min_asking_price", maxKey: "max_asking_price", testIdPrefix: "filter-asking-price" }]
      : []),
    // #3191: signeret %-afvigelse mellem asking_price og vurdering (samme akse som ValueDeltaBadge).
    ...(showValueDeviationFilter
      ? [{ key: "valueDeviation", label: t("fields.valueDeviationRange"), minKey: "min_value_deviation_pct", maxKey: "max_value_deviation_pct", testIdPrefix: "filter-value-deviation" }]
      : []),
  ];

  const rangeFieldNodes = rangeFields.map(f => (
    <RangeField key={f.key} label={f.label} minKey={f.minKey} maxKey={f.maxKey} min={f.min} max={f.max}
      testIdPrefix={f.testIdPrefix} filters={filters} onChange={onChange} t={t} />
  ));

  // #2238: show_ai (default false = skjul AI-hold-ryttere) vises KUN paa rytter-
  // databasen (showAiToggle) — de andre lister har ingen AI-ryttere.
  const showAiInGrid = showAiToggle && layout !== "bar";
  const toggleKeys = [
    { key: "free_agent", label: t("toggles.freeAgent") },
    { key: "u25", label: t("toggles.u25") },
    { key: "u23", label: t("toggles.u23") },
    ...(showAiInGrid ? [{ key: "show_ai", label: t("toggles.showAi") }] : []),
  ];

  const togglesNode = (
    <div className={`grid ${showAiInGrid ? "grid-cols-2" : "grid-cols-3"} gap-2 items-end ${compact ? "sm:col-span-2" : ""}`}>
      {toggleKeys.map(({ key, label }) => (
        <button key={key} type="button" onClick={() => onChange(key, !filters[key])}
          aria-pressed={Boolean(filters[key])}
          className={`px-2 py-2 rounded-cz text-xs font-medium transition-all border
            ${filters[key]
              ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/40"
              : "bg-cz-subtle text-cz-3 border-cz-border hover:text-cz-1 hover:border-cz-border"}`}>
          {label}
        </button>
      ))}
    </div>
  );

  const abilitiesNode = (
    <div className="mt-3 pt-3 border-t border-cz-border">
      <button type="button" onClick={() => setStatsOpen(o => !o)}
        aria-expanded={statsOpen}
        className="flex items-center gap-2 text-cz-3 hover:text-cz-2 text-xs transition-colors">
        <ChevronRightIcon size={12} aria-hidden="true"
          className={`transition-transform duration-150 ${statsOpen ? "rotate-90" : ""}`} />
        <span className="uppercase tracking-wider font-medium">{t("stats.section")}</span>
        {hasActiveStats && (
          <span className="bg-cz-accent/10 text-cz-accent-t text-3xs px-1.5 py-0.5 rounded-cz-pill">
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
  );

  // #960: altid synlig saa brugeren laerer den findes; deaktiveret/graa indtil
  // mindst ét filter er sat, og viser saa taelleren. Samme knap i begge layouts.
  const resetButton = (
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
  );

  const chipsNode = hasActiveFilters ? (
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
      {filters.min_auction_price && <Chip t={t} label={t("chips.bid.min", { amount: formatNumber(parsedFilterAmount(filters.min_auction_price)) })} onRemove={() => onChange("min_auction_price", "")} />}
      {filters.max_auction_price && <Chip t={t} label={t("chips.bid.max", { amount: formatNumber(parsedFilterAmount(filters.max_auction_price)) })} onRemove={() => onChange("max_auction_price", "")} />}
      {showAskingPriceFilter && filters.min_asking_price && <Chip t={t} label={t("chips.askingPrice.min", { amount: formatNumber(parsedFilterAmount(filters.min_asking_price)) })} onRemove={() => onChange("min_asking_price", "")} />}
      {showAskingPriceFilter && filters.max_asking_price && <Chip t={t} label={t("chips.askingPrice.max", { amount: formatNumber(parsedFilterAmount(filters.max_asking_price)) })} onRemove={() => onChange("max_asking_price", "")} />}
      {showValueDeviationFilter && filters.min_value_deviation_pct && <Chip t={t} label={t("chips.valueDeviation.min", { value: filters.min_value_deviation_pct })} onRemove={() => onChange("min_value_deviation_pct", "")} />}
      {showValueDeviationFilter && filters.max_value_deviation_pct && <Chip t={t} label={t("chips.valueDeviation.max", { value: filters.max_value_deviation_pct })} onRemove={() => onChange("max_value_deviation_pct", "")} />}
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
  ) : null;

  // ── T2-filterlinje (#4628) ──────────────────────────────────────────────────
  // Soegefelt + land + ryttertype paa én linje; alt andet bag "More filters",
  // lukket som default. Chippene staar under baren, saa et filter der er sat bag
  // folden stadig er synligt og kan fjernes med ét klik.
  if (layout === "bar") {
    return (
      <>
        <FilterBar
          className="mb-3"
          search={{
            value: filters.q,
            onChange: e => onChange("q", e.target.value),
            placeholder: t("fields.namePlaceholder"),
            ariaLabel: t("fields.name"),
            testId: "filter-name",
          }}
          filters={barFilters}
          checkbox={extraCheckbox}
          trailing={resetButton}
          meta={meta}
          moreLabel={t("panel.more")}
        >
          <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {teamSelect && (
              <div>
                <label className={labelClass()}>{t("fields.team")}</label>
                {teamSelect}
              </div>
            )}
            {rangeFieldNodes}
            {togglesNode}
          </div>
          <div className="w-full">{abilitiesNode}</div>
        </FilterBar>
        {chipsNode}
      </>
    );
  }

  return (
    <>
      {/* ── Filter panel (legacy — Auktioner + Oenskelisten indtil de migreres) ── */}
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
              <span className="bg-cz-accent/10 text-cz-accent-t text-3xs px-1.5 py-0.5 rounded-cz-pill normal-case tracking-normal">
                {t("stats.active", { count: activeFilterCount })}
              </span>
            )}
          </button>
          {resetButton}
        </div>

        {/* #2464: kollapsbart indhold — skjult på mobil indtil disclosure åbnes. */}
        <div className={`${panelOpen ? "block" : "hidden"} sm:block mt-3 sm:mt-0`}>
        <div className={`grid gap-2 ${compact ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"}`}>
          {/* Name */}
          <div>
            <label className={labelClass()}>{t("fields.name")}</label>
            <Input type="text" data-testid="filter-name" value={filters.q} onChange={e => onChange("q", e.target.value)}
              placeholder={t("fields.namePlaceholder")} />
          </div>

          {/* Country */}
          <div>
            <label className={labelClass()}>{t("fields.country")}</label>
            {countrySelect}
          </div>

          {/* Rider type (#49) */}
          <div>
            <label className={labelClass()}>{tTypes("filter.label")}</label>
            {typeSelect}
          </div>

          {/* Vaerdi / loen / alder (+ bud, salgspris, vaerdi-afvigelse pr. side) */}
          {rangeFieldNodes}

          {/* Potentiale-filter fjernet (#1162): potentialet er skjult information —
              man kan ikke filtrere på en værdi man ikke har scoutet, og et
              server-filter på den rå kolonne var en oracle-lækage. */}

          {/* Team */}
          {teamSelect && (
            <div>
              <label className={labelClass()}>{t("fields.team")}</label>
              {teamSelect}
            </div>
          )}

          {togglesNode}
        </div>

        {/* Evne-filtre (dual sliders) */}
        {abilitiesNode}
        </div>
      </Card>

      {/* ── Active filter chips (between panel and table) ── */}
      {chipsNode}
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
        text-xs px-3 min-h-[44px] rounded-cz-pill font-medium hover:bg-cz-accent/20 transition-colors"
    >
      {label}
      <XIcon size={14} aria-hidden="true" className="flex-shrink-0" />
    </button>
  );
}
