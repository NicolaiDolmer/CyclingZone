// #7778 · "Din dag" i højre kolonne: kun egne ryttere på etapen, plads, flag,
// navn og tidsgab (layout B). Udgåede står sidst med DNF/DNS og årsag (#7330).
// Planen mod det der skete bor i Taktik (valg 11), ikke her.
import { useTranslation } from "react-i18next";
import { yourDay, type DnfRowInput, type ResultRow } from "../stagePageV2/stagePageV2Model.ts";
import { Flag, RiderLink, Section, SectionHeader, SkeletonLines } from "../stagePageV2/ui.ts";

export interface V6YourDayProps {
  results: ResultRow[];
  stageNumber: number;
  myTeamId: string | null;
  dnfRows: DnfRowInput[];
  loaded: boolean;
}

export default function V6YourDay({ results, stageNumber, myTeamId, dnfRows, loaded }: V6YourDayProps) {
  const { t } = useTranslation("races");
  const mine = loaded ? yourDay(results, stageNumber, myTeamId, "stage", dnfRows).mine : [];
  return (
    <div data-race-section="your_day">
      <Section aria-label={t("racePageV6.yourDay.title")}>
        <SectionHeader title={t("racePageV6.yourDay.title")} />
        {!loaded ? <SkeletonLines lines={4} /> : !mine.length ? (
          <p className="m-0 border-t border-cz-border py-2.5 text-sm text-cz-3">{t("stagePageV2.yourDay.noRiders")}</p>
        ) : (
          <ul className="m-0 p-0">
            {mine.map((r) => (
              <li key={r.key} className="flex min-h-11 items-center gap-2.5 border-t border-cz-border px-1">
                <span className={`w-9 flex-none text-right font-data font-semibold tabular-nums ${r.status ? "text-2xs text-cz-3" : "text-sm text-cz-1"}`}
                  title={r.status === "dns" ? t("detail.incidents.dnsTitle") : undefined}>
                  {r.status === "dnf" ? t("detail.incidents.dnf") : r.status === "dns" ? t("detail.incidents.dns") : (r.rank ?? "")}
                </span>
                {r.nation && <Flag code={r.nation} className="flex-none" />}
                <span className="min-w-0 flex-1 py-1.5">
                  <RiderLink id={r.riderId} className="block truncate text-sm font-semibold text-cz-1 hover:text-cz-accent-t">{r.name}</RiderLink>
                  {r.status && r.reasonKey && <span className="block truncate text-xs text-cz-3">{t(`detail.incidents.${r.reasonKey}`)}</span>}
                </span>
                {!r.status && <span className="w-16 flex-none text-right font-data text-xs tabular-nums text-cz-2">{r.gap ?? ""}</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
