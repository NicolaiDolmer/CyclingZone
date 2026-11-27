// #8419 punkt 6 · Fanen Startlister: hvem der deltager i DETTE loeb, og intet andet (ejer 26/11: "man skal kun
// derinde se hvem der deltager i sit eget loeb"). Ingen divisionsvaelger. Data er den gamle dags-tavles
// startlister for holdets egen pulje (GET /api/races/distribution/browse?day=N, den samme kilde som
// "Min division"), filtreret til loebet. Bruttotrupper: hold og ryttere, ingen roller, form eller traethed.
// Startlisten aabner som paa den gamle side et antal dage foer loebet; foer det siges hvornaar.
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { authHeaders } from "../../lib/supabase";
import { apiFetch } from "../../lib/apiFetch.ts";
import { Button, ErrorState, SkeletonLines, Flag } from "./primitives.ts";
import TeamLinkBase from "../TeamLink.jsx";
import { startColumnFor, type StartColumn, type StartRider } from "./planningViews.ts";

const API = import.meta.env.VITE_API_URL;
const TeamLink = TeamLinkBase as unknown as (props: Record<string, unknown>) => any;

function riderName(r: StartRider): string {
  return [r.firstname, r.lastname].filter(Boolean).join(" ").trim() || "-";
}

export default function StartListsView({ raceId, day, ownRiderIds }: { raceId: string; day: number | null; ownRiderIds?: Set<string> }) {
  const { t } = useTranslation("planning");
  const { t: tr } = useTranslation("races");
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [column, setColumn] = useState<StartColumn | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const headers = await authHeaders();
      if (!headers) {
        setState("error");
        return;
      }
      const qs = day != null ? `?day=${day}` : "";
      const res = (await apiFetch(`${API}/api/races/distribution/browse${qs}`, { headers })) as { ok: boolean; data?: { columns?: StartColumn[] } };
      if (!res.ok) {
        setState("error");
        return;
      }
      setColumn(startColumnFor(res.data, raceId));
      setState("ready");
    } catch {
      setState("error");
    }
  }, [raceId, day]);

  useEffect(() => {
    load();
  }, [load]);

  if (state === "loading") {
    return (
      <div className="border-t border-cz-border p-4" data-testid="planning-startlists">
        <SkeletonLines lines={4} />
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className="border-t border-cz-border p-4" data-testid="planning-startlists">
        <ErrorState
          title={tr("browse.error.title")}
          description={tr("browse.error.body")}
          action={
            <Button variant="secondary" size="sm" onClick={load}>
              {t("error.retry")}
            </Button>
          }
        />
      </div>
    );
  }
  const teams = column?.teams ?? [];
  let note: string | null = null;
  if (!column) note = t("startlists.unavailable");
  else if (column.visible === false) note = tr("browse.opensIn", { count: column.opensInDays ?? 0 });
  else if (!teams.length) note = tr("browse.noEntries");

  return (
    <div className="border-t border-cz-border" data-testid="planning-startlists">
      {note ? (
        <p className="px-4 py-3 text-[13px] text-cz-2">{note}</p>
      ) : (
        <>
          <p className="px-4 py-2 font-data text-xs tabular-nums text-cz-3">
            {tr("browse.teamCount", { count: column?.teamCount ?? teams.length })} · {t("startlists.grossOnly")}
          </p>
          <ul>
            {teams.map((g) => {
              const mine = !!ownRiderIds && g.riders.some((r) => ownRiderIds.has(r.id));
              return (
                <li
                  key={g.team.id}
                  className={`border-t border-cz-border px-4 py-2.5 ${mine ? "bg-cz-subtle" : ""}`}
                  data-testid="planning-startlist-team"
                  data-mine={mine ? "true" : undefined}
                >
                  <p className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-cz-1">
                    <TeamLink id={g.team.id} className="hover:text-cz-accent-t">
                      {g.team.name ?? tr("browse.unknownTeam")}
                    </TeamLink>
                    {mine && <span className="text-xs font-normal text-cz-3">{t("startlists.yourTeam")}</span>}
                    <span className="ms-auto font-data text-xs font-normal tabular-nums text-cz-3">{g.riders.length}</span>
                  </p>
                  <p className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-cz-2">
                    {g.riders.map((r) => (
                      <span key={r.id} className="inline-flex items-center gap-1.5">
                        {r.nationality_code && <Flag code={r.nationality_code} className="shrink-0 text-2xs" />}
                        {riderName(r)}
                      </span>
                    ))}
                  </p>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
