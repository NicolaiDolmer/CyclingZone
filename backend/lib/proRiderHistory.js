// #4649 · Pro-lag: evne-kurver pr. saeson (Pro v1.1, ejer-valg 2/9, del B).
//
// FOERSTE rute der bruger isPro()-helperen (entitlement.js) til at gate
// funktionalitet -- #2806 fandt at isPro() var defineret men aldrig kaldt
// nogen steder i backend.
//
// Gaevzone-dom (spec §6, ejer-besluttet 2026-06-26): "Pro-analytics afsloerer
// ALDRIG eksklusive fakta -- kun rigere grafer/historik af data der allerede
// findes raat for gratis-spillere." De 15 evne-vaerdier vises allerede raa
// (nu-tilstand) paa enhver scouting-/holdside for alle spillere -- denne rute
// giver blot deres HISTORIK paa tvaers af saesoner, ikke nye tal.
//
// BEVIDST UDELADT: et rytter-specifikt "loft" pr. evne. developmentReport.js's
// egen kommentar er eksplicit om hvorfor: "Per-type-loft kraever ability_caps,
// som er invertérbar til det server-skjulte potentiale (#1162)". At vise et
// AEGTE per-evne-loft for Pro ville braede jernreglen (aldrig sportslig
// fordel -- scouting-/potentiale-praecision saelges ALDRIG, jf. issue #4649's
// egen vaerdideling-tabel). Den stiplede "loft"-linje i UI'et er derfor den
// FASTE spilbrede skala-graense (99, samme for alle ryttere -- allerede
// offentlig, RiderDevelopmentTab.jsx klamper til [0,99] i dag), ikke et
// rytter-specifikt tal. Se PR-beskrivelsen for aabent spoergsmaal til ejeren.
//
// Data: rider_derived_ability_history (samme RLS-lukkede kilde som den
// eksisterende GET /riders/:id/development, service-role laesning). Dedupe
// til ÉN raekke pr. saeson (seneste snapshot i saesonen vinder, saa kurven
// viser saesonens SLUT-tilstand) -- samme "seneste snapshot pr. noegle vinder"
// -princip som dedupeSnapshots() i frontend/src/lib/developmentReport.js, men
// noeglet paa season_number i stedet for dato.

import { isProOrFounder } from "./entitlement.js";
import { captureException } from "./sentry.js";

export function createProRiderHistoryHandler({ supabase }) {
  return async function proRiderHistory(req, res) {
    if (!req.team) return res.status(400).json({ error: "No team found" });
    try {
      // #4649: isProOrFounder — samme "isPro || isFounder"-kontrakt som
      // Layout.jsx's sidebar-gate, ikke isPro() alene (se entitlement.js).
      const pro = await isProOrFounder(supabase, req.team.id);
      if (!pro) {
        return res.status(403).json({ error: "Pro required", errorCode: "pro_required" });
      }

      const { data, error } = await supabase
        .from("rider_derived_ability_history")
        .select("snapshot_date, season_number, abilities")
        .eq("rider_id", req.params.riderId)
        .order("snapshot_date", { ascending: true });
      if (error) throw new Error(error.message);

      const bySeason = new Map();
      for (const row of data ?? []) {
        if (row.season_number == null || !row.abilities) continue;
        // ASC-raekkefoelge → seneste raekke pr. saeson overskriver (saesonens slut).
        bySeason.set(row.season_number, { season_number: row.season_number, abilities: row.abilities });
      }
      const seasons = [...bySeason.values()].sort((a, b) => a.season_number - b.season_number);
      res.json({ seasons, abilityCeiling: 99 });
    } catch (err) {
      captureException(err, { tags: { flow: "pro", stage: "rider-history" }, teamId: req.team.id });
      res.status(500).json({ error: err.message });
    }
  };
}

export default createProRiderHistoryHandler;
