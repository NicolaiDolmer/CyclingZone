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
import { loadRaceDayHistory } from "./riderDevelopmentReceipt.js";
import { REGISTRY_ABILITY_KEYS } from "./abilityRegistry.js";

// #6286: fast kilde-prioritet naar to raekker har samme dato (fx daily_training
// og season_transition paa saesonskifte-datoen). Hoejere tal sorteres SIDST og
// vinder dermed i "seneste raekke pr. saeson"-fletningen. Samme rangorden som
// mergeDevelopmentSnapshots() i riderDevelopmentReceipt.js.
const SOURCE_PRIORITY = { baseline: 1, season_transition: 2, daily_training: 3, race_development: 3 };

// #6286: deterministisk raekkefoelge: dato, saa kilde-prioritet, saa loebsdag
// (kalenderraekken, game_day -1, foer datoens loebsdage), saa kildenavn og id som
// sidste tie-break, saa vinderen aldrig afhaenger af databasens raekkefoelge.
export function compareHistoryRows(a, b) {
  return String(a.snapshot_date).localeCompare(String(b.snapshot_date))
    || (SOURCE_PRIORITY[a.source] ?? 0) - (SOURCE_PRIORITY[b.source] ?? 0)
    || (a.game_day ?? -1) - (b.game_day ?? -1)
    || String(a.source ?? "").localeCompare(String(b.source ?? ""))
    || String(a.id ?? "").localeCompare(String(b.id ?? ""));
}

// #6286: kun de synlige evner (aldrig hidden_potential). Tal eller null.
function visibleAbilities(row) {
  if (!row) return null;
  const out = {};
  let any = false;
  for (const key of REGISTRY_ABILITY_KEYS) {
    const v = row[key];
    if (typeof v === "number" && Number.isFinite(v)) { out[key] = v; any = true; }
  }
  return any ? out : null;
}

// #6286: rytterens nuvaerende evner (samme tal som profilen viser) + den aktive
// saeson. Best effort: fejler opslaget, vises historikken uden live-punkt.
async function loadLivePoint(supabase, riderId, teamId) {
  try {
    const [{ data: current, error: currentError }, { data: season, error: seasonError }] = await Promise.all([
      supabase.from("rider_derived_abilities").select(REGISTRY_ABILITY_KEYS.join(", "))
        .eq("rider_id", riderId).maybeSingle(),
      supabase.from("seasons").select("number").eq("status", "active")
        .order("number", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (currentError) throw new Error(currentError.message);
    if (seasonError) throw new Error(seasonError.message);
    const abilities = visibleAbilities(current);
    if (!abilities) return null;
    return { season_number: season?.number ?? null, abilities };
  } catch (err) {
    captureException(err, { tags: { flow: "pro", stage: "rider-history-live" }, teamId });
    return null;
  }
}

// #6286: live-punktet ERSTATTER sin saesons historik-punkt (saesonen er ikke
// slut endnu, saa dens seneste tilstand er den nuvaerende), ellers laegges det
// sidst. Ukendt saeson: knyttes til den seneste historik-saeson.
export function withLivePoint(seasons, live) {
  if (!live) return seasons;
  const seasonNumber = live.season_number ?? seasons.at(-1)?.season_number ?? null;
  const rest = seasons.filter((s) => seasonNumber == null || s.season_number !== seasonNumber);
  return [...rest, { season_number: seasonNumber, abilities: live.abilities, live: true }]
    .sort((a, b) => (a.season_number ?? Infinity) - (b.season_number ?? Infinity));
}

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
        .select("snapshot_date, season_number, source, abilities")
        .eq("rider_id", req.params.riderId)
        .order("snapshot_date", { ascending: true });
      if (error) throw new Error(error.message);
      // #5947: kalenderdags-raekken fryser paa datoens foerste gevinst-tick; den
      // seneste loebsdag pr. dato er saesonens sande slut-tilstand.
      // Noeglet er saesonen, ikke datoen: paa saesonskifte-datoen deler to saesoner
      // samme dato, og en dato-fletning ville kassere den gamle saesons slut-raekke.
      // Kalenderraekken (game_day -1) sorteres foer datoens loebsdage.
      const [raceDayRows, live] = await Promise.all([
        loadRaceDayHistory(supabase, req.params.riderId),
        loadLivePoint(supabase, req.params.riderId, req.team.id),
      ]);
      const rows = [...(data ?? []), ...raceDayRows].sort(compareHistoryRows);

      const bySeason = new Map();
      for (const row of rows) {
        if (row.season_number == null || !row.abilities) continue;
        // ASC-raekkefoelge → seneste raekke pr. saeson overskriver (saesonens slut).
        bySeason.set(row.season_number, { season_number: row.season_number, abilities: row.abilities });
      }
      const seasons = [...bySeason.values()].sort((a, b) => a.season_number - b.season_number);
      res.json({ seasons: withLivePoint(seasons, live), abilityCeiling: 99 });
    } catch (err) {
      captureException(err, { tags: { flow: "pro", stage: "rider-history" }, teamId: req.team.id });
      res.status(500).json({ error: err.message });
    }
  };
}

export default createProRiderHistoryHandler;
