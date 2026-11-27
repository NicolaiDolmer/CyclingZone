// #8853 · Slår løbsniveauet (races.squad) op for de løb, indbakkens beskeder
// peger på. Ét opslag pr. ændring i mængden af løb, delt i bidder så URL'en
// ikke bliver for lang. Fejler opslaget, vises beskederne som før, bare uden
// mærket (mærket er en tilføjelse, ikke en forudsætning for at læse beskeden).
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  collectNotificationRaceIds,
  youthSquadMap,
  type NotificationLike,
  type YouthRaceSquad,
} from "./notificationRaceSquad.ts";

const CHUNK = 50;

export function useNotificationRaceSquads(
  notifications: NotificationLike[] | null | undefined,
): Map<string, YouthRaceSquad> {
  const ids = useMemo(() => collectNotificationRaceIds(notifications), [notifications]);
  const key = ids.join(",");
  const [squads, setSquads] = useState<Map<string, YouthRaceSquad>>(() => new Map());

  useEffect(() => {
    if (!key) return undefined;
    let cancelled = false;
    const list = key.split(",");
    (async () => {
      const rows: Array<{ id: string; squad: string | null }> = [];
      for (let i = 0; i < list.length; i += CHUNK) {
        const { data, error } = await supabase
          .from("races")
          .select("id, squad")
          .in("id", list.slice(i, i + CHUNK));
        if (error) {
          console.warn("notification race squads lookup failed:", error.message);
          return;
        }
        rows.push(...((data || []) as Array<{ id: string; squad: string | null }>));
      }
      if (!cancelled) setSquads(youthSquadMap(rows));
    })();
    return () => { cancelled = true; };
  }, [key]);

  return squads;
}
