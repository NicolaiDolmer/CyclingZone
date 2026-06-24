// Race Hub Fase 1 — orkestrator for trup-fordeling-board'et. Henter aggregat-
// endpointet GET /api/races/distribution, ejer URL-params (day/scope), og gemmer
// via det eksisterende PUT /selection pr. løb (guards bevares). Afmeld via
// withdrawal-endpoint; "auto-udfyld igen" via regenerate-endpoint.
import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getSession } from "../../lib/supabase";
import ContextBand from "./ContextBand.jsx";
import RaceColumn from "./RaceColumn.jsx";
import AvailableRidersPool from "./AvailableRidersPool.jsx";
import { Spinner, EmptyState, FlagIcon } from "../ui";

const API = import.meta.env.VITE_API_URL;

async function authHeaders() {
  const { data } = await getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : null;
}

export default function RaceHubBoard() {
  const { t } = useTranslation("races");
  const [params, setParams] = useSearchParams();
  const scope = params.get("scope") || "mine";
  const dayParam = Number.parseInt(params.get("day"), 10);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (day) => {
    const headers = await authHeaders();
    if (!headers) { setLoading(false); return; }
    // Path som egen literal (query konkateneres separat) — holder /api/races/distribution
    // matchbar for feature-liveness-auditens frontend-scan (ellers læses qs som path-segment).
    const url = `${API}/api/races/distribution`;
    try {
      const res = await fetch(Number.isFinite(day) ? `${url}?day=${day}` : url, { headers });
      if (res.ok) setData(await res.json());
    } catch {
      /* netværk — board forbliver i forrige tilstand */
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(Number.isFinite(dayParam) ? dayParam : undefined); }, [load, dayParam]);

  if (loading) return <div className="flex justify-center py-10"><Spinner size={20} /></div>;
  if (!data?.enabled) return null; // flag OFF → board skjult (kalender-faner viser stadig)

  const day = Number.isFinite(dayParam) ? dayParam : (data.focusDay ?? data.currentDay);
  const columns = data.columns || [];
  const roster = columns[0]?.riders || [];

  const setDay = (d) => { params.set("day", String(d)); setParams(params, { replace: true }); };
  const setScope = (s) => { params.set("scope", s); setParams(params, { replace: true }); };

  async function putSelection(column, riderIds) {
    const headers = await authHeaders();
    if (!headers) return;
    const sel = column.selection || {};
    const body = {
      rider_ids: riderIds,
      captain_id: riderIds.includes(sel.captain_id) ? sel.captain_id : riderIds[0] ?? null,
      sprint_captain_id: riderIds.includes(sel.sprint_captain_id) ? sel.sprint_captain_id : null,
      hunter_id: riderIds.includes(sel.hunter_id) ? sel.hunter_id : null,
    };
    setBusy(true);
    try {
      await fetch(`${API}/api/races/${column.id}/selection`, { method: "PUT", headers, body: JSON.stringify(body) });
      await load(day);
    } finally {
      setBusy(false);
    }
  }

  const addRider = (raceId, riderId) => {
    const col = columns.find((c) => c.id === raceId);
    if (!col) return;
    putSelection(col, [...(col.selection?.rider_ids || []), riderId]);
  };
  const removeRider = (raceId, riderId) => {
    const col = columns.find((c) => c.id === raceId);
    if (!col) return;
    putSelection(col, (col.selection?.rider_ids || []).filter((id) => id !== riderId));
  };

  async function toggleWithdraw(raceId, withdraw) {
    const headers = await authHeaders();
    if (!headers) return;
    setBusy(true);
    try {
      await fetch(`${API}/api/races/${raceId}/withdrawal`, { method: withdraw ? "POST" : "DELETE", headers });
      await load(day);
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    const hasManual = columns.some((c) => c.selection && c.selection.is_auto_filled === false);
    if (hasManual && !window.confirm(t("racehub.regenerateWarn"))) return;
    const headers = await authHeaders();
    if (!headers) return;
    setBusy(true);
    try {
      await fetch(`${API}/api/races/distribution/regenerate?day=${day}`, { method: "POST", headers });
      await load(day);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="race-hub-board">
      <ContextBand scope={scope} day={day} currentDay={data.currentDay} timeline={data.timeline} onScopeChange={setScope} onDayChange={setDay} />
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-base font-bold text-cz-1">{t("racehub.heading")}</h2>
        <span className="text-xs text-cz-3">{t("racehub.overlap", { count: columns.length })}</span>
      </div>
      {columns.length === 0 ? (
        <EmptyState icon={<FlagIcon size={24} />} title={t("racehub.empty")} />
      ) : (
        <>
          <div className="grid sm:grid-cols-2 gap-3 mb-4">
            {columns.map((c) => (
              <RaceColumn key={c.id} column={c} busy={busy} onRemoveRider={removeRider} onToggleWithdraw={toggleWithdraw} />
            ))}
          </div>
          <AvailableRidersPool roster={roster} columns={columns} bindingMap={data.bindingMap || {}}
            onAddRiderToRace={addRider} onRegenerate={regenerate} busy={busy} />
        </>
      )}
    </div>
  );
}
