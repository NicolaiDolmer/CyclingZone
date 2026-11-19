// Fælles opsætning for shoot.cjs og sketch.cjs: prod-kontakterne 16/11, scenarier og fetch-wrapperen.
const PROD_ON = ['ability_cap_per_date_enabled','academy_enabled','auto_accept_enabled','board_mandate_model_enabled','champion_jerseys_7824','condition_model_v2','day_form_6649','day_words_7725','development_curve_b','facilities_enabled','first_race_card','market_commitment_6181','peak_planner_enabled','potential_single_number','race_engine_v4','race_form_peaks','race_library_v2','rider_hover_card','rider_why_button','route_profile_hills','sale_escrow_enabled','scout_system_enabled','season_matrix_mobile','season_signup_enabled','stage_page_v2','stage_plan_v1','tactics_ready_7864','talent_marks_7879','training_catalog_v3','training_condition_per_date','training_daily_receipt','training_decision_card','training_fatigue_rules','training_groups','training_mobile_table','training_program_cells','training_programs','training_score_visible','training_train_now','training_train_now_instant','youth_squad_pages'];
const ALL_KNOWN = [...PROD_ON,'race_page_v6','planning_workbench','training_tick_per_race_day','rider_best_role_display','training_bulk_day','academy_intake_pull_enabled','development_v2_aging_enabled','potential_estimate_display','condition_v2_race_date_training_day','stage_plan_dropped_front_7635','fatigue_now_7801','training_history_from_ticks_6490','training_train_now_bonus'];
const FLAGS = Object.fromEntries(ALL_KNOWN.map(k => [k, PROD_ON.includes(k)]));

const SCEN = {
  // ny spiller dag 1: ikke tilmeldings-berettiget, onboarding 0/4, første-løb-kort synligt
  new:      { signup: { enabled: true, eligible: false, parked: false, signed_up: false, next_season_number: 4 }, firstRace: { visible: true, assistant_picks: true, mail: true } },
  // tilbagevendende, inaktiv men ikke parkeret: "Keep your spot for season N"
  dormant:  { signup: { enabled: true, eligible: true, parked: false, signed_up: false, next_season_number: 4 }, firstRace: { visible: false }, onboardingDone: true },
  // tilbagevendende, parkeret: "Your team was parked"
  parked:   { signup: { enabled: true, eligible: true, parked: true, signed_up: false, next_season_number: 4 }, firstRace: { visible: false }, onboardingDone: true },
};

function initScript({ flags, scen, anon, theme }) {
  try {
    localStorage.setItem('cz_consent_v1', JSON.stringify({version:1,necessary:true,analytics:false,marketing:false,email_marketing:false,updated_at:new Date().toISOString()}));
    localStorage.setItem('cz-theme', theme);
    if (anon) localStorage.setItem('sb-cycling-zone-e2e-auth-token:cookie-migrated', '1');
  } catch (e) {}
  const json = (d) => new Response(JSON.stringify(d), { status: 200, headers: { 'content-type': 'application/json', 'content-range': '0-0/1' } });
  const wrap = (inner) => async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (flags && /\/api\/feature-flags(\?|$)/.test(url)) return json({ flags });
    if (/\/api\/display-flags$/.test(url)) return json({ youth_squad_pages: true });
    if (scen) {
      if (/\/api\/season\/signup-status$/.test(url)) return json(scen.signup);
      if (/\/api\/me\/first-race-card/.test(url)) return json(scen.firstRace);
      if (scen.onboardingDone && /\/api\/me\/onboarding-progress$/.test(url)) return json({ steps: [], completed_count: 4, total_count: 4, dismissed: true, established: true });
    }
    return inner(input, init);
  };
  // Stabil funktion der slår op i den aktuelle kæde ved hvert kald: biblioteker der gemmer en
  // reference til fetch ved indlæsning (supabase-js), må ikke ende uden om preview-mocken.
  let current = wrap(window.fetch.bind(window));
  const stable = (input, init) => current(input, init);
  Object.defineProperty(window, 'fetch', { configurable: true, get: () => stable, set: (fn) => { if (fn !== stable) current = wrap(fn); } });
}

module.exports = { FLAGS, SCEN, initScript };
