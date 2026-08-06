// Hero & Agony (#3397) — bridges a selected moment (heroAgonyMoment.js's
// output shape) to its i18n translation key (under dashboard:cards.heroAgony.
// moments.*) + interpolation params. Pure mapping, no I/O — the component
// itself calls t(key, params) with what this returns. Every param traces back
// to a field already present on the moment (itself derived from a persisted
// race_stage_moments/race_results row) — nothing invented here.
export function heroAgonyCopyFor(moment) {
  if (!moment) return null;
  const { kind, riderName, teamName, params = {} } = moment;
  const rider = riderName || "—";
  const team = teamName || "—";
  switch (kind) {
    case "sprint_win": return { key: "sprint_win", params: { rider } };
    case "close_win":
      return Number.isFinite(params.gapSeconds)
        ? { key: "close_win", params: { rider, seconds: params.gapSeconds } }
        : { key: "close_win_generic", params: { rider } };
    case "solo_win": return { key: "solo_win", params: { rider } };
    case "breakaway_survived": return { key: "breakaway_survived", params: { rider } };
    case "gc_takeover_won": return { key: "gc_takeover_won", params: { rider, previousLeader: params.previousLeaderName || "—" } };
    case "gc_takeover_lost": return { key: "gc_takeover_lost", params: { rider, newLeader: params.newLeaderName || "—" } };
    case "final_gc": return { key: "final_gc", params: { rider, rank: params.rank } };
    case "favorite_off_day": return { key: "favorite_off_day", params: { rider, rank: params.rank, reason: params.reason || "unexplained" } };
    case "helper_shift": return { key: "helper_shift", params: { captain: params.captainName || rider, count: params.count ?? 0 } };
    case "tag_helper_sacrifice": return { key: "tag_helper_sacrifice", params: { rider, rank: params.rank, captain: params.captainName || "—" } };
    case "form_peak": return { key: "form_peak", params: { rider } };
    case "tag_perfect_peak": return { key: "tag_perfect_peak", params: { rider } };
    case "tag_peak_day": return { key: "tag_peak_day", params: { rider } };
    case "tag_jour_sans": return { key: "tag_jour_sans", params: { rider } };
    case "tag_crash_ruined": return { key: "tag_crash_ruined", params: { rider, kind: params.kind || "other" } };
    case "incident_abandon": return { key: "incident_abandon", params: { rider, kind: params.kind || "other" } };
    case "incident_time_loss":
      return Number.isFinite(params.seconds)
        ? { key: "incident_time_loss", params: { rider, kind: params.kind || "other", seconds: params.seconds } }
        : { key: "incident_time_loss_generic", params: { rider, kind: params.kind || "other" } };
    case "tag_outsider_win": return { key: "tag_outsider_win", params: { rider } };
    case "tag_aggression_no_cost": return { key: "tag_aggression_no_cost", params: { rider } };
    case "tag_saved_effort": return { key: "tag_saved_effort", params: { rider } };
    case "tag_gave_everything": return { key: "tag_gave_everything", params: { rider } };
    case "team_day": return { key: "team_day", params: { team, count: params.count ?? 0 } };
    case "breakaway_effort": return { key: "breakaway_effort", params: { rider } };
    case "plain_result": return { key: "plain_result", params: { rider, rank: params.rank } };
    default: return null; // ukendt/fremtidig kind — degradér ærligt (kortet skjuler sig selv)
  }
}

// Headline = det navn der bærer historien. team_day er et holdanliggende (ingen
// enkelt-rytter-helt), alt andet er en personlig rytterhistorie.
export function heroAgonyHeadlineFor(moment) {
  if (!moment) return "";
  if (moment.kind === "team_day") return moment.teamName || "—";
  return moment.riderName || "—";
}

// tone → eyebrow-i18n-nøgle ("hero"/"agony"/"moment" for neutral-tonede kort
// som plain_result/tag_saved_effort). Ingen farve-kodning her med vilje — kun
// teksten adskiller de to (anti-slop-designsmagsreglen: agoni er ikke en
// fejltilstand).
export function heroAgonyEyebrowKeyFor(moment) {
  if (!moment) return "moment";
  if (moment.tone === "triumph") return "hero";
  if (moment.tone === "agony") return "agony";
  return "moment";
}
