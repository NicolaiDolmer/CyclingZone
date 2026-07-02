// #2042: sanitér ?next= så kontekst-login aldrig bliver en open-redirect-vektor.
// Kun interne, absolutte stier tillades — ingen protokol-relative (//host) eller
// absolutte URL'er (http://...). Input er den allerede-dekodede sti fra
// useSearchParams; returnerer stien eller null.
export function safeNextPath(path) {
  if (typeof path !== "string" || !path) return null;
  if (!path.startsWith("/")) return null;
  // //evil.com (protokol-relativ) og /\evil.com (backslash-trick) er eksterne.
  if (path.startsWith("//") || path.startsWith("/\\")) return null;
  return path;
}
