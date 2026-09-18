// TrainingMobileToday — I dag-fanen paa telefonen (#3643).
//
// EJER-VALG 18/9, LAAST: mobilformen er mockup 2 (tabel) —
// docs/design/mockups-training-mobile-2026-09-18/m2-table.html. Raekkefoelgen
// er "overblik foerst, detaljer eet tryk vaek":
//
//   dagens loebsdage (stribe)  ->  programmet (gitter)  ->  i gaar (kvittering)
//   ->  hele truppens dag (tabel)  ->  den valgte rytters kort  ->  assistenten
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

import { useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { DISPLAY_RECIPES } from "../../../lib/generated/displayRecipes.js";
import {
  countsForRole,
  pacePerWeek,
  programGrid,
  riderShortName,
  type RaceDayColumn,
} from "../../../lib/trainingMobileModel.ts";
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
};

export default function TrainingMobileToday({
  riders,
  columns,
  selectedRiderId,
  onSelectRider,
  conditionFor,
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
}: {
  riders: MobileRider[];
  columns: RaceDayColumn[];
  selectedRiderId: string | null;
  onSelectRider: (riderId: string) => void;
  conditionFor: (riderId: string) => { form?: number | null; fatigue?: number | null } | null;
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
        return { id: rider.id, name: riderShortName(rider), sub };
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

  // Striben: hvor mange koerer loeb, hvor mange traener — maalt paa truppen,
  // aldrig et saeson-tal.
  const splitFor = (column: RaceDayColumn) => {
    let racing = 0;
    for (const rider of riders) if (isRacing(rider.id, column)) racing += 1;
    return { racing, training: riders.length - racing };
  };

  const programRows = useMemo(
    () => programGrid(weekdays, columns, intensityForWeekday),
    [weekdays, columns, intensityForWeekday],
  );

  const selected = riders.find((rider) => rider.id === selectedRiderId) ?? null;

  return (
    <div className="space-y-3" data-testid="training-mobile-today">
      <TrainingRaceDayStrip columns={columns} splitFor={splitFor} />

      <TrainingProgramGrid weekdays={weekdays} rows={programRows} onEdit={onEditProgram} />

      {yesterdaySlot}

      {sortSlot}

      <TrainingMobileRoster
        riders={rosterRiders}
        columns={columns}
        cellFor={cellFor}
        selectedId={selectedRiderId}
        onSelect={onSelectRider}
        detailId={detailId}
      />

      {selected ? (
        <TrainingMobileRiderCard
          id={detailId}
          name={`${selected.firstname ?? ""} ${selected.lastname ?? ""}`.trim()}
          meta={[
            selected.primary_type ? tTypes(`types.${selected.primary_type}`) : null,
            selected.secondary_type && selected.secondary_type !== selected.primary_type
              ? tTypes(`types.${selected.secondary_type}`)
              : null,
          ]
            .filter(Boolean)
            .join(" / ")}
          form={conditionFor(selected.id)?.form ?? null}
          fatigue={conditionFor(selected.id)?.fatigue ?? null}
          dayLabel={dayLabelFor(selected.id)}
          receiptRows={receiptFor(selected.id)}
          countsFor={countsForRole(DISPLAY_RECIPES, selected.primary_type, abilitiesFor(selected.id), cappedFor(selected.id))}
          roleLabel={selected.primary_type ? tTypes(`types.${selected.primary_type}`) : null}
          pacePerWeek={pacePerWeek({ gainedPoints: seasonPointsFor(selected.id), daysElapsed: seasonDays })}
          seasonPoints={seasonPointsFor(selected.id)}
          onChangeDay={() => onOpenDay(selected.id)}
          changeDisabled={dayBusyFor(selected.id)}
        />
      ) : (
        <p id={detailId} className="px-1 text-2xs leading-snug text-cz-3">
          {t("mobile.pickRiderHint")}
        </p>
      )}

      {assistantSlot}
    </div>
  );
}
