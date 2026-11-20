// Init-script til Playwright: spejler prod-kontakterne 16/11 i preview-mocken.
// Pakker window.fetch ind (også når mocken overskriver den) og omskriver svaret
// fra /api/feature-flags og /api/display-flags: listede = true, alle andre = false.
module.exports = `(() => {
  const ON = new Set(${JSON.stringify(`ability_cap_per_date_enabled academy_enabled auto_accept_enabled board_mandate_model_enabled champion_jerseys_7824 condition_model_v2 day_form_6649 day_words_7725 development_curve_b facilities_enabled first_race_card market_commitment_6181 peak_planner_enabled potential_single_number race_engine_v4 race_form_peaks race_library_v2 rider_hover_card rider_why_button route_profile_hills sale_escrow_enabled scout_system_enabled season_matrix_mobile season_signup_enabled stage_page_v2 stage_plan_v1 tactics_ready_7864 talent_marks_7879 training_catalog_v3 training_condition_per_date training_daily_receipt training_decision_card training_fatigue_rules training_groups training_mobile_table training_program_cells training_programs training_score_visible training_train_now training_train_now_instant youth_squad_pages`.split(' '))});
  const rewrite = (o) => { if (!o || typeof o !== 'object') return o; const out = {}; for (const k of new Set([...Object.keys(o), ...ON])) out[k] = ON.has(k); return out; };
  const wrap = (fn) => { if (!fn || fn.__czWrapped) return fn; const w = async function(input, init) {
    const res = await fn.call(window, input, init);
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!/\\/api\\/(feature-flags|display-flags)(\\?|$)/.test(url)) return res;
    try { const body = await res.clone().json();
      const nb = /feature-flags/.test(url) ? { ...body, flags: rewrite(body.flags || {}) } : rewrite(body);
      return new Response(JSON.stringify(nb), { status: res.status, headers: { 'content-type': 'application/json' } });
    } catch { return res; } }; w.__czWrapped = true; return w; };
  let cur = wrap(window.fetch);
  Object.defineProperty(window, 'fetch', { configurable: true, get() { return cur; }, set(v) { cur = wrap(v); } });
  try { localStorage.setItem('cz_consent_v1', JSON.stringify({version:1,necessary:true,analytics:false,marketing:false,email_marketing:false,updated_at:new Date().toISOString()})); } catch(e){}
})();`;
