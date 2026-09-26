// TrainingMobileRiderCard — den valgte rytters fulde kort (#3643, mockup 2).
//
// Tabellen giver overblikket; kortet giver dybden — for EEN rytter ad gangen,
// i en udfoldet raekke LIGE UNDER ham (ejer-beslutning 21/9, variant A; foer
// stod det een gang under hele tabellen, og beta-tester @egomadsen 19/9 maalte
// prisen i scroll: 201 px fra raekke til kort ved rytter nr. 6 af 10).
//
// Kortet tegner derfor ikke laengere sin egen ramme: det ligger inde i tabellens
// kort, og en ramme mere ville vaere en kasse i en kasse (TASTE P3). Den
// tinte(de) raekke ovenover er kortets hoved, og cellens hairline lukker det
// nedadtil. Indhold, typografi, farver og spacing er uaendrede.
//
// Indholdet er bundet af #3643-kommentaren 13/8:
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
import TrainingScoreSparkline, { type TrainingScorePoint } from "../TrainingScoreSparkline.tsx";
import RiderLink from "../../RiderLink.jsx";
import type { CountsForRow, MobileScoreCell } from "../../../lib/trainingMobileModel.ts";

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
  riderId = null,
  name,
  meta,
  form,
  fatigue,
  injuryLabel = null,
  dayLabel,
  receiptRows,
  countsFor,
  roleLabel,
  pacePerWeek,
  seasonPoints,
  onChangeDay,
  changeDisabled = false,
  score = null,
  scoreSpark = null,
  scoreAria,
  changeLabel,
  footer = null,
}: {
  id: string;
  // #5735: rytterens id, kun til at bygge profil-linket i sidehovedet. `null`
  // (kaldere der endnu ikke er wiret) falder tilbage til almindelig tekst —
  // RiderLink gør præcis det samme uden id.
  riderId?: string | null;
  name: string;
  meta: string;
  form: number | null;
  fatigue: number | null;
  /** #5462: faerdig skade-tekst ("Skadet: 3 loebsdage tilbage (ca. 4. okt.)") eller null. */
  injuryLabel?: string | null;
  dayLabel: string;
  receiptRows: ReceiptRow[] | null;
  countsFor: CountsForRow[];
  roleLabel: string | null;
  pacePerWeek: number | null;
  seasonPoints: number | null;
  onChangeDay: () => void;
  changeDisabled?: boolean;
  // #4851: dagens score. `null` = flaget er off ⇒ blokken findes ikke. De tre
  // tilstande er de samme som desktop-kolonnen og tabellen ovenfor: tal,
  // "loeb" uden tal, eller streg.
  score?: MobileScoreCell | null;
  // De sidste 7 traeningsdage. Loebsdage har ingen score og udelades af
  // kurven (#5486) — TrainingScoreSparkline filtrerer dem selv vaek, saa
  // linjen er ubrudt.
  scoreSpark?: TrainingScorePoint[] | null;
  scoreAria?: string;
  // #5485 (A3): kortet bruges nu ogsaa paa desktop, foldet ud under raekken.
  // Knappens tekst kan saettes ("Change day"), og `footer` baerer rytterens
  // ugeplan og profil-linket, som Clarity viste hoerer til INDE i kortet.
  changeLabel?: string;
  footer?: React.ReactNode;
}) {
  const { t } = useTranslation("training");
  const tRider = useTranslation("rider").t;

  return (
    // `aria-label` er rytterens navn: naar raekkens knap peger herhen med
    // `aria-controls`, skal maalet kunne navngives — ellers er "udfoldet" en
    // paastand uden en flade at pege paa.
    <section id={id} aria-label={name} className="bg-cz-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* #5735: navnet er et rigtigt link til profilen (ctrl/midterklik åbner
              ny fane) — RiderLink falder tilbage til almindelig tekst uden
              riderId, så kaldere der endnu ikke sender den, ser ingen ændring. */}
          <h3 className="truncate text-[15px] font-semibold text-cz-1">
            <RiderLink id={riderId} className="hover:underline">{name}</RiderLink>
          </h3>
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

      {/* #5462: skaden staar hvor form og traethed staar — EEN kort linje, samme
          tekst som roster-raekken og rytterprofilen. Ingen ekstra ramme (TASTE P3). */}
      {injuryLabel && (
        <p className="mt-2 text-[12px] font-medium text-cz-danger">{injuryLabel}</p>
      )}

      {/* #4851: dagens score, stort, med de sidste 7 loebsdage ved siden af.
          Samme form som rytterprofilens kort (RiderTrainingScoreCard) — to
          flader maa ikke sige det samme paa to maader. Kurvens opskrift er
          laast i docs/design/TASTE.md:40 og bor i TrainingScoreSparkline. */}
      {score && (
        <div
          className="mt-3 flex items-end justify-between gap-3 border-t border-cz-border pt-2.5"
          data-testid="training-mobile-score"
        >
          <div className="min-w-0">
            <div className="font-data text-3xs font-semibold uppercase tracking-[.09em] text-cz-3">
              {t("score.column")}
              {/* #5485 (ejer-valg A 23/9): foer dagens pas er tallet det
                  SENESTE, daempet, og maerket siger det. */}
              {score.state === "latest" && (
                <span className="ms-1.5 normal-case tracking-normal" title={t("score.latestHint")}>
                  · {t("score.latest")}
                </span>
              )}
            </div>
            <div
              className={`mt-0.5 font-data text-2xl font-bold leading-none tabular-nums ${score.state === "latest" ? "text-cz-3" : "text-cz-1"}`}
              data-score-state={score.state}
            >
              {score.state === "score" || score.state === "latest"
                ? score.value
                : score.state === "race"
                  ? <span className="text-sm font-semibold uppercase tracking-[.06em] text-cz-3">{t("score.raceDay")}</span>
                  : <span className="text-cz-3">—</span>}
            </div>
          </div>
          {/* Kurven staar altid naar der er maalte dage (#5485), ogsaa foer
              dagens pas og paa en hviledag. */}
          {(scoreSpark?.length ?? 0) > 0 && (
            <TrainingScoreSparkline points={scoreSpark} label={scoreAria} width={104} height={30} />
          )}
        </div>
      )}

      {/* Fremgangen pr. evne — det eneste paa fladen der flytter sig dagligt. */}
      {receiptRows?.length ? (
        // #2819: tourens "naeste +1"-trin peger paa fremgangen pr. evne - det
        // samme indhold som desktop-kolonnen baerer.
        <div className="mt-3 border-t border-cz-border pt-2" data-tour="training-next-up">
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
          {changeLabel ?? t("mobile.change")}
        </button>
      </div>

      {seasonPoints != null && seasonPoints > 0 && (
        <p className="mt-2 font-data text-2xs tabular-nums text-cz-2">
          {t("mobile.seasonPoints", { n: seasonPoints })}
        </p>
      )}

      {footer && <div className="mt-3 border-t border-cz-border pt-2.5">{footer}</div>}
    </section>
  );
}
