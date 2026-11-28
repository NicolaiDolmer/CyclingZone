// #8808: delt scenarie til etape-afregningen (trainingSettleRaceSession7982.js) med et AI-hold.
//
// Bruges af aiTeamFrozenState8614.test.js OG af golden-generatoren, der koerer SAMME scenarie mod en
// frossen kopi af merge-base-koden (#7587). Scenariet faar delkoerslen og hjaelperne udefra, saa
// samme input kan koeres mod baade base og ny kode. Udfaldet er kun strukturen (hvilke hold aabner
// datoen, hvilke kvitteringer og koersler der skrives), aldrig motorens tal (regel 17), saa det er
// det samme med og uden private motor-parametre.

/**
 * Holdets etape er afgjort; holdet er et AI-hold. Kontakterne gives i `flags`.
 * @param {{ harness: object, facit: object, runRaceSessionSettlement: Function, flags: object }} args
 */
export async function runAiSettleScenario({ harness, facit, runRaceSessionSettlement, flags }) {
  const state = harness.seedState({ count: 6, entered: [1, 2], flags: { training_settle_race_session: "on", ...flags }, teamPatch: { is_ai: true, user_id: null } });
  harness.finishRace(state);
  const fake = facit.fakeWithRaceSessionRule(state);
  const quiet = { log() {}, warn() {}, error() {}, info() {} };
  const summary = await runRaceSessionSettlement({
    supabase: fake.supabase, now: facit.STAGE_DONE_AT, logger: quiet, loadDaySpans: async () => new Map(),
    loadContext: facit.contextOf(state), loadFinalDate: async () => "2026-12-20",
  });
  const { failures: _failures, ...stableSummary } = summary;
  return {
    summary: stableSummary,
    work: state.training_date_work.map((w) => ({ team_id: w.team_id, status: w.status, expected_rider_ids: [...(w.expected_rider_ids ?? [])].sort() })),
    ticks: state.training_rider_ticks.map((t) => [t.rider_id, t.game_day, t.team_id]).sort(),
    runs: (state.training_day_runs ?? []).map((r) => [r.team_id, r.game_day]).sort(),
  };
}
