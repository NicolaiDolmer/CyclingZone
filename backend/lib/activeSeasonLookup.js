// backend/lib/activeSeasonLookup.js
// #2743: fælles "hent den aktive sæson"-lookup for cron-sweeps der før brugte et rent
// .eq("status", "active").maybeSingle(). maybeSingle() KASTER hårdt hvis PostgREST
// returnerer >1 række — og det kan netop ske i det korte vindue midt i
// transitionToNextSeason (seasonTransition.js), hvor S2 sættes 'active' FØR S1 sættes
// 'completed' (to på-hinanden-følgende awaits). Fejler fase 2's UPDATE, står man med
// 2 aktive sæsoner, og ethvert .maybeSingle()-forbrugende sted (stageScheduler,
// raceEntryGeneratorSweep, reconcilePoolCalendarOnActivation) dør hvert tick indtil det
// rettes manuelt (#578-resume kan genoptage, men motoren ligger stille indtil da).
//
// Mønsteret herunder er identisk med det der allerede virker i seasonTransition.js'
// resolveTransitionSourceSeason: SQL-lag LIMIT 1 (.order + .limit) så PostgREST aldrig
// kan levere >1 række til .maybeSingle() — den kaster derfor ikke, uanset hvor mange
// rækker der reelt matcher .eq("status","active") i databasen.
//
// Det alene ville dog lade en reel fler-aktiv-tilstand forsvinde stille (vi ser bare
// "den nyeste" og går videre). Derfor lægger vi en separat, best-effort tælle-
// forespørgsel ovenpå: findes der faktisk >1 aktiv sæson, captures en advarsel til
// Sentry (fast fingerprint pr. call-site, så gentagne ticks grupperer i ÉT issue) —
// tilstanden bliver stadig OPDAGET, uden at dække race-motoren ned.
import { captureException } from "./sentry.js";

/**
 * @param {object} supabase
 * @param {{ select?: string, tag: string, captureExceptionFn?: (err: Error, ctx: object) => void }} opts
 *   `tag` identificerer call-site'et i Sentry-tags/fingerprint (fx "stage-scheduler").
 * @returns {Promise<object|null>} nyeste aktive sæson (efter `number`), eller null hvis ingen.
 */
export async function loadSingleActiveSeason(supabase, { select = "id", tag, captureExceptionFn = captureException } = {}) {
  const { data: season, error } = await supabase
    .from("seasons")
    .select(select)
    .eq("status", "active")
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`seasons: ${error.message}`);

  // Best-effort fler-aktiv-alarm — må ALDRIG stoppe selve lookuppet/sweepet, hverken
  // ved fejl i tælle-queryen eller hvis captureExceptionFn selv fejler (heraf de to
  // indlejrede try/catch — den yderste beskytter mod at captureExceptionFn'ens EGET
  // kald i catch-grenen kaster videre).
  try {
    const { count, error: countError } = await supabase
      .from("seasons")
      .select("id", { count: "exact", head: true })
      .eq("status", "active");
    if (!countError && typeof count === "number" && count > 1) {
      captureExceptionFn(new Error(`Flere aktive sæsoner fundet (${count}) - forventer højst 1`), {
        tags: { area: "active-season-guard", cron: tag },
        fingerprint: ["active-season-guard", "multi-active", tag ?? "unknown"],
      });
    }
  } catch (err) {
    try {
      captureExceptionFn(err, {
        tags: { area: "active-season-guard", cron: tag, check: "multi-active-count" },
        fingerprint: ["active-season-guard", "count-check-failed", tag ?? "unknown"],
      });
    } catch { /* best-effort: en fejlende alarm må aldrig dræbe kald-stedet */ }
  }

  return season ?? null;
}
