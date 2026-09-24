export type ForumSegment =
  | { type: "text"; value: string }
  | { type: "link"; value: string; href: string };

// Explicit boundaries avoid linking inside words, other schemes or // URLs.
const BOUNDARY = /[\s([{"'“‘]/u;
const CLOSERS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

function trimUrlEnd(candidate: string): string {
  const balance: Record<string, number> = { "(": 0, "[": 0, "{": 0 };
  const unmatched = new Set<number>();
  for (let i = 0; i < candidate.length; i += 1) {
    const ch = candidate[i];
    if (Object.hasOwn(balance, ch)) balance[ch] += 1;
    else if (Object.hasOwn(CLOSERS, ch)) {
      const opener = CLOSERS[ch];
      if (balance[opener] > 0) balance[opener] -= 1;
      else unmatched.add(i);
    }
  }
  let end = candidate.length;
  while (end > 0 && (/[.,;:!?]/u.test(candidate[end - 1]) || unmatched.has(end - 1))) end -= 1;
  return candidate.slice(0, end);
}

/** Plain text only: preserve every character, never interpret HTML. */
export function splitForumLinks(text: string): ForumSegment[] {
  const segments: ForumSegment[] = [];
  const candidates = /(?:https?:\/\/|www\.)[^\s\u201c\u201d\u2018\u2019<>"'`\\]+/giu;
  let cursor = 0;
  for (const match of text.matchAll(candidates)) {
    const start = match.index;
    if (start > 0 && !BOUNDARY.test(text[start - 1])) continue;
    const value = trimUrlEnd(match[0]);
    let url: URL;
    try {
      url = new URL(/^www\./i.test(value) ? `https://${value}` : value);
    } catch {
      // Invalid user input stays plain text, including the original punctuation.
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    if (start > cursor) segments.push({ type: "text", value: text.slice(cursor, start) });
    segments.push({ type: "link", value, href: url.href });
    cursor = start + value.length;
  }
  if (cursor < text.length) segments.push({ type: "text", value: text.slice(cursor) });
  return segments;
}
