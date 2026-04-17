/**
 * RiderFilters — shared filter/sort component used on all rider pages
 * Props:
 *   filters: object with current filter state
 *   onChange: (key, value) => void
 *   onReset: () => void
 *   showTeamFilter: bool (default true)
 *   compact: bool — fewer rows, for sidepanels
 */

const SORT_OPTIONS = [
  { value: "uci_points",  label: "UCI Point" },
  { value: "stat_bj",     label: "Bjerg" },
  { value: "stat_sp",     label: "Sprint" },
  { value: "stat_tt",     label: "TT" },
  { value: "stat_fl",     label: "Flad" },
  { value: "stat_udh",    label: "Udholdenhed" },
  { value: "stat_acc",    label: "Acceleration" },
  { value: "stat_mod",    label: "Modstandsdygtighed" },
  { value: "birthdate",   label: "Alder (yngst først)" },
];

export const DEFAULT_FILTERS = {
  q: "",
  sort: "uci_points",
  sort_dir: "desc",
  min_uci: "",
  max_uci: "",
  min_age: "",
  max_age: "",
  u25: false,
  u23: false,
  free_agent: false,
  team_id: "",
};

export default function RiderFilters({ filters, onChange, onReset, showTeamFilter = true, compact = false, teams = [] }) {
  const hasActiveFilters = filters.q || filters.min_uci || filters.max_uci ||
    filters.min_age || filters.max_age || filters.u25 || filters.u23 ||
    filters.free_agent || filters.team_id || filters.sort !== "uci_points";

  return (
    <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-white/40 text-xs uppercase tracking-wider font-semibold">Filtrér & Sortér</p>
        {hasActiveFilters && (
          <button onClick={onReset}
            className="text-xs text-white/30 hover:text-white transition-colors">
            Nulstil
          </button>
        )}
      </div>

      <div className={`grid gap-2 ${compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"}`}>
        {/* Name search */}
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-white/25 text-[10px] uppercase tracking-wider mb-1">Navn</label>
          <input
            type="text"
            value={filters.q}
            onChange={e => onChange("q", e.target.value)}
            placeholder="Søg rytter..."
            className="w-full bg-white/5 border border-white/8 rounded-lg px-3 py-2
              text-white text-sm placeholder-white/20 focus:outline-none focus:border-[#e8c547]/50"
          />
        </div>

        {/* Sort */}
        <div>
          <label className="block text-white/25 text-[10px] uppercase tracking-wider mb-1">Sortér efter</label>
          <div className="flex gap-1">
            <select
              value={filters.sort}
              onChange={e => onChange("sort", e.target.value)}
              className="flex-1 bg-white/5 border border-white/8 rounded-lg px-2 py-2
                text-white text-sm focus:outline-none focus:border-[#e8c547]/50 min-w-0">
              {SORT_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button
              onClick={() => onChange("sort_dir", filters.sort_dir === "desc" ? "asc" : "desc")}
              title={filters.sort_dir === "desc" ? "Høj → Lav" : "Lav → Høj"}
              className="px-2.5 bg-white/5 border border-white/8 rounded-lg text-white/50
                hover:text-white hover:bg-white/10 transition-all text-sm flex-shrink-0">
              {filters.sort_dir === "desc" ? "↓" : "↑"}
            </button>
          </div>
        </div>

        {/* UCI price range */}
        <div>
          <label className="block text-white/25 text-[10px] uppercase tracking-wider mb-1">UCI CZ$ (min–max)</label>
          <div className="flex gap-1">
            <input
              type="number"
              value={filters.min_uci}
              onChange={e => onChange("min_uci", e.target.value)}
              placeholder="Min"
              className="w-full bg-white/5 border border-white/8 rounded-lg px-2 py-2
                text-white text-sm placeholder-white/20 focus:outline-none focus:border-[#e8c547]/50"
            />
            <input
              type="number"
              value={filters.max_uci}
              onChange={e => onChange("max_uci", e.target.value)}
              placeholder="Max"
              className="w-full bg-white/5 border border-white/8 rounded-lg px-2 py-2
                text-white text-sm placeholder-white/20 focus:outline-none focus:border-[#e8c547]/50"
            />
          </div>
        </div>

        {/* Age range */}
        <div>
          <label className="block text-white/25 text-[10px] uppercase tracking-wider mb-1">Alder (min–max)</label>
          <div className="flex gap-1">
            <input
              type="number"
              value={filters.min_age}
              onChange={e => onChange("min_age", e.target.value)}
              placeholder="Min"
              min={16} max={45}
              className="w-full bg-white/5 border border-white/8 rounded-lg px-2 py-2
                text-white text-sm placeholder-white/20 focus:outline-none focus:border-[#e8c547]/50"
            />
            <input
              type="number"
              value={filters.max_age}
              onChange={e => onChange("max_age", e.target.value)}
              placeholder="Max"
              min={16} max={45}
              className="w-full bg-white/5 border border-white/8 rounded-lg px-2 py-2
                text-white text-sm placeholder-white/20 focus:outline-none focus:border-[#e8c547]/50"
            />
          </div>
        </div>

        {/* Team filter */}
        {showTeamFilter && teams.length > 0 && (
          <div>
            <label className="block text-white/25 text-[10px] uppercase tracking-wider mb-1">Hold</label>
            <select
              value={filters.team_id}
              onChange={e => onChange("team_id", e.target.value)}
              className="w-full bg-white/5 border border-white/8 rounded-lg px-2 py-2
                text-white text-sm focus:outline-none focus:border-[#e8c547]/50">
              <option value="">Alle hold</option>
              {teams.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Toggle buttons */}
        <div className={`flex gap-2 items-end ${compact ? "col-span-2" : ""}`}>
          {[
            { key: "free_agent", label: "Fri agent" },
            { key: "u25",  label: "U25" },
            { key: "u23",  label: "U23" },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => onChange(key, !filters[key])}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-all border flex-shrink-0
                ${filters[key]
                  ? "bg-[#e8c547]/10 text-[#e8c547] border-[#e8c547]/30"
                  : "bg-white/3 text-white/35 border-white/8 hover:text-white hover:border-white/20"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Active filter chips */}
      {hasActiveFilters && (
        <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-white/5">
          {filters.q && <Chip label={`"${filters.q}"`} onRemove={() => onChange("q", "")} />}
          {filters.min_uci && <Chip label={`UCI ≥ ${parseInt(filters.min_uci).toLocaleString("da-DK")}`} onRemove={() => onChange("min_uci", "")} />}
          {filters.max_uci && <Chip label={`UCI ≤ ${parseInt(filters.max_uci).toLocaleString("da-DK")}`} onRemove={() => onChange("max_uci", "")} />}
          {filters.min_age && <Chip label={`Alder ≥ ${filters.min_age}`} onRemove={() => onChange("min_age", "")} />}
          {filters.max_age && <Chip label={`Alder ≤ ${filters.max_age}`} onRemove={() => onChange("max_age", "")} />}
          {filters.u25 && <Chip label="U25" onRemove={() => onChange("u25", false)} />}
          {filters.u23 && <Chip label="U23" onRemove={() => onChange("u23", false)} />}
          {filters.free_agent && <Chip label="Fri agent" onRemove={() => onChange("free_agent", false)} />}
          {filters.team_id && <Chip label="Hold valgt" onRemove={() => onChange("team_id", "")} />}
          {filters.sort !== "uci_points" && (
            <Chip label={`Sortér: ${SORT_OPTIONS.find(o => o.value === filters.sort)?.label}`}
              onRemove={() => onChange("sort", "uci_points")} />
          )}
        </div>
      )}
    </div>
  );
}

function Chip({ label, onRemove }) {
  return (
    <span className="flex items-center gap-1 bg-[#e8c547]/8 text-[#e8c547] border border-[#e8c547]/20
      text-[10px] px-2 py-1 rounded-full font-medium">
      {label}
      <button onClick={onRemove} className="hover:text-white ml-0.5">×</button>
    </span>
  );
}
