// backend/lib/activeSeasonInvariant.js
// #4229: "der findes praecis én aktiv saeson" som en invariant der kan raabe op.
//
// Baggrund (25/8 2026, se .claude/learnings/2026-08-25-interregnum-ingen-aktiv-saeson.md):
// Kalender-regenereringen kraever `seasons.status='upcoming'` (seasonRollover.mjs
// nAegter ellers at wipe og regenerere). Saeson 3 blev sat tilbage til 'upcoming'
// kl. ca. 07:30 og aldrig sat tilbage til 'active'. I de foelgende timer laa
// alders-visningen, ranglisten, den daglige traening og akademi-flytningen nede
// for ALLE spillere, fordi 30+ kaldesteder spoerger paa `.eq("status","active")`
// og fik nul raekker.
//
// Det vaerste var ikke hullet. Det var at vagten var TAVS: alle fire
// kalender-invarianter svarer ordret "OK — ingen aktiv saeson at kontrollere"
// naar der ingen aktiv saeson er. Den naetlige audit ville have rapporteret
// groent gennem hele nedbruddet. En vagt der bliver stille naar systemet er
// slukket, er ikke en vagt.
//
// Ren funktion uden DB, saa den kan testes direkte og genbruges af baade
// verify-invariants og en fremtidig cron.

/**
 * @param {Array<{id?:string, number?:number, status?:string}>|null|undefined} activeSeasons
 *        raekker fra seasons hvor status='active'
 * @returns {{ok:boolean, detail:string, violations:Array<object>}}
 */
export function evaluateActiveSeasonInvariant(activeSeasons) {
  const rows = Array.isArray(activeSeasons) ? activeSeasons : [];
  const count = rows.length;

  if (count === 1) {
    return {
      ok: true,
      detail: `OK — praecis én aktiv saeson (saeson ${rows[0]?.number ?? "?"})`,
      violations: [],
    };
  }

  if (count === 0) {
    return {
      ok: false,
      detail:
        "ingen aktiv saeson — alder, rangliste, daglig traening og akademi-flytning er nede for alle spillere (#4229)",
      violations: [{
        active_count: 0,
        hint:
          "en saeson staar sandsynligvis stadig som 'upcoming' efter en kalender-regenerering; "
          + "saet den tilbage til 'active'. Koer IKKE admin-endpointet 'start saeson' hvis "
          + "processSeasonStart allerede har koert for saesonen — den har ingen idempotens-spaerre "
          + "og vil udbetale sponsor og traekke loen igen.",
      }],
    };
  }

  return {
    ok: false,
    detail: `${count} aktive saesoner — kalendere, stillinger og oekonomi ville blande sig (#4229)`,
    violations: rows.map((s) => ({
      active_count: count,
      season_id: s?.id ?? null,
      season_number: s?.number ?? null,
      hint: "praecis én saeson maa have status='active' ad gangen",
    })),
  };
}
