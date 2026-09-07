// #3200 · Beskedtekst → segmenter, så en URL kan renderes som et tekst-link
// uden at noget nogensinde tolkes som HTML.
//
// Forummet renderer sin body som ren tekst i en <p className="whitespace-pre-wrap">
// (ForumPostPage.jsx) — React escaper alt, og det er præcis den sikkerhed vi
// beholder her. Forskellen er kun at en http(s)-URL bliver klikbar. Der er
// bevidst ingen dangerouslySetInnerHTML, ingen markdown og ingen HTML-parser:
// beskeder ligger i loggen for evigt og læses af admin ved en anmeldelse, så
// teksten skal være præcis det brugeren skrev.
//
// Ren funktion uden DOM-afhængighed (samme mønster som lib/notificationLink.js),
// så den kan testes direkte med node --test.

// Kun http og https. Ingen bare domæner ("example.com"), ingen javascript:,
// data: eller mailto: — en klikbar javascript:-URL i en besked fra en fremmed
// er præcis den slags hul featuren ikke skal åbne.
const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;

// Afsluttende tegnsætning hører til sætningen, ikke til URL'en.
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;

/**
 * Fjerner afsluttende tegnsætning, men KUN så længe den ikke lukker en
 * parentes der faktisk er åbnet inde i URL'en. Wikipedia-links som
 * https://en.wikipedia.org/wiki/Function_(mathematics) skal beholde deres
 * sidste ")", mens "se (https://a.dk)" skal aflevere sin.
 */
function trimTrailingPunctuation(url) {
  let trimmed = url;
  for (;;) {
    const match = trimmed.match(TRAILING_PUNCTUATION);
    if (!match) return trimmed;
    const last = trimmed[trimmed.length - 1];
    const pairs = { ")": "(", "]": "[", "}": "{" };
    if (pairs[last]) {
      const opens = trimmed.split(pairs[last]).length - 1;
      const closes = trimmed.split(last).length - 1;
      if (opens >= closes) return trimmed; // parentesen er balanceret: behold den
    }
    trimmed = trimmed.slice(0, -1);
    if (!trimmed) return trimmed;
  }
}

/**
 * @param {string} text
 * @returns {Array<{type: "text"|"link", value: string}>}
 */
export function splitMessageText(text) {
  if (typeof text !== "string" || text.length === 0) return [];

  const segments = [];
  let cursor = 0;
  URL_RE.lastIndex = 0;

  let match = URL_RE.exec(text);
  while (match) {
    const raw = match[0];
    const url = trimTrailingPunctuation(raw);
    const end = match.index + url.length;

    if (url.length > 0) {
      if (match.index > cursor) {
        segments.push({ type: "text", value: text.slice(cursor, match.index) });
      }
      segments.push({ type: "link", value: url });
      cursor = end;
    }
    URL_RE.lastIndex = Math.max(end, match.index + 1);
    match = URL_RE.exec(text);
  }

  if (cursor < text.length) {
    segments.push({ type: "text", value: text.slice(cursor) });
  }
  return segments;
}
