// TrainingMobileToday — I dag-fanen paa telefonen (#3643).
//
// EJER-VALG 18/9, LAAST: mobilformen er mockup 2 (tabel) —
// docs/design/mockups-training-mobile-2026-09-18/m2-table.html. Raekkefoelgen
// er "overblik foerst, detaljer eet tryk vaek":
//
//   dagens loebsdage (stribe)  ->  programmet (gitter)  ->  i gaar (kvittering)
//   ->  hele truppens dag (tabel, med den valgte rytters kort udfoldet INDE i
//       listen)  ->  assistenten
//
// EJER-BESLUTNING 21/9 (variant A): kortet folder ud LIGE UNDER den rytter man
// trykker paa, ikke under hele tabellen. Beta-tester @egomadsen 19/9: *"Der
// bliver meget scrolleri naar rytteren folder sig ud under tabellen."* Maalt
// 21/9: 201 px fra raekke til kort ved rytter nr. 6 af 10. Alt andet i mockup 2
// staar fast. Selve raekken bygges i TrainingMobileRoster.
//
// Mobil har sit EGET udvalg af tal (ejer 18/9, spoergsmaal 1): tabellen viser
// dagens loebsdage pr. rytter, mens form, traethed, fokus og fremgang ligger i
// rytterens kort eet tryk vaek. Intet tal forsvinder helt.
// "Grupper efter type" er FJERNET paa mobil (ejer 18/9, spoergsmaal 2) og staar
// uaendret paa desktop.
//
// Desktop-fladen roeres ikke: TrainingPage.jsx vaelger mellem de to visninger
// paa `useIsMobileViewport()`, og alle fetches, mutationer og state-maskiner
// bliver liggende dér.

import { useEffect, useId, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { DISPLAY_RECIPES } from "../../../lib/generated/displayRecipes.js";
import {
  canShowScoreColumn,
  countsForRole,
  mobileScoreCell,
  pacePerWeek,
  programGrid,
  riderShortName,
  type MobileScoreView,
  type RaceDayColumn,
} from "../../../lib/trainingMobileModel.ts";
import { injuryTimeLeft, injuryBadgeMessage } from "../../../lib/training.js";
import { formatDate } from "../../../lib/intl.js";
import TrainingRaceDayStrip from "./TrainingRaceDayStrip.tsx";
import TrainingProgramGrid from "./TrainingProgramGrid.tsx";
import TrainingMobileRoster, { type RosterCell } from "./TrainingMobileRoster.tsx";
import TrainingMobileRiderCard, { type ReceiptRow } from "./TrainingMobileRiderCard.tsx";

export type MobileRider = {
  id: string;
  firstname?: string | null;
  lastname?: string | null;
  primary_type?: string | null;
  secondary_type?: string | null;
  // #5763: riders.squad — U23/JR-mærke i navnecellen (squadBadgeKey).
  squad?: string | null;
};

export default function TrainingMobileToday({
  riders,
  columns,
  selectedRiderId,
  onSelectRider,
  conditionFor,
  ageFor,
  isRacing,
  raceNameFor,
  sessionFor,
  dayLabelFor,
  receiptFor,
  abilitiesFor,
  cappedFor,
  seasonPointsFor,
  seasonDays,
  weekdays,
  intensityForWeekday,
  onEditProgram,
  onOpenDay,
  dayBusyFor,
  yesterdaySlot,
  assistantSlot,
  sortSlot,
  scoreFor = null,
  scoreSettled = true,
  openFirstForTour = false,
  overviewLayout = false,
  cardFooterFor = null,
  changeLabel,
  picked = null,
  onTogglePick,
  bulkSlot = null,
}: {
  riders: MobileRider[];
  columns: RaceDayColumn[];
  selectedRiderId: string | null;
  onSelectRider: (riderId: string) => void;
  // #5462: `injured_until` + `injury_race_days_left` er med, saa skaden kan staa paa
  // mobil-kortet i LOEBSDAGE naar flaget er on og i kalenderdage naar det er off.
  conditionFor: (riderId: string) => {
    form?: number | null;
    fatigue?: number | null;
    injured_until?: string | null;
    injury_race_days_left?: number | null;
  } | null;
  // #3815: saeson-alderen. Den er den vigtigste enkeltvariabel naar man vaelger
  // hvem der skal traenes haardt, saa den maa ikke forsvinde paa telefonen —
  // den staar i rytterens kort, eet tryk vaek (ejer 18/9: "intet tal
  // forsvinder helt paa mobil").
  ageFor: (riderId: string) => number | null;
  isRacing: (riderId: string, column: RaceDayColumn) => boolean;
  raceNameFor: (riderId: string, column: RaceDayColumn) => string | null;
  sessionFor: (riderId: string, column: RaceDayColumn) => string | null;
  dayLabelFor: (riderId: string) => string;
  receiptFor: (riderId: string) => ReceiptRow[] | null;
  abilitiesFor: (riderId: string) => Record<string, unknown> | null;
  cappedFor: (riderId: string) => string[];
  seasonPointsFor: (riderId: string) => number | null;
  seasonDays: number | null;
  weekdays: readonly string[];
  intensityForWeekday: (weekday: string) => string;
  onEditProgram: () => void;
  onOpenDay: (riderId: string) => void;
  dayBusyFor: (riderId: string) => boolean;
  yesterdaySlot?: React.ReactNode;
  assistantSlot?: React.ReactNode;
  sortSlot?: React.ReactNode;
  // #4851: rytterens score-udsnit fra /api/training/me. `null` = flaget
  // `training_score_visible` er off, og saa findes hverken kolonnen eller
  // blokken i kortet — praecis som paa desktop.
  scoreFor?: ((riderId: string) => MobileScoreView | null) | null;
  // #5485 (ejer-valg A 23/9): er dagens pas koert? Foer det viser scoren det
  // SENESTE tal daempet (mobileScoreCell), bagefter dagens tal.
  scoreSettled?: boolean;
  // #2819: sandt naar onboarding-touren koerer paa denne side. Se effekten
  // nedenfor — det er den ENESTE grund til at et kort aabner af sig selv.
  openFirstForTour?: boolean;
  // #5485: siden har faaet sit eget overblik oeverst (Needs a day / Racing /
  // Training / Tired), og programmet er flyttet til fanen Week plan. I den
  // struktur tegnes hverken dagens stribe, programmet eller tabellens titel-
  // linje her, saa mindst 8 ryttere staar paa foerste skaerm (390 x 844).
  overviewLayout?: boolean;
  // Rytterens ugeplan + profil-linket, inde i kortet (A3).
  cardFooterFor?: ((riderId: string) => React.ReactNode) | null;
  changeLabel?: string;
  // #5620/#5485: markerings-tilstanden til hurtig hvile, sendt uaendret videre
  // til TrainingMobileRoster. `bulkSlot` er vaerktoejslinjen (TrainingMobileBulkBar)
  // og staar lige over tabellen, under sorteringen.
  picked?: ReadonlySet<string> | null;
  onTogglePick?: (riderId: string) => void;
  bulkSlot?: React.ReactNode;
}) {
  const { t } = useTranslation("training");
  const tTypes = useTranslation("riderTypes").t;
  const detailId = useId();

  const rosterRiders = useMemo(
    () =>
      riders.map((rider) => {
        const cond = conditionFor(rider.id) ?? {};
        const type = rider.primary_type
          ? rider.secondary_type && rider.secondary_type !== rider.primary_type
            ? `${tTypes(`types.${rider.primary_type}`)}/${tTypes(`types.${rider.secondary_type}`)}`
            : tTypes(`types.${rider.primary_type}`)
          : null;
        // #5350: type + form + traethed staar som EEN daempet linje under
        // navnet i stedet for en badge og to kolonner. F/T er forkortelser der
        // staar forklaret i rytterens kort lige nedenunder.
        const sub = [type, `${t("mobile.formShort")}${cond.form ?? "—"}`, `${t("mobile.fatigueShort")}${cond.fatigue ?? "—"}`]
          .filter(Boolean)
          .join(" · ");
        // #5485 (ejer-valg 23/9): skaden staar i raekken. Samme kerne og
        // samme korte noegler som desktop-raekkens badge (injuryBadgeMessage
        // compact): loebsdage naar backenden har skrevet dem, ellers
        // kalenderdage fra injured_until. Ca.-datoen staar i title.
        const injuryLeft = injuryTimeLeft(cond);
        let injury: { label: string; title: string | null } | null = null;
        if (injuryLeft.count > 0) {
          const msg = injuryBadgeMessage(injuryLeft, { compact: true });
          injury = {
            label: t(msg.key, { days: msg.days }),
            title: injuryLeft.approxDate
              ? t("injuredApprox", { date: formatDate(injuryLeft.approxDate, "medium") })
              : null,
          };
        }
        // #5763: riders.squad (ALDRIG alder) => U23/JR-mærke i navnecellen,
        // samme kilde som desktop-tabellen (squadBadgeKey i TrainingMobileRoster).
        return { id: rider.id, name: riderShortName(rider), sub, injury, squad: rider.squad ?? null };
      }),
    [riders, conditionFor, tTypes, t],
  );

  const cellFor = (riderId: string, column: RaceDayColumn): RosterCell => {
    if (isRacing(riderId, column)) {
      const race = raceNameFor(riderId, column);
      return { label: t("mobile.raceShort"), tone: "race", title: race ?? undefined };
    }
    const session = sessionFor(riderId, column);
    if (!session) return { label: t("mobile.noDay"), tone: "off" };
    if (session === "rest") return { label: t("mobile.sessionShort_rest"), tone: "off" };
    const label = t([`mobile.sessionShort_${session}`, `dayPanel.session_${session}`]);
    return { label, tone: "session", title: label };
  };

  // Striben svarer paa "hvor mange af truppen har en dag at koere paa" — enten
  // et loeb eller en session. En rytter UDEN et valg taeller ikke som traenende
  // (cellen skriver "Ikke valgt" om ham), for saa ville striben paastaa en
  // aktivitet der ikke findes. Naevneren er hele truppen, aldrig et saeson-tal.
  const splitFor = (column: RaceDayColumn) => {
    let set = 0;
    for (const rider of riders) {
      if (isRacing(rider.id, column) || sessionFor(rider.id, column)) set += 1;
    }
    return { set, total: riders.length };
  };

  const programRows = useMemo(
    () => programGrid(weekdays, columns, intensityForWeekday),
    [weekdays, columns, intensityForWeekday],
  );

  // INGEN rytter er foldet ud ved indlaesning (ejer 21/9). Foer blev den
  // oeverste valgt automatisk; nu hvor kortet bor inde i listen, ville det
  // skubbe hele truppen ned og tage netop det overblik fladen er bygget til at
  // give ("overblik foerst"). Et lukket kort er ogsaa den aerlige udgangs-
  // tilstand: spilleren har ikke valgt nogen endnu.
  const selected = riders.find((rider) => rider.id === selectedRiderId) ?? null;
  const selectedId = selected?.id ?? null;

  // #2819: onboarding-tourens tredje trin peger paa fremgangen pr. evne, som
  // paa telefonen kun findes i rytterens kort. Uden auto-valget ville ankeret
  // mangle praecis naar touren koerer, saa touren — og KUN touren — folder den
  // oeverste rytter ud, een gang. `didOpenForTour` goer det uigenkaldeligt:
  // lukker spilleren kortet, bliver det lukket.
  const didOpenForTour = useRef(false);
  useEffect(() => {
    if (!openFirstForTour || didOpenForTour.current) return;
    if (selectedRiderId || riders.length === 0) return;
    didOpenForTour.current = true;
    onSelectRider(riders[0].id);
  }, [openFirstForTour, selectedRiderId, riders, onSelectRider]);

  // #4851: kolonnen findes kun naar BEGGE gaelder — flaget er on (scoreFor er
  // sat) OG loebsdags-kolonnerne ikke allerede bruger tabellens budget. Falder
  // den ud af tabellen, staar scoren fortsat i kortet eet tryk vaek, saa tallet
  // aldrig forsvinder helt fra telefonen (ejer 18/9).
  const scoreColumn =
    scoreFor && canShowScoreColumn(columns)
      ? (riderId: string) => mobileScoreCell(scoreFor(riderId), { settled: scoreSettled })
      : null;
  const selectedScore = selected && scoreFor ? scoreFor(selected.id) : null;

  return (
    <div className="space-y-3" data-testid="training-mobile-today">
      {!overviewLayout && <TrainingRaceDayStrip columns={columns} splitFor={splitFor} />}

      {!overviewLayout && <TrainingProgramGrid weekdays={weekdays} rows={programRows} onEdit={onEditProgram} />}

      {yesterdaySlot}

      {sortSlot}

      {bulkSlot}

      <TrainingMobileRoster
        picked={picked}
        onTogglePick={onTogglePick}
        riders={rosterRiders}
        columns={columns}
        cellFor={cellFor}
        selectedId={selectedId}
        onSelect={onSelectRider}
        detailId={detailId}
        scoreFor={scoreColumn}
        showHeader={!overviewLayout}
        detail={selected && (
        <TrainingMobileRiderCard
          id={detailId}
          riderId={selected.id}
          name={`${selected.firstname ?? ""} ${selected.lastname ?? ""}`.trim()}
          meta={[
            [
              selected.primary_type ? tTypes(`types.${selected.primary_type}`) : null,
              selected.secondary_type && selected.secondary_type !== selected.primary_type
                ? tTypes(`types.${selected.secondary_type}`)
                : null,
            ]
              .filter(Boolean)
              .join(" / ") || null,
            ageFor(selected.id) != null ? `${t("colAge")} ${ageFor(selected.id)}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          form={conditionFor(selected.id)?.form ?? null}
          fatigue={conditionFor(selected.id)?.fatigue ?? null}
          injuryLabel={(() => {
            // #5462: samme kerne og samme noegler som desktop-fladerne.
            const injury = injuryTimeLeft(conditionFor(selected.id));
            if (injury.count <= 0) return null;
            const msg = injuryBadgeMessage(injury);
            return t(msg.key, {
              days: msg.days,
              ...(msg.date ? { date: formatDate(msg.date, "short") } : {}),
            });
          })()}
          dayLabel={dayLabelFor(selected.id)}
          receiptRows={receiptFor(selected.id)}
          countsFor={countsForRole(DISPLAY_RECIPES, selected.primary_type, abilitiesFor(selected.id), cappedFor(selected.id))}
          roleLabel={selected.primary_type ? tTypes(`types.${selected.primary_type}`) : null}
          pacePerWeek={pacePerWeek({ gainedPoints: seasonPointsFor(selected.id), daysElapsed: seasonDays })}
          seasonPoints={seasonPointsFor(selected.id)}
          onChangeDay={() => onOpenDay(selected.id)}
          changeDisabled={dayBusyFor(selected.id)}
          score={scoreFor ? mobileScoreCell(selectedScore, { settled: scoreSettled }) : null}
          scoreSpark={selectedScore?.spark ? [...selectedScore.spark] : null}
          changeLabel={changeLabel}
          footer={cardFooterFor ? cardFooterFor(selected.id) : null}
          scoreAria={t("score.sparkAria", {
            name: `${selected.firstname ?? ""} ${selected.lastname ?? ""}`.trim(),
          })}
        />
        )}
      />

      {assistantSlot}
    </div>
  );
}
