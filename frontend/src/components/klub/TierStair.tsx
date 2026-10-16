// Niveau-trappen i et facilitets-kort (#6666, Klub retning D): alle 5 niveauer med
// hvad hvert niveau giver og hvad det koster. Det ejede niveau er markeret, det næste
// fremhævet. Tallene er API'ets (facility.ladder); står et niveaus effekt ikke i data,
// vises kun prisen. På en smal skærm scroller trappen vandret INDE i kortet, aldrig
// siden (min-bredde på listen + overflow-x-auto på rammen).
//
// Den gamle TierLadder.jsx (5 pips) bruges stadig af holdsidens Klub-fane og er
// uændret.
import { useTranslation } from "react-i18next";
import { formatNumber } from "../../lib/intl.js";
import { formatTrackEffect } from "../../lib/facilityDisplay.js";
import { stepState } from "../../lib/klubFacilityModel.ts";
import type { Facility, LadderRow, StepState } from "../../lib/klubFacilityModel.ts";

const STEP_CLASS: Record<StepState, string> = {
  owned: "border-cz-border bg-cz-subtle text-cz-3",
  current: "border-cz-1 bg-cz-subtle text-cz-1",
  next: "border-cz-accent bg-cz-card text-cz-1",
  future: "border-cz-border bg-cz-card text-cz-2",
};

function useStepEffect(track: string) {
  const { t } = useTranslation("klub");
  return (row: LadderRow): string | null => {
    if (track === "scouting") return t("ladder.scouting", { tier: row.tier });
    if (track === "academy") return t("ladder.academy", { count: row.bonus });
    if (track === "training") return formatTrackEffect(track, row.bonus);
    return null;
  };
}

export default function TierStair({ facility }: { facility: Facility }) {
  const { t } = useTranslation("klub");
  const effectFor = useStepEffect(facility.track);
  const rows = facility.ladder ?? [];
  if (rows.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <ol aria-label={t("ladder.label")} className="grid grid-cols-5 gap-[3px] min-w-[250px]">
        {rows.map((row) => {
          const state = stepState(row.tier, facility.tier);
          const effect = effectFor(row);
          const unlock = row.unlock ? t(`ladder.unlock.${row.unlock}`) : null;
          const showPrice = state === "next" || state === "future";
          return (
            <li
              key={row.tier}
              aria-current={state === "current" ? "step" : undefined}
              className={`flex flex-col gap-[2px] rounded-cz border px-[6px] py-[5px] min-w-0 ${STEP_CLASS[state]}`}
            >
              <span className="text-2xs font-semibold font-data tabular-nums whitespace-nowrap">
                {row.tier}
                {state === "current" && <span className="font-normal"> · {t("ladder.now")}</span>}
              </span>
              {effect && <span className="text-3xs font-data tabular-nums leading-tight">{effect}</span>}
              {unlock && <span className="text-3xs leading-tight">{unlock}</span>}
              {showPrice && (
                <span className="mt-auto pt-[2px] text-3xs font-data tabular-nums text-cz-2">{formatNumber(row.price)}</span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
