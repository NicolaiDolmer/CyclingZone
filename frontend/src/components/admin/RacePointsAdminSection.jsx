import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import RacePointModelSection from "./RacePointModelSection";

const API = import.meta.env.VITE_API_URL;

// #505 — Admin editor for race_points (UCI ranking points per race_class × result_type × rank).
// Replaces the legacy inline editor in AdminPage that bypassed audit-log + missing #503 Dag-result_types.
//
// Backend contract:
//   GET    /api/admin/race-points          → { rows[], race_classes[], result_types[] }
//   GET    /api/admin/race-points/baseline → { rows[] }
//   PUT    /api/admin/race-points/:id      → { row } (+ admin_log: RACE_POINTS_EDITED)
export default function RacePointsAdminSection({ getAuth, onMsg }) {
  const { t } = useTranslation("admin");

  const [mode, setMode] = useState("model"); // "model" (kaskade) | "manual" (per-celle)
  const [rows, setRows] = useState([]);
  const [baseline, setBaseline] = useState([]);
  const [raceClasses, setRaceClasses] = useState([]);
  const [resultTypes, setResultTypes] = useState([]);
  const [selectedClass, setSelectedClass] = useState("");
  const [edits, setEdits] = useState({}); // { [id]: newPointsInt }
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // ── Initial load ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== "manual") return; // manuel data hentes først når fanen åbnes
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const headers = await getAuth();
        const [rowsRes, baselineRes] = await Promise.all([
          fetch(`${API}/api/admin/race-points`, { headers }),
          fetch(`${API}/api/admin/race-points/baseline`, { headers }),
        ]);
        const rowsData = await rowsRes.json();
        const baselineData = await baselineRes.json();
        if (!rowsRes.ok) throw new Error(rowsData.error || "load failed");
        if (!baselineRes.ok) throw new Error(baselineData.error || "baseline failed");
        if (cancelled) return;
        setRows(rowsData.rows || []);
        setBaseline(baselineData.rows || []);
        setRaceClasses(rowsData.race_classes || []);
        setResultTypes(rowsData.result_types || []);
        if (rowsData.race_classes?.length) setSelectedClass(rowsData.race_classes[0].key);
      } catch (e) {
        onMsg(t("racePoints.loadError", { error: e.message }), "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ── Lookups ──────────────────────────────────────────────────────────────
  const rowByKey = useMemo(() => {
    const map = new Map();
    for (const r of rows) map.set(`${r.race_class}|${r.result_type}|${r.rank}`, r);
    return map;
  }, [rows]);

  const baselineByKey = useMemo(() => {
    const map = new Map();
    for (const r of baseline) map.set(`${r.race_class}|${r.result_type}|${r.rank}`, r.points);
    return map;
  }, [baseline]);

  const classGroups = useMemo(() => {
    const grouped = new Map();
    for (const c of raceClasses) {
      if (!grouped.has(c.type)) grouped.set(c.type, []);
      grouped.get(c.type).push(c);
    }
    return Array.from(grouped.entries());
  }, [raceClasses]);

  const maxRankAcrossSelected = useMemo(() => {
    if (!selectedClass) return 0;
    let max = 0;
    for (const rt of resultTypes) {
      const existing = rows.some((r) => r.race_class === selectedClass && r.result_type === rt.key);
      if (existing) max = Math.max(max, rt.maxRank);
    }
    return max;
  }, [selectedClass, rows, resultTypes]);

  // ── Edit ops ─────────────────────────────────────────────────────────────
  function currentValue(row) {
    if (edits[row.id] !== undefined) return edits[row.id];
    return row.points;
  }

  function setEdit(rowId, value) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      onMsg(t("racePoints.invalidValue"), "error");
      return false;
    }
    setEdits((prev) => {
      const next = { ...prev };
      // If equal to original → drop from edits (no diff)
      const row = rows.find((r) => r.id === rowId);
      if (row && row.points === parsed) {
        delete next[rowId];
      } else {
        next[rowId] = parsed;
      }
      return next;
    });
    return true;
  }

  function discardAll() {
    setEdits({});
    setEditingId(null);
  }

  async function saveAll() {
    const dirty = Object.entries(edits);
    if (!dirty.length) return;
    setSaving(true);
    let okCount = 0;
    let lastErr = null;
    try {
      const headers = await getAuth();
      for (const [id, points] of dirty) {
        try {
          const res = await fetch(`${API}/api/admin/race-points/${id}`, {
            method: "PUT",
            headers,
            body: JSON.stringify({ points }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) { lastErr = data.error || `HTTP ${res.status}`; continue; }
          // Update local row
          setRows((prev) => prev.map((r) => (r.id === id ? data.row : r)));
          okCount++;
        } catch (e) {
          lastErr = e.message;
        }
      }
      setEdits({});
      setEditingId(null);
    } catch (e) {
      lastErr = e.message || "ukendt";
    } finally {
      setSaving(false);
    }
    if (lastErr && okCount === 0) {
      onMsg(t("racePoints.saveError", { error: lastErr }), "error");
    } else if (lastErr) {
      onMsg(`${t("racePoints.saved", { count: okCount })} · ${t("racePoints.saveError", { error: lastErr })}`, "error");
    } else {
      onMsg(t("racePoints.saved", { count: okCount }));
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  const dirtyCount = Object.keys(edits).length;

  return (
    <div>
      {/* Mode-toggle: model (kaskade) vs manuel (per-celle) */}
      <div className="mb-4 flex gap-1">
        {[
          { key: "model", label: t("racePoints.model.tabModel") },
          { key: "manual", label: t("racePoints.model.tabManual") },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setMode(tab.key)}
            className={`px-3 py-1 rounded-md text-xs border transition-colors
              ${mode === tab.key
                ? "bg-cz-accent text-cz-bg border-cz-accent"
                : "bg-cz-card text-cz-2 border-cz-border hover:border-cz-accent/50"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {mode === "model" ? (
        <RacePointModelSection getAuth={getAuth} onMsg={onMsg} />
      ) : (
      <>
      <p className="text-cz-3 text-xs mb-2 leading-relaxed">{t("racePoints.intro")}</p>
      <p className="text-cz-warn text-xs mb-4 leading-relaxed">{t("racePoints.appliesToFutureHint")}</p>

      {loading ? (
        <p className="text-cz-3 text-xs">…</p>
      ) : (
        <>
          {/* Class tabs grouped by tier */}
          <div className="mb-4 space-y-2">
            {classGroups.map(([groupType, classesInGroup]) => (
              <div key={groupType} className="flex flex-wrap items-center gap-2">
                <span className="text-cz-3 text-xs uppercase tracking-wide min-w-[140px]">
                  {t(`racePoints.groups.${groupType}`, { defaultValue: groupType })}
                </span>
                <div className="flex flex-wrap gap-1">
                  {classesInGroup.map((c) => {
                    const active = c.key === selectedClass;
                    return (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => { setSelectedClass(c.key); setEditingId(null); }}
                        className={`px-3 py-1 rounded-md text-xs border transition-colors
                          ${active
                            ? "bg-cz-accent text-cz-bg border-cz-accent"
                            : "bg-cz-card text-cz-2 border-cz-border hover:border-cz-accent/50"}`}
                      >
                        {t(`racePoints.raceClasses.${c.key}`, { defaultValue: c.label })}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Grid */}
          {selectedClass && (
            <div className="overflow-x-auto rounded-lg border border-cz-border">
              <table data-sort-exempt="Point-matrix: result-typer x rank, ikke en liste" className="w-full text-xs">
                <thead>
                  <tr className="border-b border-cz-border">
                    <th className="px-3 py-2 text-left text-cz-3 font-medium min-w-[200px]">
                      {t("racePoints.resultTypeLabel")}
                    </th>
                    {Array.from({ length: maxRankAcrossSelected }, (_, i) => i + 1).map((r) => (
                      <th key={r} className="px-2 py-2 text-center text-cz-3 font-medium w-12">
                        {t("racePoints.rankHeader", { rank: r })}
                      </th>
                    ))}
                    <th className="px-2 py-2 text-center text-cz-3 font-medium w-32">·</th>
                  </tr>
                </thead>
                <tbody>
                  {resultTypes.map((rt) => {
                    const hasAny = rows.some(
                      (r) => r.race_class === selectedClass && r.result_type === rt.key,
                    );
                    if (!hasAny) return null;
                    const rowDirty = rows.some(
                      (r) => r.race_class === selectedClass && r.result_type === rt.key && edits[r.id] !== undefined,
                    );
                    return (
                      <tr key={rt.key} className="border-b border-cz-border last:border-0">
                        <td className="px-3 py-2 text-cz-2 font-medium whitespace-nowrap">
                          {t(`racePoints.resultTypes.${rt.key}`, { defaultValue: rt.label })}
                        </td>
                        {Array.from({ length: maxRankAcrossSelected }, (_, i) => i + 1).map((rank) => {
                          if (rank > rt.maxRank) return <td key={rank} className="px-2 py-2 text-center text-cz-3">·</td>;
                          const row = rowByKey.get(`${selectedClass}|${rt.key}|${rank}`);
                          if (!row) return <td key={rank} className="px-2 py-2 text-center text-cz-3">·</td>;
                          const pts = currentValue(row);
                          const baselinePts = baselineByKey.get(`${selectedClass}|${rt.key}|${rank}`);
                          const dirty = edits[row.id] !== undefined;
                          const isEditing = editingId === row.id;
                          return (
                            <td key={rank} className="px-2 py-2 text-center">
                              {isEditing ? (
                                <input
                                  type="number"
                                  min={0}
                                  autoFocus
                                  defaultValue={pts}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      if (setEdit(row.id, e.target.value)) setEditingId(null);
                                    }
                                    if (e.key === "Escape") setEditingId(null);
                                  }}
                                  onBlur={(e) => { if (setEdit(row.id, e.target.value)) setEditingId(null); }}
                                  className="w-14 bg-cz-card border border-cz-accent/60 rounded px-1 py-0.5 text-cz-1 text-xs font-mono text-center focus:outline-none"
                                  aria-label={`${rt.label} #${rank}`}
                                />
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setEditingId(row.id)}
                                  title={baselinePts !== undefined ? `Baseline: ${baselinePts}` : undefined}
                                  className={`w-full px-1 py-1 rounded text-xs font-mono transition-colors hover:bg-cz-subtle
                                    ${dirty ? "text-cz-warn font-semibold" : pts > 0 ? "text-cz-1" : "text-cz-3"}`}
                                >
                                  {pts}
                                </button>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-2 py-2 text-center">
                          <button
                            type="button"
                            disabled={!hasAny}
                            onClick={() => {
                              for (const r of rows) {
                                if (r.race_class === selectedClass && r.result_type === rt.key) {
                                  const baselinePts = baselineByKey.get(`${r.race_class}|${r.result_type}|${r.rank}`);
                                  if (baselinePts !== undefined && baselinePts !== r.points) {
                                    setEdits((prev) => ({ ...prev, [r.id]: baselinePts }));
                                  }
                                }
                              }
                            }}
                            className={`text-[10px] px-2 py-1 rounded border transition-colors
                              ${rowDirty ? "border-cz-warn/60 text-cz-warn" : "border-cz-border text-cz-3 hover:text-cz-2 hover:border-cz-accent/50"}`}
                          >
                            {t("racePoints.resetRow")}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Sticky save bar */}
          {dirtyCount > 0 && (
            <div className="mt-4 sticky bottom-2 z-10 flex items-center justify-end gap-2 bg-cz-card border border-cz-accent/40 rounded-lg px-4 py-2 shadow-lg">
              <button
                type="button"
                onClick={discardAll}
                disabled={saving}
                className="px-3 py-1.5 rounded-md text-xs border border-cz-border text-cz-2 hover:text-cz-1 disabled:opacity-50"
              >
                {t("racePoints.discard")}
              </button>
              <button
                type="button"
                onClick={saveAll}
                disabled={saving}
                className="px-3 py-1.5 rounded-md text-xs bg-cz-accent text-cz-bg font-medium disabled:opacity-50"
              >
                {saving ? t("racePoints.saving") : t("racePoints.save", { count: dirtyCount })}
              </button>
            </div>
          )}
        </>
      )}
      </>
      )}
    </div>
  );
}
