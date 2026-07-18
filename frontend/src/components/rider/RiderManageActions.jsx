// #2007 (EPIC #2000, Slice 3): egen-rytter-handlinger på selve rytter-profilen.
//
// Samler de handlinger der hidtil KUN levede i holdsidens RiderActionModal:
//   • Senior-rytter:  forlæng kontrakt (#1720) · flyt til akademi/demote (#932,
//     kun U23) · fyr/release (#1719, destruktiv).
//   • Akademi-rytter: promovér til senior-truppen (#932).
//
// Auktion + transferliste + bud på andres ryttere bor allerede inline på
// RiderStatsPage og dubleres IKKE her. Komponenten mountes kun for egne,
// ikke-pending, ikke-pensionerede ryttere (forælderen gater).
//
// Akademi-delen ligger i en egen sub-komponent (RiderAcademyActions) der KUN
// mountes når en akademi-handling faktisk kan være relevant (akademi-rytter eller
// U23-senior) — så useAcademy (/api/academy/me) ikke hentes på enhver senior-profil.
//
// Æstetik (design-SSOT docs/design/rider-page): editorial cz-tokens, ingen slop
// (ingen glow/gradient/emoji), forlæng/fyr som inline udvidelses-paneler (samme
// mønster som TransferListButton), akademi op/ned via den konsekvens-bevidste
// AcademyTransferConfirmModal. Player-facing copy: EN først, DA under.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber } from "../../lib/intl.js";
import { resolveApiError } from "../../lib/apiError.js";
import { isU23 } from "../../lib/riderAge.js";
import { projectSeniorSalary, projectYouthSalary } from "../../lib/marketValues.js";
import { fetchRiderQuote, postRiderContractAction } from "../../lib/riderContractActions.js";
import { useAcademy } from "../../lib/useAcademy.js";
import { AcademyTransferConfirmModal } from "../AcademyTransferConfirmModal.jsx";
import { supabase } from "../../lib/supabase.js";
import { buttonClass } from "../ui/buttonStyles.js";

// Trigger-knapper (ejer-feedback 3/7): appens delte buttonStyles, kompakt
// auto-bredde — komponenten renderes med display:contents så knapperne indgår
// direkte i hero'ens horisontale handlingsrække. Udvidede paneler/feedback
// lægger sig i fuld bredde UNDER hele rækken (order-2, spejler RiderStatsPage's
// ACTION_PANEL) — den tintede/ring-markerede trigger viser tilhørsforholdet.
const ACTION_PANEL = "order-2 w-full";
// Bekræft-knap inde i udfoldede paneler (fuld bredde i panelet).
const BTN_PRIMARY = "w-full min-h-[44px] py-2 rounded-lg text-sm font-bold transition-all bg-cz-accent text-cz-on-accent hover:brightness-110 disabled:opacity-50";

// Akademi returnerer rå fejl-koder i `error` (ikke { errorCode }) — pak dem så
// resolveApiError kan oversætte via errors:api.<code>.
function academyError(code, t, fallback) {
  return resolveApiError({ errorCode: code }, t, fallback);
}

// Akademi op/ned. Egen sub-komponent så useAcademy (/api/academy/me) kun hentes
// når relevant. Kalder onResult(ok, msg) for den delte feedback-boks i forælderen.
function RiderAcademyActions({ rider, isAcademyRider, canDemote, onResult, onChanged }) {
  const { t } = useTranslation("rider");
  const academy = useAcademy();
  // { direction, newSalary, currentSalary, capLabel, capAfterLabel, racesCleared } | null
  const [academyModal, setAcademyModal] = useState(null);
  const [academyBusy, setAcademyBusy] = useState(false);
  const riderName = `${rider.firstname} ${rider.lastname}`;

  function openPromote() {
    setAcademyModal({
      direction: "promote",
      newSalary: projectSeniorSalary(rider, { division: academy.division }),
      currentSalary: null,
      capLabel: `${academy.seniorCount} / ${academy.seniorMax}`,
      capAfterLabel: `${academy.seniorCount + 1} / ${academy.seniorMax}`,
      racesCleared: null,
    });
  }

  async function openDemote() {
    // Tæl fremtidige løb der ryddes (scheduled + stages_completed=0) — spejler
    // TeamPage.handleDemote — så modalen kan vise konsekvensen før bekræftelse.
    let racesCleared = 0;
    try {
      const { data } = await supabase
        .from("race_entries")
        .select("race_id, races!inner(status, stages_completed)")
        .eq("rider_id", rider.id)
        .eq("races.status", "scheduled")
        .eq("races.stages_completed", 0);
      racesCleared = (data || []).length;
    } catch { /* count er nice-to-have; vis dialogen uanset */ }
    const used = academy.slots?.used ?? 0;
    const max = academy.slots?.max ?? 8;
    setAcademyModal({
      direction: "demote",
      newSalary: projectYouthSalary(rider, { division: academy.division }),
      currentSalary: rider.salary ?? null,
      capLabel: `${used} / ${max}`,
      capAfterLabel: `${used + 1} / ${max}`,
      racesCleared,
    });
  }

  async function confirmAcademy() {
    if (!academyModal) return;
    setAcademyBusy(true);
    const isPromote = academyModal.direction === "promote";
    const res = isPromote ? await academy.promoteRider(rider.id) : await academy.demoteRider(rider.id);
    setAcademyBusy(false);
    setAcademyModal(null);
    if (res.ok) {
      onResult(true, t(isPromote ? "manage.promote.success" : "manage.demote.success"));
      onChanged?.();
    } else {
      const prefix = t(isPromote ? "manage.promote.errorPrefix" : "manage.demote.errorPrefix");
      onResult(false, `${prefix} ${academyError(res.error, t, t("blocked.errorFallback"))}`);
    }
  }

  // Akademiet slået fra (flag) → ingen op/ned-handlinger at vise.
  if (!academy.enabled) return null;

  return (
    <>
      {isAcademyRider && (
        <button type="button" onClick={openPromote} className={buttonClass({ variant: "primary" })}>
          {t("manage.promote.button")}
        </button>
      )}
      {!isAcademyRider && canDemote && (
        <button type="button" onClick={openDemote} className={buttonClass({ variant: "secondary" })}>
          {t("manage.demote.button")}
        </button>
      )}
      <AcademyTransferConfirmModal
        show={Boolean(academyModal)}
        direction={academyModal?.direction}
        riderName={riderName}
        newSalary={academyModal?.newSalary}
        currentSalary={academyModal?.currentSalary}
        capLabel={academyModal?.capLabel}
        capAfterLabel={academyModal?.capAfterLabel}
        racesCleared={academyModal?.racesCleared}
        busy={academyBusy}
        onCancel={() => { if (!academyBusy) setAcademyModal(null); }}
        onConfirm={confirmAcademy}
      />
    </>
  );
}

export default function RiderManageActions({ rider, onChanged, marketActions = null }) {
  const { t } = useTranslation("rider");

  const isAcademyRider = Boolean(rider.is_academy);
  const canDemote = !isAcademyRider && isU23(rider.birthdate);

  // Inline udvidelses-paneler (forlæng/fyr).
  const [extendOpen, setExtendOpen] = useState(false);
  const [extendQuote, setExtendQuote] = useState(null);
  const [extendErr, setExtendErr] = useState(null);
  const [extendBusy, setExtendBusy] = useState(false);

  const [releaseOpen, setReleaseOpen] = useState(false);
  const [releaseQuote, setReleaseQuote] = useState(null);
  const [releaseErr, setReleaseErr] = useState(null);
  const [releaseBusy, setReleaseBusy] = useState(false);

  const [result, setResult] = useState(null);
  function flashResult(ok, msg) {
    setResult({ ok, msg });
    setTimeout(() => setResult(null), 4000);
  }

  // ── Forlæng kontrakt (#1720) ────────────────────────────────────────────────
  async function openExtend() {
    const next = !extendOpen;
    setExtendOpen(next);
    if (next) setReleaseOpen(false);
    if (next && extendQuote === null && extendErr === null) {
      try {
        const { ok, data } = await fetchRiderQuote(rider.id, "extend-quote");
        if (ok) setExtendQuote(data);
        else setExtendErr(resolveApiError(data, t, t("auth:error.connectionFailed")));
      } catch { setExtendErr(t("auth:error.connectionFailed")); }
    }
  }

  async function confirmExtend() {
    setExtendBusy(true);
    try {
      const { ok, data } = await postRiderContractAction(rider.id, "extend-contract");
      if (ok) {
        setExtendOpen(false);
        flashResult(true, t("manage.extend.success"));
        onChanged?.();
      } else {
        flashResult(false, `${t("manage.extend.errorPrefix")} ${resolveApiError(data, t)}`);
      }
    } catch { flashResult(false, t("auth:error.connectionFailed")); }
    finally { setExtendBusy(false); }
  }

  // ── Fyr/release (#1719) ─────────────────────────────────────────────────────
  async function openRelease() {
    const next = !releaseOpen;
    setReleaseOpen(next);
    if (next) setExtendOpen(false);
    if (next && releaseQuote === null && releaseErr === null) {
      try {
        const { ok, data } = await fetchRiderQuote(rider.id, "release-quote");
        if (ok) setReleaseQuote(data);
        else setReleaseErr(resolveApiError(data, t, t("auth:error.connectionFailed")));
      } catch { setReleaseErr(t("auth:error.connectionFailed")); }
    }
  }

  async function confirmReleaseAction() {
    setReleaseBusy(true);
    try {
      const { ok, data } = await postRiderContractAction(rider.id, "release");
      if (ok) {
        setReleaseOpen(false);
        flashResult(true, t("manage.release.success"));
        onChanged?.();
      } else {
        flashResult(false, `${t("manage.release.errorPrefix")} ${resolveApiError(data, t)}`);
      }
    } catch { flashResult(false, t("auth:error.connectionFailed")); }
    finally { setReleaseBusy(false); }
  }

  return (
    /* display:contents — knapperne bliver direkte flex-items i hero'ens
       handlingsrække; paneler/feedback tager selv fuld bredde. */
    <div className="contents">
      {result && (
        <div className={`${ACTION_PANEL} px-3 py-2 rounded-lg text-sm border
          ${result.ok ? "bg-cz-success-bg text-cz-success border-cz-success/30" : "bg-cz-danger-bg text-cz-danger border-cz-danger/30"}`}>
          {result.msg}
        </div>
      )}

      {isAcademyRider ? (
        /* Akademi-rytter: promovér (egen flow) + evt. markeds-handlinger fra parent. */
        <>
          <RiderAcademyActions rider={rider} isAcademyRider onResult={flashResult} onChanged={onChanged} />
          {marketActions}
        </>
      ) : (
        /* Senior-rytter, prototypens rækkefølge: forlæng (guld) · flyt til akademi
           (kun U23) · markeds-handlinger (salg/auktion, injiceret) · fyr (destruktiv sidst). */
        <>
          {/* Forlæng kontrakt */}
          <div className="contents">
            <button type="button" onClick={openExtend}
              className={`${buttonClass({ variant: "primary" })} ${extendOpen ? "ring-1 ring-cz-accent/60" : ""}`}>
              {t("manage.extend.button")}
            </button>
            {extendOpen && (
              <div className={`${ACTION_PANEL} flex flex-col gap-2`}>
                <p className="text-cz-3 text-xs">{t("manage.extend.description")}</p>
                {extendErr ? (
                  <div className="rounded-cz border border-cz-danger/30 bg-cz-danger-bg px-3 py-2.5 text-cz-danger text-xs">{extendErr}</div>
                ) : (
                  <>
                    <div className="space-y-1.5 text-sm rounded-cz border border-cz-border bg-cz-subtle p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-cz-3 text-xs">{t("manage.extend.currentSalary")}</span>
                        <span className="text-cz-2 font-mono">{formatNumber(rider.salary || 0)} CZ$</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-cz-3 text-xs">{t("manage.extend.newSalary")}</span>
                        <span className="text-cz-1 font-mono font-bold">
                          {extendQuote ? `${formatNumber(extendQuote.newSalary)} CZ$` : "..."}
                        </span>
                      </div>
                      {extendQuote && (
                        <div className="flex items-center justify-between">
                          <span className="text-cz-3 text-xs">{t("manage.extend.newContract")}</span>
                          <span className="text-cz-2 font-mono">
                            {t("manage.extend.newContractValue", { season: extendQuote.contract_end_season })}
                          </span>
                        </div>
                      )}
                    </div>
                    <button onClick={confirmExtend} disabled={extendBusy || !extendQuote} className={BTN_PRIMARY}>
                      {extendBusy ? "..." : t("manage.extend.confirm")}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Flyt til akademi (kun U23 + akademi aktivt) — mountes kun ved canDemote. */}
          {canDemote && (
            <RiderAcademyActions rider={rider} isAcademyRider={false} canDemote onResult={flashResult} onChanged={onChanged} />
          )}

          {/* Markeds-handlinger (sæt til salg · start auktion) — injiceret af
              parent så den destruktive Frigiv står SIDST i rækken. */}
          {marketActions}

          {/* Fyr rytter (destruktiv) — udvid (viser gebyr som speed-bump) → bekræft/annullér. */}
          <div className="contents">
            <button type="button" onClick={openRelease}
              className={`${buttonClass({ variant: "danger" })} ${releaseOpen ? "ring-1 ring-cz-danger/40" : ""}`}>
              {t("manage.release.button")}
            </button>
            {releaseOpen && (
              <div className={`${ACTION_PANEL} flex flex-col gap-2`}>
                {releaseErr ? (
                  <div className="rounded-cz border border-cz-danger/30 bg-cz-danger-bg px-3 py-2.5 text-cz-danger text-xs">{releaseErr}</div>
                ) : (
                  <>
                    <p className="text-cz-3 text-xs">{t("manage.release.description")}</p>
                    <div className="space-y-1.5 text-sm rounded-cz border border-cz-border bg-cz-subtle p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-cz-3 text-xs">{t("manage.release.fee")}</span>
                        <span className="text-cz-danger font-mono font-bold">
                          {releaseQuote ? `${formatNumber(releaseQuote.fee)} CZ$` : "..."}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-cz-3 text-xs">{t("manage.release.balance")}</span>
                        <span className="text-cz-2 font-mono">
                          {releaseQuote ? `${formatNumber(releaseQuote.balance)} CZ$` : "..."}
                        </span>
                      </div>
                    </div>
                    <p className="text-cz-3 text-xs">
                      {releaseQuote && releaseQuote.fee === 0 ? t("manage.release.freeHint") : t("manage.release.feeHint")}
                    </p>
                    {releaseQuote && releaseQuote.affordable === false && (
                      <p className="text-cz-danger text-xs">{t("manage.release.cannotAfford")}</p>
                    )}
                    <div className="flex gap-2">
                      <button onClick={confirmReleaseAction}
                        disabled={releaseBusy || !releaseQuote || releaseQuote.affordable === false}
                        className="flex-1 min-h-[44px] py-2 bg-cz-danger text-white font-bold rounded-lg text-sm hover:brightness-110 disabled:opacity-50 transition-all">
                        {releaseBusy ? "..." : t("manage.release.confirm")}
                      </button>
                      <button onClick={() => setReleaseOpen(false)} disabled={releaseBusy}
                        className="flex-1 min-h-[44px] py-2 bg-cz-card text-cz-2 border border-cz-border rounded-lg text-sm hover:text-cz-1 disabled:opacity-50 transition-all">
                        {t("manage.release.cancel")}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
