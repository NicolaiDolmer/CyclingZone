// Race Hub S3 — Holdstrategi (Lag 0). Stående præferencer der fodrer den proaktive
// generator: rangordnet A-kæde, faste rolle-regler, kaptajn 1/2/3 pr. terræn, mål-løb.
// Gem skriver IKKE entries — den tilbyder live preview-diff + eksplicit "Regenerér".
// Auth/fetch-mønster spejler RaceHubBoard.jsx.
import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getSession } from "../lib/supabase";
import { Spinner, EmptyState, Button } from "../components/ui";
import AChainEditor from "../components/racehub/strategy/AChainEditor.jsx";
import RoleRulesEditor from "../components/racehub/strategy/RoleRulesEditor.jsx";
import CaptainBoard from "../components/racehub/strategy/CaptainBoard.jsx";
import TargetRacePicker from "../components/racehub/strategy/TargetRacePicker.jsx";
import PreviewDiff from "../components/racehub/strategy/PreviewDiff.jsx";

const API = import.meta.env.VITE_API_URL;

async function authHeaders() {
  const { data } = await getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : null;
}

export default function StrategyPage() {
  const { t } = useTranslation("races");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(null); // { aChain, captainPriorities, roleRules, targetRaceIds }
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  // #2465: preview/save/regenerate used to swallow every error silently (bare
  // catch, only set state on res.ok) — a failed save just stopped the spinner
  // with no explanation. Same shape/pattern as RaceHubBoard.jsx's mutate() error surface.
  const [error, setError] = useState(null); // { code } | null

  const load = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) { setLoading(false); return; }
    try {
      const res = await fetch(`${API}/api/races/strategy`, { headers });
      if (res.ok) {
        const j = await res.json();
        setData(j);
        if (j.enabled) setDraft({
          aChain: j.a_chain || [], captainPriorities: j.captain_priorities || {},
          roleRules: j.role_rules || {}, targetRaceIds: j.target_race_ids || [],
        });
      }
    } catch { /* netværk — siden forbliver i forrige tilstand */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex justify-center py-10"><Spinner size={20} /></div>;
  if (!data?.enabled) return null;
  if (!data.roster?.length) return <div className="max-w-4xl mx-auto px-3 py-6"><EmptyState title={t("strategy.aChain.empty")} /></div>;

  const dirty = () => { setSaved(false); };
  const payload = () => ({
    a_chain: draft.aChain, captain_priorities: draft.captainPriorities,
    role_rules: draft.roleRules, target_race_ids: draft.targetRaceIds,
  });
  const raceNames = Object.fromEntries((data.upcoming || []).map((r) => [r.id, r.name]));

  const runPreview = async () => {
    const headers = await authHeaders(); if (!headers) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`${API}/api/races/strategy/preview`, { method: "POST", headers, body: JSON.stringify(payload()) });
      if (res.ok) {
        setPreview((await res.json()).diff || {});
      } else {
        const body = await res.json().catch(() => ({}));
        setError({ code: body.error || "generic" });
      }
    } catch { setError({ code: "generic" }); } finally { setBusy(false); }
  };
  const save = async () => {
    const headers = await authHeaders(); if (!headers) return;
    setBusy(true); setSaved(false); setError(null);
    try {
      const res = await fetch(`${API}/api/races/strategy`, { method: "PUT", headers, body: JSON.stringify(payload()) });
      if (res.ok) {
        setSaved(true);
      } else {
        const body = await res.json().catch(() => ({}));
        setError({ code: body.error || "generic" });
      }
    } catch { setError({ code: "generic" }); } finally { setBusy(false); }
  };
  const regenerate = async () => {
    const headers = await authHeaders(); if (!headers) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`${API}/api/races/distribution/regenerate?mode=missing`, { method: "POST", headers });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError({ code: body.error || "generic" });
      }
    } catch { setError({ code: "generic" }); } finally { setBusy(false); }
  };

  const update = (patch) => { setDraft({ ...draft, ...patch }); dirty(); };

  return (
    <div className="max-w-4xl mx-auto px-3 py-4" data-testid="strategy-page">
      <div className="flex items-center justify-between mb-1">
        <h1 className="font-display text-2xl text-cz-1">{t("strategy.title")}</h1>
        <Link to="/races" className="text-xs text-cz-accent-t hover:underline">{t("strategy.back")}</Link>
      </div>
      <p className="text-sm text-cz-3 mb-5">{t("strategy.subtitle")}</p>

      {error && (
        <div role="alert" className="mb-3 flex items-start justify-between gap-3 rounded-cz border border-cz-danger/30 bg-cz-danger/10 px-3 py-2">
          <span className="text-xs text-cz-danger">{t([`selection.errors.${error.code}`, "selection.errors.generic"])}</span>
          <button type="button" onClick={() => setError(null)} aria-label={t("racehub.dismiss")} className="text-cz-danger/70 hover:text-cz-danger text-sm leading-none">×</button>
        </div>
      )}

      <AChainEditor roster={data.roster} value={draft.aChain} onChange={(aChain) => update({ aChain })} />
      <RoleRulesEditor roster={data.roster} value={draft.roleRules} onChange={(roleRules) => update({ roleRules })} />
      <CaptainBoard roster={data.roster} value={draft.captainPriorities} onChange={(captainPriorities) => update({ captainPriorities })} />
      <TargetRacePicker upcoming={data.upcoming || []} value={draft.targetRaceIds} onChange={(targetRaceIds) => update({ targetRaceIds })} />

      <div className="flex flex-wrap items-center gap-2 mt-6 border-t border-cz-border pt-4">
        <Button variant="secondary" size="sm" onClick={runPreview} loading={busy}>{t("strategy.preview.run")}</Button>
        <Button variant="primary" size="sm" onClick={save} loading={busy}>{t("strategy.save")}</Button>
        <Button variant="secondary" size="sm" onClick={regenerate} loading={busy}>{t("strategy.regenerate")}</Button>
        {saved && <span className="text-xs text-cz-success">{t("strategy.saved")}</span>}
      </div>

      {preview && <PreviewDiff diff={preview} roster={data.roster} raceNames={raceNames} />}
    </div>
  );
}
