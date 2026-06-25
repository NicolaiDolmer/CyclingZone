// RaceSelectionPanel — managerens holdudtagelse til et kommende løb (#1307).
//
// Henter GET /api/races/:raceId/selection (ryttere + evt. eksisterende
// udtagelse) og gemmer via PUT. Renderer intet når race-engine-flaget er OFF
// eller løbet ikke længere er "scheduled" (backend sender enabled=false /
// race.status). Klient-validering spejler backendens snake_case-koder
// (raceSelectionLogic.js) så fejl vises FØR kaldet — samme fetch-mønster
// som useTraining (Bearer-token fra Supabase-session).

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getSession } from "../../lib/supabase";
import { toggleRider, validateSelectionClient } from "../../lib/raceSelectionLogic.js";
import RiderTypeBadge from "../rider/RiderTypeBadge.jsx";
import FitBar from "../racehub/FitBar.jsx";
import { effectiveStageFit, bestFitRiderId } from "../../lib/lineupInsight.js";

const API = import.meta.env.VITE_API_URL;

const EMPTY_SELECTION = { riderIds: [], captainId: null, sprintCaptainId: null, hunterId: null };

async function authHeaders() {
  const { data } = await getSession();
  const token = data?.session?.access_token;
  if (!token) return null;
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export default function RaceSelectionPanel({ raceId, selectedStageIndex = null, selectedStageBucket = null }) {
  const { t } = useTranslation("races");
  const [data, setData] = useState(null);
  const [sel, setSel] = useState(EMPTY_SELECTION);
  const [status, setStatus] = useState("idle"); // idle | saving | saved | error
  const [errorKey, setErrorKey] = useState(null);
  const [touched, setTouched] = useState(false);
  // #1747: skjul-skadede-toggle. Default false (skadede vises dæmpet + deaktiveret)
  // så manageren stadig kan se hvem der er ude — toggler skjuler dem helt.
  const [hideInjured, setHideInjured] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setStatus("idle");
    setErrorKey(null);
    setTouched(false);
    (async () => {
      const headers = await authHeaders();
      if (!headers) return;
      try {
        const res = await fetch(`${API}/api/races/${raceId}/selection`, { headers });
        if (!res.ok) return;
        const body = await res.json();
        if (cancelled) return;
        setData(body);
        if (body.selection) {
          setSel({
            riderIds: body.selection.rider_ids ?? [],
            captainId: body.selection.captain_id ?? null,
            sprintCaptainId: body.selection.sprint_captain_id ?? null,
            hunterId: body.selection.hunter_id ?? null,
          });
        }
      } catch {
        /* netværk — panelet forbliver skjult */
      }
    })();
    return () => { cancelled = true; };
  }, [raceId]);

  // Flag OFF eller løbet ikke længere åbent → intet panel.
  if (!data?.enabled || data.race?.status !== "scheduled") return null;

  const { size, riders, availableCount } = data;
  const clientErrors = validateSelectionClient({ ...sel, size, availableCount });
  const selectedRiders = riders.filter((r) => sel.riderIds.includes(r.id));
  // S4: best-fit-nudge — den valgte rytter med højest rute-match til den valgte etape.
  const bestId = bestFitRiderId(riders, sel.riderIds, selectedStageIndex);
  const atMax = sel.riderIds.length >= size.max;
  const errParams = { min: size.min, max: size.max };
  const saving = status === "saving";
  // #1747: skjul skadede ryttere. En allerede-udtaget (skadet) rytter forbliver
  // synlig så manageren ikke mister overblikket over en ugyldig udtagelse.
  const injuredCount = riders.filter((r) => r.injured).length;
  const visibleRiders = hideInjured
    ? riders.filter((r) => !r.injured || sel.riderIds.includes(r.id))
    : riders;

  function update(next) {
    setSel(next);
    if (!touched) setTouched(true);
    if (status !== "idle") setStatus("idle");
    if (errorKey) setErrorKey(null);
  }

  // <select> stringificerer values — slå tilbage til rytterens originale id-type.
  function riderIdFromValue(value) {
    const rider = riders.find((r) => String(r.id) === value);
    return rider ? rider.id : null;
  }

  function setRole(key, value) {
    update({ ...sel, [key]: riderIdFromValue(value) });
  }

  async function save() {
    const headers = await authHeaders();
    if (!headers) return;
    setStatus("saving");
    setErrorKey(null);
    try {
      const res = await fetch(`${API}/api/races/${raceId}/selection`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          rider_ids: sel.riderIds,
          captain_id: sel.captainId,
          sprint_captain_id: sel.sprintCaptainId,
          hunter_id: sel.hunterId,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus("error");
        setErrorKey(body.error || "generic");
        return;
      }
      setStatus("saved");
      // Efter manuel gem er udtagelsen ikke længere assistentens.
      setData((d) => (d
        ? {
            ...d,
            selection: {
              rider_ids: sel.riderIds,
              captain_id: sel.captainId,
              sprint_captain_id: sel.sprintCaptainId,
              hunter_id: sel.hunterId,
              is_auto_filled: false,
            },
          }
        : d));
    } catch {
      setStatus("error");
      setErrorKey("generic");
    }
  }

  return (
    <section data-testid="race-selection-panel" className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
      {/* Header: titel + tæller */}
      <div className="px-4 py-3 border-b border-cz-border flex flex-col sm:flex-row sm:items-center justify-between gap-1">
        <div>
          <h2 className="font-semibold text-cz-1 text-sm">{t("selection.title")}</h2>
          <p className="text-cz-3 text-xs">{t("selection.subtitle", errParams)}</p>
        </div>
        <span className="text-xs font-mono text-cz-2 whitespace-nowrap">
          {t("selection.count", { count: sel.riderIds.length, max: size.max })}
        </span>
      </div>

      {/* #1747: forklaring af egnethedstallet (det "uklare element") + skjul-skadede-toggle. */}
      <div className="px-4 py-2 border-b border-cz-border flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-cz-subtle">
        <p className="text-cz-3 text-[11px] leading-snug">{t("selection.suitabilityHelp")}</p>
        {injuredCount > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-cz-2 whitespace-nowrap cursor-pointer self-start sm:self-auto">
            <input
              type="checkbox"
              checked={hideInjured}
              onChange={() => setHideInjured((v) => !v)}
              className="accent-cz-accent"
            />
            {t("selection.hideInjured")}
          </label>
        )}
      </div>

      {/* S4: delt "why this rider"-hint — kobler etapens terræn til dit stærkeste fit. */}
      {selectedStageBucket && bestId && (
        <p className="px-4 py-2 text-[11px] leading-snug text-cz-2 bg-cz-subtle border-b border-cz-border">
          {t("selection.whyBest", {
            bucket: t(`strategy.buckets.${selectedStageBucket}`),
            name: riders.find((r) => r.id === bestId)?.name ?? "",
          })}
        </p>
      )}

      {data.selection?.is_auto_filled && (
        <p className="px-4 py-2 text-xs text-cz-2 bg-cz-subtle border-b border-cz-border">
          {t("selection.autoPicked")}
        </p>
      )}

      {/* Rytterliste — responsivt. På mobil (<sm) en stablet liste: en 5-kolonne
          tabel kræver ~488px og tvinger en vandret scroll-container på 393px-
          viewporten. Under Playwrights Pixel 5 (isMobile) emulering skævvrider
          den overflow-container hit-testet på "Gem udtagelse"-knappen nedenunder,
          så klikket rammer en tabel-celle i stedet (#1834, frontend-smoke rød på
          CI). Stablede kort fjerner overflow'en helt + er bedre mobil-UX.
          Fra sm og op vises den klassiske tabel. */}
      <ul className="sm:hidden divide-y divide-cz-border">
        {visibleRiders.map((rider) => {
          const checked = sel.riderIds.includes(rider.id);
          const disabled = rider.injured || (!checked && atMax) || saving;
          const fitLabel = selectedStageIndex != null ? t("selection.routeMatch") : t("selection.suitability");
          return (
            <li key={rider.id} className={rider.injured ? "opacity-60" : ""}>
              <label className={`flex items-start gap-3 px-4 py-3 ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => update(toggleRider(sel, rider.id, size.max))}
                  className="accent-cz-accent disabled:cursor-not-allowed mt-1 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-cz-1 font-medium">{rider.name}</span>
                    {rider.injured && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-cz-danger/10 text-cz-danger border border-cz-danger/20">
                        {t("selection.injured")}
                      </span>
                    )}
                    <RiderTypeBadge primaryType={rider.primaryType} secondaryType={rider.secondaryType} />
                  </div>
                  <div className="mt-1.5 flex items-center gap-x-4 gap-y-1 flex-wrap text-xs text-cz-2">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-cz-3 uppercase text-[10px] tracking-wide">{fitLabel}</span>
                      {rider.id === bestId && (
                        <span className="text-[9px] uppercase tracking-wide text-cz-accent-t" title={t("selection.bestForStage")}>{t("selection.best")}</span>
                      )}
                      <FitBar score={effectiveStageFit(rider, selectedStageIndex)} />
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="text-cz-3 uppercase text-[10px] tracking-wide">{t("selection.form")}</span>
                      <span className="font-mono tabular-nums text-cz-2">{rider.form ?? "—"}</span>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="text-cz-3 uppercase text-[10px] tracking-wide">{t("selection.fatigue")}</span>
                      <span className="font-mono tabular-nums text-cz-2">{rider.fatigue ?? "—"}</span>
                    </span>
                  </div>
                </div>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-cz-border">
              <th scope="col" className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">{t("selection.thRider")}</th>
              <th scope="col" className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">{t("selection.type")}</th>
              <th scope="col" className="px-4 py-3 text-right text-cz-3 font-medium text-xs uppercase">
                {selectedStageIndex != null ? t("selection.routeMatch") : t("selection.suitability")}
              </th>
              <th scope="col" className="px-4 py-3 text-right text-cz-3 font-medium text-xs uppercase">{t("selection.form")}</th>
              <th scope="col" className="px-4 py-3 text-right text-cz-3 font-medium text-xs uppercase">{t("selection.fatigue")}</th>
            </tr>
          </thead>
          <tbody>
            {visibleRiders.map((rider) => {
              const checked = sel.riderIds.includes(rider.id);
              const disabled = rider.injured || (!checked && atMax) || saving;
              return (
                <tr key={rider.id} className={`border-b border-cz-border last:border-0 hover:bg-cz-subtle ${rider.injured ? "opacity-60" : ""}`}>
                  <td className="px-4 py-2.5">
                    <label className={`flex items-center gap-2 ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => update(toggleRider(sel, rider.id, size.max))}
                        className="accent-cz-accent disabled:cursor-not-allowed"
                      />
                      <span className="text-cz-1 font-medium">{rider.name}</span>
                      {rider.injured && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-cz-danger/10 text-cz-danger border border-cz-danger/20">
                          {t("selection.injured")}
                        </span>
                      )}
                    </label>
                  </td>
                  <td className="px-4 py-2.5">
                    <RiderTypeBadge primaryType={rider.primaryType} secondaryType={rider.secondaryType} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="inline-flex items-center gap-2 justify-end">
                      {rider.id === bestId && (
                        <span className="text-[9px] uppercase tracking-wide text-cz-accent-t" title={t("selection.bestForStage")}>{t("selection.best")}</span>
                      )}
                      <FitBar score={effectiveStageFit(rider, selectedStageIndex)} />
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-cz-2">{rider.form ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-cz-2">{rider.fatigue ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Roller + gem */}
      <div className="px-4 py-3 border-t border-cz-border space-y-3">
        <div className="flex flex-wrap gap-3">
          <RoleSelect
            label={t("selection.captain")}
            value={sel.captainId}
            riders={selectedRiders}
            emptyLabel="—"
            disabled={saving}
            onChange={(v) => setRole("captainId", v)}
          />
          <RoleSelect
            label={t("selection.sprintCaptain")}
            value={sel.sprintCaptainId}
            riders={selectedRiders}
            emptyLabel={t("selection.noRole")}
            disabled={saving}
            onChange={(v) => setRole("sprintCaptainId", v)}
          />
          <RoleSelect
            label={t("selection.hunter")}
            value={sel.hunterId}
            riders={selectedRiders}
            emptyLabel={t("selection.noRole")}
            disabled={saving}
            onChange={(v) => setRole("hunterId", v)}
          />
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="space-y-0.5">
            {touched && clientErrors.map((code) => (
              <p key={code} className="text-xs text-cz-warning">
                {t(`selection.errors.${code}`, errParams)}
              </p>
            ))}
            {status === "error" && errorKey && (
              <p className="text-xs text-cz-danger">
                {t([`selection.errors.${errorKey}`, "selection.errors.generic"], errParams)}
              </p>
            )}
            {status === "saved" && (
              <p className="text-xs text-cz-success">{t("selection.saved")}</p>
            )}
          </div>
          <button
            type="button"
            onClick={save}
            disabled={clientErrors.length > 0 || saving}
            className="px-4 py-2 rounded-lg bg-cz-accent text-cz-on-accent text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity self-start sm:self-auto"
          >
            {saving ? t("selection.saving") : t("selection.save")}
          </button>
        </div>
      </div>
    </section>
  );
}

function RoleSelect({ label, value, riders, emptyLabel, disabled, onChange }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-cz-3">
      {label}
      <select
        value={value != null ? String(value) : ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="bg-cz-subtle border border-cz-border rounded px-2 py-1 text-xs text-cz-1 disabled:opacity-50 min-w-[160px]"
      >
        <option value="">{emptyLabel}</option>
        {riders.map((r) => (
          <option key={r.id} value={String(r.id)}>{r.name}</option>
        ))}
      </select>
    </label>
  );
}
