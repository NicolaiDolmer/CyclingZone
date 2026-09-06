// RaceIntentionPanel — løbsdagens intention (#4632), variant B.
//
// Afløser etape-taktik-matrixen (StageRoleMatrix, #2034): i stedet for et
// gitter af rolle- og indsats-dropdowns pr. rytter × etape har fladen nu ÉN
// åben etape ad gangen (etape-vælger øverst) og ÉN kolonne: dagens intention
// pr. rytter. Ejer-beslutning 6/9:
//   · rollen gælder HELE løbet og står som standard — den redigeres ikke
//     længere pr. etape (kolonnen "Rolle" er ren visning),
//   · intentionen er dagens valg pr. rytter: chip med aktuel værdi + en
//     udfoldet vælger med ét trin pr. linje og én sætning i ORD (aldrig tal),
//   · "ikke valgt" er en synlig tilstand ("Rollens standard · normal"), ikke et
//     tomt felt — passivitet er lovligt og straffes aldrig,
//   · endagsløb har ingen etape-vælger; kolonnen hedder "Løbsdag".
//
// Trinnene kommer fra serverens `valid_efforts` (tre når
// race_day_intention_enabled er OFF, fem når ON). Fladen hardkoder dem ALDRIG:
// et flag-flip alene ændrer hvad spilleren kan vælge, uden en ny deploy.
//
// FOG OF WAR: ingen tal, ingen procenter, ingen "loft"-signaler. Hvert trin
// siger i ord hvad der sker; manualen bor i Hjælp.
//
// Kørte etaper (stage_number <= stages_completed) er låst i vælgeren og kan
// ikke åbnes. Gem sender hele diffen for de redigerbare etaper (REPLACE-
// semantik, se raceStageRolesApi.js) — knappen hedder "Gem etape N" fordi det
// er den etape man ser, men et gem må aldrig tabe en intention der allerede er
// sat på en anden kommende etape.

import { useState, useEffect, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { authHeaders } from "../../lib/supabase"; // #4348: kanonisk kopi
import { terrainBucket } from "../../lib/stageTerrain.js";
import { LockIcon, CheckIcon, Button } from "../ui/index.js";
import {
  buildDraftMatrix,
  diffToOverrides,
  isDirty,
} from "../../lib/stageRoleMatrixLogic.js";
import {
  DEFAULT_EFFORT,
  orderedEfforts,
  intentionFor,
  setIntention,
  copyStageIntentions,
  nextEditableStage,
  stageIntentionCounts,
  untouchedStages,
  baseRoleForRider,
} from "../../lib/raceIntention.js";

const API = import.meta.env.VITE_API_URL;

// Rollens navn i kolonnen. captain/sprint_captain/hunter/helper genbruger de
// eksisterende racehub.role.*-labels (helper vises som "rytter"); free_role har
// sin egen nøgle fra S3.
const ROLE_LABEL_KEY = {
  captain: "racehub.role.captain",
  sprint_captain: "racehub.role.sprintCaptain",
  helper: "racehub.role.rider",
  hunter: "racehub.role.hunter",
  free_role: "intention.roleFree",
};

function roleLabelKey(role) {
  return ROLE_LABEL_KEY[role] || ROLE_LABEL_KEY.helper;
}

// Chip: valgt intention (guld-tekst på tonet flade) vs. "ikke valgt" (stiplet
// hairline, dæmpet). To tilstande, ingen tredje.
function IntentionChip({ t, effort, isDefault }) {
  if (isDefault) {
    return (
      <span className="inline-flex items-center rounded-full border border-dashed border-cz-border px-2.5 py-0.5 text-2xs font-medium text-cz-3 whitespace-nowrap">
        {t("intention.roleDefault")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-cz-accent/30 bg-cz-accent/10 px-2.5 py-0.5 text-2xs font-semibold text-cz-accent-t whitespace-nowrap">
      {t(`intention.step.${effort}`)}
    </span>
  );
}

// Rytterens intentions-celle: chip + den stille handling + linjen der siger hvad
// valget betyder i ord. Udgåede ryttere kan ikke få ny taktik (backend afviser
// dem med stage_roles_rider_abandoned) — de vises låst.
function IntentionCell({ t, rider, effort, open, disabled, onToggle }) {
  if (rider.abandoned) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-cz-3">
        <LockIcon size={11} aria-hidden="true" />
        {t("intention.riderAbandoned")}
      </span>
    );
  }
  const isDefault = effort === DEFAULT_EFFORT;
  return (
    <>
      <div className="flex items-center gap-2.5 flex-wrap">
        <IntentionChip t={t} effort={effort} isDefault={isDefault} />
        <button
          type="button"
          disabled={disabled}
          aria-expanded={open}
          onClick={onToggle}
          className="text-xs font-medium text-cz-accent-t hover:underline disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {open ? t("intention.close") : t(isDefault ? "intention.setIntention" : "intention.change")}
        </button>
      </div>
      <p className="mt-1 text-3xs text-cz-3">
        {isDefault
          ? t("intention.nothingSet")
          : t("intention.line", {
              role: t(`intention.roleWord.${baseRoleForRider(rider)}`),
              today: t(`intention.today.${effort}`),
            })}
      </p>
    </>
  );
}

// Den udfoldede vælger: ét trin pr. linje, én sætning i ord, ingen tal.
// "Rollens standard"-mærket sidder på 'normal', så spilleren kan se hvad han
// falder tilbage til uden at gætte.
function IntentionPicker({ t, rider, scopeLabel, steps, value, disabled, onPick }) {
  return (
    <div className="rounded-cz border border-cz-border bg-cz-card overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 px-3.5 py-2 border-b border-cz-border">
        <span className="text-xs font-semibold text-cz-1">
          {t("intention.pickerTitle", { name: rider.name || "—", scope: scopeLabel })}
        </span>
        <span className="text-3xs text-cz-3 whitespace-nowrap">{t("intention.appliesToStageOnly")}</span>
      </div>
      {steps.map((step) => {
        const on = step === value;
        return (
          <button
            key={step}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => onPick(step)}
            className={`w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2 text-left border-b border-cz-border last:border-b-0 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              on ? "bg-cz-accent/10" : "hover:bg-cz-subtle"
            }`}
          >
            <span className="w-3.5 shrink-0 text-cz-accent-t">
              {on && <CheckIcon size={14} aria-hidden="true" />}
            </span>
            <span className={`text-xs sm:w-32 shrink-0 ${on ? "font-semibold text-cz-accent-t" : "font-medium text-cz-1"}`}>
              {t(`intention.step.${step}`)}
            </span>
            <span className="text-xs text-cz-2 basis-full sm:basis-auto ps-[26px] sm:ps-0">
              {t(`intention.why.${step}`)}
            </span>
            {step === DEFAULT_EFFORT && (
              <span className="text-3xs uppercase tracking-wider text-cz-3 sm:ms-auto whitespace-nowrap">
                {t("intention.roleDefaultTag")}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default function RaceIntentionPanel({ raceId, profileByStage = {} }) {
  const { t } = useTranslation("races");
  const [data, setData] = useState(null);
  const [draftMatrix, setDraftMatrix] = useState({});
  const [initialMatrix, setInitialMatrix] = useState({});
  const [activeStage, setActiveStage] = useState(null);
  const [openRiderId, setOpenRiderId] = useState(null);
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
      // Åbn den første etape der kan redigeres — løbsdagen. Et gyldigt valg
      // spilleren allerede har truffet bevares (load() genbruges som post-save
      // re-fetch, og etapen under fingeren må ikke hoppe).
      setActiveStage((current) => {
        const editable = stageNumbers.filter((n) => n > (body.stages_completed ?? 0));
        return current != null && editable.includes(current) ? current : (editable[0] ?? null);
      });
      // NB: status/errorKey nulstilles bevidst IKKE her — "Gemt"-kvitteringen
      // (sat af save() lige før den awaiter load()) må ikke overskrives.
    } catch {
      /* netværk — panelet forbliver skjult (data forbliver null) */
    }
  }, [raceId]);

  useEffect(() => { load(); }, [load]);

  const stagesCompleted = data?.stages_completed ?? 0;
  const stageNumbers = useMemo(
    () => Array.from({ length: data?.stage_count ?? 0 }, (_, i) => i + 1),
    [data?.stage_count],
  );
  const editableStages = useMemo(
    () => stageNumbers.filter((n) => n > stagesCompleted),
    [stageNumbers, stagesCompleted],
  );
  // Femtrins-skalaen når flaget er on, tre trin når det er off — altid serverens
  // liste, aldrig en lokal konstant.
  const steps = useMemo(() => orderedEfforts(data?.valid_efforts), [data?.valid_efforts]);
  const riders = useMemo(() => data?.riders ?? [], [data?.riders]);

  const counts = useMemo(
    () => stageIntentionCounts({ matrix: draftMatrix, riders, stageNumber: activeStage }),
    [draftMatrix, riders, activeStage],
  );
  const untouched = useMemo(
    () => untouchedStages({ matrix: draftMatrix, riders, editableStages, exceptStage: activeStage }),
    [draftMatrix, riders, editableStages, activeStage],
  );

  const isOneDay = (data?.stage_count ?? 0) <= 1;
  const dirty = isDirty(draftMatrix, initialMatrix);
  const saving = status === "saving";
  const nextStage = nextEditableStage({ editableStages, stageNumber: activeStage });

  function pickIntention(riderId, effort) {
    setDraftMatrix((m) => setIntention({ matrix: m, stageNumber: activeStage, riderId, effort }));
    setOpenRiderId(null);
    if (status !== "idle") setStatus("idle");
  }

  function copyToNextStage() {
    if (nextStage == null) return;
    setDraftMatrix((m) => copyStageIntentions({ matrix: m, fromStage: activeStage, toStage: nextStage, riders }));
    if (status !== "idle") setStatus("idle");
  }

  function openStage(stageNumber) {
    setActiveStage(stageNumber);
    setOpenRiderId(null);
  }

  async function save() {
    const headers = await authHeaders();
    if (!headers) return;
    setStatus("saving");
    setErrorKey(null);
    try {
      // Hele diffen for de redigerbare etaper: PUT'en er REPLACE for alt >
      // stages_completed, så et gem af etape 3 må ikke slette etape 4's
      // intentioner. Kun celler der afviger fra rytterens basis sendes.
      const overrides = diffToOverrides({ matrix: draftMatrix, riders });
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
      setOpenRiderId(null);
      await load();
    } catch {
      setStatus("error");
      setErrorKey("generic");
    }
  }

  // Flag OFF, ikke hentet endnu, eller holdet har ingen ryttere i løbet.
  if (!data?.enabled || riders.length === 0) return null;
  // Ingen kommende etape at sætte noget på — panelet skjules stille i stedet
  // for at vise en vælger uden valg.
  if (activeStage == null || editableStages.length === 0) return null;

  const scopeLabel = isOneDay
    ? t("intention.raceDayLower")
    : t("intention.stageLower", { number: activeStage });
  const columnLabel = isOneDay
    ? t("intention.colIntentionRaceDay")
    : t("intention.colIntention", { number: activeStage });
  const roleScope = isOneDay ? t("intention.thisRace") : t("intention.allRace");
  const bucket = terrainBucket(profileByStage[activeStage]?.profile_type);
  const toolbarNote = profileByStage[activeStage]
    ? `${t(`strategy.buckets.${bucket}`)}. ${t("intention.notSetNote")}`
    : t("intention.notSetNote");
  const footerLine = isOneDay
    ? t("intention.footerRaceDay", counts)
    : t("intention.footer", { stage: activeStage, ...counts });
  // "etaperne 4 og 5" — ikke "4, 5". Sidste led bindes med sprogets eget ord,
  // saa linjen laeses som en saetning og ikke som en liste.
  const stageList = untouched.length <= 1
    ? untouched.join("")
    : [untouched.slice(0, -1).join(", "), untouched[untouched.length - 1]].join(t("intention.listAnd"));
  const untouchedLine = untouched.length === 0
    ? null
    : t(untouched.length === 1 ? "intention.footerUntouchedOne" : "intention.footerUntouchedMany", {
        stages: stageList,
      });

  const cellFor = (rider) => ({
    effort: intentionFor({ matrix: draftMatrix, stageNumber: activeStage, riderId: rider.rider_id }),
    open: openRiderId === rider.rider_id && !rider.abandoned,
  });

  return (
    <section data-testid="race-intention-panel" className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
      <div className="px-4 py-3 border-b border-cz-border">
        <h2 className="font-semibold text-cz-1 text-sm">{t("intention.title")}</h2>
        <p className="text-cz-3 text-xs mt-0.5">{t(isOneDay ? "intention.helpRaceDay" : "intention.help")}</p>
      </div>

      {/* Etape-vælger: fladens egen toolbar inde i hairline-rammen. Kørte etaper
          bærer en lås og kan ikke åbnes. Endagsløb har ingen vælger — kun ét
          "Løbsdag"-mærke, så kolonnen stadig har et navn. */}
      <div className="px-4 py-2 border-b border-cz-border bg-cz-subtle flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="inline-flex rounded-cz border border-cz-border bg-cz-card overflow-x-auto max-w-full self-start">
          {isOneDay ? (
            <span className="px-3 py-1 text-xs font-semibold text-cz-accent-t bg-cz-accent/10 whitespace-nowrap">
              {t("intention.raceDay")}
            </span>
          ) : (
            stageNumbers.map((sn) => {
              const locked = sn <= stagesCompleted;
              const on = sn === activeStage;
              const isToday = stagesCompleted > 0 && sn === stagesCompleted + 1;
              return (
                <button
                  key={sn}
                  type="button"
                  disabled={locked || saving}
                  aria-pressed={on}
                  // Eksplicit navn: etape-striben oeverst paa loebssiden har
                  // ALLEREDE knapper der hedder "Etape 1". To kontroller med
                  // samme navn paa samme side er tvetydigt for baade skaerm-
                  // laesere og tests (e2e-strict-mode-brud, maalt 6/9).
                  aria-label={t(isToday ? "intention.stageTodayAria" : "intention.stageAria", { number: sn })}
                  onClick={() => openStage(sn)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs whitespace-nowrap border-s border-cz-border first:border-s-0 transition-colors disabled:cursor-not-allowed ${
                    on
                      ? "bg-cz-accent/10 text-cz-accent-t font-semibold"
                      : locked
                        ? "text-cz-3"
                        : "text-cz-2 hover:text-cz-1"
                  }`}
                >
                  {locked && <LockIcon size={11} aria-hidden="true" />}
                  {isToday
                    ? t("intention.stageToday", { number: sn })
                    : t("intention.stage", { number: sn })}
                </button>
              );
            })
          )}
        </div>
        <p className="text-xs text-cz-2">{toolbarNote}</p>
      </div>

      {/* Desktop: tabel. Under sm: stablede kort (samme indhold, ingen vandret
          scroll — siden må aldrig overflowe på mobil, #1834). */}
      <div className="hidden sm:block overflow-x-auto">
        <table data-sort-exempt="Intentions-listen foelger holdets udtagelses-raekkefoelge, ikke en sorterbar kolonne" className="w-full text-sm">
          <thead>
            <tr className="border-b border-cz-border">
              <th className="px-4 py-2 text-left font-medium text-xs uppercase tracking-wide text-cz-3">{t("intention.colRider")}</th>
              <th className="px-4 py-2 text-left font-medium text-xs uppercase tracking-wide text-cz-3">{t("intention.colRole")}</th>
              <th className="px-4 py-2 text-left font-medium text-xs uppercase tracking-wide text-cz-3">{columnLabel}</th>
            </tr>
          </thead>
          <tbody>
            {riders.map((rider) => {
              const { effort, open } = cellFor(rider);
              const row = (
                <tr key={rider.rider_id} className={`border-b border-cz-border ${open ? "" : "last:border-0"}`}>
                  <td className="px-4 py-2.5 align-top text-cz-1 font-medium">{rider.name || "—"}</td>
                  <td className="px-4 py-2.5 align-top">
                    <div className="text-cz-1 text-xs">{t(roleLabelKey(baseRoleForRider(rider)))}</div>
                    <div className="text-3xs uppercase tracking-wider text-cz-3 mt-0.5">{roleScope}</div>
                  </td>
                  <td className="px-4 py-2.5 align-top">
                    <IntentionCell
                      t={t}
                      rider={rider}
                      effort={effort}
                      open={open}
                      disabled={saving}
                      onToggle={() => setOpenRiderId(open ? null : rider.rider_id)}
                    />
                  </td>
                </tr>
              );
              // Vaelgeren aabner som sin EGEN raekke i fuld bredde (mockup'ens
              // pickbox), ikke inde i den smalle intentions-kolonne: saetningen
              // pr. trin er det vigtigste paa fladen og skal kunne staa paa én
              // linje ved siden af sit trin-navn.
              const pickerRow = open ? (
                <tr key={`${rider.rider_id}-picker`} className="border-b border-cz-border last:border-0 bg-cz-subtle">
                  <td colSpan={3} className="px-4 pb-3.5 pt-0">
                    <IntentionPicker
                      t={t}
                      rider={rider}
                      scopeLabel={scopeLabel}
                      steps={steps}
                      value={effort}
                      disabled={saving}
                      onPick={(step) => pickIntention(rider.rider_id, step)}
                    />
                  </td>
                </tr>
              ) : null;
              return [row, pickerRow];
            })}
          </tbody>
        </table>
      </div>

      <ul className="sm:hidden divide-y divide-cz-border">
        {riders.map((rider) => {
          const { effort, open } = cellFor(rider);
          return (
            <li key={rider.rider_id} className="px-4 py-3">
              <div className="text-cz-1 font-medium text-sm">{rider.name || "—"}</div>
              <div className="mt-0.5 flex items-baseline gap-2 flex-wrap">
                <span className="text-xs text-cz-1">{t(roleLabelKey(baseRoleForRider(rider)))}</span>
                <span className="text-3xs uppercase tracking-wider text-cz-3">{roleScope}</span>
              </div>
              <div className="mt-2">
                <IntentionCell
                  t={t}
                  rider={rider}
                  effort={effort}
                  open={open}
                  disabled={saving}
                  onToggle={() => setOpenRiderId(open ? null : rider.rider_id)}
                />
              </div>
              {open && (
                <div className="mt-2.5">
                  <IntentionPicker
                    t={t}
                    rider={rider}
                    scopeLabel={scopeLabel}
                    steps={steps}
                    value={effort}
                    disabled={saving}
                    onPick={(step) => pickIntention(rider.rider_id, step)}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="px-4 py-3 border-t border-cz-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-xs text-cz-3 tabular-nums">
            {untouchedLine ? `${footerLine} · ${untouchedLine}` : footerLine}
          </p>
          {status === "error" && errorKey && (
            <p className="text-xs text-cz-danger">
              {t([`intention.errors.${errorKey}`, "intention.errors.generic"])}
            </p>
          )}
          {status === "saved" && <p className="text-xs text-cz-success">{t("intention.saved")}</p>}
          {status === "idle" && dirty && <p className="text-xs text-cz-2">{t("intention.unsaved")}</p>}
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          {nextStage != null && (
            <Button variant="secondary" size="sm" disabled={saving} onClick={copyToNextStage}>
              {t("intention.copyToStage", { number: nextStage })}
            </Button>
          )}
          <Button variant="primary" size="sm" disabled={!dirty || saving} onClick={save}>
            {saving
              ? t("intention.saving")
              : isOneDay
                ? t("intention.saveRaceDay")
                : t("intention.save", { number: activeStage })}
          </Button>
        </div>
      </div>
    </section>
  );
}
