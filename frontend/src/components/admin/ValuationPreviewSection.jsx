import { useState, useEffect, useMemo } from "react";
import { readAdminJson, adminErrorMessage } from "./shared/useAdminAuth";

const API = import.meta.env.VITE_API_URL;
const PAGE_SIZE = 50;

// Dansk label pr. ability/feature (admin-only flade → ingen i18n).
const FEATURE_LABELS = {
  climbing: "Klatring", time_trial: "Enkeltstart", sprint: "Sprint", punch: "Punch",
  endurance: "Udholdenhed", cobble_classics: "Brosten", acceleration: "Acceleration",
  recovery: "Restitution", tactics: "Taktik", positioning: "Positionering",
  age: "Alder", age_sq: "Alder²", potentiale: "Potentiale", popularity: "Popularitet",
  is_u25: "U25",
};

const fmt = (n) => (n == null ? "—" : Math.round(n).toLocaleString("da-DK"));

export default function ValuationPreviewSection({ getAuth, onMsg }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState({ key: "new_value", dir: "desc" });
  const [page, setPage] = useState(1);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/admin/rider-valuation-preview`, { headers: await getAuth() });
      const json = await readAdminJson(res);
      if (res.ok) setData(json);
      else onMsg?.(`❌ ${adminErrorMessage(json, res)}`, "error");
    } catch (e) {
      onMsg?.(`❌ Forbindelsen fejlede: ${e.message || "ukendt"}`, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    if (!data?.riders) return [];
    const q = search.trim().toLowerCase();
    let r = q ? data.riders.filter((x) => x.name.toLowerCase().includes(q)) : data.riders;
    const { key, dir } = sort;
    const mul = dir === "asc" ? 1 : -1;
    r = [...r].sort((a, b) => {
      const av = a[key], bv = b[key];
      if (typeof av === "string") return av.localeCompare(bv) * mul;
      return ((av ?? 0) - (bv ?? 0)) * mul;
    });
    return r;
  }, [data, search, sort]);

  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
    setPage(1);
  }

  if (loading && !data) return <p className="text-cz-3 text-xs">Henter forhåndsvisning…</p>;
  if (!data) return (
    <button onClick={load} className="px-3 py-1.5 bg-cz-subtle text-cz-2 border border-cz-border rounded-lg text-xs hover:text-cz-1">
      Indlæs forhåndsvisning
    </button>
  );

  const m = data.model;
  const d = data.distribution;
  const maxCoef = Math.max(...data.coefficients.map((c) => Math.abs(c.weight)), 1e-9);

  return (
    <div className="space-y-4">
      {/* Model-metadata + ærlig caveat */}
      <div className="bg-cz-subtle border border-cz-border rounded-lg px-4 py-3 text-xs">
        <p className="text-cz-2 font-semibold mb-2">Model (data-drevet · #1101 SHADOW — styrer endnu intet)</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-center">
          <Stat label="Trænet på" value={`${m.n_train} salg`} />
          <Stat label="CV R²" value={m.cv_r2} />
          <Stat label="Train R²" value={m.train_r2} />
          <Stat label="λ" value={m.lambda} />
          <Stat label="Konveksitet" value={m.convexity_exponent} />
          <Stat label="Gulv" value={`${fmt(m.floor)} CZ$`} />
        </div>
        <p className="text-cz-3 mt-2">
          Fittet {m.fitted_at} på kontesterede menneske-salg. <span className="text-cz-warning">Lille datasæt ({m.n_train} handler) → grove,
          usikre koefficienter</span>; re-fit efter relaunch på renere data. Værdierne her påvirker IKKE køb/salg/løn endnu.
        </p>
      </div>

      {/* Koefficienter — hvad betaler managers for */}
      <div className="bg-cz-subtle border border-cz-border rounded-lg px-4 py-3 text-xs">
        <p className="text-cz-2 font-semibold mb-2">Hvad betaler managers for? (standardiserede vægte)</p>
        <div className="space-y-1">
          {data.coefficients.map((c) => (
            <div key={c.key} className="flex items-center gap-2">
              <span className="w-28 shrink-0 text-cz-2">{FEATURE_LABELS[c.key] || c.key}</span>
              <div className="flex-1 h-3 bg-cz-bg rounded relative overflow-hidden">
                <div
                  className={`absolute top-0 bottom-0 ${c.weight >= 0 ? "left-1/2 bg-cz-accent" : "right-1/2 bg-cz-danger"}`}
                  style={{ width: `${(Math.abs(c.weight) / maxCoef) * 50}%` }}
                />
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-cz-border" />
              </div>
              <span className={`w-14 text-right font-mono ${c.weight >= 0 ? "text-cz-accent-t" : "text-cz-danger"}`}>
                {c.weight >= 0 ? "+" : ""}{c.weight.toFixed(3)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Fordeling gammel vs ny */}
      <div className="bg-cz-subtle border border-cz-border rounded-lg px-4 py-3 text-xs">
        <p className="text-cz-2 font-semibold mb-2">Fordeling — {d.count.toLocaleString("da-DK")} ryttere (CZ$)</p>
        <table className="w-full">
          <thead>
            <tr className="text-cz-3 border-b border-cz-border">
              <th className="text-left py-1"></th><th className="text-right py-1 px-2">p10</th>
              <th className="text-right py-1 px-2">median</th><th className="text-right py-1 px-2">p90</th>
              <th className="text-right py-1 ps-2">max</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            <tr className="border-b border-cz-border/50">
              <td className="py-1 text-cz-3 font-sans">Gammel (uci)</td>
              <td className="py-1 px-2 text-right text-cz-3">{fmt(d.old.p10)}</td>
              <td className="py-1 px-2 text-right text-cz-3">{fmt(d.old.median)}</td>
              <td className="py-1 px-2 text-right text-cz-3">{fmt(d.old.p90)}</td>
              <td className="py-1 ps-2 text-right text-cz-3">{fmt(d.old.max)}</td>
            </tr>
            <tr>
              <td className="py-1 text-cz-1 font-sans font-semibold">Ny (base_value)</td>
              <td className="py-1 px-2 text-right text-cz-1">{fmt(d.new.p10)}</td>
              <td className="py-1 px-2 text-right text-cz-1">{fmt(d.new.median)}</td>
              <td className="py-1 px-2 text-right text-cz-1">{fmt(d.new.p90)}</td>
              <td className="py-1 ps-2 text-right text-cz-1">{fmt(d.new.max)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Rytter-tabel */}
      <div>
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Søg rytter…"
          className="w-full sm:w-64 bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none mb-2"
        />
        <div className="overflow-x-auto rounded-lg border border-cz-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-cz-border text-cz-3">
                <Th label="Rytter" k="name" sort={sort} onSort={toggleSort} align="left" />
                <Th label="Speciale" k="specialty" sort={sort} onSort={toggleSort} align="left" />
                <Th label="Overall" k="overall" sort={sort} onSort={toggleSort} />
                <Th label="Gammel" k="old_value" sort={sort} onSort={toggleSort} />
                <Th label="Ny" k="new_value" sort={sort} onSort={toggleSort} />
                <Th label="Δ" k="delta" sort={sort} onSort={toggleSort} />
                <Th label="%" k="pct" sort={sort} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.id} className="border-b border-cz-border/50 last:border-0 hover:bg-cz-bg">
                  <td className="px-3 py-1.5 text-cz-1">{r.name}{r.is_fictional && <span className="ms-1 text-cz-3" title="Fiktiv rytter">◆</span>}</td>
                  <td className="px-3 py-1.5 text-cz-2">{FEATURE_LABELS[r.specialty] || r.specialty}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-cz-2">{r.overall}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-cz-3">{fmt(r.old_value)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-cz-1 font-semibold">{fmt(r.new_value)}</td>
                  <td className={`px-3 py-1.5 text-right font-mono ${r.delta >= 0 ? "text-cz-accent-t" : "text-cz-danger"}`}>{r.delta >= 0 ? "+" : ""}{fmt(r.delta)}</td>
                  <td className={`px-3 py-1.5 text-right font-mono ${(r.pct ?? 0) >= 0 ? "text-cz-accent-t" : "text-cz-danger"}`}>{r.pct == null ? "—" : `${r.pct >= 0 ? "+" : ""}${r.pct}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between mt-2 text-xs text-cz-3">
          <span>{rows.length.toLocaleString("da-DK")} ryttere</span>
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-2 py-1 rounded bg-cz-subtle disabled:opacity-40">‹</button>
            <span>{page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="px-2 py-1 rounded bg-cz-subtle disabled:opacity-40">›</button>
            <button onClick={load} className="ms-2 px-2 py-1 rounded bg-cz-subtle hover:text-cz-1">↻ Genindlæs</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="text-cz-3">{label}</div>
      <div className="text-cz-1 font-mono font-semibold">{value}</div>
    </div>
  );
}

function Th({ label, k, sort, onSort, align = "right" }) {
  const active = sort.key === k;
  return (
    <th
      onClick={() => onSort(k)}
      className={`px-3 py-2 cursor-pointer select-none hover:text-cz-1 ${align === "left" ? "text-left" : "text-right"} ${active ? "text-cz-1" : ""}`}
    >
      {label}{active ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
    </th>
  );
}
