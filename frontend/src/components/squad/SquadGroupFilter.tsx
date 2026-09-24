// #5631: gruppe-filteret på My Team (Squad- og Stats-fanen deler det).
//
// Afløser components/team/AcademySquadFilter.tsx (#5075): samme markup, samme
// placering i tabellens toolbar og samme delte state (løftet til TeamPage), men
// med grupperne Senior / U23 / Junior når kontakten youth_squad_pages er tændt.
// Slukket, eller før truppen er hentet, er det dagens Seniors / Academy.
//
// State'en ejes af useSquadGroupFilter() i TeamPage, så et flip i den ene fane
// følger med til den anden (kernekravet i #5075).
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { authHeaders } from "../../lib/supabase";
import { apiFetch } from "../../lib/apiFetch.ts";
import { useYouthSquadPages } from "../../lib/useYouthSquadPages.ts";
import {
  ALL_GROUPS_VISIBLE,
  countSquadGroups,
  shouldShowGroupFilter,
  squadGroupOf,
  squadGroupsFor,
  youthSplitFromPayload,
  type GroupRider,
  type GroupVisibility,
  type SquadGroup,
  type YouthSplit,
} from "./squadGroups.ts";

const API: string | undefined = import.meta.env.VITE_API_URL;

export interface SquadGroupFilterState {
  split: YouthSplit | null;
  visible: GroupVisibility;
  isVisible: (rider: GroupRider) => boolean;
  toggle: (group: SquadGroup) => void;
  /** Stabil streng der skifter når filteret gør; til memo-afhængigheder. */
  key: string;
}

export function useSquadGroupFilter(): SquadGroupFilterState {
  const flagOn = useYouthSquadPages();
  // U23/Junior-etiketterne ligger i squad-namespacet (lazy). Indtil det er
  // klar, står filteret som Seniors / Academy, så en rå nøgle aldrig vises.
  const { ready } = useTranslation("squad");
  const [split, setSplit] = useState<YouthSplit | null>(null);
  const [visible, setVisible] = useState<GroupVisibility>(ALL_GROUPS_VISIBLE);

  useEffect(() => {
    if (!flagOn || !API) { setSplit(null); return; }
    let cancelled = false;
    void (async () => {
      try {
        const headers = await authHeaders({ json: false });
        if (!headers || cancelled) return;
        const res = await apiFetch(`${API}/api/youth-squads`, { headers }, { source: "youth-squads" });
        if (!cancelled) setSplit(res.ok ? youthSplitFromPayload(res.data) : null);
      } catch {
        if (!cancelled) setSplit(null);
      }
    })();
    return () => { cancelled = true; };
  }, [flagOn]);

  const activeSplit = ready ? split : null;
  const isVisible = useCallback(
    (rider: GroupRider) => visible[squadGroupOf(rider, activeSplit)],
    [visible, activeSplit],
  );
  const toggle = useCallback((group: SquadGroup) => {
    setVisible((v) => ({ ...v, [group]: !v[group] }));
  }, []);
  const key = useMemo(() => {
    const groups = squadGroupsFor(activeSplit).map((g) => `${g}:${visible[g] ? 1 : 0}`).join(",");
    const ids = activeSplit ? [...activeSplit.junior].sort().join("|") : "";
    return `${groups}#${ids}`;
  }, [activeSplit, visible]);

  return { split: activeSplit, visible, isVisible, toggle, key };
}

function SquadGroupFilter({ filter, counts }: {
  filter: SquadGroupFilterState;
  counts: Record<SquadGroup, number>;
}) {
  const { t } = useTranslation("team");
  const { t: tSquad } = useTranslation("squad");
  const label: Record<SquadGroup, string> = {
    senior: t("squad.filter.seniors", { count: counts.senior }),
    academy: t("squad.filter.academy", { count: counts.academy }),
    u23: tSquad("filter.u23", { count: counts.u23 }),
    junior: tSquad("filter.junior", { count: counts.junior }),
  };
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="squad-group-filter">
      <span className="text-xs text-cz-3 select-none">{t("squad.filter.label")}</span>
      {squadGroupsFor(filter.split).map((group) => {
        const on = filter.visible[group];
        return (
          <button key={group} type="button" onClick={() => filter.toggle(group)} aria-pressed={on}
            className={`px-3 py-1.5 text-xs font-medium rounded-cz border transition-colors duration-150 ${on ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30" : "bg-cz-card text-cz-3 border-cz-border hover:text-cz-1"}`}>
            {label[group]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Filter-kontrollen til en DataTable-toolbar, eller null når der intet er at
 * filtrere. null er vigtigt: DataTable tegner sin toolbar-bjælke for ethvert
 * element, også ét der selv renderer null (#5075 rettespor).
 */
export function squadGroupFilterToolbar(filter: SquadGroupFilterState, riders: GroupRider[]): ReactNode | null {
  const counts = countSquadGroups(riders, filter.split);
  if (!shouldShowGroupFilter(counts, filter.visible, filter.split)) return null;
  return <SquadGroupFilter filter={filter} counts={counts} />;
}
