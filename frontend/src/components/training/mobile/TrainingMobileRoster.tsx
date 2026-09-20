// TrainingMobileRoster — hele truppens dag paa eet blik (#3643, mockup 2).
//
// Raekker = ryttere, kolonner = dagens loebsdage. Ingen kolonne ligger bag
// skaermkanten: tabellen er `table-fixed` i en `overflow-hidden`-ramme, og
// navnecellen wrapper i stedet for at staa paa een nowrap-linje. Det er den
// samme haandhaevelse D-047 kraever ("ikke haabet om at indholdet passer"),
// men uden chip-byttere: der er ikke laengere fem kolonner at vaelge imellem.
//
// #5350 (spillerfund 6/9): fornavne i fuld laengde aad bredden, og ryttertypen
// fyldte en hel badge. Navnet er nu "M. Sørensen" + een dæmpet underlinje med
// type, form og traethed — samme form som Mit Hold, som spillerne selv pegede paa.
//
// #4851 (ejer-review 20/9): bredderne var vendt forkert. Navnekolonnen stod paa
// faste 124 px mens `table-fixed` delte HELE resten ligeligt mellem TODAY og
// SCORE — saa "VO2" fik 115 px, mens "TIME-TRIALIST/COBBLES SPECIALIST · F78 ·
// T59" blev presset ned i 3-4 linjer og stak ud over kolonnestregen (samme
// fejlklasse som #5383/#5410; den blev synlig da #5449 fik table-fixed til at
// virke). Nu er det omvendt: tal-kolonnerne er SMALLE og faste, maalt efter
// deres eget laengste indhold, og navnet faar resten.
//
// Rytteren man trykker paa faar sit fulde kort EEN gang UNDER tabellen, ikke i
// hver raekke. Tastaturvejen er knappen i navnecellen (aria-expanded/-controls);
// de oevrige celler er museklik-genveje til den samme handling.

import { useTranslation } from "react-i18next";
import type { MobileScoreCell, RaceDayColumn } from "../../../lib/trainingMobileModel.ts";

export type RosterCell = {
  label: string;
  tone: "race" | "session" | "off";
  title?: string;
};

export type RosterRider = {
  id: string;
  name: string;
  sub: string;
};

// Tal-kolonnernes faste bredder (#4851, ejer-review 20/9). De er MAALT paa det
// laengste indhold kolonnen kan faa, ikke gaettet:
//
//   loebsdag  "Ikke valgt" (DA `mobile.noDay`, 10 tegn) er den laengste celle;
//             derefter "Løbslære" og "Tærskel". 62 px baerer dem paa een linje
//             i Inter Tight 11 px inkl. cellens px-1 og chippens px-0.5.
//   score     "Løb"/"Race" i 10 px uppercase med tracking, og overskriften
//             "SCORE" selv — den er bredere end de to cifre under den.
//
// Navnekolonnen faar med vilje INGEN bredde: `table-fixed` giver den alt hvad
// tal-kolonnerne ikke bruger, saa den vokser naar der kun er een loebsdag og
// krymper naar der kommer flere — i stedet for at staa fast paa 124 px mens
// tallene svoemmer i tom plads.
const RACE_DAY_COL = "w-[62px]";
const SCORE_COL = "w-[46px]";

export default function TrainingMobileRoster({
  riders,
  columns,
  cellFor,
  selectedId,
  onSelect,
  detailId,
  scoreFor = null,
}: {
  riders: RosterRider[];
  columns: RaceDayColumn[];
  cellFor: (riderId: string, column: RaceDayColumn) => RosterCell;
  selectedId: string | null;
  onSelect: (riderId: string) => void;
  // id'et paa kortet under tabellen, saa raekkens knap kan pege paa det.
  detailId: string;
  // #4851: dagens traeningsscore som en ekstra, sidste kolonne. `null` =
  // kolonnen findes IKKE i DOM'en — enten fordi `training_score_visible` er off,
  // eller fordi loebsdags-kolonnerne allerede bruger tabellens budget
  // (canShowScoreColumn). Kaldes kun naar kolonnen er der.
  scoreFor?: ((riderId: string) => MobileScoreCell) | null;
}) {
  const { t } = useTranslation("training");
  const single = columns.length === 1;

  return (
    <div className="overflow-hidden rounded-cz border border-cz-border bg-cz-card">
      <div className="flex items-center justify-between gap-2 border-b border-cz-border px-3 py-2">
        <span className="text-[13px] font-semibold text-cz-1">{t("mobile.rosterTitle")}</span>
        <span className="font-data text-2xs font-medium uppercase tracking-[.07em] text-cz-3">
          {t("mobile.riderCount", { n: riders.length })}
        </span>
      </div>

      <table className="w-full table-fixed border-separate border-spacing-0" data-testid="training-mobile-roster">
        {/* Bredderne staar i EEN colgroup i stedet for paa hver <th>: saa er
            "navnet tager resten" een linje man kan laese, og ikke en regel der
            skal genfindes i tre forskellige celle-klasser. */}
        <colgroup>
          <col />
          {columns.map((column) => (
            <col key={column.key} className={RACE_DAY_COL} />
          ))}
          {scoreFor && <col className={SCORE_COL} />}
        </colgroup>
        <thead>
          <tr>
            <th className="border-b border-e border-cz-border px-2.5 py-1.5 text-start font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3">
              {t("colRider")}
            </th>
            {columns.map((column) => (
              <th
                key={column.key}
                className="border-b border-cz-border px-1 py-1.5 text-center font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3"
              >
                {single ? t("mobile.today") : column.index}
              </th>
            ))}
            {/* #4851: scoren er den sidste kolonne — laesningen gaar "hvem,
                hvad koerer han, hvor godt gik det". */}
            {scoreFor && (
              <th className="border-b border-cz-border px-1 py-1.5 text-center font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3">
                {t("score.column")}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {riders.map((rider, index) => {
            const isSelected = rider.id === selectedId;
            return (
              <tr key={rider.id} className={isSelected ? "bg-cz-subtle" : ""}>
                <td className="border-b border-e border-cz-border align-middle last:border-b-0">
                  <button
                    type="button"
                    onClick={() => onSelect(rider.id)}
                    aria-expanded={isSelected}
                    aria-controls={detailId}
                    // #2819: onboarding-tourens foerste anker paa /training.
                    // Paa desktop sidder det paa Dag-knappen i raekken; her er
                    // raekken SELV vejen til dagens valg, saa ankeret hoerer paa
                    // den oeverste raekkes knap.
                    data-tour={index === 0 ? "training-focus" : undefined}
                    className="flex min-h-11 w-full min-w-0 flex-col justify-center px-2.5 py-1.5 text-start"
                  >
                    <span
                      title={rider.name}
                      className="w-full truncate text-[13px] font-medium leading-tight text-cz-1"
                    >
                      {rider.name}
                    </span>
                    {/* `break-words` er selve rettelsen (#4851): uden den brydes
                        "PUNCHEUR/BAROUDEUR" slet ikke — der er hverken mellemrum
                        eller bindestreg at bryde paa — og ordet loeb ud over
                        kolonnestregen. `line-clamp-2` er loftet ejeren satte:
                        meta-linjen maa fylde to linjer, aldrig fire. `title`
                        goer den afkortning laesbar (og lovlig for tekst-vagten,
                        #5383), men den udloeses foerst naar typenavnene er
                        laengere end de laengste vi har i dag. */}
                    <span
                      title={rider.sub}
                      className="mt-px line-clamp-2 w-full break-words font-data text-3xs font-medium uppercase tracking-[.05em] tabular-nums text-cz-3"
                    >
                      {rider.sub}
                    </span>
                  </button>
                </td>
                {columns.map((column) => {
                  const cell = cellFor(rider.id, column);
                  return (
                    <td
                      key={column.key}
                      onClick={() => onSelect(rider.id)}
                      className="border-b border-cz-border px-1 py-1.5 text-center align-middle"
                    >
                      <span
                        // Altid en `title`, ogsaa paa "Ikke valgt": kolonnen er
                        // smal og fast, saa skulle et sprog en dag have en
                        // laengere etikette, er afkortningen laesbar i stedet
                        // for tavs (og lovlig for tekst-vagten, #5383).
                        title={cell.title ?? cell.label}
                        className={`block truncate rounded-cz px-0.5 py-0.5 font-data text-2xs font-semibold leading-tight ${
                          cell.tone === "race"
                            ? "bg-cz-1 text-cz-card"
                            : cell.tone === "off"
                              ? "font-medium text-cz-3"
                              : "text-cz-1"
                        }`}
                      >
                        {cell.label}
                      </span>
                    </td>
                  );
                })}
                {scoreFor && (() => {
                  const score = scoreFor(rider.id);
                  return (
                    <td
                      onClick={() => onSelect(rider.id)}
                      // `tabular-nums` (TASTE, bindende paa al numerik): cifrene
                      // flugter lodret ned gennem truppen, saa kolonnen kan
                      // skannes uden at laese hvert tal.
                      className="border-b border-cz-border px-1 py-1.5 text-center align-middle font-data tabular-nums"
                    >
                      {score.state === "score" ? (
                        <span className="text-2xs font-bold leading-tight text-cz-1">{score.value}</span>
                      ) : score.state === "race" ? (
                        <span className="text-3xs font-medium uppercase tracking-[.06em] text-cz-3">
                          {t("score.raceDay")}
                        </span>
                      ) : (
                        <span className="text-2xs text-cz-3">—</span>
                      )}
                    </td>
                  );
                })()}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
