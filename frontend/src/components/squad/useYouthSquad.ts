// #5519: data til U23 team- og Junior team-siden.
//
// To trin, med vilje:
//   1. GET /api/youth-squads afgør HVEM der står i truppen. Serveren grupperer
//      via effectiveSquad (backend/lib/youthSquadRoster.js), så siden aldrig selv
//      regner en trup ud af en alder (ingen kopi af aldersgrænserne i klienten).
//      409 = kontakten youth_squad_pages er slukket → status "disabled".
//   2. Visnings-felterne hentes med SAMME projektion som My Team (TeamPage.jsx),
//      så rating, type, potentiale og værdi ser ens ud på begge sider.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, authHeaders } from "../../lib/supabase";
import { apiFetch } from "../../lib/apiFetch.ts";
import { ABILITY_SELECT, flattenAbilities } from "../../lib/abilities.js";
import { CONDITION_SELECT, flattenCondition } from "../../lib/training.js";
import { capForSquad, riderIdsForSquad, YOUTH_SQUAD_CAP_FALLBACK, type YouthSquad } from "../../lib/youthSquadPages.ts";

const API: string | undefined = import.meta.env.VITE_API_URL;

// Samme felter som My Team's trup-query (TeamPage.jsx loadAll), minus
// transfer-markørerne (pending_team_id) som ungdomstrupperne ikke viser.
const RIDER_SELECT = `id, firstname, lastname, birthdate, market_value, salary, prize_earnings_bonus, current_production_value, is_u25, is_academy, base_value, nationality_code, primary_type, secondary_type, contract_end_season, popularity, ${ABILITY_SELECT}, ${CONDITION_SELECT}`;

export type YouthSquadStatus = "loading" | "ready" | "disabled" | "error";

export interface YouthSquadRider {
  id: string;
  firstname: string | null;
  lastname: string | null;
  birthdate: string | null;
  nationality_code: string | null;
  primary_type: string | null;
  secondary_type: string | null;
  salary: number | null;
  contract_end_season: number | null;
  market_value: number | null;
  [key: string]: unknown;
}

export interface YouthSquadTeam { id: string; name: string | null }

export function useYouthSquad(squad: YouthSquad) {
  const [status, setStatus] = useState<YouthSquadStatus>("loading");
  const [team, setTeam] = useState<YouthSquadTeam | null>(null);
  const [riders, setRiders] = useState<YouthSquadRider[]>([]);
  // #5631: truppens loft (SQUAD_CAPS via /api/youth-squads' `caps`-felt).
  // Fallback-værdien indtil svaret er hentet, samme tal som en manglende cap.
  const [cap, setCap] = useState<number>(YOUTH_SQUAD_CAP_FALLBACK[squad]);
  // Hver hentning får et nummer; et svar fra en ældre hentning (eller efter
  // unmount) kasseres, så det aldrig overskriver det der vises nu.
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    const isCurrent = () => requestRef.current === request;
    setStatus("loading");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const headers = await authHeaders({ json: false });
      if (!isCurrent()) return;
      if (!user || !headers || !API) { setStatus("error"); return; }

      const [teamRes, squadsRes] = await Promise.all([
        supabase.from("teams").select("id, name").eq("user_id", user.id).maybeSingle(),
        apiFetch(`${API}/api/youth-squads`, { headers }, { source: "youth-squads" }),
      ]);
      if (!isCurrent()) return;
      if (squadsRes.status === 409) { setStatus("disabled"); return; }
      if (!squadsRes.ok) { setStatus("error"); return; }

      setCap(capForSquad(squadsRes.data, squad));
      const ids = riderIdsForSquad(squadsRes.data, squad);
      let rows: YouthSquadRider[] = [];
      if (ids.length > 0) {
        // pagination-safe: kun id'erne fra én ungdomstrup, langt under 1000
        const { data, error } = await supabase
          .from("riders")
          .select(RIDER_SELECT)
          .in("id", ids)
          .eq("is_retired", false)
          .order("market_value", { ascending: false });
        if (error) throw error;
        if (!isCurrent()) return;
        rows =((data ?? []) as unknown[]).map(
          (r) => flattenCondition(flattenAbilities(r)) as YouthSquadRider,
        );
      }
      const teamRow = teamRes.data as { id?: string; name?: string | null } | null;
      setTeam(teamRow?.id ? { id: teamRow.id, name: teamRow.name ?? null } : null);
      setRiders(rows);
      setStatus("ready");
    } catch {
      if (isCurrent()) setStatus("error");
    }
  }, [squad]);

  useEffect(() => {
    void load();
    return () => { requestRef.current += 1; };
  }, [load]);

  return { status, team, riders, cap, reload: load };
}
