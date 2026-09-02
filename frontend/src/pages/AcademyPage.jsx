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
// (useTableSort, NationCell, RiderTypeBadge, RiderBadges, Card, Button,
// EmptyState, PageLoader), så akademiet ser ud og opfører sig som resten af
// appen. #3045: rosteret migreret videre fra Table/Tr/Th/Td til den kanoniske
// DataTable (sticky navnekolonne + mobil-fold — se rosterColumns).
//
// Flag-gated: siden er kun tilgængelig via nav når enabled=true (se Layout.jsx).
// Hvis nogen alligevel navigerer hertil med flag slukket, vises en graceful
// "coming soon"-state — men KUN når flaget faktisk er slukket, ikke ved en
// backend-fejl (#2796: en 500'er viste før "Akademiet kommer snart").

import { useMemo, useState } from "react";
import { Link } from "react-router";
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
import { AcademyReleaseConfirmModal } from "../components/AcademyReleaseConfirmModal.jsx";
import AcademyPnl from "../components/AcademyPnl.jsx";
import {
  Card, Button, EmptyState, PageLoader, ErrorState, PageHeader, DataTable,
  Section, SectionHeader, SectionAction,
} from "../components/ui";
import { projectSeniorSalary, getRiderMarketValue } from "../lib/marketValues.js";
import { keepsExistingContractOnPromote } from "../lib/academyPromoteContract.js";
import { formatNumber } from "../lib/intl.js";
import { getRiderAge } from "../lib/riderAge.js";
import { useActiveSeasonYear } from "../hooks/useActiveSeasonYear.js";
import { useTableSort } from "../lib/useTableSort.js";
import { buttonClass } from "../components/ui/buttonStyles.js";
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
  // #3071: modul-konstant kan ikke se komponentens seasonYear-state — men
  // alders-SORTERING er ordinalt uafhængig af referenceåret (samme offset for
  // alle ryttere), så vi sorterer på det negerede fødselsår i stedet (ældre
  // fødselsår = højere alder). Ingen wall-clock involveret.
  age: (r) => (r.birthdate ? -new Date(r.birthdate).getFullYear() : null),
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
  // #3045: mobil-fold-tekst for ryttertype (samme namespace som /riders' #2849 bølge 2).
  const { t: tTypes } = useTranslation("riderTypes");
  const scouting = useScouting();
  // #3071: sæson-referenceår til alders-visning (intake/roster) — se riderAge.js.
  const seasonYear = useActiveSeasonYear();
  const {
    enabled, slots, seniorCount, seniorMax, roster, intake, graduations, balance,
    intakePull, loading, error, signCandidate, rejectCandidate, resolveGraduate, promoteRider,
    fetchReleaseQuote, releaseRider,
    pullIntake,
  } = useAcademy();

  // Per-kandidat in-flight state + fejlbeskeder.
  const [actionState, setActionState] = useState({}); // { [riderId]: "signing"|"rejecting"|null }
  const [actionErrors, setActionErrors] = useState({}); // { [riderId]: string | null }

  // #3550: pull-knappens egen in-flight/fejl-state (ikke per-kandidat).
  const [pullBusy, setPullBusy] = useState(false);
  const [pullError, setPullError] = useState(null);

  // #932 S7: promote-bekræftelse (akademi → senior). Konsekvens-bevidst: viser
  // senior-cap-effekt + projiceret senior-løn. { riderId, riderName, newSalary } | null.
  const [promoteConfirm, setPromoteConfirm] = useState(null);

  // #4009: fyr-bekræftelse (akademi-rytter forlader akademiet, samme
  // buyout-gebyr som senior-fyring). { riderId, riderName, fee, balance,
  // affordable } | null. fee/balance/affordable er null indtil quoten er hentet.
  const [releaseConfirm, setReleaseConfirm] = useState(null);
  const [releaseBusy, setReleaseBusy] = useState(false);

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

  // #3045 — rosteret migreret fra den hånd-rullede Table/Tr/Th/Td (ingen sticky
  // navnekolonne, ingen fold-mekanisme — den var den eneste rytterflade der stod
  // uden for den kanoniske DataTable/T2-recipe) til DataTable. Portræt-kolonne-
  // kontrakten her: Type + Værdi følger navnet ind i mobil-underlinjen. Akademiet
  // har INGEN rating-kolonne (evnerne hentes ikke til rosteret — unge, uformede
  // ryttere vurderes på potentiale, ikke aktuel rating), så Potentiale erstatter
  // Rating som kvalitetssignalet — men forbliver en almindelig (ikke-foldet)
  // kolonne, fordi ScoutablePotentiale er et scoutet stjerne-bånd uden en kort,
  // meningsfuld tekst-repræsentation til underlinjen (se PR-beskrivelsen).
  const rosterColumns = [
    {
      key: "nation",
      header: t("colNation"),
      sortKey: "nationality_code",
      render: (r) => <NationCell code={r.nationality_code} />,
    },
    {
      key: "name",
      header: t("colRider"),
      sticky: true,
      sortKey: "name",
      render: (r) => (
        <>
          <div className="flex items-center gap-1.5 flex-wrap">
            <RiderLink id={r.id} className="text-cz-1 font-medium hover:text-cz-accent-t transition-colors">
              {r.firstname} {r.lastname}
            </RiderLink>
            <RiderBadges badges={["academy"]} />
          </div>
          {actionErrors[r.id] && <p className="text-xs text-cz-danger mt-1 whitespace-normal">{actionErrors[r.id]}</p>}
        </>
      ),
    },
    {
      key: "type",
      header: t("colType"),
      sortKey: "primary_type",
      fold: true,
      foldValue: (r) => {
        if (!r.primary_type) return "";
        const primary = tTypes(`types.${r.primary_type}`);
        const hasSecondary = r.secondary_type && r.secondary_type !== r.primary_type;
        return hasSecondary ? `${primary}/${tTypes(`types.${r.secondary_type}`)}` : primary;
      },
      render: (r) => <RiderTypeBadge primaryType={r.primary_type} secondaryType={r.secondary_type} />,
    },
    {
      key: "age",
      header: t("colAge"),
      numeric: true,
      sortKey: "age",
      render: (r) => getRiderAge(r.birthdate, seasonYear) ?? "–",
    },
    {
      key: "potential",
      header: t("potential"),
      sortKey: "potential",
      // #2796: labelAsTitle — stjernerne bærer informationen, den kvalitative
      // tekst ligger i tooltip'en.
      render: (r) => <ScoutablePotentiale rider={r} scouting={scouting} labelAsTitle />,
    },
    {
      key: "value",
      header: t("colValue"),
      numeric: true,
      sortKey: "market_value",
      fold: true,
      foldValue: (r) => formatMoney(getRiderMarketValue(r)),
      render: (r) => formatMoney(getRiderMarketValue(r)),
    },
    {
      key: "salary",
      header: t("colSalary"),
      numeric: true,
      sortKey: "salary",
      render: (r) => formatMoney(r.salary),
    },
    {
      key: "contract",
      header: t("colContract"),
      sortKey: "contract_end_season",
      render: (r) => (r.contract_end_season != null ? t("contractUntil", { season: r.contract_end_season }) : "–"),
    },
    // #932 S7: promote-handlingen lever HER (på akademi-rosteret), ikke på
    // holdsiden. Blokeres når senior-truppen er fuld.
    // #4009: Fyr sidder ved siden af Promovér — samme handling som ELLERS kun
    // var tilgængelig via gradueringsvinduet (ryttere ≥22). Ejer-ja 20/8:
    // fyring skal virke på alle ryttere, ikke kun graduerede.
    // #4628: raekkeknapper er ALTID secondary (T2: "row action buttons are
    // secondary sm, never gold in rows") — Promovér var primary og blev
    // tvunget om af kittet med et console.error (#4625/#4657). Fyr var en
    // roed outline-knap, altsaa en indrammet danger-flade i hver eneste
    // raekke; den er nu en destruktiv TEKST-handling (ghost + --danger),
    // saa raekken har én indrammet knap og roedt kun som farve.
    // En rigtig handlings-menu (Dropdown) er fravalgt her: DataTable's WRAP er
    // overflow-hidden og SCROLLER overflow-x-auto, saa et absolut placeret
    // panel i en raekke ville blive klippet af tabellens egen scroller.
    {
      key: "action",
      header: t("colAction"),
      render: (r) => {
        const busy = actionState[r.id] != null;
        return (
          <div className="flex items-center gap-1.5 justify-end">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => handlePromote(r)}
              disabled={busy || seniorFull}
              loading={actionState[r.id] === "promoting"}
              title={seniorFull ? t("promoteSeniorFullTooltip") : undefined}
            >
              {t("promoteBtn")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-cz-danger hover:text-cz-danger"
              onClick={() => handleReleaseOpen(r)}
              disabled={busy}
            >
              {t("releaseBtn")}
            </Button>
          </div>
        );
      },
    },
  ];

  function mapActionError(err) {
    if (err === "academy_full") return t("error.academyFull");
    if (err === "not_offered") return t("error.notOffered");
    // #2796: begge faldt før igennem til den generiske besked (+ Sentry-500).
    if (err === "insufficient_balance") return t("error.insufficientBalance");
    if (err === "already_assigned") return t("error.alreadyAssigned");
    // #4213: stale tilbud — rytteren er i mellemtiden ejet af et andet hold.
    if (err === "rider_owned") return t("error.riderOwned");
    if (err === "squad_cap_violation") return t("error.squadFull");
    // #4009: fyr-specifikke fejl fra /api/riders/:id/academy-release.
    if (err === "rider_on_auction_release") return t("error.riderOnAuction");
    if (err === "cannot_afford_release") return t("error.cannotAffordRelease");
    if (err === "rider_state_changed" || err === "rider_not_academy") return t("error.riderStateChanged");
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

  // #3550: hent ugens akademi-kuld (pull-intake).
  async function handlePullIntake() {
    setPullBusy(true);
    setPullError(null);
    const result = await pullIntake();
    if (!result.ok) {
      setPullError(t("intakePull.errorFailed"));
    }
    setPullBusy(false);
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
      // #2796: dialogen viste engang 161 CZ$ for ENHVER rytter, fordi to
      // korrekte defaults ramte samtidig (manglende division → global sats,
      // manglende current_production_value → base-fallback 1000). #3989 fjernede
      // division-benet strukturelt; rytterens current_production_value SKAL
      // stadig være i payloaden, ellers rammer base-fallbacken igen.
      // #3620: har rytteren allerede en kontrakt, regenereres den ikke, så
      // lønnen ændrer sig ikke. Så viser vi den rigtige løn i stedet for en
      // projektion der aldrig bliver skrevet.
      newSalary: keepsExistingContractOnPromote(rider)
        ? rider.salary
        : projectSeniorSalary(rider),
      keepsContract: keepsExistingContractOnPromote(rider),
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

  // #4009: Åbn fyr-bekræftelse — henter gebyr-quoten (samme formel som
  // senior-fyring) FØR dialogen viser bekræft-knappen aktiv, samme
  // speed-bump-mønster som rytterprofilens/holdsidens Fyr-panel.
  async function handleReleaseOpen(rider) {
    setActionErrors(prev => ({ ...prev, [rider.id]: null }));
    setReleaseConfirm({
      riderId: rider.id,
      riderName: `${rider.firstname} ${rider.lastname}`.trim(),
      fee: null,
      balance: null,
      affordable: null,
    });
    const { ok, data } = await fetchReleaseQuote(rider.id);
    setReleaseConfirm(prev => (prev && prev.riderId === rider.id
      ? { ...prev, fee: ok ? data.fee : 0, balance: ok ? data.balance : null, affordable: ok ? data.affordable : false }
      : prev));
  }

  async function confirmRelease() {
    if (!releaseConfirm) return;
    const riderId = releaseConfirm.riderId;
    setReleaseBusy(true);
    setActionErrors(prev => ({ ...prev, [riderId]: null }));
    const result = await releaseRider(riderId);
    setReleaseBusy(false);
    setReleaseConfirm(null);
    if (!result.ok) {
      setActionErrors(prev => ({ ...prev, [riderId]: mapActionError(result.error) }));
    }
  }

  // Loading — PageLoader reserverer højde (#1794 CLS).
  if (loading) return <PageLoader label={t("title")} />;

  // #2796: en backend-fejl efterlod `enabled` false og ramte derfor "kommer
  // snart"-grenen nedenfor — spilleren fik at vide at featuren ikke fandtes.
  // Fejl vises nu som fejl; "kommer snart" er forbeholdt et slukket flag.
  // #2849 bølge 6: Academy stod på den editoriale 38px-header uden at være på
  // ejer-godkendelseslisten for editorial-headers (kun Klub/ScoutingCentral/
  // SeasonPlanner) — bragt til T1's kanoniske PageHeader (docs/design/PAGE_TEMPLATES.md).
  // #3454: fejl-/disabled-staterne er selv læse-tunge (en enkelt besked), men
  // deler containerbredde med sidens hovedindhold nedenfor, så bredden ikke
  // hopper når en fejl løses ved retry — samme mønster som RidersPage's
  // fejl-gren.
  if (error) {
    return (
      <div className="max-w-[1600px] mx-auto">
        <PageHeader title={t("title")} />
        <ErrorState title={t("error.loadTitle")} description={t("error.loadBody")} />
      </div>
    );
  }

  // Flag slukket
  if (!enabled) {
    return (
      <div className="max-w-[1600px] mx-auto">
        <PageHeader title={t("title")} />
        {/* #4628 (TASTE fork 4): en tom tilstand uden vej videre er et fund —
            EmptyState kraever nu `action` (#4625). */}
        <EmptyState
          title={t("disabledTitle")}
          description={t("disabledNote")}
          action={
            <Link to="/roadmap" className={buttonClass({ variant: "secondary", size: "sm" })}>
              {t("disabledAction")}
            </Link>
          }
        />
      </div>
    );
  }

  // #3454: T1 (max-w-4xl) → T2 (max-w-[1600px]) — akademiets roster bruger
  // allerede den kanoniske DataTable (#3045, T2-recipen), men sad klemt i en
  // T1-container med spildt whitespace i siderne (ejer-direktiv 6/8, samme
  // fejlklasse som #1675/#1186/#2446). Layout.jsx's WIDE_CONTENT_ROUTES
  // matcher (se Layout.jsx), så shellen giver nu fuld bredde til denne cap.
  return (
    <div className="max-w-[1600px] mx-auto">
      {/* Saldo + slot-tæller er ren status-tekst (intet Select/Button) — samme
          dokumenterede afvigelse fra action-cluster-kontrakten "max 1 select +
          1 primary" som ActivityPage's lastUpdated-tidsstempel, fordi siden ikke
          har nogen primær header-handling at vise ved siden af. */}
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
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
        }
      />

      <div className="space-y-6">
      {/* GRADUERINGS-sektion (#932) — akademiryttere der har passeret 21 og skal
          promoveres/sælges/slippes inden override-vinduets udløb. Vises kun når der
          er pending graduates (call-to-action, ikke permanent tom-tilstand). */}
      {graduations.length > 0 && (
        <section>
          {/* #4628: eyebrow-idiomet (11px uppercase meta) var sidens fjerde
              overskrifts-stil og fik Youth squads-kortets kanoniske 15/600-titel
              til at skille sig ud fra sine naboer (audit 2026-09, /academy).
              Alle fire blokke bruger nu SectionHeader-recipen. */}
          <SectionHeader title={t("graduationHeading")} meta={String(graduations.length)} />
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
                        className={`flex-shrink-0 text-3xs font-semibold uppercase tracking-wide leading-none px-1.5 py-0.5 rounded-cz-pill ${overdue ? "bg-cz-danger-bg text-cz-danger" : "bg-cz-accent/15 text-cz-accent-t"}`}
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

                  {/* #4628: kortene gentages (ét pr. graduerende rytter), saa en
                      guld-primary pr. kort giver N guld-knapper paa ét view.
                      Guld er rationeret til ÉN primaer handling pr. view
                      (TASTE P3 / fork 3) — kort-handlingerne er secondary,
                      og den destruktive er en ghost i --danger. */}
                  <div className="flex gap-2 mt-auto pt-1">
                    <Button size="sm" variant="secondary" className="flex-1"
                      onClick={() => handleGraduate(g.riderId, "promote")}
                      disabled={busy} loading={actionState[g.riderId] === "promote"}>
                      {t("promoteBtn")}
                    </Button>
                    <Button size="sm" variant="secondary" className="flex-1"
                      onClick={() => handleGraduate(g.riderId, "sell")}
                      disabled={busy} loading={actionState[g.riderId] === "sell"}>
                      {t("sellBtn")}
                    </Button>
                    <Button size="sm" variant="ghost" className="flex-1 text-cz-danger hover:text-cz-danger"
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
        <SectionHeader title={t("intakeHeading")} meta={t("slots", { used: slots.used, max: slots.max })} />

        {/* #3550 (ejer-beslutning 19/8, ungdomspakken): pull-baseret intake.
            intakePull.enabled=false (default indtil cutover-flip 23/8) → uændret
            visning (auto-drip-tomtilstand nedenfor). enabled=true bytter tomme-
            tilstanden ud med en hent-knap (tilstand a) medmindre ugens kuld
            allerede er hentet OG opbrugt (tilstand b var kandidat-kortene). */}
        {intake.length === 0 && intakePull.enabled && !intakePull.pulledThisWeek ? (
          <Card className="p-5 flex flex-col items-start gap-3">
            <h3 className="text-sm font-semibold text-cz-1">{t("intakePull.title")}</h3>
            <p className="text-xs text-cz-2 max-w-md">{t("intakePull.description")}</p>
            <p className="text-3xs uppercase tracking-wide text-cz-3">{t("intakePull.deadlineNote")}</p>
            {pullError && <p className="text-xs text-cz-danger">{pullError}</p>}
            <Button size="sm" variant="primary" onClick={handlePullIntake} disabled={pullBusy} loading={pullBusy}>
              {t("intakePull.pullBtn")}
            </Button>
          </Card>
        ) : intake.length === 0 && intakePull.enabled ? (
          <EmptyState
            title={t("emptyIntakeTitle")}
            description={t("intakePull.emptyAfterPull")}
            action={
              <Link to="/auctions" className={buttonClass({ variant: "secondary", size: "sm" })}>
                {t("emptyAction")}
              </Link>
            }
          />
        ) : intake.length === 0 ? (
          <EmptyState
            title={t("emptyIntakeTitle")}
            description={t("emptyIntake")}
            action={
              <Link to="/auctions" className={buttonClass({ variant: "secondary", size: "sm" })}>
                {t("emptyAction")}
              </Link>
            }
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {intake.map((item) => {
              const rider = item.rider;
              const age = getRiderAge(rider.birthdate, seasonYear);
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
                  {/* Navn + nationalitet. #3142: INGEN RiderLink her — en 'offered'
                      intake-kandidat er bevidst skjult for den almindelige rytter-DB
                      via RLS (database/2026-06-22-hide-intake-riders-from-db.sql,
                      #1743), så /riders/:id ville altid give "rider not found" for
                      netop denne rytter, uanset hvilket hold der klikker. Navnet er
                      derfor almindelig tekst indtil kandidaten er signeret/afvist —
                      roster- og gradueringssektionerne linker fortsat (de ryttere er
                      ikke længere 'offered' og er derfor synlige). */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm leading-snug truncate text-cz-1">
                        {rider.firstname} {rider.lastname}
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
                        <span className="text-3xs font-semibold uppercase tracking-wide leading-none px-1.5 py-0.5 rounded-cz-pill bg-cz-accent/15 text-cz-accent-t">
                          {t("seriousBadge")}
                        </span>
                      )}
                      {expiryDays != null && (
                        <span
                          title={t("expiryTooltip")}
                          className={`text-3xs font-semibold uppercase tracking-wide leading-none px-1.5 py-0.5 rounded-cz-pill ${expirySoon ? "bg-cz-danger-bg text-cz-danger" : "bg-cz-subtle text-cz-2 border border-cz-border"}`}
                        >
                          {expiryDays <= 0 ? t("expiryToday") : t("expiryDays", { days: expiryDays })}
                        </span>
                      )}
                    </div>
                  </div>

                  <RiderTypeBadge primaryType={rider.primary_type} secondaryType={rider.secondary_type} className="self-start" />

                  {/* #2454/#3746: potentiale i RATING-point, samme enhed som resten
                      af spillet. `prog` er prognose-båndets navn; `ceil` er en
                      alias (samme tal) for ældre klient-cache. Stjernerne bliver
                      stående som fallback for payloads uden bånd. */}
                  {(item.potentialBand || potential) && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-cz-3">{t("potential")}</span>
                      {item.potentialBand ? (
                        <span className="font-mono tabular-nums text-[13px] text-cz-1">
                          {(item.potentialBand.prog ?? item.potentialBand.ceil).lo}
                          –{(item.potentialBand.prog ?? item.potentialBand.ceil).hi}
                        </span>
                      ) : (
                        <PotentialeStars range={{ lo: potential.lo, hi: potential.hi }} />
                      )}
                    </div>
                  )}

                  {/* #2796: Signér var et irreversibelt køb uden synlig pris.
                      #3550: pull-mode viser markedsværdien som PROVISORISK (symbolsk
                      startværdi, ejer-beslutning 19/8 punkt 2) + en lønforhåndsvisning
                      (1 sæsons intro-kontrakt), og forklarer at den rigtige værdi
                      sættes ved førstkommende søndags-opdatering (punkt 5). */}
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs border-t border-cz-border pt-2">
                    <dt className="text-cz-3">{intakePull.enabled ? t("intakePull.provisionalValue") : t("colValue")}</dt>
                    <dd className="text-right font-data tabular-nums text-cz-1">{formatMoney(getRiderMarketValue(rider))} CZ$</dd>
                    <dt className="text-cz-3">{t("signingFee")}</dt>
                    <dd className={`text-right font-data tabular-nums font-semibold ${tooExpensive ? "text-cz-danger" : "text-cz-1"}`}>
                      {formatMoney(fee)} CZ$
                    </dd>
                    {intakePull.enabled && (
                      <>
                        <dt className="text-cz-3">{t("intakePull.wageOneSeason")}</dt>
                        <dd className="text-right font-data tabular-nums text-cz-1">{formatMoney(item.wagePreview)} CZ$</dd>
                      </>
                    )}
                  </dl>
                  {intakePull.enabled && (
                    <p className="text-3xs text-cz-3">{t("intakePull.valuationNote")}</p>
                  )}

                  {/* Fejlbesked */}
                  {err && <p className="text-xs text-cz-danger">{err}</p>}

                  {/* Handlingsknapper */}
                  {/* #4628: samme guld-rationering som gradueringskortene —
                      tre "Signer"-kort gav tre guld-knapper (audit 2026-09). */}
                  <div className="flex gap-2 mt-auto pt-1">
                    <Button size="sm" variant="secondary" className="flex-1"
                      onClick={() => handleSign(rider.id)}
                      disabled={busy || isFull || tooExpensive}
                      loading={actionState[rider.id] === "signing"}
                      title={isFull ? t("fullTooltip", { max: slots.max }) : tooExpensive ? t("error.insufficientBalance") : undefined}>
                      {t("signBtn")}
                    </Button>
                    <Button size="sm" variant="ghost" className="flex-1"
                      onClick={() => handleReject(rider.id)}
                      disabled={busy} loading={actionState[rider.id] === "rejecting"}>
                      {t("rejectBtn")}
                    </Button>
                  </div>

                  {/* Blokerings-forklaring under knapperne */}
                  {isFull && !err && (
                    <p className="text-3xs text-cz-3 text-center">{t("fullNote", { max: slots.max })}</p>
                  )}
                  {!isFull && tooExpensive && !err && (
                    <p className="text-3xs text-cz-danger text-center">{t("error.insufficientBalance")}</p>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* ROSTER-sektion — #3045: DataTable (T2-recipen), sticky navnekolonne +
          Type/Værdi foldet ind i portræt-underlinjen (se rosterColumns). */}
      <section>
        <SectionHeader title={t("rosterHeading")} meta={String(roster.length)} />

        {roster.length === 0 ? (
          <EmptyState
            title={t("emptyRosterTitle")}
            description={t("emptyRoster")}
            action={
              <Link to="/auctions" className={buttonClass({ variant: "secondary", size: "sm" })}>
                {t("emptyAction")}
              </Link>
            }
          />
        ) : (
          <DataTable
            label={t("rosterHeading")}
            columns={rosterColumns}
            rows={sortedRoster}
            rowKey={(r) => r.id}
            sort={sort}
            sortDir={sortDir}
            onSort={handleSort}
          />
        )}
      </section>

      {/* YOUTH SQUADS-kort (#4618, slice 0 af epic #2492) — "Kommer snart"-rammen
          for Junior team og U23 team, jf. docs/YOUTH_RULES.md §3 og artboard 3b
          (docs/design/youth-tiers/HANDOFF.md beslutning 10). Lægges UNDER
          roster-kortet, ikke over (fold-disciplin, PAGE_TEMPLATES.md). Ingen
          nye nav-punkter, ingen tomme tabeller, ingen tal — kun en pille
          (FacilityTrackCard-mønstret) + én sætning pr. trup + ét roadmap-link
          (P11 "ingenting opdigtet", TASTE.md). Dagens akademi-ryttere forbliver
          én samlet trup ("Academy roster" ovenfor) indtil slice 1.
          Beskrivelseslinjen er en fuld sætning, ikke en meta-label, så den
          IKKE bruger PAGE_TEMPLATES' uppercase-11px-meta-stil (den stil er til
          korte labels/tal, ikke løbende tekst) — samme valg som
          FacilityTrackCard's egen "coming soon"-linje (text-xs text-cz-2). */}
      <Section>
        <SectionHeader
          title={t("youthSquads.title")}
          action={<SectionAction as={Link} to="/roadmap">{t("youthSquads.roadmap")}</SectionAction>}
        />
        <div className="divide-y divide-cz-border">
          {[
            { key: "junior", title: t("youthSquads.junior.title"), description: t("youthSquads.junior.description") },
            { key: "u23", title: t("youthSquads.u23.title"), description: t("youthSquads.u23.description") },
          ].map((row) => (
            <div key={row.key} className="py-[13px] flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13.5px] font-medium text-cz-1">{row.title}</p>
                <p className="text-xs text-cz-2 mt-0.5">{row.description}</p>
              </div>
              <span className="shrink-0 text-3xs uppercase tracking-wide rounded-cz px-[7px] py-[2px] text-cz-accent-t bg-cz-accent/10">
                {t("youthSquads.comingSoon")}
              </span>
            </div>
          ))}
        </div>
      </Section>

      {/* Akademi-regnskab (#2485) — P&L for udvikl-og-sælg. */}
      <AcademyPnl />
      </div>

      {/* Promote-bekræftelse (#932 S7) — senior-cap-effekt + projiceret senior-løn. */}
      <AcademyTransferConfirmModal
        show={!!promoteConfirm}
        direction="promote"
        riderName={promoteConfirm?.riderName}
        newSalary={promoteConfirm?.newSalary}
        keepsContract={!!promoteConfirm?.keepsContract}
        capLabel={`${seniorCount} / ${seniorMax}`}
        capAfterLabel={`${seniorCount + 1} / ${seniorMax}`}
        busy={promoteConfirm ? actionState[promoteConfirm.riderId] === "promoting" : false}
        onCancel={() => {
          if (promoteConfirm && actionState[promoteConfirm.riderId] === "promoting") return;
          setPromoteConfirm(null);
        }}
        onConfirm={confirmPromote}
      />

      {/* Fyr-bekræftelse (#4009) — buyout-gebyr som speed-bump, samme formel
          som senior-fyring. */}
      <AcademyReleaseConfirmModal
        show={!!releaseConfirm}
        riderName={releaseConfirm?.riderName}
        fee={releaseConfirm?.fee}
        balance={releaseConfirm?.balance}
        affordable={releaseConfirm?.affordable}
        busy={releaseBusy}
        onCancel={() => { if (!releaseBusy) setReleaseConfirm(null); }}
        onConfirm={confirmRelease}
      />
    </div>
  );
}
