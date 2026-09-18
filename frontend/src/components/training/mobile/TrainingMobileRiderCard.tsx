// TrainingMobileRiderCard — den valgte rytters fulde kort (#3643, mockup 2).
//
// Tabellen giver overblikket; kortet giver dybden — EEN gang, under tabellen,
// i stedet for i hver raekke. Indholdet er bundet af #3643-kommentaren 13/8:
//
//   1. fremgang pr. evne for det aktive fokus (AbilityReceiptRow, den samme
//      kvittering rytterprofilen viser — to flader kan ikke sige forskelligt)
//   2. "taeller for <rolle>": rollens opskrift som evne-chips MED rytterens
//      egne tal, lagt dér hvor beslutningen tages
//   3. loftet som chip i evnelisten, ikke bag vandret scroll
//   4. tempo formuleret som HASTIGHED ("ca. N point om ugen"), ALDRIG som
//      ankomsttid — en ankomsttid ville afsloere det maskerede loft (#1162)
//
// Tempoet er MAALT paa rytterens egne landede point i saesonen, ikke en
// fremskrivning, og linjen udelades helt naar grundlaget er for tyndt (P11).

import { useTranslation } from "react-i18next";
import AbilityReceiptRow from "../AbilityReceiptRow.jsx";
import type { CountsForRow } from "../../../lib/trainingMobileModel.ts";

export type ReceiptRow = {
  ability: string;
  value: number | null;
  gained: number | null;
  pct: number | null;
  locked: boolean;
  yesterdayPct: number;
};

export default function TrainingMobileRiderCard({
  id,
  name,
  meta,
  form,
  fatigue,
  dayLabel,
  receiptRows,
  countsFor,
  roleLabel,
  pacePerWeek,
  seasonPoints,
  onChangeDay,
  changeDisabled = false,
}: {
  id: string;
  name: string;
  meta: string;
  form: number | null;
  fatigue: number | null;
  dayLabel: string;
  receiptRows: ReceiptRow[] | null;
  countsFor: CountsForRow[];
  roleLabel: string | null;
  pacePerWeek: number | null;
  seasonPoints: number | null;
  onChangeDay: () => void;
  changeDisabled?: boolean;
}) {
  const { t } = useTranslation("training");
  const tRider = useTranslation("rider").t;

  return (
    <section id={id} className="rounded-cz border border-cz-border bg-cz-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold text-cz-1">{name}</h3>
          <p className="mt-px font-data text-3xs font-medium uppercase tracking-[.07em] text-cz-3">{meta}</p>
        </div>
        <div className="flex flex-none gap-3 text-end">
          <div>
            <div className="font-data text-3xs font-semibold uppercase tracking-[.08em] text-cz-3">{t("form")}</div>
            <div className="font-data text-sm font-semibold leading-tight tabular-nums text-cz-1">{form ?? "—"}</div>
          </div>
          <div>
            <div className="font-data text-3xs font-semibold uppercase tracking-[.08em] text-cz-3">{t("fatigue")}</div>
            <div className="font-data text-sm font-semibold leading-tight tabular-nums text-cz-1">{fatigue ?? "—"}</div>
          </div>
        </div>
      </div>

      {/* Fremgangen pr. evne — det eneste paa fladen der flytter sig dagligt. */}
      {receiptRows?.length ? (
        <div className="mt-3 border-t border-cz-border pt-2">
          <div className="font-data text-3xs font-semibold uppercase tracking-[.09em] text-cz-3">
            {t("receipt.title")}
          </div>
          <div className="mt-1">
            {receiptRows.map((row) => (
              <AbilityReceiptRow key={row.ability} row={row} inFocus />
            ))}
          </div>
        </div>
      ) : null}

      {/* "Taeller for sprinter" — rollens opskrift, med rytterens egne tal. */}
      {countsFor.length > 0 && roleLabel && (
        <div className="mt-3 border-t border-cz-border pt-2">
          <div className="font-data text-3xs font-semibold uppercase tracking-[.09em] text-cz-3">
            {t("mobile.countsFor", { role: roleLabel })}
          </div>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {countsFor.map((row) => (
              <li
                key={row.ability}
                className={`inline-flex items-baseline gap-1.5 rounded-cz-pill border px-2 py-0.5 font-data text-2xs bg-cz-elevated ${
                  row.atCap ? "border-cz-warning/40 text-cz-warning" : "border-cz-border text-cz-2"
                }`}
              >
                <span>{tRider(`racePreview.derived.${row.ability}`)}</span>
                <b className="font-semibold tabular-nums text-cz-1">{row.value ?? "—"}</b>
                {row.atCap && (
                  <span className="font-data text-3xs font-semibold uppercase tracking-[.07em]">
                    {t("mobile.atCap")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Dagens valg + tempo. Den ENE gold primary paa fladen er
          "Koer dagens traening" i sidehovedet — knappen her er sekundaer. */}
      <div className="mt-3 flex items-end justify-between gap-3 border-t border-cz-border pt-2.5">
        <div className="min-w-0">
          <div className="font-data text-3xs font-semibold uppercase tracking-[.09em] text-cz-3">
            {t("dayPanel.colDay")}
          </div>
          <div className="truncate text-[13px] font-medium text-cz-1">{dayLabel}</div>
          {pacePerWeek != null && (
            <div className="mt-1 font-data text-2xs tabular-nums text-cz-2">
              {t("mobile.pace", { n: pacePerWeek })}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onChangeDay}
          disabled={changeDisabled}
          className="inline-flex min-h-11 min-w-[88px] flex-none items-center justify-center rounded-cz border border-cz-border bg-cz-card px-3 font-data text-[13px] font-semibold text-cz-1 transition-colors hover:border-cz-2/40 hover:bg-cz-subtle disabled:opacity-40"
        >
          {t("mobile.change")}
        </button>
      </div>

      {seasonPoints != null && seasonPoints > 0 && (
        <p className="mt-2 font-data text-2xs tabular-nums text-cz-2">
          {t("mobile.seasonPoints", { n: seasonPoints })}
        </p>
      )}
    </section>
  );
}
