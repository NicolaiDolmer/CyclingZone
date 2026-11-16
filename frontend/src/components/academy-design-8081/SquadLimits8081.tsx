// #8081 / #7932: trupgrænserne (30/30/30, højst 60 på hele holdet), vist som
// midlertidige. Rækkerne linker til trupsiderne; ingen knapper (TASTE: sidens
// eneste guld er ugens hentning).
import { Link } from "react-router";
import { ChevronRightIcon } from "../ui/icons/index.jsx";
import { DESIGN_SQUAD_LIMITS } from "./designModel.ts";
import { useDesignCopy } from "./copy.ts";

const PATH: Record<SquadKey, string> = { senior: "/team", u23: "/squads/u23", junior: "/squads/junior" };

import type { SquadCountsAll, SquadKey } from "./designModel.ts";

export function squadLimitRows(counts: SquadCountsAll | null | undefined) {
  const n = (k: SquadKey) => Number(counts?.[k]) || 0;
  const rows = (["junior", "u23", "senior"] as SquadKey[]).map((squad) => ({
    squad, used: n(squad), max: DESIGN_SQUAD_LIMITS[squad], full: n(squad) >= DESIGN_SQUAD_LIMITS[squad],
  }));
  const used = rows.reduce((sum, r) => sum + r.used, 0);
  return { rows, total: { used, max: DESIGN_SQUAD_LIMITS.total, full: used >= DESIGN_SQUAD_LIMITS.total } };
}

export default function SquadLimits8081({ counts }: { counts: SquadCountsAll }) {
  const c = useDesignCopy();
  const { rows, total } = squadLimitRows(counts);
  return (
    <div data-testid="design8081-squad-limits">
      <div className="divide-y divide-cz-border">
        {rows.map((row) => (
          <Link
            key={row.squad}
            to={PATH[row.squad]}
            className="group -mx-2 flex items-center justify-between gap-3 rounded-cz px-2 py-[11px] transition-colors hover:bg-cz-subtle"
          >
            <span className="text-[13.5px] font-medium text-cz-1 group-hover:text-cz-accent-t">{c(`squad.${row.squad}`)}</span>
            <span className="flex shrink-0 items-center gap-2">
              <span className={`font-data text-sm tabular-nums ${row.full ? "text-cz-warning" : "text-cz-2"}`}>
                {c("squads.count", { used: row.used, max: row.max })}
              </span>
              <ChevronRightIcon size={14} className="text-cz-3" aria-hidden="true" />
            </span>
          </Link>
        ))}
        <div className="flex items-center justify-between gap-3 py-[11px]">
          <span className="text-[13.5px] font-semibold text-cz-1">{c("squads.total")}</span>
          <span className={`font-data text-sm font-semibold tabular-nums ${total.full ? "text-cz-warning" : "text-cz-1"}`}>
            {c("squads.count", { used: total.used, max: total.max })}
          </span>
        </div>
      </div>
      <p className="mt-1 font-data text-3xs uppercase tracking-wide text-cz-3">{c("squads.temporary")}</p>
    </div>
  );
}
