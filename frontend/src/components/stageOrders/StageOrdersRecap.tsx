// #6299 (b), ejer-go 24/10: "Your orders" på en kørt etape. Viser hver egen
// rytters låste ordre (rolle, indsats, udbrudsforsøg, sprint-tog) og holdets
// udbruds-holdning, så man bagefter kan se hvad rytterne kørte efter.
//
// Kun eget hold: fetchTeamOrders kalder GET /api/races/:raceId/team-orders, der
// svarer for den indloggede managers hold alene. Har siden allerede hentet
// svaret (RaceDetailPage's StageTab), sendes det ind som `teamOrders`.
// Renderer intet uden svar eller uden egne ryttere på etapen.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { RiderLink, Section, SectionHeader } from "../race/stagePageV2/ui.ts";
import { ChevronRightIcon } from "../ui/index.js";
import { isTimeTrialNarrative } from "../../../../backend/lib/engine/v4/mechanics/narrativeCauses6469.ts";
import { fetchTeamOrders } from "../../lib/tacticsOrdersAdapter.js";
import { roleLabelKey } from "../../lib/stageRoleVocabulary.ts";
import { stageOrdersRecap, type StageRolesLike, type TeamOrdersContext } from "./stageOrdersRecap.ts";

export interface StageOrdersRecapProps {
  raceId: string | null | undefined;
  stageNumber: number;
  /** Egne ryttere der kørte etapen. Tom = intet at vise. */
  riderIds: readonly string[];
  nameOf: (id: string) => string | null | undefined;
  profileType?: string | null;
  stageRoles?: StageRolesLike | null | false;
  ranAt?: string | null;
  /** Allerede hentet fetchTeamOrders-svar; undefined = komponenten henter selv. */
  teamOrders?: TeamOrdersContext | null;
}

const EFFORT_KEYS = new Set(["grupetto", "save", "normal", "protect", "all_out"]);
const STANCE_KEYS = new Set(["chase", "neutral", "let_go"]);

export default function StageOrdersRecap({
  raceId, stageNumber, riderIds, nameOf, profileType = null, stageRoles = null, ranAt = null, teamOrders,
}: StageOrdersRecapProps) {
  const { t } = useTranslation("races");
  const [fetched, setFetched] = useState<TeamOrdersContext | null>(null);
  const needsFetch = teamOrders === undefined && Boolean(raceId) && riderIds.length > 0;

  useEffect(() => {
    if (!needsFetch || !raceId) return undefined;
    let live = true;
    fetchTeamOrders({ raceId })
      .then((ctx) => { if (live) setFetched(ctx as TeamOrdersContext | null); })
      .catch(() => { /* catch-ok: ingen ordre-oversigt er bedre end en fejl midt i etapens resultat */ });
    return () => { live = false; };
  }, [needsFetch, raceId]);

  const context = teamOrders === undefined ? fetched : teamOrders;
  const recap = useMemo(
    () => (riderIds.length ? stageOrdersRecap({ context, stageRoles, stageNumber, profileType, riderIds, nameOf, ranAt }) : null),
    [context, stageRoles, stageNumber, profileType, riderIds, nameOf, ranAt],
  );
  if (!recap || !recap.riders.length) return null;

  const timeTrial = isTimeTrialNarrative([], profileType);
  const stanceText = recap.stance === "auto"
    ? t("stageOrders.stanceAuto")
    : t(`tacticsOrders.breakaway.${STANCE_KEYS.has(recap.stance) ? recap.stance : "neutral"}`);
  return (
    <Section aria-label={t("stageOrders.title")}>
      <SectionHeader title={t("stageOrders.title")} meta={t("tacticsOrders.locked")} />
      {!timeTrial && <p className="mb-2 text-sm text-cz-2">
        {t("tacticsOrders.breakawayLabel")}: <span className="font-semibold text-cz-1">{stanceText}</span>
        {!recap.saved && <span className="text-cz-3"> · {t("stageOrders.roleDefaults")}</span>}
      </p>}
      <ul>
        {recap.riders.map((r) => {
          const roleKey = roleLabelKey(r.role); // #7326: faelles vokabular; ukendt rolle = intet tag
          const tags = [
            roleKey ? t(roleKey) : null,
            r.plan ? null : t(`tacticsOrders.effort.${EFFORT_KEYS.has(r.effort) ? r.effort : "normal"}`), // #7333: en plan vises som planen, ikke foerste leds indsats
            !timeTrial && r.tryBreak ? t("tacticsOrders.tryBreak") : null,
            !timeTrial && r.leadout ? t("tacticsOrders.leadout") : null,
            r.roleDefault ? t("stageOrders.roleDefaultShort") : null,
          ].filter(Boolean);
          return (
            <li key={r.riderId} className="flex min-h-11 flex-wrap items-baseline gap-x-3 gap-y-0.5 border-t border-cz-border py-2 first:border-t-0">
              <RiderLink id={r.riderId} className="min-w-0 flex-1 truncate text-sm font-semibold text-cz-1 hover:text-cz-accent-t">{r.name || t("tacticsOrders.riderFallback")}</RiderLink>
              <span className="text-xs text-cz-2">
                {r.plan && r.plan.map((task, i) => ( // #7333
                  <span key={i} className="inline-flex items-center gap-1">
                    {i > 0 && <ChevronRightIcon size={12} aria-hidden="true" className="mx-0.5 shrink-0 text-cz-3" />}
                    {t(`stagePlan.task.${task}`)}
                  </span>
                ))}
                {r.plan && tags.length > 0 && " · "}
                {tags.join(" · ")}
              </span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
