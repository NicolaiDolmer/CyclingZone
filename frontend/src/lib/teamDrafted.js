// #940 målebølge — tærskel for team_drafted-funnel-eventet.
//
// En ny manager har "draftet" sit hold når truppen FØRSTE gang er løbsklar
// (≥ MIN_RIDERS_FOR_RACE = 8 ryttere — starter-squad-størrelsen fra relaunch-
// designet, docs/superpowers/specs/2026-06-09-relaunch-season1-orchestrator-design.md).
// Pure (ingen Supabase-import) så den kan unit-testes; logEvent.js re-eksporterer
// helperne og kobler dem til logFirstEvent (de-dup pr. bruger).

export const DRAFTED_SQUAD_THRESHOLD = 8;

export function isSquadDrafted(riderCount) {
  return Number.isFinite(riderCount) && riderCount >= DRAFTED_SQUAD_THRESHOLD;
}
