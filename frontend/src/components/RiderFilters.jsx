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
 */
import { useState } from "react";
import { getFlagEmoji, getCountryName } from "../lib/countryUtils";

export const STAT_KEYS = [
  "stat_fl","stat_bj","stat_kb","stat_bk","stat_tt","stat_prl",
  "stat_bro","stat_sp","stat_acc","stat_ned","stat_udh","stat_mod","stat_res","stat_ftr",
];

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
  sort: "uci_points",
  sort_dir: "desc",
  nationality_code: "",
  min_uci: "",
  max_uci: "",
  min_salary: "",
  max_salary: "",
  min_age: "",
  max_age: "",
  u25: false,
  u23: false,
  free_agent: false,
  team_id: "",
  ...makeStatDefaults(),
};

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
        <label className="text-slate-400 text-[10px] uppercase tracking-wider">{label}</label>
        <span className={`text-[10px] font-mono font-bold ${active ? "text-amber-700" : "text-slate-300"}`}>
          {valMin}–{valMax}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <input
          type="range" min={50} max={85} step={1} value={valMin}
          onChange={e => onChange(minKey, Math.min(parseInt(e.target.value), valMax))}
          className="w-full cursor-pointer accent-slate-400"
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
}) {
  const [statsOpen, setStatsOpen] = useState(false);

  const activeStatKeys = STAT_KEYS.filter(k => isStatActive(filters, k));
  const hasActiveStats = activeStatKeys.length > 0;

  const hasBasicActive = filters.q || filters.nationality_code ||
    filters.min_uci || filters.max_uci ||
    filters.min_salary || filters.max_salary ||
    filters.min_age || filters.max_age || filters.u25 || filters.u23 ||
    filters.free_agent || filters.team_id;

  const hasActiveFilters = hasBasicActive || hasActiveStats;

  function resetStat(key) {
    onChange(`${key}_min`, STAT_DEFAULT_MIN);
    onChange(`${key}_max`, STAT_DEFAULT_MAX);
  }

  return (
    <>
      {/* ── Filter panel ── */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-3">
        <div className="flex items-center justify-between gap-3 mb-3">
          <p className="text-slate-500 text-xs uppercase tracking-wider font-semibold">Filtrér</p>
          {hasActiveFilters && (
            <button onClick={onReset} className="text-xs text-slate-400 hover:text-slate-900 transition-colors flex-shrink-0">
              Nulstil
            </button>
          )}
        </div>

        <div className={`grid gap-2 ${compact ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"}`}>
          {/* Name */}
          <div>
            <label className="block text-slate-400 text-[10px] uppercase tracking-wider mb-1">Navn</label>
            <input type="text" value={filters.q} onChange={e => onChange("q", e.target.value)}
              placeholder="Søg rytter..."
              className="w-full bg-slate-100 border border-slate-200 rounded-lg px-3 py-2
                text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-amber-400" />
          </div>

          {/* Country */}
          <div>
            <label className="block text-slate-400 text-[10px] uppercase tracking-wider mb-1">Land</label>
            <select value={filters.nationality_code} onChange={e => onChange("nationality_code", e.target.value)}
              className="w-full bg-slate-100 border border-slate-200 rounded-lg px-2 py-2
                text-slate-900 text-sm focus:outline-none focus:border-amber-400">
              <option value="">Alle lande</option>
              {nationalities.map(code => (
                <option key={code} value={code}>{getFlagEmoji(code)} {getCountryName(code)}</option>
              ))}
            </select>
          </div>

          {/* UCI range */}
          <div>
            <label className="block text-slate-400 text-[10px] uppercase tracking-wider mb-1">Værdi CZ$ (min–max)</label>
            <div className="flex gap-1">
              <input type="number" value={filters.min_uci} onChange={e => onChange("min_uci", e.target.value)}
                placeholder="Min"
                className="w-full bg-slate-100 border border-slate-200 rounded-lg px-2 py-2
                  text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-amber-400" />
              <input type="number" value={filters.max_uci} onChange={e => onChange("max_uci", e.target.value)}
                placeholder="Max"
                className="w-full bg-slate-100 border border-slate-200 rounded-lg px-2 py-2
                  text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-amber-400" />
            </div>
          </div>

          {/* Salary range */}
          <div>
            <label className="block text-slate-400 text-[10px] uppercase tracking-wider mb-1">Løn CZ$ (min–max)</label>
            <div className="flex gap-1">
              <input type="number" value={filters.min_salary} onChange={e => onChange("min_salary", e.target.value)}
                placeholder="Min"
                className="w-full bg-slate-100 border border-slate-200 rounded-lg px-2 py-2
                  text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-amber-400" />
              <input type="number" value={filters.max_salary} onChange={e => onChange("max_salary", e.target.value)}
                placeholder="Max"
                className="w-full bg-slate-100 border border-slate-200 rounded-lg px-2 py-2
                  text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-amber-400" />
            </div>
          </div>

          {/* Age range */}
          <div>
            <label className="block text-slate-400 text-[10px] uppercase tracking-wider mb-1">Alder (min–max)</label>
            <div className="flex gap-1">
              <input type="number" value={filters.min_age} onChange={e => onChange("min_age", e.target.value)}
                placeholder="Min" min={16} max={45}
                className="w-full bg-slate-100 border border-slate-200 rounded-lg px-2 py-2
                  text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-amber-400" />
              <input type="number" value={filters.max_age} onChange={e => onChange("max_age", e.target.value)}
                placeholder="Max" min={16} max={45}
                className="w-full bg-slate-100 border border-slate-200 rounded-lg px-2 py-2
                  text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-amber-400" />
            </div>
          </div>

          {/* Team */}
          {showTeamFilter && teams.length > 0 && (
            <div>
              <label className="block text-slate-400 text-[10px] uppercase tracking-wider mb-1">Hold</label>
              <select value={filters.team_id} onChange={e => onChange("team_id", e.target.value)}
                className="w-full bg-slate-100 border border-slate-200 rounded-lg px-2 py-2
                  text-slate-900 text-sm focus:outline-none focus:border-amber-400">
                <option value="">Alle hold</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}

          {/* Toggles */}
          <div className={`grid grid-cols-3 gap-2 items-end ${compact ? "sm:col-span-2" : ""}`}>
            {[{ key: "free_agent", label: "Fri agent" }, { key: "u25", label: "U25" }, { key: "u23", label: "U23" }].map(({ key, label }) => (
              <button key={key} onClick={() => onChange(key, !filters[key])}
                className={`px-2 py-2 rounded-lg text-xs font-medium transition-all border
                  ${filters[key]
                    ? "bg-amber-50 text-amber-700 border-amber-300"
                    : "bg-slate-50 text-slate-400 border-slate-200 hover:text-slate-900 hover:border-slate-400"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Evne-filtre (dual sliders) */}
        <div className="mt-3 pt-3 border-t border-slate-200">
          <button onClick={() => setStatsOpen(o => !o)}
            className="flex items-center gap-2 text-slate-400 hover:text-slate-500 text-xs transition-colors">
            <span className={`transition-transform duration-150 inline-block ${statsOpen ? "rotate-90" : ""}`}>▶</span>
            <span className="uppercase tracking-wider font-medium">Evne-filtre</span>
            {hasActiveStats && (
              <span className="bg-amber-50 text-amber-700 text-[10px] px-1.5 py-0.5 rounded-full">
                {activeStatKeys.length} aktive
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
          {filters.q && <Chip label={`"${filters.q}"`} onRemove={() => onChange("q", "")} />}
          {filters.nationality_code && (
            <Chip
              label={`${getFlagEmoji(filters.nationality_code)} ${getCountryName(filters.nationality_code)}`}
              onRemove={() => onChange("nationality_code", "")}
            />
          )}
          {filters.min_uci && <Chip label={`Værdi ≥ ${parseInt(filters.min_uci).toLocaleString("da-DK")} CZ$`} onRemove={() => onChange("min_uci", "")} />}
          {filters.max_uci && <Chip label={`Værdi ≤ ${parseInt(filters.max_uci).toLocaleString("da-DK")} CZ$`} onRemove={() => onChange("max_uci", "")} />}
          {filters.min_salary && <Chip label={`Løn ≥ ${parseInt(filters.min_salary).toLocaleString("da-DK")} CZ$`} onRemove={() => onChange("min_salary", "")} />}
          {filters.max_salary && <Chip label={`Løn ≤ ${parseInt(filters.max_salary).toLocaleString("da-DK")} CZ$`} onRemove={() => onChange("max_salary", "")} />}
          {filters.min_age && <Chip label={`Alder ≥ ${filters.min_age}`} onRemove={() => onChange("min_age", "")} />}
          {filters.max_age && <Chip label={`Alder ≤ ${filters.max_age}`} onRemove={() => onChange("max_age", "")} />}
          {filters.u25 && <Chip label="U25" onRemove={() => onChange("u25", false)} />}
          {filters.u23 && <Chip label="U23" onRemove={() => onChange("u23", false)} />}
          {filters.free_agent && <Chip label="Fri agent" onRemove={() => onChange("free_agent", false)} />}
          {filters.team_id && <Chip label="Hold valgt" onRemove={() => onChange("team_id", "")} />}
          {activeStatKeys.map(key => {
            const min = parseInt(filters[`${key}_min`]) ?? STAT_DEFAULT_MIN;
            const max = parseInt(filters[`${key}_max`]) ?? STAT_DEFAULT_MAX;
            return (
              <Chip
                key={key}
                label={`${STAT_LABELS_MAP[key]} ${min}–${max}`}
                onRemove={() => resetStat(key)}
              />
            );
          })}
        </div>
      )}
    </>
  );
}

function Chip({ label, onRemove }) {
  return (
    <span className="flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200
      text-[10px] px-2 py-1 rounded-full font-medium">
      {label}
      <button onClick={onRemove} className="hover:text-slate-900 ml-0.5">×</button>
    </span>
  );
}
