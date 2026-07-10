import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const API = import.meta.env.VITE_API_URL;

// Master-anker-kort (modul-niveau så det ikke gen-skabes pr. render).
function MasterCard({ t, titleKey, rts, anchorOf, setAnchor, anchorEdits }) {
  if (!rts.length) return null;
  return (
    <div className="rounded-lg border border-cz-border p-3">
      <p className="text-cz-2 text-xs font-medium mb-2">{t(titleKey)}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {rts.map((rt) => {
          const dirty = anchorEdits[rt.key] !== undefined;
          return (
            <label key={rt.key} className="flex flex-col gap-1">
              <span className="text-cz-3 text-[10px] leading-tight">
                {t(`racePoints.resultTypes.${rt.key}`, { defaultValue: rt.label })}
              </span>
              <input
                type="number"
                min={0}
                value={anchorOf(rt.key)}
                onChange={(e) => setAnchor(rt.key, e.target.value)}
                className={`w-full bg-cz-card border rounded px-2 py-1 text-xs font-mono text-cz-1 focus:outline-none
                  ${dirty ? "border-cz-warn/60 text-cz-warn" : "border-cz-border focus:border-cz-accent/60"}`}
                aria-label={`${t("racePoints.model.anchorLabel")} ${rt.label}`}
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}

// #894 (epic #893) — sammenkædet/relativ point-model: master-ankre + kaskade-faktorer + generate.
// Design: docs/slices/prize-money-audit-r2-design.md
//
// Backend contract:
//   GET  /api/admin/race-point-model                              → { masters[], cascades[], templates[], race_classes[], result_types[] }
//   PUT  /api/admin/race-point-model/master/:result_type          → { row }  (body { anchor })
//   PUT  /api/admin/race-point-model/factor/:class/:result_type   → { row }  (body { factor })
//   POST /api/admin/race-point-model/generate                     → { changed }
export default function RacePointModelSection({ getAuth, onMsg }) {
  const { t } = useTranslation("admin");

  const [masters, setMasters] = useState([]);
  const [cascades, setCascades] = useState([]);
  const [raceClasses, setRaceClasses] = useState([]);
  const [resultTypes, setResultTypes] = useState([]);
  const [anchorEdits, setAnchorEdits] = useState({}); // { result_type: number }
  const [factorEdits, setFactorEdits] = useState({}); // { "class|rt": number }
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // ── Load ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const headers = await getAuth();
        const res = await fetch(`${API}/api/admin/race-point-model`, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "load failed");
        if (cancelled) return;
        setMasters(data.masters || []);
        setCascades(data.cascades || []);
        setRaceClasses(data.race_classes || []);
        setResultTypes(data.result_types || []);
      } catch (e) {
        onMsg(t("racePoints.model.loadError", { error: e.message }), "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Lookups ──────────────────────────────────────────────────────────────
  const masterByRt = useMemo(() => {
    const m = new Map();
    for (const r of masters) m.set(r.result_type, r);
    return m;
  }, [masters]);

  const cascadeByKey = useMemo(() => {
    const m = new Map();
    for (const c of cascades) m.set(`${c.race_class}|${c.result_type}`, c);
    return m;
  }, [cascades]);

  function anchorOf(rt) {
    if (anchorEdits[rt] !== undefined) return anchorEdits[rt];
    return Number(masterByRt.get(rt)?.anchor ?? 0);
  }
  function factorOf(raceClass, rt) {
    const key = `${raceClass}|${rt}`;
    if (factorEdits[key] !== undefined) return factorEdits[key];
    return Number(cascadeByKey.get(key)?.factor ?? 0);
  }
  function isMasterCell(raceClass, rt) {
    return masterByRt.get(rt)?.master_class === raceClass;
  }
  // Resulterende 1.-plads (live preview): round(factor × anchor)
  function previewRank1(raceClass, rt) {
    return Math.floor(factorOf(raceClass, rt) * anchorOf(rt) + 0.5);
  }

  // result_types der faktisk findes i modellen, i kanonisk rækkefølge
  const usedResultTypes = useMemo(
    () => resultTypes.filter((rt) => masterByRt.has(rt.key)),
    [resultTypes, masterByRt],
  );

  const masterGroups = useMemo(() => {
    const stage = [], oneDay = [];
    for (const rt of usedResultTypes) {
      const mc = masterByRt.get(rt.key)?.master_class;
      (mc === "Monuments" ? oneDay : stage).push(rt);
    }
    return { stage, oneDay };
  }, [usedResultTypes, masterByRt]);

  // ── Edits ────────────────────────────────────────────────────────────────
  function setAnchor(rt, value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      onMsg(t("racePoints.model.invalidValue"), "error");
      return;
    }
    setAnchorEdits((prev) => {
      const next = { ...prev };
      const original = Number(masterByRt.get(rt)?.anchor ?? 0);
      if (original === parsed) delete next[rt];
      else next[rt] = parsed;
      return next;
    });
  }

  function setFactorPct(raceClass, rt, pctValue) {
    const pct = Number(pctValue);
    if (!Number.isFinite(pct) || pct < 0) {
      onMsg(t("racePoints.model.invalidValue"), "error");
      return;
    }
    const key = `${raceClass}|${rt}`;
    const parsed = pct / 100;
    setFactorEdits((prev) => {
      const next = { ...prev };
      const original = Number(cascadeByKey.get(key)?.factor ?? 0);
      if (Math.abs(original - parsed) < 1e-12) delete next[key];
      else next[key] = parsed;
      return next;
    });
  }

  function discardAll() {
    setAnchorEdits({});
    setFactorEdits({});
  }

  const dirtyCount = Object.keys(anchorEdits).length + Object.keys(factorEdits).length;

  // ── Save & generate ────────────────────────────────────────────────────────
  async function saveAndGenerate() {
    if (!window.confirm(t("racePoints.model.generateConfirm"))) return;
    setSaving(true);
    try {
      const headers = await getAuth();

      for (const [rt, anchor] of Object.entries(anchorEdits)) {
        const res = await fetch(`${API}/api/admin/race-point-model/master/${encodeURIComponent(rt)}`, {
          method: "PUT", headers, body: JSON.stringify({ anchor }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "master PUT failed");
      }
      for (const [key, factor] of Object.entries(factorEdits)) {
        const [raceClass, rt] = key.split("|");
        const res = await fetch(
          `${API}/api/admin/race-point-model/factor/${encodeURIComponent(raceClass)}/${encodeURIComponent(rt)}`,
          { method: "PUT", headers, body: JSON.stringify({ factor }) },
        );
        if (!res.ok) throw new Error((await res.json()).error || "factor PUT failed");
      }

      const genRes = await fetch(`${API}/api/admin/race-point-model/generate`, { method: "POST", headers });
      const genData = await genRes.json();
      if (!genRes.ok) throw new Error(genData.error || "generate failed");

      // Commit edits into local model state + clear dirty.
      setMasters((prev) => prev.map((m) =>
        anchorEdits[m.result_type] !== undefined ? { ...m, anchor: anchorEdits[m.result_type] } : m));
      setCascades((prev) => prev.map((c) => {
        const key = `${c.race_class}|${c.result_type}`;
        return factorEdits[key] !== undefined ? { ...c, factor: factorEdits[key] } : c;
      }));
      setAnchorEdits({});
      setFactorEdits({});

      const changed = genData.changed || 0;
      onMsg(changed > 0
        ? t("racePoints.model.generated", { count: changed })
        : t("racePoints.model.noChanges"));
    } catch (e) {
      onMsg(t("racePoints.model.generateError", { error: e.message }), "error");
    } finally {
      setSaving(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  if (loading) return <p className="text-cz-3 text-xs">…</p>;

  const fmtPct = (factor) => {
    const pct = factor * 100;
    return Math.abs(pct - Math.round(pct)) < 0.05 ? String(Math.round(pct)) : pct.toFixed(1);
  };

  return (
    <div>
      <p className="text-cz-3 text-xs mb-4 leading-relaxed">{t("racePoints.model.intro")}</p>

      {/* Master-ankre */}
      <p className="text-cz-3 text-xs uppercase tracking-wide mb-2">{t("racePoints.model.mastersTitle")}</p>
      <div className="grid md:grid-cols-2 gap-3 mb-6">
        <MasterCard t={t} titleKey="racePoints.model.masterStage" rts={masterGroups.stage}
          anchorOf={anchorOf} setAnchor={setAnchor} anchorEdits={anchorEdits} />
        <MasterCard t={t} titleKey="racePoints.model.masterOneDay" rts={masterGroups.oneDay}
          anchorOf={anchorOf} setAnchor={setAnchor} anchorEdits={anchorEdits} />
      </div>

      {/* Kaskade-grid */}
      <p className="text-cz-3 text-xs uppercase tracking-wide mb-2">{t("racePoints.model.cascadeTitle")}</p>
      <div className="overflow-x-auto rounded-lg border border-cz-border">
        <table data-sort-exempt="Pivot-grid: race-klasser x result-typer, ikke en liste" className="w-full text-xs">
          <thead>
            <tr className="border-b border-cz-border">
              <th className="px-3 py-2 text-left text-cz-3 font-medium min-w-[140px] sticky left-0 bg-cz-bg">
                {t("racePoints.raceClassTab")}
              </th>
              {usedResultTypes.map((rt) => (
                <th key={rt.key} className="px-2 py-2 text-center text-cz-3 font-medium min-w-[72px]">
                  {t(`racePoints.resultTypes.${rt.key}`, { defaultValue: rt.label })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {raceClasses.map((c) => (
              <tr key={c.key} className="border-b border-cz-border last:border-0">
                <td className="px-3 py-2 text-cz-2 font-medium whitespace-nowrap sticky left-0 bg-cz-bg">
                  {t(`racePoints.raceClasses.${c.key}`, { defaultValue: c.label })}
                </td>
                {usedResultTypes.map((rt) => {
                  const key = `${c.key}|${rt.key}`;
                  const hasCascade = cascadeByKey.has(key);
                  if (!hasCascade) {
                    return <td key={rt.key} className="px-2 py-2 text-center text-cz-3">·</td>;
                  }
                  if (isMasterCell(c.key, rt.key)) {
                    return (
                      <td key={rt.key} className="px-2 py-2 text-center">
                        <span className="text-cz-3 text-[10px] uppercase tracking-wide" title={t("racePoints.model.masterBadge")}>
                          ★ {previewRank1(c.key, rt.key)}
                        </span>
                      </td>
                    );
                  }
                  const dirty = factorEdits[key] !== undefined;
                  return (
                    <td key={rt.key} className="px-2 py-1 text-center">
                      <div className="flex flex-col items-center gap-0.5">
                        <div className="flex items-center gap-0.5">
                          <input
                            type="number"
                            min={0}
                            step="0.1"
                            value={fmtPct(factorOf(c.key, rt.key))}
                            onChange={(e) => setFactorPct(c.key, rt.key, e.target.value)}
                            className={`w-14 bg-cz-card border rounded px-1 py-0.5 text-[11px] font-mono text-center focus:outline-none
                              ${dirty ? "border-cz-warn/60 text-cz-warn" : "border-cz-border text-cz-1 focus:border-cz-accent/60"}`}
                            aria-label={`${c.label} ${rt.label} %`}
                          />
                          <span className="text-cz-3 text-[10px]">%</span>
                        </div>
                        <span className="text-cz-3 text-[10px] font-mono" title={t("racePoints.model.previewHint")}>
                          → {previewRank1(c.key, rt.key)}
                        </span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Sticky action bar */}
      <div className="mt-4 sticky bottom-2 z-10 flex items-center justify-end gap-3 bg-cz-card border border-cz-accent/40 rounded-lg px-4 py-2 shadow-lg">
        {dirtyCount > 0 && (
          <>
            <span className="text-cz-warn text-xs me-auto">{t("racePoints.model.dirty", { count: dirtyCount })}</span>
            <button
              type="button"
              onClick={discardAll}
              disabled={saving}
              className="px-3 py-1.5 rounded-md text-xs border border-cz-border text-cz-2 hover:text-cz-1 disabled:opacity-50"
            >
              {t("racePoints.model.discard")}
            </button>
          </>
        )}
        <button
          type="button"
          onClick={saveAndGenerate}
          disabled={saving}
          className="px-3 py-1.5 rounded-md text-xs bg-cz-accent text-cz-bg font-medium disabled:opacity-50"
        >
          {saving ? t("racePoints.model.generating") : t("racePoints.model.save")}
        </button>
      </div>
    </div>
  );
}
