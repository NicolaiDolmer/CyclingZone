// Forum-synlighed (#3199, variant B): ren udvælgelses-logik for dashboardets
// "From the forum"-kort — udtrukket af useForumHighlights.js så den kan
// node--test'es uden en fetch/DOM-harness (samme princip som
// lib/dashboardDivStandings.js osv.).
//
// "De to tråde med nyeste aktivitet" er IKKE det samme som "pinned altid
// øverst" (ForumPage's egen regel) — et gammelt pinnet opslag skal ikke
// fortrænge en tråd med et splinternyt svar på dette kort. Aktivitets-nøglen
// er den samme som backend/lib/forum.js allerede bruger: last_reply_at,
// ellers created_at.
export function threadActivityMs(thread) {
  const iso = thread?.last_reply_at || thread?.created_at;
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

export function selectForumHighlights(pinned, items, limit = 2) {
  const merged = [...(pinned || []), ...(items || [])];
  return merged
    .slice()
    .sort((a, b) => threadActivityMs(b) - threadActivityMs(a))
    .slice(0, limit);
}
