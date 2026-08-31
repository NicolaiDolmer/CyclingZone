// Race Hub S3 — Holdstrategi (Lag 0). Stående præferencer der fodrer den proaktive
// generator: rangordnet A-kæde, faste rolle-regler, kaptajn 1/2/3 pr. terræn, mål-løb.
// Gem skriver IKKE entries — den tilbyder live preview-diff + eksplicit "Regenerér".
// Auth/fetch-mønster spejler RaceHubBoard.jsx. #3102 etape 3: Strategi-fanen i
// Planlægnings-hubben (før egen rute /races/strategy, som redirecter til
// /planning?tab=strategy) — hubben ejer sidehovedet, så eget PageHeader +
// tilbage-link udgik.
import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { authHeaders } from "../lib/supabase"; // #4348: kanonisk kopi
import { reportLoadFailure } from "../lib/actionTelemetry.js";
import { PageLoader, SectionStack, EmptyState, ErrorState, Button } from "../components/ui";
import AChainEditor from "../components/racehub/strategy/AChainEditor.jsx";
import RoleRulesEditor from "../components/racehub/strategy/RoleRulesEditor.jsx";
import CaptainBoard from "../components/racehub/strategy/CaptainBoard.jsx";
import TargetRacePicker from "../components/racehub/strategy/TargetRacePicker.jsx";
import PreviewDiff from "../components/racehub/strategy/PreviewDiff.jsx";

const API = import.meta.env.VITE_API_URL;

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
  // #2849 bølge 6: hvilken handling der fejlede, så ErrorState's ene retry-knap
  // kan gengive den samme handling — ikke bare lukke fejlen.
  const lastActionRef = useRef(null); // "preview" | "save" | "regenerate" | null
  // #4165: #2465 gav MUTATIONERNE en fejl-flade, men selve hentningen beholdt den
  // tavse gren - !res.ok og netværksfejl satte ingen state, og `!data?.enabled →
  // null` tegnede så en tom side. Samme rettelse som RaceHubBoard får her.
  const [loadError, setLoadError] = useState(null); // { kind, status? } | null

  const load = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) {
      setLoadError({ kind: "auth" });
      reportLoadFailure("strategy_page", { kind: "auth" });
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`${API}/api/races/strategy`, { headers });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setLoadError({ kind: "http", status: res.status });
        reportLoadFailure("strategy_page", { kind: "http", status: res.status, reason: body?.error });
        return;
      }
      // #4165: egen gren for parsningen - ellers tagges en malformet 200-krop
      // som "network" og peger triagen mod spillerens forbindelse.
      let j;
      try {
        j = await res.json();
      } catch (cause) {
        setLoadError({ kind: "parse", status: res.status });
        reportLoadFailure("strategy_page", { kind: "parse", status: res.status, cause });
        return;
      }
      setData(j);
      if (j.enabled) setDraft({
        aChain: j.a_chain || [], captainPriorities: j.captain_priorities || {},
        roleRules: j.role_rules || {}, targetRaceIds: j.target_race_ids || [],
      });
      setLoadError(null);
    } catch (cause) {
      setLoadError({ kind: "network" });
      reportLoadFailure("strategy_page", { kind: "network", cause });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const retryLoad = () => {
    setLoading(true);
    setLoadError(null);
    load();
  };

  if (loading) return <PageLoader label={t("strategy.title")} />;
  // #4165: fejlet hentning FØR flag-grenen, ellers ser en fejl ud som "ikke aktiv".
  if (loadError) {
    return (
      <div role="alert" className="max-w-4xl mx-auto">
        <ErrorState
          title={t("strategy.error.loadTitle")}
          description={loadError.kind === "auth" ? t("strategy.error.session") : t("strategy.error.loadBody")}
          action={<Button variant="secondary" size="sm" onClick={retryLoad}>{t("strategy.error.retry")}</Button>}
        />
      </div>
    );
  }
  if (!data?.enabled) return null;
  if (!data.roster?.length) return (
    <div className="max-w-4xl mx-auto">
      <EmptyState title={t("strategy.aChain.empty")} />
    </div>
  );

  const dirty = () => { setSaved(false); };
  const payload = () => ({
    a_chain: draft.aChain, captain_priorities: draft.captainPriorities,
    role_rules: draft.roleRules, target_race_ids: draft.targetRaceIds,
  });
  const raceNames = Object.fromEntries((data.upcoming || []).map((r) => [r.id, r.name]));

  const runPreview = async () => {
    const headers = await authHeaders(); if (!headers) return;
    lastActionRef.current = "preview";
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
    lastActionRef.current = "save";
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
    lastActionRef.current = "regenerate";
    setBusy(true); setError(null);
    try {
      const res = await fetch(`${API}/api/races/distribution/regenerate?mode=missing`, { method: "POST", headers });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError({ code: body.error || "generic" });
      }
    } catch { setError({ code: "generic" }); } finally { setBusy(false); }
  };
  const retryLastAction = () => {
    if (lastActionRef.current === "preview") runPreview();
    else if (lastActionRef.current === "save") save();
    else if (lastActionRef.current === "regenerate") regenerate();
  };

  const update = (patch) => { setDraft({ ...draft, ...patch }); dirty(); };

  return (
    <div className="max-w-4xl mx-auto" data-testid="strategy-page">
      {/* Fladens formåls-linje (før PageHeader-subtitle) — hubben ejer titlen. */}
      <p className="mb-4 text-xs text-cz-2">{t("strategy.subtitle")}</p>

      {error && (
        <div role="alert" className="mb-4">
          <ErrorState
            title={t("strategy.error.title")}
            description={t([`selection.errors.${error.code}`, "selection.errors.generic"])}
            action={<Button variant="secondary" size="sm" onClick={retryLastAction}>{t("strategy.error.retry")}</Button>}
          />
        </div>
      )}

      <SectionStack>
        <AChainEditor roster={data.roster} value={draft.aChain} onChange={(aChain) => update({ aChain })} />
        <RoleRulesEditor roster={data.roster} value={draft.roleRules} onChange={(roleRules) => update({ roleRules })} />
        <CaptainBoard roster={data.roster} value={draft.captainPriorities} onChange={(captainPriorities) => update({ captainPriorities })} />
        <TargetRacePicker upcoming={data.upcoming || []} value={draft.targetRaceIds} onChange={(targetRaceIds) => update({ targetRaceIds })} />
      </SectionStack>

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
