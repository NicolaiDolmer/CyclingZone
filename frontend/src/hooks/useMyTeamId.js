import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";

// #3200 · "Hvilket hold er MIT?" — det eneste MessageManagerButton behøver for
// at kunne skjule sig selv på egne opslag og på sin egen profil.
//
// Modul-cache frem for en context: knappen sidder på flader der renderer den
// mange gange (hvert svar i en forumtråd), og svaret ændrer sig ikke inden for
// en session. Uden cachen ville en tråd med 30 svar lave 30 identiske
// forespørgsler. `inFlight` sikrer at samtidige mounts deler ÉT kald.
let cachedTeamId;
let inFlight = null;

async function loadMyTeamId() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data, error } = await supabase
    .from("teams")
    .select("id")
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

export function resetMyTeamIdCache() {
  cachedTeamId = undefined;
  inFlight = null;
}

export function useMyTeamId() {
  const [teamId, setTeamId] = useState(cachedTeamId);

  useEffect(() => {
    if (cachedTeamId !== undefined) { setTeamId(cachedTeamId); return undefined; }
    let alive = true;
    // Kun en LYKKET opslag caches. Et fejlet kald må ikke fryse "du har intet
    // hold" fast for resten af sessionen — så ville knappen dukke op på ens
    // egne opslag, og backenden ville afvise klikket med 400.
    inFlight = inFlight || loadMyTeamId().then(
      (id) => { cachedTeamId = id; return id; },
      () => null,
    );
    inFlight.then(id => {
      inFlight = null;
      if (alive) setTeamId(id);
    });
    return () => { alive = false; };
  }, []);

  return teamId ?? null;
}
