// #7778 · "Din dag" i højre kolonne: kun egne ryttere på etapen, plads, flag,
// navn og tidsgab (layout B). Udgåede står sidst med DNF/DNS og årsag (#7330).
// Planen mod det der skete bor i Taktik (valg 11), ikke her.
// Hvorfor?-knappen (#7717, kontakten rider_why_button) står ved dine ryttere som på den
// nuværende side: samme komponent, samme kontakt, samme adfærd.
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { asStory, castFrom } from "../stagePageV2/raceStoryModel.ts";
import { sortedClimbs, yourDay, type DnfRowInput, type ResultRow, type RoleRider, type StageProfile } from "../stagePageV2/stagePageV2Model.ts";
import { Flag, RiderLink, Section, SectionHeader, SkeletonLines } from "../stagePageV2/ui.ts";
import { RiderWhyButton, RiderWhyLine } from "../RiderWhy.tsx";
import { useStageTimeline } from "../../../hooks/useStageTimeline.js";
import { stageRouteMatch } from "../../../lib/lineupInsight.js";
import { withTimeLimitFatigue } from "../../../lib/raceRecap.js";
import { useRiderWhyEnabled } from "../../../lib/riderWhyFlag.ts";
import { buildV6RowWhy, v6RouteFits } from "./v6RowWhy.ts";

export interface V6YourDayProps {
  results: ResultRow[];
  stageNumber: number;
  myTeamId: string | null;
  dnfRows: DnfRowInput[];
  loaded: boolean;
  /** #7717: løbet, profilen og holdets roller, så Hvorfor?-sætningen kan bygges af løbets egen historie. */
  raceId?: string | null;
  profile?: StageProfile | null;
  stageRoles?: null | false | { riders?: RoleRider[] };
  nowMs?: number;
}

export default function V6YourDay({ results, stageNumber, myTeamId, dnfRows, loaded, raceId = null, profile = null, stageRoles = null, nowMs = 0 }: V6YourDayProps) {
  const { t } = useTranslation("races");
  const panelBase = useId();
  const [openKey, setOpenKey] = useState<string | null>(null);
  // Samme kilder som den nuværende side (StageTabV2): kontakten, løbshistorien og holdets rute-match.
  const whyEnabled = useRiderWhyEnabled(true);
  const { timeline, loading: storyLoading, error: storyError } = useStageTimeline(whyEnabled ? raceId : null, stageNumber, { story: true });
  const story = useMemo(() => asStory((timeline as { story?: unknown } | null)?.story), [timeline]);
  const events = (timeline as { events?: Parameters<typeof withTimeLimitFatigue>[1] } | null)?.events;
  const ranAt = (timeline as { created_at?: string | null } | null)?.created_at ?? null;
  const riders = useMemo(() => (stageRoles ? stageRoles.riders ?? [] : []), [stageRoles]);
  const climbs = useMemo(() => sortedClimbs(profile), [profile]);
  const cast = useMemo(() => castFrom(results, riders, stageNumber, myTeamId), [results, riders, stageNumber, myTeamId]);
  const routeFits = useMemo(
    () => v6RouteFits(new Map<string, number | null>(riders.map((r) => [r.rider_id, stageRouteMatch(r, stageNumber)])), ranAt, nowMs),
    [riders, stageNumber, ranAt, nowMs],
  );
  const outRows = useMemo<DnfRowInput[]>(() => withTimeLimitFatigue(dnfRows, events), [dnfRows, events]);
  const why = useMemo(
    () => buildV6RowWhy({ enabled: whyEnabled, storyError, storyLoading, events, story, climbs, cast, routeFits }),
    [whyEnabled, storyError, storyLoading, events, story, climbs, cast, routeFits],
  );
  const mine = loaded ? yourDay(results, stageNumber, myTeamId, "stage", outRows).mine : [];
  return (
    <div data-race-section="your_day">
      <Section aria-label={t("racePageV6.yourDay.title")}>
        <SectionHeader title={t("racePageV6.yourDay.title")} />
        {!loaded ? <SkeletonLines lines={4} /> : !mine.length ? (
          <p className="m-0 border-t border-cz-border py-2.5 text-sm text-cz-3">{t("stagePageV2.yourDay.noRiders")}</p>
        ) : (
          <ul className="m-0 p-0">
            {mine.map((r) => {
              const rowWhy = why?.forRow(r) ?? null;
              const panelId = `${panelBase}-${r.key}`;
              return (
              <li key={r.key} className={`flex min-h-11 items-center gap-2.5 border-t border-cz-border px-1 ${rowWhy ? "flex-wrap" : ""}`}>
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
                {rowWhy && <RiderWhyButton open={openKey === r.key} panelId={panelId} name={r.name} onToggle={() => setOpenKey(openKey === r.key ? null : r.key)} />}
                {rowWhy && openKey === r.key && <RiderWhyLine id={panelId} why={why?.loading ? null : rowWhy} />}
              </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
