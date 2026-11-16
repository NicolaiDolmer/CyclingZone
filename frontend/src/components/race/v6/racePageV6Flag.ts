// #7778 · Kontakten race_page_v6 (off | beta | on) for løbssidens v6-ramme.
// Svaret evalueres server-side mod viewerens beta-status (GET /api/feature-flags).
// Fejl eller manglende svar = off, så siden ser ud som i dag.
//
// #7865 (punkt 7): siden tegnede først den gamle ramme og skiftede så til v6, når
// svaret kom. Den sidst kendte værdi huskes derfor i browseren (med kontoens id) og
// bruges til første billede; serverens svar vinder altid bagefter. En spiller uden
// kontakten venter aldrig: uden husket værdi tegnes den gamle side straks, som i dag.
// Er den indloggede konto en anden end den, der gemte værdien, slukkes v6 straks,
// når sessionen er læst (lokalt, før serverens svar). Hvert svar valideres: kun et
// udtrykkeligt "til" bliver husket; slukket, fejl og {} rydder værdien (#7865, punkt e).
import { useEffect, useState } from "react";
import { fetchPlayerFeatureFlags } from "../../../lib/playerFeatureFlags.js";
import { getSession } from "../../../lib/supabase";
import { readLastRacePageV6, rememberAfterAnswer, rememberedFor, rememberedFromFlags, writeLastRacePageV6 } from "./racePageV6FlagCache.ts";

export const RACE_PAGE_V6_FLAG_KEY = "race_page_v6";

async function currentUserId(): Promise<string | null> {
  try {
    const { data } = await getSession();
    return data?.session?.user?.id ?? null;
  } catch {
    return null; // catch-ok: ukendt konto = den huskede værdi bruges ikke
  }
}

export function useRacePageV6Enabled(): boolean {
  const [remembered] = useState(() => readLastRacePageV6());
  const [enabled, setEnabled] = useState(remembered.on);
  useEffect(() => {
    let alive = true;
    let answered = false;
    const userIdPromise = currentUserId();
    if (remembered.on) {
      userIdPromise.then((userId) => {
        if (alive && !answered && !rememberedFor(remembered, userId)) setEnabled(false);
      });
    }
    fetchPlayerFeatureFlags().then(async (flags: Record<string, boolean>) => {
      answered = true;
      const known = rememberedFromFlags(flags, RACE_PAGE_V6_FLAG_KEY);
      if (alive) setEnabled(known === true);
      // #7865 (review-punkt e): ethvert svar valideres; alt andet end et udtrykkeligt
      // "til" rydder det huskede, så næste første billede ikke viser v6 for en konto,
      // der har mistet kontakten.
      writeLastRacePageV6(rememberAfterAnswer(flags, RACE_PAGE_V6_FLAG_KEY, await userIdPromise));
    });
    return () => { alive = false; };
  }, [remembered]);
  return enabled;
}
