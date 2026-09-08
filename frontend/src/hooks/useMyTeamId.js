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
let cachedUserId = null;
let inFlight = null;

// CodeRabbit 8/9: cachen overlevede et bruger-skifte. Logger man ud og ind som
// en anden, ville knappen skjule sig på den FORRIGE brugers profil og vise sig
// på ens egen. Cachen bærer derfor nu bruger-id'et den blev fyldt for, og
// abonnenterne får besked når den ryddes — et modul-lokalt mikro-store frem for
// en context, af samme grund som cachen selv findes.
const subscribers = new Set();

function notify() {
  for (const fn of subscribers) fn();
}

async function loadMyTeamId() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { userId: null, teamId: null };
  const { data, error } = await supabase
    .from("teams")
    .select("id")
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (error) throw error;
  return { userId: session.user.id, teamId: data?.id ?? null };
}

export function resetMyTeamIdCache() {
  cachedTeamId = undefined;
  cachedUserId = null;
  inFlight = null;
  notify();
}

// App.jsx håndterer allerede SIGNED_IN/SIGNED_OUT; den ene linje her holder
// hook'ens cache i takt uden at hver forbruger skal huske det.
supabase.auth.onAuthStateChange((_event, session) => {
  const nextUserId = session?.user?.id ?? null;
  if (nextUserId !== cachedUserId) resetMyTeamIdCache();
});

/**
 * @returns {{ teamId: string|null, resolved: boolean }}
 *   `resolved` er falsk indtil opslaget er kørt. Uden det flag kunne
 *   `teamId === myTeamId` aldrig være sandt i det første render, så knappen
 *   nåede at blive tegnet på ens EGEN profil og forsvinde igen — og et klik i
 *   det vindue ville sende en besked til en selv, som backenden afviser med 400
 *   (CodeRabbit 8/9).
 */
export function useMyTeamId() {
  const [state, setState] = useState(() => ({
    teamId: cachedTeamId ?? null,
    resolved: cachedTeamId !== undefined,
  }));

  useEffect(() => {
    let alive = true;

    function sync() {
      if (!alive) return;
      if (cachedTeamId !== undefined) {
        setState({ teamId: cachedTeamId ?? null, resolved: true });
        return;
      }
      setState({ teamId: null, resolved: false });
      // Kun et LYKKET opslag caches. Et fejlet kald må ikke fryse "du har intet
      // hold" fast for resten af sessionen — så ville knappen dukke op på ens
      // egne opslag, og backenden ville afvise klikket med 400.
      inFlight = inFlight || loadMyTeamId().then(
        ({ userId, teamId }) => { cachedTeamId = teamId; cachedUserId = userId; return teamId; },
        () => null,
      );
      const pending = inFlight;
      pending.then((id) => {
        if (pending === inFlight) inFlight = null;
        if (alive) setState({ teamId: id ?? null, resolved: cachedTeamId !== undefined });
      });
    }

    subscribers.add(sync);
    sync();
    return () => { alive = false; subscribers.delete(sync); };
  }, []);

  return state;
}
