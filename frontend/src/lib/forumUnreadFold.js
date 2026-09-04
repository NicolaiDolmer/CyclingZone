// #3451 — ren fold-beregning: "en tråd skal åbne direkte ved dit første
// ulæste svar, med de allerede læste svar foldet sammen" (spillerønske
// egomadsen 29/8). Ingen React/DOM her — kun tal/dato-sammenligning, så den
// kan enhedstestes uafhængigt af siden.
//
// `previousReadAt` er brugerens last_read_at FØR dette besøg (backend sender
// den værdi som `viewer_last_read_at` i GET /api/forum/posts/:id-svaret —
// FØR routen best-effort opdaterer den, se markForumThreadRead i
// backend/lib/forum.js). `replies` skal allerede være sorteret ældst-først
// (seq ascending), som backend leverer dem.
//
// Ved første besøg (previousReadAt null/undefined) eller uden svar nyere end
// tidspunktet: ingen fold, uændret adfærd — der findes ingen fornuftig
// basislinje at splitte imod.
export function computeForumUnreadFold({ replies, previousReadAt }) {
  const list = Array.isArray(replies) ? replies : [];

  if (!previousReadAt || list.length === 0) {
    return { hasFold: false, earlierReplies: [], unreadReplies: list, firstUnreadId: null };
  }

  const readAtMs = new Date(previousReadAt).getTime();
  if (Number.isNaN(readAtMs)) {
    return { hasFold: false, earlierReplies: [], unreadReplies: list, firstUnreadId: null };
  }

  const firstUnreadIdx = list.findIndex((reply) => new Date(reply.created_at).getTime() > readAtMs);

  if (firstUnreadIdx === -1) {
    // Ingen svar nyere end sidst læst — intet ulæst, intet at folde.
    return { hasFold: false, earlierReplies: [], unreadReplies: list, firstUnreadId: null };
  }

  if (firstUnreadIdx === 0) {
    // Det første svar er allerede ulæst — intet ELDRE at folde væk, men
    // stadig noget at scrolle til og markere.
    return { hasFold: false, earlierReplies: [], unreadReplies: list, firstUnreadId: list[0].id };
  }

  return {
    hasFold: true,
    earlierReplies: list.slice(0, firstUnreadIdx),
    unreadReplies: list.slice(firstUnreadIdx),
    firstUnreadId: list[firstUnreadIdx].id,
  };
}
