// AbilityReceiptRow — én evne-linje i trænings-kvitteringen (#3709 trin 1).
//
// Kvitteringen har tre tal og intet løfte: hvad evnen står på NU, hvor mange
// hele point rytteren har fået i DENNE SÆSON, og hvor langt han er mod næste
// point. En låst evne skriver "færdig" i stedet for en død bar. Ordet "aldrig"
// bruges ikke, og der vises aldrig et loft-tal: `ability_caps` forlader aldrig
// serveren (#1162), så fladen kender kun NØGLERNE på de låste evner.
//
// Samme komponent på begge flader (/training's roster-tabel og rytterprofilens
// Træning-fane), med copy fra ÉT navnerum ("training"), så de to steder ikke kan
// komme til at sige forskellige ting om samme rytter. Rod-årsagen bag #3639 var
// præcis det modsatte: ÉN aggregeret bar pr. fokus, som viste evnen tættest på
// gennembrud og dermed skjulte den låste evne ved siden af.
//
// Rækken er ren visning — al afledning sker i lib/trainingReport.js
// (abilityReceipt / focusAbilityReceipt), som er unit-testet isoleret.
//
// #3924 trin 2 (design-go 20/8): baren bærer et mørkere gold-segment
// (#a07800) der viser gårsdagens bidrag til den viste pct — row.yesterdayPct,
// også afledt (og unit-testet) i trainingReport.js. Løser #3988: 67% af hårde
// pas viste +0 i dag i gained-kolonnen og blev læst som bugs.

import { useTranslation } from "react-i18next";

// Bredder er faste, så de fire kolonner flugter linje for linje (tabular-nums på
// al numerik, jf. docs/design/PAGE_TEMPLATES.md).
export default function AbilityReceiptRow({ row, inFocus = false }) {
  const { t } = useTranslation("training");
  const { t: tRider } = useTranslation("rider");
  const { ability, value, gained, pct, locked, yesterdayPct } = row;
  const label = tRider(`racePreview.derived.${ability}`);

  return (
    <div className="flex items-center gap-2 py-[3px]">
      <span className="flex flex-none w-[5px] justify-center" aria-hidden="true">
        {inFocus && <span className="block h-[5px] w-[5px] rounded-full bg-cz-accent" />}
      </span>
      <span
        className={`flex-1 min-w-0 truncate text-2xs ${inFocus ? "text-cz-1 font-semibold" : "text-cz-2"}`}
        title={inFocus ? t("receipt.inFocusTitle") : undefined}
      >
        {label}
      </span>

      {/* Nu */}
      <span className="flex-none w-[24px] text-right font-mono tabular-nums text-2xs text-cz-1">
        {value ?? "—"}
      </span>

      {/* Point i denne sæson. null = sæsonen er ukendt (ingen aktiv sæson hentet)
          → "—", aldrig et opfundet "+0". */}
      <span
        className={`flex-none w-[28px] text-right font-mono tabular-nums text-2xs ${
          gained > 0 ? "text-cz-success" : "text-cz-3"
        }`}
      >
        {gained == null ? "—" : `+${gained}`}
      </span>

      {/* På vej mod næste point, eller "færdig" på en låst evne. */}
      {locked ? (
        <span
          className="flex-none w-[72px] text-right font-data text-3xs uppercase tracking-[.06em] text-cz-3 cursor-help"
          title={t("receipt.doneTitle")}
        >
          {t("receipt.done")}
        </span>
      ) : pct == null ? (
        <span className="flex-none w-[72px] text-right font-mono tabular-nums text-3xs text-cz-3">—</span>
      ) : (
        <span
          className="flex-none w-[72px] flex items-center gap-1.5"
          title={yesterdayPct > 0 ? t("receipt.yesterdayContribution", { pct: yesterdayPct }) : undefined}
        >
          <span className="relative h-1 flex-1 rounded-full bg-cz-subtle" aria-hidden="true">
            <span
              className="absolute left-0 top-0 h-full rounded-full bg-cz-accent/85 transition-[width] duration-500"
              style={{ width: `${pct}%` }}
            />
            {/* #3924 trin 2 (design-go 20/8): gårsdagens bidrag som mørkere segment
                oven på fylden — #3988-fundet var at et +0-pas er usynligt i baren.
                Positioneret som HALEN af fylden (segmentet ER den seneste tilvækst),
                aldrig bredere end selve fylden (yesterdayPct <= pct, se trainingReport.js). */}
            {yesterdayPct > 0 && (
              <span
                className="absolute top-0 h-full rounded-full bg-[#a07800] transition-[width] duration-500"
                style={{ left: `${Math.max(0, pct - yesterdayPct)}%`, width: `${Math.min(yesterdayPct, pct)}%` }}
              />
            )}
          </span>
          <span className="flex-none w-[24px] text-right font-mono tabular-nums text-3xs text-cz-3">
            {pct}%
          </span>
        </span>
      )}
    </div>
  );
}

// Kolonne-overskrift til en blok af AbilityReceiptRow. Samme faste bredder, så
// overskriften står præcis over sin kolonne.
export function AbilityReceiptHeader() {
  const { t } = useTranslation("training");
  return (
    <div className="flex items-center gap-2 pb-1 border-b border-cz-border font-data text-3xs uppercase tracking-[.08em] text-cz-3">
      <span className="flex-none w-[5px]" aria-hidden="true" />
      <span className="flex-1 min-w-0 truncate">{t("receipt.colAbility")}</span>
      <span className="flex-none w-[24px] text-right">{t("receipt.colNow")}</span>
      <span className="flex-none w-[28px] text-right">{t("receipt.colSeason")}</span>
      <span className="flex-none w-[72px] text-right">{t("receipt.colProgress")}</span>
    </div>
  );
}
