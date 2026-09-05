import { useTranslation } from "react-i18next";
import { Section, SectionHeader, ProgressMeter } from "../../components/ui";
import { formatWeekdayShortDate } from "./boardroomFormat";

// #4557 · Boardroom · Tillidskort (Main.dc.html §1). Stort tabular-nums-tal +
// ugedelta, 4 kategorimetre (gold fyld, amber under ~60 pr. mockup) og en
// konsekvens-forklaringslinje under hairline. Ingen egen loading/error —
// BoardroomPage swapper hele kort-kroppen ét niveau op (canonical states).
// #4557 (overblik + faner) · `lastMovement` er referatets NYESTE raekke
// (payloadens `minutes[0]`) — mockup 6/9's "Last movement: ... Sun 30 Aug." i
// kortets venstre fod. Mangler den (nyt hold, ingen kvitteringer endnu),
// udelades linjen HELT; en tom "Last movement:"-etiket ville vaere chrome uden
// data (TASTE P11), praecis som GoalReceipt allerede goer det pr. maal.
export default function ConfidenceCard({ confidence, lastMovement = null }) {
  const { t } = useTranslation("board");
  const { value, weekDelta, updatedAt, categories = [], consequence } = confidence;

  const deltaClass = weekDelta > 0 ? "text-cz-success" : weekDelta < 0 ? "text-cz-danger" : "text-cz-3";
  const deltaText = weekDelta > 0
    ? t("boardroom.confidence.weekDeltaUp", { delta: weekDelta })
    : weekDelta < 0
      ? t("boardroom.confidence.weekDeltaDown", { delta: weekDelta })
      : t("boardroom.confidence.weekDeltaFlat");

  return (
    <Section>
      <SectionHeader
        title={t("boardroom.confidence.cardTitle")}
        meta={t("boardroom.confidence.updated", { date: formatWeekdayShortDate(updatedAt) })}
      />
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="flex items-baseline gap-2.5">
          <span className="font-data text-[44px] font-bold leading-none tabular-nums text-cz-1">{value}</span>
          <span className={`text-[13px] font-semibold tabular-nums ${deltaClass}`}>{deltaText}</span>
        </div>
        <div className="grid flex-1 grid-cols-2 gap-3.5 sm:grid-cols-4">
          {categories.map((cat) => {
            const tone = cat.score < 60 ? "warning" : "accent";
            return (
              <div key={cat.key}>
                <p className="mb-1.5 text-3xs font-semibold uppercase tracking-[.1em] text-cz-3">
                  {t(`boardroom.confidence.categories.${cat.key}`, { defaultValue: cat.key })}
                </p>
                <ProgressMeter value={cat.score} tone={tone} ariaLabel={t(`boardroom.confidence.categories.${cat.key}`, { defaultValue: cat.key })} />
                <p className="mt-1 font-data text-xs font-semibold tabular-nums text-cz-1">{cat.score}</p>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-1.5 border-t border-cz-border pt-3 text-[13px] text-cz-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        {lastMovement?.textKey ? (
          <p className="min-w-0">
            <span className="font-medium text-cz-1">{t("boardroom.mandate.receipt.lastMovementPrefix")}</span>{" "}
            {t(lastMovement.textKey, lastMovement.textParams || {})}
            {lastMovement.occurredAt ? `, ${formatWeekdayShortDate(lastMovement.occurredAt)}.` : ""}
          </p>
        ) : <span />}
        <p className="min-w-0 sm:text-end">
          {consequence?.active
            ? t(consequence.lineKey, consequence.lineParams || {})
            : t("boardroom.confidence.noConsequenceDefault")}
        </p>
      </div>
    </Section>
  );
}
