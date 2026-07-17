import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { formatNumber } from "../lib/intl";
import { Card } from "./ui";

// #2453: lille dashboard-widget — "#N ▲x · point" → linker til /global-rank
// (godkendt mockup). Egen let fetch (kun eget hold) i stedet for hele
// useGlobalRank-hooken, som henter ALLE hold (unødvendigt tungt for et lille kort).
export default function GlobalRankWidget() {
  const { t } = useTranslation("globalRank");
  const [row, setRow] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: myTeam } = await supabase.from("teams").select("id").eq("user_id", user.id).single();
        if (!myTeam) return;
        const [{ data: mv }, { data: weekly }] = await Promise.all([
          supabase.from("global_rank_mv").select("*").eq("team_id", myTeam.id).maybeSingle(),
          supabase.from("global_rank_weekly_snapshot").select("global_rank").eq("team_id", myTeam.id).maybeSingle(),
        ]);
        if (mv) {
          const currentRank = mv.global_rank == null ? null : Number(mv.global_rank);
          const prevRank = weekly?.global_rank == null ? null : Number(weekly.global_rank);
          const movement = (currentRank == null || prevRank == null) ? null : prevRank - currentRank;
          setRow({ ...mv, global_rank: currentRank, movement });
        }
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // Ingen data (inaktiv, eller endnu ingen resultater) → widget renderer ingenting,
  // ikke et misvisende tomt kort.
  if (!loaded || !row || row.global_rank == null) return null;

  const up = row.movement > 0;

  return (
    <Card className="p-5">
      <Link to="/global-rank" className="mb-3 block group">
        <h2 className="font-semibold text-cz-1 text-sm group-hover:text-cz-accent-t transition-colors">{t("title")}</h2>
      </Link>
      <Link to="/global-rank" className="flex items-center gap-3">
        <span className="font-mono font-bold text-2xl text-cz-accent-t">#{row.global_rank}</span>
        {row.movement != null && row.movement !== 0 && (
          <span className={`font-mono text-sm font-bold inline-flex items-center gap-0.5 ${up ? "text-cz-success" : "text-cz-danger"}`}>
            {up ? "▲" : "▼"} {Math.abs(row.movement)}
          </span>
        )}
        <span className="font-mono text-cz-2 text-sm ms-auto">{formatNumber(row.global_points)} {t("scoreUnit")}</span>
      </Link>
    </Card>
  );
}
