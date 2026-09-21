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
// #3643 (ejer-beslutning 21/9, variant A): kortet folder ud LIGE UNDER den
// rytter man trykker paa — inde i listen, som en ekstra `<tr>` med een
// `<td colSpan>` i samme `<tbody>`. Foer stod det EEN gang under HELE tabellen,
// og beta-tester @egomadsen 19/9 ramte prisen: *"Der bliver meget scrolleri naar
// rytteren folder sig ud under tabellen. Den burde maaske bare folde sig ud lige
// under den paagaeldende rytter."* Maalt 21/9 paa rytter nr. 6 af 10: 201 px fra
// raekkens bund til kortets top — og en rigtig trup er 25-30 ryttere, ikke 10.
// Nu er afstanden 0 px.
//
// Hvorfor en raekke i SAMME tabel og ikke et element under den: kolonnebudgettet
// ovenfor bygger paa `table-fixed` + colgroup, og en `colSpan`-celle deltager
// ikke i den fordeling. Kortet kan altsaa fylde hele bredden uden at roere en
// eneste kolonnebredde. Raekken baerer INGEN onClick: et tryk inde i kortet (fx
// "Skift") maa ikke lukke det igen.
//
// Tastaturvejen er uaendret: knappen i navnecellen (aria-expanded/-controls);
// de oevrige celler er museklik-genveje til den samme handling.

import { Fragment, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { expandScrollAdjustment, type MobileScoreCell, type RaceDayColumn } from "../../../lib/trainingMobileModel.ts";

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
  detail = null,
  scoreFor = null,
}: {
  riders: RosterRider[];
  columns: RaceDayColumn[];
  cellFor: (riderId: string, column: RaceDayColumn) => RosterCell;
  selectedId: string | null;
  onSelect: (riderId: string) => void;
  // id'et paa det aabne kort, saa den valgte raekkes knap kan pege paa det.
  // Der er altid hoejst EET aabent kort, saa eet id er nok.
  detailId: string;
  // Den valgte rytters kort. Bygges af TrainingMobileToday (som ejer alle
  // kortets data) og indsaettes her, i raekken lige under rytteren.
  detail?: React.ReactNode;
  // #4851: dagens traeningsscore som en ekstra, sidste kolonne. `null` =
  // kolonnen findes IKKE i DOM'en — enten fordi `training_score_visible` er off,
  // eller fordi loebsdags-kolonnerne allerede bruger tabellens budget
  // (canShowScoreColumn). Kaldes kun naar kolonnen er der.
  scoreFor?: ((riderId: string) => MobileScoreCell) | null;
}) {
  const { t } = useTranslation("training");
  const single = columns.length === 1;
  // Navn + een pr. loebsdag + evt. score. Kortets celle skal spaende dem alle,
  // ellers ville `table-fixed` klemme den ned i navnekolonnens bredde.
  const detailColSpan = 1 + columns.length + (scoreFor ? 1 : 0);

  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const detailRowRef = useRef<HTMLTableRowElement | null>(null);

  // Naar et kort der stod OVER den trykkede raekke lukker, forsvinder dets
  // hoejde fra flowet og raekken under fingeren hopper op — i vaerste fald ud
  // af syne. Efter layout (useLayoutEffect koerer FOER browseren maler) rettes
  // rullepositionen saa raekken og kortets foerste 44 px staar synlige, og
  // kortet ikke gemmer sig bag den faste bundnavigation.
  //
  // Rullet er MOMENTANT, ikke "smooth": det er en layout-korrektion der skal
  // vaere sket inden fingeren loefter, ikke en effekt. Dermed er der heller
  // ingen ny animation at slaa fra for `prefers-reduced-motion` — fladen faar
  // ikke bevaegelse den ikke havde i forvejen.
  useLayoutEffect(() => {
    if (!selectedId) return;
    const row = rowRefs.current.get(selectedId);
    if (!row || typeof window === "undefined") return;
    const rowRect = row.getBoundingClientRect();
    const cardRect = detailRowRef.current?.getBoundingClientRect() ?? null;
    // Bundnavigationen (MobileQuickNav) ligger OVEN PAA indholdet, saa dens
    // hoejde maales i stedet for at blive gentaget som et tal her. Findes den
    // ikke (desktop-bredder), er hele viewporten synlig.
    const navHeight =
      document.querySelector("[data-mobile-quick-nav]")?.getBoundingClientRect().height ?? 0;
    const delta = expandScrollAdjustment({
      rowTop: rowRect.top,
      rowBottom: rowRect.bottom,
      cardBottom: cardRect?.bottom ?? rowRect.bottom,
      safeBottom: window.innerHeight - navHeight,
    });
    if (delta) window.scrollBy(0, delta);
  }, [selectedId]);

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
              <Fragment key={rider.id}>
              <tr
                ref={(el) => {
                  if (el) rowRefs.current.set(rider.id, el);
                  else rowRefs.current.delete(rider.id);
                }}
                className={isSelected ? "bg-cz-subtle" : ""}
              >
                <td className="border-b border-e border-cz-border align-middle last:border-b-0">
                  <button
                    type="button"
                    onClick={() => onSelect(rider.id)}
                    aria-expanded={isSelected}
                    // Kortet findes kun mens raekken er foldet ud, saa
                    // `aria-controls` saettes kun dér: et id der peger paa et
                    // element der ikke er i DOM'en er et loefte skaermlaeseren
                    // ikke kan indfri.
                    aria-controls={isSelected ? detailId : undefined}
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
              {/* Kortet, lige under rytteren. Raekken har INGEN onClick: et tryk
                  inde i kortet (fx "Skift") maa ikke lukke det igen. Cellen er
                  uden padding — kortet baerer sin egen (`p-3`), praecis som da
                  det stod under tabellen. */}
              {isSelected && detail && (
                <tr ref={detailRowRef}>
                  <td colSpan={detailColSpan} className="border-b border-cz-border p-0 align-top">
                    {detail}
                  </td>
                </tr>
              )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
