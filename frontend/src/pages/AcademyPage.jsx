// AcademyPage — Akademi (#1308, UX-rework #2796).
//
// Fire sektioner:
//   • Graduering — akademiryttere der er vokset ud og skal promoveres/sælges/slippes.
//   • Intake — kandidater med potentiale-estimat, signeringspris og udløbsfrist.
//   • Roster — signerede akademi-ryttere i en sorterbar tabel.
//   • Regnskab — AcademyPnl.
//
// #2796 (Discord 22/7, @knud_r_flink: "akademi siden trænger til lidt kærlighed"):
// siden var den eneste rytter-flade der stod uden for design-systemet — hånd-
// rullet tabel uden sortering, ingen ryttertype, ingen markedsværdi, og både
// intake- og gradueringskort bad om irreversible valg uden at vise pris eller
// frist. Den bruger nu de samme primitiver som auktions-/rytter-/holdsiden
// (Table/Tr/Th/Td + useTableSort, NationCell, RiderTypeBadge, RiderBadges,
// Card, Button, EmptyState, PageLoader), så akademiet ser ud og opfører sig som
// resten af appen.
//
// Flag-gated: siden er kun tilgængelig via nav når enabled=true (se Layout.jsx).
// Hvis nogen alligevel navigerer hertil med flag slukket, vises en graceful
// "coming soon"-state — men KUN når flaget faktisk er slukket, ikke ved en
// backend-fejl (#2796: en 500'er viste før "Akademiet kommer snart").

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAcademy } from "../lib/useAcademy.js";
import PotentialeStars from "../components/PotentialeStars.jsx";
import ScoutablePotentiale from "../components/rider/ScoutablePotentiale.jsx";
import { useScouting } from "../lib/useScouting.js";
import RiderLink from "../components/RiderLink.jsx";
import NationCell from "../components/rider/NationCell.jsx";
import RiderTypeBadge from "../components/rider/RiderTypeBadge.jsx";
import RiderBadges from "../components/rider/RiderBadges.jsx";
import { AcademyTransferConfirmModal } from "../components/AcademyTransferConfirmModal.jsx";
import AcademyPnl from "../components/AcademyPnl.jsx";
import { Card, Button, EmptyState, PageLoader, ErrorState, Table, Tr, Th, Td } from "../components/ui";
import { projectSeniorSalary, getRiderMarketValue } from "../lib/marketValues.js";
import { formatNumber } from "../lib/intl.js";
import { getRiderAge } from "../lib/riderAge.js";
import { useTableSort } from "../lib/useTableSort.js";
import { scoutSortValue } from "../lib/scouting.js";

// #2796: var hardkodet Intl.NumberFormat("en-US") midt på en side der ellers
// bruger den locale-bevidste formatNumber — en dansk bruger så "45,000 CZ$" i
// løn-kolonnen og "45.000 CZ$" i headeren på samme skærm.
function formatMoney(n) {
  if (n == null) return "–";
  return formatNumber(Math.round(Number(n)), { maximumFractionDigits: 0 });
}

function daysUntil(deadline) {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

// Sorterings-accessors for roster-tabellen. Modul-konstant, så useTableSort ikke
// re-sorterer på hver render (ny objekt-reference ville invalidere memo'en).
const ROSTER_ACCESSORS = {
  nationality_code: (r) => r.nationality_code,
  name: (r) => `${r.lastname ?? ""} ${r.firstname ?? ""}`.trim(),
  primary_type: (r) => r.primary_type,
  age: (r) => getRiderAge(r.birthdate),
  potential: (r) => r._potMid,
  market_value: (r) => getRiderMarketValue(r),
  salary: (r) => (r.salary == null ? null : Number(r.salary)),
  contract_end_season: (r) => r.contract_end_season,
};
// Numeriske kolonner starter faldende ved første klik — "vis mig de dyreste"
// er det forventede første klik, ikke "vis mig de billigste".
const ROSTER_DESC_FIRST = new Set(["age", "potential", "market_value", "salary", "contract_end_season"]);

export default function AcademyPage() {
  const { t } = useTranslation("academy");
  const scouting = useScouting();
  const {
    enabled, slots, seniorCount, seniorMax, roster, intake, graduations, balance, division,
    loading, error, signCandidate, rejectCandidate, resolveGraduate, promoteRider,
  } = useAcademy();

  // Per-kandidat in-flight state + fejlbeskeder.
  const [actionState, setActionState] = useState({}); // { [riderId]: "signing"|"rejecting"|null }
  const [actionErrors, setActionErrors] = useState({}); // { [riderId]: string | null }

  // #932 S7: promote-bekræftelse (akademi → senior). Konsekvens-bevidst: viser
  // senior-cap-effekt + projiceret senior-løn. { riderId, riderName, newSalary } | null.
  const [promoteConfirm, setPromoteConfirm] = useState(null);

  const isFull = slots.used >= slots.max;
  // Senior-truppen er fuld → promote blokeres (en op-rykning ville sprænge cap'en).
  const seniorFull = seniorCount >= seniorMax;

  // #1162-mønstret fra holdsiden: dekorér med estimat-midtpunktet, så
  // potentiale-kolonnen kan sorteres uden det server-skjulte rå potentiale.
  const rosterRows = useMemo(
    () => roster.map((r) => ({ ...r, _potMid: scoutSortValue(scouting.estimateFor(r.id)) })),
    [roster, scouting],
  );
  const { rows: sortedRoster, sort, sortDir, handleSort } = useTableSort(
    rosterRows,
    ROSTER_ACCESSORS,
    { descFirstKeys: ROSTER_DESC_FIRST },
  );

  function mapActionError(err) {
    if (err === "academy_full") return t("error.academyFull");
    if (err === "not_offered") return t("error.notOffered");
    // #2796: begge faldt før igennem til den generiske besked (+ Sentry-500).
    if (err === "insufficient_balance") return t("error.insufficientBalance");
    if (err === "already_assigned") return t("error.alreadyAssigned");
    if (err === "squad_cap_violation") return t("error.squadFull");
    return t("error.generic");
  }

  async function handleSign(riderId) {
    setActionState(prev => ({ ...prev, [riderId]: "signing" }));
    setActionErrors(prev => ({ ...prev, [riderId]: null }));
    const result = await signCandidate(riderId);
    if (!result.ok) {
      setActionErrors(prev => ({ ...prev, [riderId]: mapActionError(result.error) }));
    }
    setActionState(prev => ({ ...prev, [riderId]: null }));
  }

  async function handleReject(riderId) {
    setActionState(prev => ({ ...prev, [riderId]: "rejecting" }));
    setActionErrors(prev => ({ ...prev, [riderId]: null }));
    const result = await rejectCandidate(riderId);
    if (!result.ok) {
      setActionErrors(prev => ({ ...prev, [riderId]: mapActionError(result.error) }));
    }
    setActionState(prev => ({ ...prev, [riderId]: null }));
  }

  async function handleGraduate(riderId, action) {
    setActionState(prev => ({ ...prev, [riderId]: action }));
    setActionErrors(prev => ({ ...prev, [riderId]: null }));
    const result = await resolveGraduate(riderId, action);
    if (!result.ok) {
      setActionErrors(prev => ({ ...prev, [riderId]: mapActionError(result.error) }));
    }
    setActionState(prev => ({ ...prev, [riderId]: null }));
  }

  // Åbn promote-bekræftelse (#932 S7) — selve op-rykningen sker i confirmPromote.
  function handlePromote(rider) {
    setActionErrors(prev => ({ ...prev, [rider.id]: null }));
    setPromoteConfirm({
      riderId: rider.id,
      riderName: `${rider.firstname} ${rider.lastname}`.trim(),
      // #2796: division manglede, så salaryFromProduction faldt tilbage på den
      // globale sats OG på base-fallbacken 1000 (current_production_value var
      // ikke i payloaden) → dialogen viste 161 CZ$ for ENHVER rytter.
      newSalary: projectSeniorSalary(rider, { division }),
    });
  }

  async function confirmPromote() {
    if (!promoteConfirm) return;
    const riderId = promoteConfirm.riderId;
    setActionState(prev => ({ ...prev, [riderId]: "promoting" }));
    setActionErrors(prev => ({ ...prev, [riderId]: null }));
    const result = await promoteRider(riderId);
    if (result.ok) {
      setPromoteConfirm(null);
    } else {
      setActionErrors(prev => ({ ...prev, [riderId]: mapActionError(result.error) }));
      setPromoteConfirm(null);
    }
    setActionState(prev => ({ ...prev, [riderId]: null }));
  }

  // Loading — PageLoader reserverer højde (#1794 CLS).
  if (loading) return <PageLoader label={t("title")} />;

  // #2796: en backend-fejl efterlod `enabled` false og ramte derfor "kommer
  // snart"-grenen nedenfor — spilleren fik at vide at featuren ikke fandtes.
  // Fejl vises nu som fejl; "kommer snart" er forbeholdt et slukket flag.
  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-[38px] leading-none uppercase tracking-wide text-cz-1">{t("title")}</h1>
        <ErrorState title={t("error.loadTitle")} description={t("error.loadBody")} />
      </div>
    );
  }

  // Flag slukket
  if (!enabled) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-[38px] leading-none uppercase tracking-wide text-cz-1">{t("title")}</h1>
        <EmptyState title={t("title")} description={t("disabledNote")} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header med saldo + slot-tæller */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[38px] leading-none uppercase tracking-wide text-cz-1">{t("title")}</h1>
          <p className="mt-1 text-sm text-cz-2">{t("subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {balance != null && (
            <span className="font-data text-sm tabular-nums text-cz-2">
              {t("balance", { amount: formatMoney(balance) })}
            </span>
          )}
          <span
            className={`font-data text-sm tabular-nums ${isFull ? "text-cz-warning" : "text-cz-2"}`}
            title={isFull ? t("fullTooltip", { max: slots.max }) : undefined}
          >
            {t("slots", { used: slots.used, max: slots.max })}
          </span>
        </div>
      </div>

      {/* GRADUERINGS-sektion (#932) — akademiryttere der har passeret 21 og skal
          promoveres/sælges/slippes inden override-vinduets udløb. Vises kun når der
          er pending graduates (call-to-action, ikke permanent tom-tilstand). */}
      {graduations.length > 0 && (
        <section>
          <h2 className="font-data text-[11px] font-semibold uppercase tracking-[.1em] text-cz-3 mb-3">{t("graduationHeading")}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {graduations.map((g) => {
              const busy = actionState[g.riderId] != null;
              const err = actionErrors[g.riderId];
              const days = daysUntil(g.deadline);
              const overdue = days != null && days <= 0;
              return (
                <Card key={g.riderId} className="p-4 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm leading-snug truncate">
                        <RiderLink id={g.riderId} className="text-cz-1 hover:text-cz-accent-t transition-colors">{g.name}</RiderLink>
                      </p>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        {g.nationality_code && <NationCell code={g.nationality_code} />}
                        {g.age != null && (
                          <span className="text-xs text-cz-3">{t("ageLabel", { age: g.age })}</span>
                        )}
                      </div>
                    </div>
                    {days != null && (
                      <span
                        className={`flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide leading-none px-1.5 py-0.5 rounded ${overdue ? "bg-cz-danger-bg text-cz-danger" : "bg-cz-accent/15 text-cz-accent-t"}`}
                      >
                        {overdue ? t("graduationOverdue") : t("graduationDeadline", { days })}
                      </span>
                    )}
                  </div>

                  {/* #2796: valget var konsekvensblindt — type, værdi og løn er nu på kortet.
                      self-start: kortet er en flex-kolonne, så badgen ville ellers
                      strække sig i fuld bredde og læses som en bjælke, ikke en badge. */}
                  <RiderTypeBadge primaryType={g.primary_type} secondaryType={g.secondary_type} className="self-start" />
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <dt className="text-cz-3">{t("colValue")}</dt>
                    <dd className="text-right font-data tabular-nums text-cz-1">{formatMoney(g.market_value)} CZ$</dd>
                    <dt className="text-cz-3">{t("colSalary")}</dt>
                    <dd className="text-right font-data tabular-nums text-cz-1">{formatMoney(g.salary)} CZ$</dd>
                  </dl>

                  {err && <p className="text-xs text-cz-danger">{err}</p>}

                  <div className="flex gap-2 mt-auto pt-1">
                    <Button size="sm" variant="primary" className="flex-1"
                      onClick={() => handleGraduate(g.riderId, "promote")}
                      disabled={busy} loading={actionState[g.riderId] === "promote"}>
                      {t("promoteBtn")}
                    </Button>
                    <Button size="sm" variant="secondary" className="flex-1"
                      onClick={() => handleGraduate(g.riderId, "sell")}
                      disabled={busy} loading={actionState[g.riderId] === "sell"}>
                      {t("sellBtn")}
                    </Button>
                    <Button size="sm" variant="ghost" className="flex-1"
                      onClick={() => handleGraduate(g.riderId, "release")}
                      disabled={busy} loading={actionState[g.riderId] === "release"}>
                      {t("releaseBtn")}
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {/* INTAKE-sektion */}
      <section>
        <h2 className="font-data text-[11px] font-semibold uppercase tracking-[.1em] text-cz-3 mb-3">{t("intakeHeading")}</h2>

        {intake.length === 0 ? (
          <EmptyState title={t("emptyIntakeTitle")} description={t("emptyIntake")} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {intake.map((item) => {
              const rider = item.rider;
              const age = getRiderAge(rider.birthdate);
              const busy = actionState[rider.id] != null;
              const err = actionErrors[rider.id];
              const potential = item.potentialEstimate;
              // #2796: tilbuddet udløber efter 7 dage (academyIntakeExpirySweep) —
              // hjælpeteksten har lovet det siden #2627, men kortet viste det aldrig.
              const expiryDays = daysUntil(item.expiresAt);
              const expirySoon = expiryDays != null && expiryDays <= 2;
              // Signeringsprisen er backend-beregnet (samme udtryk som debiteringen),
              // så kortet ikke spejler en økonomi-regel der kan drive fra hinanden.
              const fee = item.signingFee;
              const tooExpensive = fee != null && balance != null && fee > balance;

              return (
                <Card key={item.intakeId} className="p-4 flex flex-col gap-3">
                  {/* Navn + nationalitet */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm leading-snug truncate">
                        <RiderLink id={rider.id} className="text-cz-1 hover:text-cz-accent-t transition-colors">
                          {rider.firstname} {rider.lastname}
                        </RiderLink>
                      </p>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        {rider.nationality_code && <NationCell code={rider.nationality_code} />}
                        {age != null && (
                          <span className="text-xs text-cz-3">{t("ageLabel", { age })}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      {item.is_serious && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide leading-none px-1.5 py-0.5 rounded bg-cz-accent/15 text-cz-accent-t">
                          {t("seriousBadge")}
                        </span>
                      )}
                      {expiryDays != null && (
                        <span
                          title={t("expiryTooltip")}
                          className={`text-[10px] font-semibold uppercase tracking-wide leading-none px-1.5 py-0.5 rounded ${expirySoon ? "bg-cz-danger-bg text-cz-danger" : "bg-cz-subtle text-cz-2 border border-cz-border"}`}
                        >
                          {expiryDays <= 0 ? t("expiryToday") : t("expiryDays", { days: expiryDays })}
                        </span>
                      )}
                    </div>
                  </div>

                  <RiderTypeBadge primaryType={rider.primary_type} secondaryType={rider.secondary_type} className="self-start" />

                  {/* Potentiale-stjerner */}
                  {potential && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-cz-3">{t("potential")}</span>
                      <PotentialeStars range={{ lo: potential.lo, hi: potential.hi }} birthdate={rider.birthdate} />
                    </div>
                  )}

                  {/* #2796: Signér var et irreversibelt køb uden synlig pris. */}
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs border-t border-cz-border pt-2">
                    <dt className="text-cz-3">{t("colValue")}</dt>
                    <dd className="text-right font-data tabular-nums text-cz-1">{formatMoney(getRiderMarketValue(rider))} CZ$</dd>
                    <dt className="text-cz-3">{t("signingFee")}</dt>
                    <dd className={`text-right font-data tabular-nums font-semibold ${tooExpensive ? "text-cz-danger" : "text-cz-1"}`}>
                      {formatMoney(fee)} CZ$
                    </dd>
                  </dl>

                  {/* Fejlbesked */}
                  {err && <p className="text-xs text-cz-danger">{err}</p>}

                  {/* Handlingsknapper */}
                  <div className="flex gap-2 mt-auto pt-1">
                    <Button size="sm" variant="primary" className="flex-1"
                      onClick={() => handleSign(rider.id)}
                      disabled={busy || isFull || tooExpensive}
                      loading={actionState[rider.id] === "signing"}
                      title={isFull ? t("fullTooltip", { max: slots.max }) : tooExpensive ? t("error.insufficientBalance") : undefined}>
                      {t("signBtn")}
                    </Button>
                    <Button size="sm" variant="secondary" className="flex-1"
                      onClick={() => handleReject(rider.id)}
                      disabled={busy} loading={actionState[rider.id] === "rejecting"}>
                      {t("rejectBtn")}
                    </Button>
                  </div>

                  {/* Blokerings-forklaring under knapperne */}
                  {isFull && !err && (
                    <p className="text-[10px] text-cz-3 text-center">{t("fullNote", { max: slots.max })}</p>
                  )}
                  {!isFull && tooExpensive && !err && (
                    <p className="text-[10px] text-cz-danger text-center">{t("error.insufficientBalance")}</p>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* ROSTER-sektion */}
      <section>
        <h2 className="font-data text-[11px] font-semibold uppercase tracking-[.1em] text-cz-3 mb-3">{t("rosterHeading")}</h2>

        {roster.length === 0 ? (
          <EmptyState title={t("emptyRosterTitle")} description={t("emptyRoster")} />
        ) : (
          <Card className="overflow-hidden">
            <Table data-sortable>
              <thead>
                <tr>
                  <Th className="w-px" sortKey="nationality_code" sort={sort} sortDir={sortDir} onSort={handleSort}>{t("colNation")}</Th>
                  <Th sortKey="name" sort={sort} sortDir={sortDir} onSort={handleSort}>{t("colRider")}</Th>
                  <Th sortKey="primary_type" sort={sort} sortDir={sortDir} onSort={handleSort}>{t("colType")}</Th>
                  <Th numeric sortKey="age" sort={sort} sortDir={sortDir} onSort={handleSort}>{t("colAge")}</Th>
                  <Th sortKey="potential" sort={sort} sortDir={sortDir} onSort={handleSort}>{t("potential")}</Th>
                  <Th numeric sortKey="market_value" sort={sort} sortDir={sortDir} onSort={handleSort}>{t("colValue")}</Th>
                  <Th numeric sortKey="salary" sort={sort} sortDir={sortDir} onSort={handleSort}>{t("colSalary")}</Th>
                  <Th sortKey="contract_end_season" sort={sort} sortDir={sortDir} onSort={handleSort}>{t("colContract")}</Th>
                  <Th className="text-right">{t("colAction")}</Th>
                </tr>
              </thead>
              <tbody>
                {sortedRoster.map((rider) => {
                  const age = getRiderAge(rider.birthdate);
                  const busy = actionState[rider.id] != null;
                  const err = actionErrors[rider.id];
                  return (
                    <Tr key={rider.id}>
                      <Td><NationCell code={rider.nationality_code} /></Td>
                      <Td>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <RiderLink id={rider.id} className="text-cz-1 font-medium hover:text-cz-accent-t transition-colors">
                            {rider.firstname} {rider.lastname}
                          </RiderLink>
                          <RiderBadges badges={["academy"]} />
                        </div>
                        {err && <p className="text-xs text-cz-danger mt-1">{err}</p>}
                      </Td>
                      <Td><RiderTypeBadge primaryType={rider.primary_type} secondaryType={rider.secondary_type} /></Td>
                      <Td numeric>{age != null ? age : "–"}</Td>
                      {/* #2796: labelAsTitle — stjernerne bærer informationen,
                          den kvalitative tekst ligger i tooltip'en. */}
                      <Td><ScoutablePotentiale rider={rider} scouting={scouting} labelAsTitle /></Td>
                      <Td numeric>{formatMoney(getRiderMarketValue(rider))}</Td>
                      <Td numeric>{formatMoney(rider.salary)}</Td>
                      <Td>
                        {rider.contract_end_season != null
                          ? t("contractUntil", { season: rider.contract_end_season })
                          : "–"}
                      </Td>
                      {/* #932 S7: promote-handlingen lever HER (på akademi-rosteret),
                          ikke på holdsiden. Blokeres når senior-truppen er fuld. */}
                      <Td className="text-right">
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => handlePromote(rider)}
                          disabled={busy || seniorFull}
                          loading={actionState[rider.id] === "promoting"}
                          title={seniorFull ? t("promoteSeniorFullTooltip") : undefined}
                        >
                          {t("promoteBtn")}
                        </Button>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>
        )}
      </section>

      {/* Akademi-regnskab (#2485) — P&L for udvikl-og-sælg. */}
      <AcademyPnl />

      {/* Promote-bekræftelse (#932 S7) — senior-cap-effekt + projiceret senior-løn. */}
      <AcademyTransferConfirmModal
        show={!!promoteConfirm}
        direction="promote"
        riderName={promoteConfirm?.riderName}
        newSalary={promoteConfirm?.newSalary}
        capLabel={`${seniorCount} / ${seniorMax}`}
        capAfterLabel={`${seniorCount + 1} / ${seniorMax}`}
        busy={promoteConfirm ? actionState[promoteConfirm.riderId] === "promoting" : false}
        onCancel={() => {
          if (promoteConfirm && actionState[promoteConfirm.riderId] === "promoting") return;
          setPromoteConfirm(null);
        }}
        onConfirm={confirmPromote}
      />
    </div>
  );
}
