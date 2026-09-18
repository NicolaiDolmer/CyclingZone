import { useCallback, useEffect, useState } from "react";
import { adminErrorMessage } from "../shared/useAdminAuth";
import { apiFetch } from "../../../lib/apiFetch.ts";

// #5259 · Stadie-tavlen. ÉT sted hvor et flag flyttes mellem off / beta / on.
//
// Tavlen viser KUN de nøgler der faktisk evalueres med evaluateFlagStage
// (backend/lib/stageFlagCatalog.js — og en forward-guard-test fejler hvis et
// nyt stage-flag-modul smutter ind uden at komme med her). app_config rummer
// også tal, tidsstempler og flag med et ANDET tre-ords-ordforråd
// (email_loop_* er off|dry_run|on); et "beta" skrevet i sådan en nøgle ville
// blive læst som "off" af det modul, og tavlen ville lyve.
//
// Stadiet er kun den halve sandhed: `beta` betyder "synlig for admin ELLER
// users.is_beta_tester". HVEM der er beta-tester sættes i Brugere-fanen.

const API = import.meta.env.VITE_API_URL;

const REGISTRY_URL =
  "https://github.com/NicolaiDolmer/CyclingZone/blob/main/docs/FEATURE_REGISTRY.yml";

const AREA_LABELS = {
  academy: "Akademi",
  board: "Bestyrelse",
  training: "Træning",
  club: "Klub",
  scouting: "Scouting",
  season: "Sæson",
  "race-day": "Løbsdag",
  "race-engine": "Løbsmotor",
  economy: "Økonomi",
  market: "Marked",
  ops: "Drift",
  billing: "Betaling",
};

const STAGE_LABELS = { off: "Fra", beta: "Beta", on: "Til" };

// Farven bærer betydningen: `beta` er den eneste tilstand hvor spilleren og
// beta-testeren ser to forskellige ting, og den skal kunne ses på afstand.
const STAGE_ACTIVE_CLASS = {
  off: "bg-cz-subtle text-cz-2 border-cz-border",
  beta: "bg-cz-info/10 text-cz-info border-cz-info/30",
  on: "bg-cz-success-bg text-cz-success border-cz-success/30",
};

export default function FeatureFlagBoardSection({ getAuth, onMsg }) {
  const [flags, setFlags] = useState(null);
  const [saving, setSaving] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(
        `${API}/api/admin/feature-flags`, { headers: await getAuth() }, { source: "admin-feature-flags" },
      );
      if (res.limited) return;
      const data = res.data ?? {};
      if (!res.ok) { onMsg?.(adminErrorMessage(data, res), "error"); return; }
      setFlags(data.flags || []);
    } catch (e) {
      onMsg?.(`Forbindelsen fejlede: ${e.message || "ukendt"}`, "error");
    }
  }, [getAuth, onMsg]);

  useEffect(() => { load(); }, [load]);

  async function setStage(flag, stage) {
    if (flag.stage === stage || saving) return;
    // Et flag i `on` rammer ALLE spillere med det samme. Bekræftelsen er kun
    // på vej OP (mod on) — at slukke eller trække tilbage til beta er den
    // sikre retning og skal ikke bremses.
    if (stage === "on" && !confirm(`Tænd "${flag.label}" for ALLE spillere nu?`)) return;
    setSaving(flag.key);
    try {
      const res = await apiFetch(`${API}/api/admin/feature-flags/${flag.key}`, {
        method: "PATCH", headers: await getAuth(),
        body: JSON.stringify({ stage }),
      }, { source: "admin-feature-flag-set" });
      if (res.limited) return;
      const data = res.data ?? {};
      if (res.ok) { onMsg?.(`${flag.label} står nu på ${STAGE_LABELS[stage]}`); load(); }
      else onMsg?.(adminErrorMessage(data, res), "error");
    } catch (e) {
      onMsg?.(`Forbindelsen fejlede: ${e.message || "ukendt"}`, "error");
    } finally {
      setSaving(null);
    }
  }

  if (flags === null) return <p className="text-cz-3 text-sm">Henter flag…</p>;
  if (flags.length === 0) return <p className="text-cz-3 text-sm">Ingen stadie-flag registreret.</p>;

  const areas = [...new Set(flags.map(f => f.area))];
  const betaCount = flags.filter(f => f.stage === "beta").length;

  return (
    <>
      <p className="text-cz-3 text-xs mb-4 leading-relaxed">
        <strong className="text-cz-2">Fra</strong> = ingen ser den ·{" "}
        <strong className="text-cz-2">Beta</strong> = kun admin og beta-testere ·{" "}
        <strong className="text-cz-2">Til</strong> = alle.
        Hvem der er beta-tester sættes i fanen Brugere.{" "}
        {betaCount > 0
          ? <>Lige nu står <span className="tabular-nums">{betaCount}</span> flag i beta.</>
          : "Ingen flag står i beta lige nu."}
        {" "}Stadiet skal matche <code className="text-cz-2">state:</code> i{" "}
        <a href={REGISTRY_URL} target="_blank" rel="noreferrer" className="text-cz-accent-t underline">
          FEATURE_REGISTRY.yml
        </a>.
      </p>

      <div className="flex flex-col gap-5">
        {areas.map(area => (
          <div key={area}>
            <p className="text-cz-3 text-2xs uppercase tracking-wide mb-2">{AREA_LABELS[area] || area}</p>
            <div className="rounded-cz border border-cz-border divide-y divide-cz-border">
              {flags.filter(f => f.area === area).map(flag => (
                <div key={flag.key} className="px-3 py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-cz-1 text-sm">{flag.label}</p>
                    <p className="text-cz-3 text-xs font-mono truncate">{flag.key}</p>
                    {/* En værdi uden for off/beta/on er en DRIFT, ikke et valg —
                        modulet selv læser den som "off" (fail-safe). Vi skjuler
                        den ikke bag et pænt "Fra". */}
                    {flag.unknown_value && (
                      <p className="text-cz-warning text-xs mt-0.5">
                        Ukendt værdi i app_config: {JSON.stringify(flag.raw_value)} — læses som Fra
                      </p>
                    )}
                    {flag.boolean_only && (
                      <p className="text-cz-3 text-xs mt-0.5">Boolean-flag (gammelt skema) — intet beta-stadie</p>
                    )}
                  </div>
                  <div className="flex gap-1 flex-shrink-0 self-start sm:self-auto" role="group" aria-label={`Stadie for ${flag.label}`}>
                    {["off", "beta", "on"].map(stage => {
                      const active = flag.stage === stage;
                      const unavailable = stage === "beta" && flag.boolean_only;
                      return (
                        <button
                          key={stage}
                          type="button"
                          aria-pressed={active}
                          disabled={saving === flag.key || unavailable}
                          onClick={() => setStage(flag, stage)}
                          className={`text-xs px-2.5 py-1 border rounded transition-all disabled:opacity-40
                            ${active
                              ? STAGE_ACTIVE_CLASS[stage]
                              : "bg-transparent text-cz-3 border-cz-border hover:text-cz-1"}`}
                        >
                          {saving === flag.key && active ? "…" : STAGE_LABELS[stage]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
