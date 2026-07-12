// StageRoleMatrix — etape-taktik-matrix for et etapeløb (#2034, Race Engine v3 S3).
//
// Én række pr. rytter, én kolonne pr. etape. Kørte etaper (stage_number <=
// stages_completed) er låst og viser den resolverede rolle (+ effort hvis den
// afviger) som stille tekst med en lås-markør. Kommende etaper er redigerbare
// via to kompakte <select>-felter pr. celle (rolle + effort). Default = holdets
// løbs-rolle kopieret ind, kun AFVIGELSER redigeres — sådanne celler markeres
// med en accent-kant. Renderer intet når backend-flaget er OFF, eller holdet
// ingen ryttere har i løbet (samme selv-gatende mønster som RaceSelectionPanel).
//
// Vises BÅDE for scheduled og live etapeløb (taktik-skift undervejs er hele
// pointen — se RaceDetailPage's callsite) — panelet styrer KOMMENDE etaper,
// aldrig startfeltet, så det er upåvirket af #1825's lineup-frysning.

import { useState, useEffect, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { getSession } from "../../lib/supabase";
import { terrainBucket } from "../../lib/stageTerrain.js";
import { LockIcon } from "../ui/index.js";
import {
  overridesIndex,
  resolveCell,
  buildDraftMatrix,
  isCellOverridden,
  setCell,
  diffToOverrides,
  isDirty,
  jerseyLeaderId,
  applyJerseyCaptainShortcut,
} from "../../lib/stageRoleMatrixLogic.js";

const API = import.meta.env.VITE_API_URL;

// Samme rækkefølge som backend VALID_RACE_ROLES/VALID_EFFORTS (raceRoles.js).
const ROLE_OPTIONS = ["captain", "sprint_captain", "helper", "hunter", "free_role"];
const EFFORT_OPTIONS = ["protect", "normal", "save"];

// captain/sprint_captain/hunter/helper genbruger de eksisterende racehub.role.*-
// labels (helper vises som "rider only" — samme UI-koncept som RoleCard/
// roleHint.js, hvor race_entries.race_role "helper" mappes til UI-nøglen "rider").
// free_role er nyt i S3 og har sin egen nøgle.
const ROLE_LABEL_KEY = {
  captain: "racehub.role.captain",
  sprint_captain: "racehub.role.sprintCaptain",
  helper: "racehub.role.rider",
  hunter: "racehub.role.hunter",
  free_role: "stageTactics.role.free_role",
};

async function authHeaders() {
  const { data } = await getSession();
  const token = data?.session?.access_token;
  if (!token) return null;
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export default function StageRoleMatrix({ raceId, profileByStage = {}, gcRows = [] }) {
  const { t } = useTranslation("races");
  const [data, setData] = useState(null);
  const [draftMatrix, setDraftMatrix] = useState({});
  const [initialMatrix, setInitialMatrix] = useState({});
  const [status, setStatus] = useState("idle"); // idle | saving | saved | error
  const [errorKey, setErrorKey] = useState(null);

  const load = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) return;
    try {
      const res = await fetch(`${API}/api/races/${raceId}/stage-roles`, { headers });
      if (!res.ok) return;
      const body = await res.json();
      setData(body);
      const stageNumbers = Array.from({ length: body.stage_count ?? 0 }, (_, i) => i + 1);
      const seeded = buildDraftMatrix({
        riders: body.riders,
        overrides: body.overrides,
        stageNumbers,
        stagesCompleted: body.stages_completed ?? 0,
      });
      setDraftMatrix(seeded);
      setInitialMatrix(seeded);
      // NB: status/errorKey er bevidst IKKE nulstillet her. Denne funktion
      // dobbelt-bruges som initial-load (status er allerede 'idle' fra
      // useState) OG som post-save re-fetch (#2034 punkt 5) — ville vi
      // nulstille til 'idle' her, ville "Tactics saved."-kvitteringen (sat af
      // save() lige før den awaiter load()) blive overskrevet med det samme.
    } catch {
      /* netværk — panelet forbliver skjult (data forbliver null) */
    }
  }, [raceId]);

  useEffect(() => { load(); }, [load]);

  const stageNumbers = useMemo(
    () => Array.from({ length: data?.stage_count ?? 0 }, (_, i) => i + 1),
    [data?.stage_count],
  );
  const stagesCompleted = data?.stages_completed ?? 0;
  const lockedStages = useMemo(() => stageNumbers.filter((n) => n <= stagesCompleted), [stageNumbers, stagesCompleted]);
  const editableStages = useMemo(() => stageNumbers.filter((n) => n > stagesCompleted), [stageNumbers, stagesCompleted]);
  const overridesMap = useMemo(() => overridesIndex(data?.overrides), [data?.overrides]);

  const dirty = isDirty(draftMatrix, initialMatrix);
  const saving = status === "saving";

  const leaderId = useMemo(
    () => jerseyLeaderId({ gcRows, myRiderIds: (data?.riders ?? []).map((r) => r.rider_id) }),
    [gcRows, data?.riders],
  );
  const leaderRider = leaderId != null ? (data?.riders ?? []).find((r) => r.rider_id === leaderId) : null;
  // Genvejen er kun meningsfuld hvis der er kommende etaper tilbage at sætte den på,
  // og føreren ikke allerede er kaptajn på ALLE af dem.
  const leaderAlreadyCaptainEverywhere = leaderId != null && editableStages.length > 0
    && editableStages.every((sn) => draftMatrix[sn]?.[leaderId]?.race_role === "captain");
  const showJerseyShortcut = leaderRider && editableStages.length > 0 && !leaderAlreadyCaptainEverywhere;

  function applyJerseyShortcut() {
    setDraftMatrix((m) => applyJerseyCaptainShortcut({ matrix: m, leaderId, stageNumbers, stagesCompleted }));
    if (status !== "idle") setStatus("idle");
  }

  function updateCell(stageNumber, riderId, patch) {
    setDraftMatrix((m) => setCell(m, stageNumber, riderId, patch));
    if (status !== "idle") setStatus("idle");
  }

  async function save() {
    const headers = await authHeaders();
    if (!headers) return;
    setStatus("saving");
    setErrorKey(null);
    try {
      const overrides = diffToOverrides({ matrix: draftMatrix, riders: data.riders });
      const res = await fetch(`${API}/api/races/${raceId}/stage-roles`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ overrides }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus("error");
        setErrorKey(body.error || "generic");
        return;
      }
      setStatus("saved");
      await load(); // #2034 punkt 5: re-fetch efter succesfuldt gem.
    } catch {
      setStatus("error");
      setErrorKey("generic");
    }
  }

  // Flag OFF, ikke hentet endnu, eller holdet har ingen ryttere i løbet → intet panel.
  if (!data?.enabled || !(data.riders?.length > 0)) return null;
  // Alt kørt (ingen kommende etaper) — der er intet at redigere; panelet skjules
  // stille i stedet for at vise en tom "kommende"-kolonne.
  if (editableStages.length === 0 && lockedStages.length === 0) return null;

  return (
    <section data-testid="stage-role-matrix" className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
      <div className="px-4 py-3 border-b border-cz-border">
        <h2 className="font-semibold text-cz-1 text-sm">{t("stageTactics.title")}</h2>
        <p className="text-cz-3 text-xs mt-0.5">{t("stageTactics.help")}</p>
      </div>

      {showJerseyShortcut && (
        <div className="px-4 py-2.5 border-b border-cz-border bg-cz-subtle flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-cz-2">{t("stageTactics.jerseyShortcutHint", { name: leaderRider.name })}</p>
          <button
            type="button"
            onClick={applyJerseyShortcut}
            className="px-3 py-1.5 rounded-lg border border-cz-accent/30 bg-cz-accent/10 text-cz-accent-t text-xs font-semibold hover:bg-cz-accent/20 transition-colors whitespace-nowrap"
          >
            {t("stageTactics.jerseyShortcut", { name: leaderRider.name })}
          </button>
        </div>
      )}

      {/* #2034 punkt 6: overflow-x-auto på selve matrix-containeren — siden må
          aldrig scrolle vandret (e2e overflow-guards). */}
      <div className="overflow-x-auto">
        <table data-sort-exempt="Etape-taktik-matrix: raekker=ryttere, kolonner=etapenumre, begge faste" className="text-sm border-collapse">
          <thead>
            <tr className="border-b border-cz-border">
              <th className="sticky left-0 bg-cz-card px-4 py-2 text-left font-medium text-xs uppercase text-cz-3 whitespace-nowrap">
                {t("stageTactics.riderCol")}
              </th>
              {stageNumbers.map((sn) => {
                const bucket = terrainBucket(profileByStage[sn]?.profile_type);
                const locked = sn <= stagesCompleted;
                return (
                  <th key={sn} className="px-2.5 py-2 text-center font-medium text-xs text-cz-3 whitespace-nowrap min-w-[7.5rem]">
                    <span className="inline-flex items-center gap-1 justify-center">
                      {locked && <LockIcon size={11} aria-hidden="true" className="text-cz-3" />}
                      {t("stageTactics.stageCol", { number: sn })}
                    </span>
                    {profileByStage[sn] && (
                      <span className="block text-[10px] font-normal normal-case text-cz-3 mt-0.5">
                        {t(`strategy.buckets.${bucket}`)}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {data.riders.map((rider) => (
              <tr key={rider.rider_id} className="border-b border-cz-border last:border-0">
                <td className="sticky left-0 bg-cz-card px-4 py-2 text-cz-1 font-medium whitespace-nowrap">
                  {rider.name || "—"}
                </td>
                {stageNumbers.map((sn) => {
                  const locked = sn <= stagesCompleted;
                  if (locked) {
                    const cell = resolveCell({ rider, stageNumber: sn, overridesMap });
                    const overridden = isCellOverridden(cell, rider);
                    return (
                      <td key={sn} className="px-2.5 py-2 text-center text-xs text-cz-3">
                        <span className="inline-flex items-center gap-1">
                          <LockIcon size={10} aria-hidden="true" className="text-cz-3" />
                          {t(ROLE_LABEL_KEY[cell.race_role] || "stageTactics.role.free_role")}
                          {overridden && cell.effort !== "normal" && (
                            <span className="text-cz-3"> · {t(`stageTactics.effort.${cell.effort}`)}</span>
                          )}
                        </span>
                      </td>
                    );
                  }
                  const cell = draftMatrix[sn]?.[rider.rider_id] || { race_role: "helper", effort: "normal" };
                  const overridden = isCellOverridden(cell, rider);
                  return (
                    <td key={sn} className={`px-2 py-1.5 text-center ${overridden ? "border-l-2 border-cz-accent" : ""}`}>
                      <div className="flex flex-col gap-1 items-stretch">
                        <select
                          aria-label={t("stageTactics.roleAria", { stage: sn, rider: rider.name })}
                          value={cell.race_role}
                          disabled={saving}
                          onChange={(e) => updateCell(sn, rider.rider_id, { race_role: e.target.value })}
                          className="bg-cz-subtle border border-cz-border rounded px-1.5 py-1 text-[11px] text-cz-1 disabled:opacity-50"
                        >
                          {ROLE_OPTIONS.map((r) => (
                            <option key={r} value={r}>{t(ROLE_LABEL_KEY[r])}</option>
                          ))}
                        </select>
                        <select
                          aria-label={t("stageTactics.effortAria", { stage: sn, rider: rider.name })}
                          value={cell.effort}
                          disabled={saving}
                          onChange={(e) => updateCell(sn, rider.rider_id, { effort: e.target.value })}
                          className="bg-cz-subtle border border-cz-border rounded px-1.5 py-1 text-[11px] text-cz-1 disabled:opacity-50"
                        >
                          {EFFORT_OPTIONS.map((ef) => (
                            <option key={ef} value={ef}>{t(`stageTactics.effort.${ef}`)}</option>
                          ))}
                        </select>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-3 border-t border-cz-border flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="space-y-0.5">
          {status === "error" && errorKey && (
            <p className="text-xs text-cz-danger">
              {t([`stageTactics.errors.${errorKey}`, "stageTactics.errors.generic"])}
            </p>
          )}
          {status === "saved" && (
            <p className="text-xs text-cz-success">{t("stageTactics.saved")}</p>
          )}
          {status === "idle" && dirty && (
            <p className="text-xs text-cz-2">{t("stageTactics.unsaved")}</p>
          )}
        </div>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="px-4 py-2 rounded-lg bg-cz-accent text-cz-on-accent text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity self-start sm:self-auto"
        >
          {saving ? t("stageTactics.saving") : t("stageTactics.save")}
        </button>
      </div>
    </section>
  );
}
