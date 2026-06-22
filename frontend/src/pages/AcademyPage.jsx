// AcademyPage — Akademi-MVP (#1308).
//
// To sektioner:
//   • Intake — kandidater med potentiale-estimat + sign/reject-knapper.
//   • Roster — signerede akademi-ryttere med kontrakt-info.
// Flag-gated: siden er kun tilgængelig via nav når enabled=true (se Layout.jsx).
// Hvis nogen alligevel navigerer hertil med flag slukket, vises en graceful
// "coming soon"-state.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAcademy } from "../lib/useAcademy.js";
import { Flag } from "../components/Flag.jsx";
import PotentialeStars from "../components/PotentialeStars.jsx";
import RiderLink from "../components/RiderLink.jsx";
import { AcademySignConfirmModal } from "../components/AcademySignConfirmModal.jsx";
import { getRiderMarketValue } from "../lib/marketValues.js";
import { formatNumber } from "../lib/intl.js";

function calcAge(birthdate) {
  if (!birthdate) return null;
  const birth = new Date(birthdate);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function formatSalary(salary) {
  if (salary == null) return "–";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(salary);
}

function daysUntil(deadline) {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

export default function AcademyPage() {
  const { t } = useTranslation("academy");
  const { enabled, slots, roster, intake, freeAgents, graduations, balance, loading, signCandidate, rejectCandidate, signFreeAgent, resolveGraduate } = useAcademy();

  // Per-kandidat in-flight state + fejlbeskeder.
  const [actionState, setActionState] = useState({}); // { [riderId]: "signing"|"rejecting"|null }
  const [actionErrors, setActionErrors] = useState({}); // { [riderId]: string | null }

  // Bekræftelses-modal for free-agent-køb (#1744): koster penge, så kræv eksplicit
  // bekræftelse med pris + saldo-effekt. { riderId, riderName, price } | null.
  const [signConfirm, setSignConfirm] = useState(null);

  const isFull = slots.used >= slots.max;

  async function handleSign(riderId) {
    setActionState(prev => ({ ...prev, [riderId]: "signing" }));
    setActionErrors(prev => ({ ...prev, [riderId]: null }));
    const result = await signCandidate(riderId);
    if (!result.ok) {
      const msg = result.error === "academy_full"
        ? t("error.academyFull")
        : result.error === "not_offered"
          ? t("error.notOffered")
          : t("error.generic");
      setActionErrors(prev => ({ ...prev, [riderId]: msg }));
    }
    setActionState(prev => ({ ...prev, [riderId]: null }));
  }

  async function handleReject(riderId) {
    setActionState(prev => ({ ...prev, [riderId]: "rejecting" }));
    setActionErrors(prev => ({ ...prev, [riderId]: null }));
    const result = await rejectCandidate(riderId);
    if (!result.ok) {
      setActionErrors(prev => ({ ...prev, [riderId]: t("error.generic") }));
    }
    setActionState(prev => ({ ...prev, [riderId]: null }));
  }

  async function handleGraduate(riderId, action) {
    setActionState(prev => ({ ...prev, [riderId]: action }));
    setActionErrors(prev => ({ ...prev, [riderId]: null }));
    const result = await resolveGraduate(riderId, action);
    if (!result.ok) {
      const msg = result.error === "squad_cap_violation"
        ? t("error.squadFull")
        : t("error.generic");
      setActionErrors(prev => ({ ...prev, [riderId]: msg }));
    }
    setActionState(prev => ({ ...prev, [riderId]: null }));
  }

  // Åbn bekræftelses-modal — selve købet sker først i confirmSignFreeAgent (#1744).
  function handleSignFreeAgent(rider) {
    setActionErrors(prev => ({ ...prev, [rider.id]: null }));
    setSignConfirm({
      riderId: rider.id,
      riderName: `${rider.firstname} ${rider.lastname}`.trim(),
      // Optagelsen koster den viste markedsværdi (backend trækker calculateRiderMarketValue,
      // = market_value; spejlet client-side via getRiderMarketValue). Refs #1713.
      price: getRiderMarketValue(rider),
    });
  }

  async function confirmSignFreeAgent() {
    if (!signConfirm) return;
    const riderId = signConfirm.riderId;
    setActionState(prev => ({ ...prev, [riderId]: "signing" }));
    setActionErrors(prev => ({ ...prev, [riderId]: null }));
    const result = await signFreeAgent(riderId);
    if (result.ok) {
      setSignConfirm(null);
    } else {
      const msg = result.error === "academy_full"
        ? t("error.academyFull")
        : result.error === "insufficient_balance"
          ? t("error.insufficientBalance")
          : result.error === "not_academy_age"
            ? t("error.notAcademyAge")
            : result.error === "not_free_agent"
              ? t("error.notFreeAgent")
              : t("error.generic");
      setActionErrors(prev => ({ ...prev, [riderId]: msg }));
      setSignConfirm(null);
    }
    setActionState(prev => ({ ...prev, [riderId]: null }));
  }

  // Loading
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-7 h-7 border-2 border-cz-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Flag slukket
  if (!enabled) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-cz-1">{t("title")}</h1>
        <div className="bg-cz-card border border-cz-border rounded-cz px-6 py-10 text-center">
          <p className="text-cz-2 text-sm">{t("disabledNote")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header med saldo + slot-tæller */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-cz-1">{t("title")}</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {balance != null && (
            <span className="text-sm font-mono text-cz-2">
              {t("balance", { amount: formatNumber(balance) })}
            </span>
          )}
          <span className="text-sm font-mono text-cz-2">
            {t("slots", { used: slots.used, max: slots.max })}
          </span>
        </div>
      </div>

      {/* GRADUERINGS-sektion (#932) — akademiryttere der har passeret 21 og skal
          promoveres/sælges/slippes inden override-vinduets udløb. Vises kun når der
          er pending graduates (call-to-action, ikke permanent tom-tilstand). */}
      {graduations.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-cz-3 uppercase tracking-wide mb-3">{t("graduationHeading")}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {graduations.map((g) => {
              const busy = actionState[g.riderId] != null;
              const err = actionErrors[g.riderId];
              const days = daysUntil(g.deadline);
              return (
                <div key={g.riderId} className="bg-cz-card border border-cz-border rounded-cz p-4 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-sm leading-snug">
                        <RiderLink id={g.riderId} className="text-cz-1 hover:text-cz-accent-t transition-colors">{g.name}</RiderLink>
                      </p>
                      {g.age != null && (
                        <span className="text-xs text-cz-3">{t("ageLabel", { age: g.age })}</span>
                      )}
                    </div>
                    {days != null && (
                      <span className="flex-shrink-0 text-[10px] px-2 py-0.5 rounded-full bg-cz-warning/10 text-cz-warning border border-cz-warning/30 font-medium">
                        {t("graduationDeadline", { days })}
                      </span>
                    )}
                  </div>

                  {err && <p className="text-xs text-cz-danger">{err}</p>}

                  <div className="flex gap-2 mt-auto pt-1">
                    <button
                      type="button"
                      onClick={() => handleGraduate(g.riderId, "promote")}
                      disabled={busy}
                      className="flex-1 px-2.5 py-1.5 rounded-lg bg-cz-accent text-white text-xs font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                    >
                      {actionState[g.riderId] === "promote" ? t("loading") : t("promoteBtn")}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleGraduate(g.riderId, "sell")}
                      disabled={busy}
                      className="flex-1 px-2.5 py-1.5 rounded-lg border border-cz-border text-cz-2 text-xs font-medium hover:bg-cz-subtle disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {actionState[g.riderId] === "sell" ? t("loading") : t("sellBtn")}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleGraduate(g.riderId, "release")}
                      disabled={busy}
                      className="flex-1 px-2.5 py-1.5 rounded-lg border border-cz-border text-cz-3 text-xs font-medium hover:bg-cz-subtle hover:text-cz-danger disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {actionState[g.riderId] === "release" ? t("loading") : t("releaseBtn")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* INTAKE-sektion */}
      <section>
        <h2 className="text-sm font-semibold text-cz-3 uppercase tracking-wide mb-3">{t("intakeHeading")}</h2>

        {intake.length === 0 ? (
          <div className="bg-cz-card border border-cz-border rounded-cz px-6 py-10 text-center">
            <p className="text-cz-3 text-sm">{t("emptyIntake")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {intake.map((item) => {
              const rider = item.rider;
              const age = calcAge(rider.birthdate);
              const busy = actionState[rider.id] != null;
              const err = actionErrors[rider.id];
              const potential = item.potentialEstimate;

              return (
                <div
                  key={item.intakeId}
                  className="bg-cz-card border border-cz-border rounded-cz p-4 flex flex-col gap-3"
                >
                  {/* Navn + nationalitet */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-sm leading-snug">
                        <RiderLink id={rider.id} className="text-cz-1 hover:text-cz-accent-t transition-colors">
                          {rider.firstname} {rider.lastname}
                        </RiderLink>
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {rider.nationality_code && (
                          <Flag code={rider.nationality_code} className="text-sm" />
                        )}
                        {age != null && (
                          <span className="text-xs text-cz-3">{t("ageLabel", { age })}</span>
                        )}
                      </div>
                    </div>
                    {item.is_serious && (
                      <span className="flex-shrink-0 text-[10px] px-2 py-0.5 rounded-full bg-cz-accent/10 text-cz-accent border border-cz-accent/30 font-medium">
                        {t("seriousBadge")}
                      </span>
                    )}
                  </div>

                  {/* Potentiale-stjerner */}
                  {potential && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-cz-3">{t("potential")}</span>
                      <PotentialeStars
                        range={potential.exact
                          ? null
                          : { lo: potential.lo, hi: potential.hi }}
                        value={potential.exact ? potential.lo : null}
                        birthdate={rider.birthdate}
                      />
                    </div>
                  )}

                  {/* Fejlbesked */}
                  {err && (
                    <p className="text-xs text-cz-danger">{err}</p>
                  )}

                  {/* Handlingsknapper */}
                  <div className="flex gap-2 mt-auto pt-1">
                    <button
                      type="button"
                      onClick={() => handleSign(rider.id)}
                      disabled={busy || isFull}
                      title={isFull ? t("fullTooltip") : undefined}
                      className="flex-1 px-3 py-1.5 rounded-lg bg-cz-accent text-white text-xs font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                    >
                      {actionState[rider.id] === "signing" ? t("loading") : t("signBtn")}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReject(rider.id)}
                      disabled={busy}
                      className="flex-1 px-3 py-1.5 rounded-lg border border-cz-border text-cz-2 text-xs font-medium hover:bg-cz-subtle disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {actionState[rider.id] === "rejecting" ? t("loading") : t("rejectBtn")}
                    </button>
                  </div>

                  {/* Akademi-fuld-besked under knapperne */}
                  {isFull && !err && (
                    <p className="text-[10px] text-cz-3 text-center">{t("fullNote")}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ROSTER-sektion */}
      <section>
        <h2 className="text-sm font-semibold text-cz-3 uppercase tracking-wide mb-3">{t("rosterHeading")}</h2>

        {roster.length === 0 ? (
          <div className="bg-cz-card border border-cz-border rounded-cz px-6 py-8 text-center">
            <p className="text-cz-3 text-sm">{t("emptyRoster")}</p>
          </div>
        ) : (
          <div className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-cz-border">
                    <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">{t("colRider")}</th>
                    <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">{t("colAge")}</th>
                    <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">{t("colSalary")}</th>
                    <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">{t("colContract")}</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.map((rider) => {
                    const age = calcAge(rider.birthdate);
                    return (
                      <tr key={rider.id} className="border-b border-cz-border last:border-0 hover:bg-cz-subtle">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {rider.nationality_code && (
                              <Flag code={rider.nationality_code} className="text-sm" />
                            )}
                            <RiderLink id={rider.id} className="text-cz-1 font-medium hover:text-cz-accent-t transition-colors">
                              {rider.firstname} {rider.lastname}
                            </RiderLink>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-cz-2">
                          {age != null ? age : "–"}
                        </td>
                        <td className="px-4 py-3 font-mono text-cz-2">
                          {formatSalary(rider.salary)} CZ$
                        </td>
                        <td className="px-4 py-3 text-cz-2">
                          {rider.contract_end_season != null
                            ? t("contractUntil", { season: rider.contract_end_season })
                            : "–"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* FREE-AGENT-sektion (#1308 Fase B) — usolgte ungdomsryttere fra ungdomsauktioner. */}
      <section>
        <h2 className="text-sm font-semibold text-cz-3 uppercase tracking-wide mb-3">{t("freeAgentsHeading")}</h2>

        {freeAgents.length === 0 ? (
          <div className="bg-cz-card border border-cz-border rounded-cz px-6 py-8 text-center">
            <p className="text-cz-3 text-sm">{t("emptyFreeAgents")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {freeAgents.map((rider) => {
              const age = calcAge(rider.birthdate);
              const busy = actionState[rider.id] != null;
              const err = actionErrors[rider.id];
              return (
                <div key={rider.id} className="bg-cz-card border border-cz-border rounded-cz p-4 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-sm leading-snug">
                        <RiderLink id={rider.id} className="text-cz-1 hover:text-cz-accent-t transition-colors">
                          {rider.firstname} {rider.lastname}
                        </RiderLink>
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {rider.nationality_code && (
                          <Flag code={rider.nationality_code} className="text-sm" />
                        )}
                        {age != null && (
                          <span className="text-xs text-cz-3">{t("ageLabel", { age })}</span>
                        )}
                      </div>
                    </div>
                    <span className="flex-shrink-0 text-xs font-mono text-cz-2">
                      {formatSalary(rider.market_value)} CZ$
                    </span>
                  </div>

                  {err && <p className="text-xs text-cz-danger">{err}</p>}

                  <button
                    type="button"
                    onClick={() => handleSignFreeAgent(rider)}
                    disabled={busy || isFull}
                    title={isFull ? t("fullTooltip") : undefined}
                    className="mt-auto px-3 py-1.5 rounded-lg bg-cz-accent text-white text-xs font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                  >
                    {actionState[rider.id] === "signing"
                      ? t("loading")
                      : t("signFreeAgentBtnPriced", { price: formatNumber(getRiderMarketValue(rider)) })}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Bekræftelses-modal for free-agent-køb (#1744) — pris + saldo-effekt. */}
      <AcademySignConfirmModal
        show={!!signConfirm}
        riderName={signConfirm?.riderName}
        price={signConfirm?.price}
        balance={balance}
        busy={signConfirm ? actionState[signConfirm.riderId] === "signing" : false}
        onCancel={() => {
          if (signConfirm && actionState[signConfirm.riderId] === "signing") return;
          setSignConfirm(null);
        }}
        onConfirm={confirmSignFreeAgent}
      />
    </div>
  );
}
