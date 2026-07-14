import { useState, useEffect, useMemo } from "react";
import { readAdminJson, adminErrorMessage } from "./shared/useAdminAuth";

const API = import.meta.env.VITE_API_URL;
const PAGE_SIZE = 50;

// Dansk label pr. ryttertype (admin-only flade → ingen i18n, samme princip som
// ValuationPreviewSection.jsx). Nøglerne matcher RIDER_TYPE_KEYS (riderTypes.js).
const TYPE_LABELS = {
  sprinter: "Sprinter", tt: "Enkeltstart", climber: "Klatrer", puncheur: "Punchrytter",
  brostensrytter: "Brostensrytter", baroudeur: "Baroudeur", rouleur: "Rouleur", gc: "GC",
};

const fmt = (n) => (n == null ? "—" : Math.round(n).toLocaleString("da-DK"));

export default function ValuationV4PreviewSection({ getAuth, onMsg }) {
  const [data, setData] = useState(null);
  const [notFitted, setNotFitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState({ key: "v4_value", dir: "desc" });
  const [page, setPage] = useState(1);

  async function load() {
    setLoading(true);
    setNotFitted(false);
    try {
      const res = await fetch(`${API}/api/admin/rider-valuation-preview-v4`, { headers: await getAuth() });
      const json = await readAdminJson(res);
      if (res.ok) {
        setData(json);
      } else if (res.status === 503) {
        // v4-model ikke fittet endnu (riderValuationModelV4.json findes ikke) —
        // forventet tilstand indtil fit-scriptet er kørt. Pænt degraderet, ikke en fejl.
        setNotFitted(true);
        setData(null);
      } else {
        onMsg?.(adminErrorMessage(json, res), "error");
      }
    } catch (e) {
      onMsg?.(`Forbindelsen fejlede: ${e.message || "ukendt"}`, "error");
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
      return ((av ?? -Infinity) - (bv ?? -Infinity)) * mul;
    });
    return r;
  }, [data, search, sort]);

  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
    setPage(1);
  }

  if (loading && !data && !notFitted) return <p className="text-cz-3 text-xs">Henter forhåndsvisning…</p>;

  if (notFitted) {
    return (
      <div className="bg-cz-subtle border border-cz-border rounded-lg px-4 py-3 text-xs">
        <p className="text-cz-2">
          v4-modellen er ikke fittet endnu — kør fit-scriptet (<code className="font-mono text-cz-3">backend/scripts/fitRiderValuationV4.js</code>)
          for at generere <code className="font-mono text-cz-3">backend/lib/riderValuationModelV4.json</code>.
        </p>
        <p className="text-cz-3 mt-1">V4 model not fitted yet — run the fit script to generate the model file.</p>
        <button onClick={load} className="mt-2 px-3 py-1.5 bg-cz-bg text-cz-2 border border-cz-border rounded-lg text-xs hover:text-cz-1">
          ↻ Prøv igen
        </button>
      </div>
    );
  }

  if (!data) return (
    <button onClick={load} className="px-3 py-1.5 bg-cz-subtle text-cz-2 border border-cz-border rounded-lg text-xs hover:text-cz-1">
      Indlæs forhåndsvisning
    </button>
  );

  const v3m = data.v3_model || {};
  const v4m = data.v4_model || {};
  const d = data.distribution || {};
  const typeEconomy = data.type_economy || [];

  return (
    <div className="space-y-4">
      {/* Model-metadata v3 vs v4 + ærlig caveat */}
      <div className="bg-cz-subtle border border-cz-border rounded-lg px-4 py-3 text-xs">
        <p className="text-cz-2 font-semibold mb-2">Model v3 vs v4 (karriere-NPV, sim-produktion · #2428 SHADOW — styrer endnu intet)</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-cz-3 mb-1">v3 (live)</p>
            <div className="grid grid-cols-2 gap-2 text-center">
              <Stat label="Fittet" value={v3m.fitted_at ? v3m.fitted_at.slice(0, 10) : "—"} />
              <Stat label="Konveksitet" value={v3m.convexity_exponent ?? "—"} />
            </div>
          </div>
          <div>
            <p className="text-cz-3 mb-1">v4 (shadow)</p>
            <div className="grid grid-cols-2 gap-2 text-center">
              <Stat label="Fittet" value={v4m.fitted_at ? String(v4m.fitted_at).slice(0, 10) : "—"} />
              <Stat label="R² (log)" value={v4m.fit?.r2_log ?? "—"} />
              <Stat label="Discount" value={v4m.discount ?? "—"} />
              <Stat label="Sim K" value={v4m.K ?? "—"} />
              <Stat label="Scale" value={v4m.scale ?? "—"} />
              <Stat label="N samples" value={v4m.fit?.n_samples ?? "—"} />
            </div>
          </div>
        </div>
        <p className="text-cz-3 mt-2">
          v4 = forventet karriere-NPV (nutidsværdi af fremtidig præmieindtjening, survival-vægtet, discount {v4m.discount ?? "?"}).
          Values here do not affect buy/sell/salary yet.
        </p>
      </div>

      {/* Type-økonomi */}
      <div className="bg-cz-subtle border border-cz-border rounded-lg px-4 py-3 text-xs">
        <p className="text-cz-2 font-semibold mb-2">Type-økonomi — v3-offset vs v4-fordeling pr. speciale</p>
        <div className="overflow-x-auto">
          <table data-sort-exempt="Fast type-oekonomi-tabel" className="w-full">
            <thead>
              <tr className="text-cz-3 border-b border-cz-border">
                <th className="text-left py-1">Type</th>
                <th className="text-right py-1 px-2">n</th>
                <th className="text-right py-1 px-2">v3-offset</th>
                <th className="text-right py-1 px-2">v4 median</th>
                <th className="text-right py-1 px-2">v4 p90</th>
                <th className="text-right py-1 px-2">Sim median</th>
                <th className="text-right py-1 ps-2">Sim p90</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {typeEconomy.map((t) => (
                <tr key={t.type} className="border-b border-cz-border/50 last:border-0">
                  <td className="py-1 text-cz-1 font-sans">{TYPE_LABELS[t.type] || t.type}</td>
                  <td className="py-1 px-2 text-right text-cz-3">{t.n}</td>
                  <td className="py-1 px-2 text-right text-cz-3">{t.v3_offset != null ? t.v3_offset.toFixed(3) : "—"}</td>
                  <td className="py-1 px-2 text-right text-cz-1">{fmt(t.v4_median_value)}</td>
                  <td className="py-1 px-2 text-right text-cz-1">{fmt(t.v4_p90_value)}</td>
                  <td className="py-1 px-2 text-right text-cz-3">{fmt(t.sim_median_prize)}</td>
                  <td className="py-1 ps-2 text-right text-cz-3">{fmt(t.sim_p90_prize)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Fordeling v3 vs v4 */}
      <div className="bg-cz-subtle border border-cz-border rounded-lg px-4 py-3 text-xs">
        <p className="text-cz-2 font-semibold mb-2">Fordeling — {(d.count ?? 0).toLocaleString("da-DK")} ryttere (CZ$)</p>
        <table data-sort-exempt="Fast fordelings-tabel, 2 raekker" className="w-full">
          <thead>
            <tr className="text-cz-3 border-b border-cz-border">
              <th className="text-left py-1"></th><th className="text-right py-1 px-2">p10</th>
              <th className="text-right py-1 px-2">median</th><th className="text-right py-1 px-2">p90</th>
              <th className="text-right py-1 ps-2">max</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            <tr className="border-b border-cz-border/50">
              <td className="py-1 text-cz-3 font-sans">v3 (live)</td>
              <td className="py-1 px-2 text-right text-cz-3">{fmt(d.v3?.p10)}</td>
              <td className="py-1 px-2 text-right text-cz-3">{fmt(d.v3?.median)}</td>
              <td className="py-1 px-2 text-right text-cz-3">{fmt(d.v3?.p90)}</td>
              <td className="py-1 ps-2 text-right text-cz-3">{fmt(d.v3?.max)}</td>
            </tr>
            <tr>
              <td className="py-1 text-cz-1 font-sans font-semibold">v4 (shadow)</td>
              <td className="py-1 px-2 text-right text-cz-1">{fmt(d.v4?.p10)}</td>
              <td className="py-1 px-2 text-right text-cz-1">{fmt(d.v4?.median)}</td>
              <td className="py-1 px-2 text-right text-cz-1">{fmt(d.v4?.p90)}</td>
              <td className="py-1 ps-2 text-right text-cz-1">{fmt(d.v4?.max)}</td>
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
          <table data-sortable className="w-full text-xs">
            <thead>
              <tr className="border-b border-cz-border text-cz-3">
                <Th label="Rytter" k="name" sort={sort} onSort={toggleSort} align="left" />
                <Th label="Type" k="type" sort={sort} onSort={toggleSort} align="left" />
                <Th label="Overall" k="overall" sort={sort} onSort={toggleSort} />
                <Th label="Alder" k="age" sort={sort} onSort={toggleSort} />
                <Th label="v3" k="v3_value" sort={sort} onSort={toggleSort} />
                <Th label="v4" k="v4_value" sort={sort} onSort={toggleSort} />
                <Th label="Δ" k="delta" sort={sort} onSort={toggleSort} />
                <Th label="%" k="pct" sort={sort} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.id} className="border-b border-cz-border/50 last:border-0 hover:bg-cz-bg">
                  <td className="px-3 py-1.5 text-cz-1">{r.name}</td>
                  <td className="px-3 py-1.5 text-cz-2">{TYPE_LABELS[r.type] || r.type || "—"}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-cz-2">{r.overall}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-cz-2">{r.age ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-cz-3">{fmt(r.v3_value)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-cz-1 font-semibold">{fmt(r.v4_value)}</td>
                  <td className={`px-3 py-1.5 text-right font-mono ${(r.delta ?? 0) >= 0 ? "text-cz-accent-t" : "text-cz-danger"}`}>{r.delta == null ? "—" : `${r.delta >= 0 ? "+" : ""}${fmt(r.delta)}`}</td>
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
