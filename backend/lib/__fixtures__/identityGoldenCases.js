// #6857 (L2 #6928): løbsidentitets-tilfældene i pass1-golden.json (nøglerne i_*).
// Syntetiske løb (ingen katalog-id'er); én pr. type + to med signatur. Golden'en låser
// pass 1 (type, afslutning, demand-vektor) for identitets-stien, profileModel "s5".
const base = (key, type, stages, signature = null) => ({
  id: key, external_id: `6857-${key}`, season_id: "s5", name: "Ronde test",
  race_type: "stage_race", stages, race_identity_type: type, signature,
});

export const IDENTITY_GOLDEN_CASES = Object.freeze({
  i_sprinters: base("i_sprinters", "sprinters", 5),
  i_climbers: base("i_climbers", "climbers_gt_prelude", 7),
  i_hilly: base("i_hilly", "hilly", 4),
  i_cobbles: base("i_cobbles", "cobbles_benelux", 6),
  i_time_trial: base("i_time_trial", "time_trial", 5),
  i_gravel: base("i_gravel", "gravel", 3),
  i_mountains_first: base("i_mountains_first", "mountains_first", 8),
  i_allround: base("i_allround", "allround", 6),
  i_hilly_signature: base("i_hilly_signature", "hilly", 6, {
    features: [{ kind: "climb", name: "Oude Kwaremberg", category: "2", length_km: 2.2, avg_gradient: 9.5, stage_hint: "queen", summit_finish: true }],
  }),
  i_time_trial_signature: base("i_time_trial_signature", "time_trial", 7, {
    features: [{ kind: "prologue", stage_hint: "first", band: "flat" }, { kind: "itt", stage_hint: "last", band: "hilly" }],
  }),
});
