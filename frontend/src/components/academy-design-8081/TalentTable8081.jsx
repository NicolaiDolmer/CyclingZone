// #8081 / #8036 (ejervalg 16/11): primær og sekundær ryttertype står ALTID ved
// talentet, fra den dag han er hentet. Typerne er de persisterede
// riders.primary_type/secondary_type, ikke prognosen, så de kræver intet
// kendskabs-trin. Prognosen står ved siden af på sit eget trin.
import { Link } from "react-router";
import RiderLink from "../RiderLink.jsx";
import NationCell from "../rider/NationCell.jsx";
import RiderTypeBadge from "../rider/RiderTypeBadge.jsx";
import AcademyPrognosisCell from "../rider/AcademyPrognosisCell.tsx";
import EmptyState from "../ui/EmptyState.jsx";
import { buttonClass } from "../ui/buttonStyles.js";
import { getRiderAge } from "../../lib/riderAge.js";
import { useDesignCopy } from "./copy.js";

const TH = "px-3 py-2 text-left font-data text-2xs font-semibold uppercase tracking-wide text-cz-3";
const TD = "px-3 py-[9px] align-top";

export default function TalentTable8081({ roster, seasonYear, squadById, pool, onGoToIntake = null, showVia = true }) {
  const c = useDesignCopy();
  if (!roster || roster.length === 0) {
    return (
      <EmptyState
        title={c("talents.emptyTitle")}
        description={c("talents.emptyBody")}
        action={onGoToIntake
          ? <button type="button" onClick={onGoToIntake} className={buttonClass({ variant: "secondary", size: "sm" })}>{c("talents.emptyAction")}</button>
          : <Link to="/academy" className={buttonClass({ variant: "secondary", size: "sm" })}>{c("talents.emptyAction")}</Link>}
      />
    );
  }
  return (
    <div className="overflow-hidden rounded-cz border border-cz-border bg-cz-card" data-testid="design8081-talents">
      <table data-sort-exempt="Designudkast #8081, rækkefølge = yngste først som akademiets liste" className="w-full table-fixed border-collapse text-sm sm:table-auto">
        <thead className="bg-cz-subtle">
          <tr className="border-b border-cz-border">
            <th className={`${TH} w-[46%] sm:w-auto`}>{c("talents.colRider")}</th>
            <th className={`${TH} hidden sm:table-cell`}>{c("talents.colType")}</th>
            <th className={TH}>{c("talents.colSquad")}</th>
            <th className={`${TH} text-right`}>{c("talents.colAge")}</th>
            <th className={TH}>{c("talents.colPrognosis")}</th>
            {showVia && <th className={`${TH} hidden lg:table-cell`}>{c("talents.colVia")}</th>}
          </tr>
        </thead>
        <tbody>
          {roster.map((r) => {
            const age = getRiderAge(r.birthdate, seasonYear);
            const squad = squadById?.get(r.id) ?? r.squad ?? null;
            const origin = pool?.get(r.id)?.origin ?? null;
            return (
              <tr key={r.id} className="border-b border-cz-border last:border-0 hover:bg-cz-subtle">
                <td className={TD}>
                  <span className="flex min-w-0 items-center gap-1.5">
                    {r.nationality_code && <NationCell code={r.nationality_code} />}
                    <RiderLink id={r.id} className="min-w-0 break-words text-[13.5px] font-medium text-cz-1 hover:text-cz-accent-t">
                      {r.firstname} {r.lastname}
                    </RiderLink>
                  </span>
                  {/* Mobil: typen folder ind under navnet, så tre datakolonner står uden vandret scroll. */}
                  <RiderTypeBadge primaryType={r.primary_type} secondaryType={r.secondary_type} stacked className="mt-1 sm:hidden" />
                </td>
                <td className={`${TD} hidden sm:table-cell`}>
                  <RiderTypeBadge primaryType={r.primary_type} secondaryType={r.secondary_type} />
                </td>
                <td className={`${TD} text-cz-2`}>{squad ? c(`squad.${squad}`) : "–"}</td>
                <td className={`${TD} text-right font-data tabular-nums text-cz-1`}>{age ?? "–"}</td>
                <td className={TD}>{r.prognosis ? <AcademyPrognosisCell prognosis={r.prognosis} /> : <span className="text-cz-3">–</span>}</td>
                {showVia && <td className={`${TD} hidden text-xs text-cz-2 lg:table-cell`}>{origin ? c(`origin.${origin}`) : "–"}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
