import { useState, useEffect, useMemo } from "react";
import { readAdminJson, adminErrorMessage } from "./shared/useAdminAuth";

const API = import.meta.env.VITE_API_URL;
const PAGE_SIZE = 50;
const ABIL_COLS = ["climbing", "time_trial", "sprint", "endurance"];
const fmt = (n) => (n == null ? "—" : Math.round(n).toLocaleString("da-DK"));

export default function RiderExplorerSection({ getAuth, onMsg }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [sort, setSort] = useState({ key: "base_value", dir: "desc" });
  const [page, setPage] = useState(1);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/admin/fictional-rider-preview`, { headers: await getAuth() });
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

  const types = useMemo(() => {
    if (!data?.riders) return [];
    return [...new Set(data.riders.map((r) => r.primary_type))].sort();
  }, [data]);

  const rows = useMemo(() => {
    if (!data?.riders) return [];
    const q = search.trim().toLowerCase();
    let r = data.riders;
    if (q) r = r.filter((x) => x.name.toLowerCase().includes(q));
    if (typeFilter) r = r.filter((x) => x.primary_type === typeFilter);
    const { key, dir } = sort;
    const mul = dir === "asc" ? 1 : -1;
    const val = (x) => (ABIL_COLS.includes(key) ? x.abilities?.[key] : x[key]);
    r = [...r].sort((a, b) => {
      const av = val(a), bv = val(b);
      if (typeof av === "string") return av.localeCompare(bv) * mul;
      return ((av ?? 0) - (bv ?? 0)) * mul;
    });
    return r;
  }, [data, search, typeFilter, sort]);

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
  const d = data.distribution;

  return (
    <div className="space-y-4">
      <div className="bg-cz-subtle border border-cz-border rounded-lg px-4 py-3 text-xs">
        <p className="text-cz-2 font-semibold mb-1">Fiktiv launch-population — {data.count.toLocaleString("da-DK")} ryttere (preview, rører intet)</p>
        <p className="text-cz-3">base_value CZ$ · p10 {fmt(d.p10)} · median {fmt(d.median)} · p90 {fmt(d.p90)} · max {fmt(d.max)}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Søg rytter…"
          className="w-full sm:w-56 bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none"
        />
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          className="bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm"
        >
          <option value="">Alle typer</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-cz-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-cz-border text-cz-3">
              <Th label="Rytter" k="name" sort={sort} onSort={toggleSort} align="left" />
              <Th label="Nat" k="nationality_code" sort={sort} onSort={toggleSort} align="left" />
              <Th label="Alder" k="age" sort={sort} onSort={toggleSort} />
              <Th label="Type" k="primary_type" sort={sort} onSort={toggleSort} align="left" />
              <Th label="2.type" k="secondary_type" sort={sort} onSort={toggleSort} align="left" />
              {ABIL_COLS.map((a) => <Th key={a} label={a} k={a} sort={sort} onSort={toggleSort} />)}
              <Th label="base_value" k="base_value" sort={sort} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr key={r.id} className="border-b border-cz-border/50 last:border-0 hover:bg-cz-bg">
                <td className="px-3 py-1.5 text-cz-1">{r.name}</td>
                <td className="px-3 py-1.5 text-cz-2">{r.nationality_code}</td>
                <td className="px-3 py-1.5 text-right font-mono text-cz-2">{r.age}</td>
                <td className="px-3 py-1.5 text-cz-2">{r.primary_type}</td>
                <td className="px-3 py-1.5 text-cz-3">{r.secondary_type}</td>
                {ABIL_COLS.map((a) => <td key={a} className="px-3 py-1.5 text-right font-mono text-cz-2">{r.abilities?.[a] ?? "—"}</td>)}
                <td className="px-3 py-1.5 text-right font-mono text-cz-1 font-semibold">{fmt(r.base_value)}</td>
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
