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
import { fetchTeamOrders } from "../../lib/tacticsOrdersAdapter.js";
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

const ROLE_KEYS = new Set(["captain", "sprint_captain", "hunter", "helper", "free_role"]);
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

  const stanceText = recap.stance === "auto"
    ? t("stageOrders.stanceAuto")
    : t(`tacticsOrders.breakaway.${STANCE_KEYS.has(recap.stance) ? recap.stance : "neutral"}`);
  return (
    <Section aria-label={t("stageOrders.title")}>
      <SectionHeader title={t("stageOrders.title")} meta={t("tacticsOrders.locked")} />
      <p className="mb-2 text-sm text-cz-2">
        {t("tacticsOrders.breakawayLabel")}: <span className="font-semibold text-cz-1">{stanceText}</span>
        {!recap.saved && <span className="text-cz-3"> · {t("stageOrders.roleDefaults")}</span>}
      </p>
      <ul>
        {recap.riders.map((r) => {
          const tags = [
            r.role && ROLE_KEYS.has(r.role) ? t(`tacticsOrders.roleLabel.${r.role}`) : null,
            t(`tacticsOrders.effort.${EFFORT_KEYS.has(r.effort) ? r.effort : "normal"}`),
            r.tryBreak ? t("tacticsOrders.tryBreak") : null,
            r.leadout ? t("tacticsOrders.leadout") : null,
            r.roleDefault ? t("stageOrders.roleDefaultShort") : null,
          ].filter(Boolean);
          return (
            <li key={r.riderId} className="flex min-h-11 flex-wrap items-baseline gap-x-3 gap-y-0.5 border-t border-cz-border py-2 first:border-t-0">
              <RiderLink id={r.riderId} className="min-w-0 flex-1 truncate text-sm font-semibold text-cz-1 hover:text-cz-accent-t">{r.name || t("tacticsOrders.riderFallback")}</RiderLink>
              <span className="text-xs text-cz-2">{tags.join(" · ")}</span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
