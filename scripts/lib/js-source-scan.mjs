// scripts/lib/js-source-scan.mjs
// ============================================================
// Delte primitiver til repoets regex/AST-lette JS-scannere (lint-*.mjs).
//
// WHY: lint-swallowed-catches.mjs, lint-silent-mutations.mjs og
// lint-dropped-supabase-error.mjs havde hver sin byte-identiske kopi af
// blankStringsAndComments/lineAt. Én kilde → én fejlrettelse rammer alle
// scannere (#2897).
//
// Trade-off: dette er IKKE en JS-parser. Strenge + kommentarer blankes til
// whitespace (længde og newlines bevares, så char-offsets og linjenumre stadig
// peger på den RÅ kilde), hvorefter scannerne kan brace-/paren-matche uden at
// ramme indhold inde i strenge og kommentarer. Regex-literaler blankes ikke —
// en regex med ubalancerede tuborg-/parenteser kan i teorien forvirre en
// matcher. Det findes ikke i praksis i denne kodebase, og hver scanner har en
// baseline-ratchet + markør-escape-hatch hvis det skulle ske.

/**
 * Erstat indholdet af strenge og kommentarer med mellemrum, så scanning kun
 * ser ægte kode. Længde + newlines bevares 1:1 med kilden.
 * @param {string} src rå JS-kilde
 * @returns {string} samme længde, men strenge-/kommentar-indhold blanket
 */
export function blankStringsAndComments(src) {
  const out = src.split("");
  let i = 0;
  const n = src.length;
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) {
      if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
    }
  };
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    // Line-kommentar
    if (c === "/" && next === "/") {
      let j = i + 2;
      while (j < n && src[j] !== "\n") j++;
      blank(i, j);
      i = j;
      continue;
    }
    // Blok-kommentar
    if (c === "/" && next === "*") {
      let j = i + 2;
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++;
      j = Math.min(n, j + 2);
      blank(i, j);
      i = j;
      continue;
    }
    // Streng (', ", `) — håndter escapes; template-literals blankes fladt (godt nok).
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === quote) { j++; break; }
        j++;
      }
      blank(i + 1, j - 1); // bevar selve quote-tegnene så strukturen ikke skrider
      i = j;
      continue;
    }
    i++;
  }
  return out.join("");
}

/**
 * 1-indekseret linjenummer for et char-offset.
 * @param {string} src
 * @param {number} offset
 * @returns {number}
 */
export function lineAt(src, offset) {
  let line = 1;
  for (let k = 0; k < offset && k < src.length; k++) if (src[k] === "\n") line++;
  return line;
}
