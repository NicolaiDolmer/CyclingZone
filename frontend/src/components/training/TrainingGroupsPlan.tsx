// TrainingGroupsPlan — Plan-fanen naar "Plan for" er en GRUPPE (#6000, mockup pin 1-3, 6).
//
// Samme kort som holdet og rytteren (TrainingPlanCard), ingen ny fane og intet
// nyt kort:
//   · "Fatigue tonight" = gruppens mest traette rytter (pin 2).
//   · Et felt rettes for hele gruppen; rytterne med en etape beholder etapen
//     (regel A, pin 3). Et felt vises kun som "Stage" naar ALLE har etape i det.
//   · Ryttere der har faaet deres egen plan rettet, staar som chips ("egen plan
//     vinder", pin 6) med "Follow group" ved siden af.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import TrainingPlanCard, { type PlanForOption } from "./TrainingPlanCard.tsx";
import FatigueForecast from "./FatigueForecast.tsx";
import { ChevronRightIcon } from "../ui/icons/index.jsx";
import type { ForecastResponse } from "./FatigueForecastModel.ts";
import type { RaceDayColumn } from "../../lib/trainingMobileModel.ts";
import type { CatalogProgram, ProgramWeekDays } from "../../lib/trainingPrograms.ts";
import { groupForecastEntry, groupLockedSlots, type TrainingGroup } from "./groups/trainingGroupsModel.ts";
import type { TrainingGroupsClient } from "./groups/useTrainingGroups.ts";

export default function TrainingGroupsPlan({
  weekdays,
  todayWeekday,
  columns,
  planFor,
  planForOptions,
  onPlanFor,
  group,
  client,
  forecast,
  lockedFor,
  catalog,
  riderShortName,
  onEdit,
}: {
  weekdays: readonly string[];
  todayWeekday: string;
  columns: RaceDayColumn[];
  planFor: string;
  planForOptions: PlanForOption[];
  onPlanFor: (value: string) => void;
  group: TrainingGroup;
  client: TrainingGroupsClient;
  forecast: ForecastResponse | null;
  lockedFor: (riderId: string) => ReadonlySet<number>;
  catalog: CatalogProgram[];
  riderShortName: (riderId: string) => string;
  onEdit: () => void;
}) {
  const { t } = useTranslation("training");
  const [message, setMessage] = useState<string | null>(null);
  const memberIds = group.members.map((m) => m.riderId);
  const followers = group.members.filter((m) => m.followsGroup).map((m) => m.riderId);
  const ownPlanIds = group.members.filter((m) => !m.followsGroup).map((m) => m.riderId);
  const entry = groupForecastEntry(forecast?.riders, memberIds);
  const intro = memberIds.length === 0
    ? t("groups.emptyHint")
    : group.isSeed ? t("groups.seedHint") : t("groups.intro", { n: followers.length });

  const extra = (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="training-group-actions">
      <button
        type="button"
        onClick={onEdit}
        className="inline-flex min-h-11 items-center gap-0.5 text-xs font-medium text-cz-accent-t hover:underline sm:min-h-0"
        data-testid="training-group-edit"
      >
        {t("groups.edit")}
        <ChevronRightIcon size={12} aria-hidden="true" />
      </button>
      {ownPlanIds.length > 0 && (
        <button
          type="button"
          disabled={client.busy}
          onClick={async () => {
            const result = await client.follow(group.id, ownPlanIds);
            setMessage(result.ok ? null : t("groups.error"));
          }}
          className="inline-flex min-h-11 items-center text-xs font-medium text-cz-accent-t hover:underline disabled:opacity-50 sm:min-h-0"
          data-testid="training-group-follow"
        >
          {t("groups.followAll", { n: ownPlanIds.length })}
        </button>
      )}
    </span>
  );

  return (
    <TrainingPlanCard
      weekdays={weekdays}
      todayWeekday={todayWeekday}
      columns={columns}
      planFor={planFor}
      planForOptions={planForOptions}
      onPlanFor={(value) => { setMessage(null); onPlanFor(value); }}
      planForExtra={extra}
      forecast={entry ? (
        <FatigueForecast
          entry={{ fatigue: entry.fatigue, band: entry.band as "ok" | "warn" | "risk" | null }}
          settled={forecast?.settled === true}
          label={t("forecast.teamLabel")}
        />
      ) : null}
      intro={intro}
      intensity={null}
      cells={group.days ? {
        days: group.days as ProgramWeekDays,
        isSeed: false,
        program: catalog.find((p) => p.key === group.programKey) ?? null,
        lockedToday: groupLockedSlots(memberIds.map(lockedFor)),
        busy: client.busy,
        onSetCell: async (weekday, slotIndex, session) => {
          const result = await client.setCell(group.id, weekday, slotIndex, session);
          setMessage(result.ok ? null : t(result.error === "train_now_locked" ? "groups.locked" : "groups.error"));
        },
        message,
      } : null}
      ownPlans={ownPlanIds.map((id) => ({ id, name: riderShortName(id) }))}
      onOpenOwnPlan={(riderId) => { setMessage(null); onPlanFor(riderId); }}
    />
  );
}
