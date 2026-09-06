// RaceTeamTab — løbssidens Hold-fane (#4613, variant A godkendt 6/9).
//
// Fanen svarer på ét spørgsmål gennem hele løbets liv: HVEM kører, og hvad var
// hans rolle? Kun formen skifter:
//
//   FØR    holdudtagelsen selv (RaceSelectionPanel) — hvem der kører og hvilken
//          rolle han har, med fanens ENE guld-knap ("Gem udtagelse").
//   UNDER  read-only. Truppen er frosset når flaget er faldet; kolonnerne
//          (fit / form / træthed) står tilbage som det manageren planlægger
//          resten af løbet efter.
//   EFTER  read-only læring: rollen, hvor han endte i klassementet, og DEN
//          intention du satte pr. etape — guld hvor du valgte, gråt hvor du lod
//          rollens standard stå. Det er det eneste sted en manager kan se om
//          valget var noget værd.
//
// Data under/efter: GET /api/races/:raceId/stage-roles (ryttere + roller +
// overrides + fit/form/træthed, tilføjet i #4613). /selection kan ikke bruges —
// den gater selv på race.status === 'scheduled'.
//
// FOG OF WAR: ingen procenter, ingen loft-signaler. Fit/form/træthed er de
// SAMME tal holdudtagelsen allerede viser for spillerens EGNE ryttere.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import RaceSelectionPanel from "./RaceSelectionPanel.jsx";
import FitBar from "../racehub/FitBar.jsx";
import { Section, SectionHeader, Button, SkeletonLines, LockIcon } from "../ui/index.js";
import { WRAP, SCROLLER } from "../ui/dataTableStyles.js";
import { overridesIndex, resolveCell, baseRoleForRider } from "../../lib/stageRoleMatrixLogic.js";
import { DEFAULT_EFFORT } from "../../lib/raceIntention.js";

const ROLE_KEY = {
  captain: "captain",
  sprint_captain: "sprint_captain",
  hunter: "hunter",
  helper: "helper",
  free_role: "free_role",
};
const roleKey = (role) => ROLE_KEY[role] || "helper";

function ReadOnlyRoster({ t, riders, stageNumbers, overridesMap, gcRankByRider, showStages, isOneDay }) {
  return (
    <div className={WRAP}>
      <div className={SCROLLER}>
        <table data-sort-exempt="Holdlisten foelger udtagelsens raekkefoelge, ikke en sorterbar kolonne" className="w-full text-sm">
          <thead>
            <tr className="border-b border-cz-border text-3xs uppercase tracking-wide text-cz-3">
              <th className="px-4 py-2 text-left font-medium" scope="col">{t("intention.colRider")}</th>
              <th className="px-4 py-2 text-left font-medium" scope="col">{t("intention.colRole")}</th>
              {showStages ? (
                <>
                  <th className="px-3 py-2 text-right font-medium" scope="col">{t("racePage.team.gc")}</th>
                  {stageNumbers.map((sn) => (
                    <th key={sn} className="px-3 py-2 text-left font-medium whitespace-nowrap" scope="col">
                      {isOneDay ? t("intention.raceDay") : t("racePage.team.stageShort", { number: sn })}
                    </th>
                  ))}
                </>
              ) : (
                <>
                  <th className="px-4 py-2 text-right font-medium" scope="col">{t("selection.routeMatch")}</th>
                  <th className="px-4 py-2 text-right font-medium" scope="col">{t("selection.form")}</th>
                  <th className="px-4 py-2 text-right font-medium" scope="col">{t("selection.fatigue")}</th>
                </>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-cz-border">
            {riders.map((rider) => (
              <tr key={rider.rider_id} className="hover:bg-cz-subtle transition-colors">
                <td className="px-4 py-2.5 text-cz-1 font-medium">{rider.name || "—"}</td>
                <td className="px-4 py-2.5">
                  <div className="text-cz-1 text-xs">{t(`tacticsOrders.roleLabel.${roleKey(baseRoleForRider(rider))}`)}</div>
                  <div className="text-3xs uppercase tracking-wider text-cz-3 mt-0.5">
                    {isOneDay ? t("intention.thisRace") : t("intention.allRace")}
                  </div>
                </td>
                {showStages ? (
                  <>
                    <td className="px-3 py-2.5 text-right font-data text-xs tabular-nums text-cz-1">
                      {rider.abandoned
                        ? <span className="text-cz-3">{t("racePage.team.dnf")}</span>
                        : (gcRankByRider?.get(rider.rider_id) ?? "—")}
                    </td>
                    {stageNumbers.map((sn) => {
                      const { effort } = resolveCell({ rider, stageNumber: sn, overridesMap });
                      const chosen = effort !== DEFAULT_EFFORT;
                      return (
                        <td key={sn} className={`px-3 py-2.5 text-xs whitespace-nowrap ${chosen ? "text-cz-accent-t font-medium" : "text-cz-3"}`}>
                          {t(`intention.step.${effort}`)}
                        </td>
                      );
                    })}
                  </>
                ) : (
                  <>
                    <td className="px-4 py-2.5 text-right"><FitBar score={rider.fit} /></td>
                    <td className="px-4 py-2.5 text-right font-data text-xs tabular-nums text-cz-2">{rider.form ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right font-data text-xs tabular-nums text-cz-2">{rider.fatigue ?? "—"}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function RaceTeamTab({
  raceId,
  phase,
  // Svaret fra sidens useStageRoles: null (henter) | false (fejlede) | objekt.
  // Hentes ÉT sted (RaceDetailPage) fordi hero'en og Overblik-fanen læser det
  // samme svar — ikke ét kald pr. fane-skift.
  stageRoles = null,
  onReload,
  gcRankByRider = null,
  // Kun brugt i FØR-tilstanden (holdudtagelsen), videresendt uændret.
  selectedStageIndex = 0,
  selectedStageBucket = null,
  selectedStageProfileType = null,
  selectedStageFinaleType = null,
}) {
  const { t } = useTranslation("races");
  // FØR løbet bruges svaret ikke: fanen ER holdudtagelsen, og RaceSelectionPanel
  // henter sin egen kontekst fra /selection.
  const data = stageRoles;

  const riders = useMemo(() => data?.riders ?? [], [data?.riders]);
  const overridesMap = useMemo(() => overridesIndex(data?.overrides), [data?.overrides]);
  const stageNumbers = useMemo(
    () => Array.from({ length: data?.stage_count ?? 0 }, (_, i) => i + 1),
    [data?.stage_count],
  );

  // FØR løbet: fanen ER holdudtagelsen. Panelet bærer selv sin guld-knap,
  // sine fejl-/tom-tilstande og sin egen gating på race-engine-flaget.
  if (phase === "before") {
    return (
      <div id="race-selection-anchor" className="flex flex-col gap-[14px]">
        <RaceSelectionPanel
          raceId={raceId}
          selectedStageIndex={selectedStageIndex}
          selectedStageBucket={selectedStageBucket}
          selectedStageProfileType={selectedStageProfileType}
          selectedStageFinaleType={selectedStageFinaleType}
        />
      </div>
    );
  }

  if (data === null) {
    return (
      <Section>
        <SectionHeader title={t("racePage.team.title")} />
        <SkeletonLines lines={5} />
      </Section>
    );
  }
  if (data === false) {
    return (
      <Section>
        <SectionHeader title={t("racePage.team.title")} />
        <p className="text-xs text-cz-3">{t("racePage.team.loadError")}</p>
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={onReload}>{t("tacticsOrders.retry")}</Button>
        </div>
      </Section>
    );
  }
  if (!riders.length) {
    return (
      <Section>
        <SectionHeader title={t("racePage.team.title")} />
        <p className="text-xs text-cz-3">{t("racePage.team.noRiders")}</p>
      </Section>
    );
  }

  const isOneDay = stageNumbers.length <= 1;
  const afterRace = phase === "after";

  return (
    <Section data-testid="race-team-tab">
      <SectionHeader
        title={t("racePage.team.title")}
        meta={t("racePage.team.riderCount", { count: riders.length })}
      />
      <p className="text-cz-3 text-xs mb-3 flex items-center gap-1.5">
        <LockIcon size={12} aria-hidden="true" />
        {t(afterRace ? "racePage.team.afterNote" : "racePage.team.duringNote")}
      </p>
      <ReadOnlyRoster
        t={t}
        riders={riders}
        stageNumbers={stageNumbers}
        overridesMap={overridesMap}
        gcRankByRider={gcRankByRider}
        showStages={afterRace}
        isOneDay={isOneDay}
      />
      {afterRace && (
        <p className="mt-3 pt-3 border-t border-cz-border text-3xs text-cz-3">
          {t("racePage.team.legend")}
        </p>
      )}
    </Section>
  );
}
