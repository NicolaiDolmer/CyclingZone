// Foreslå en rettelse når signup-emailens domæne ligner en tastefejl. Refs #2826.
//
// Hvorfor: en af de ubekræftede konti i prod var oprettet på "gmal.com". Den
// bekræftelsesmail kunne aldrig ankomme, og spilleren havde ingen måde at
// opdage det på — succes-skærmen sagde bare at mailen var sendt. Målingen på
// #2826 viste desuden at INGEN af 148 bekræftelser skete efter mere end en
// time: opdager man ikke fejlen i samme session, er kontoen tabt.
//
// Derfor fanger vi det FØR mailen sendes: et domæne der ligger 1-2 tegn fra et
// kendt stort maildomæne får en ikke-blokerende "mente du ..."-hint. Vi retter
// aldrig automatisk — brugeren kan sagtens have en ægte adresse på et domæne
// der ligner. Hintet er et forslag, ikke en validering.

// Domæner der dækker den faktiske spillerbase (prod 2026-07-25: gmail 110,
// hotmail 22, live.dk 4, icloud 4, outlook 2, yahoo 2) plus de nære danske og
// internationale varianter nye spillere realistisk skriver.
const COMMON_DOMAINS = [
  "gmail.com",
  "hotmail.com",
  "hotmail.co.uk",
  "hotmail.dk",
  "outlook.com",
  "outlook.dk",
  "live.dk",
  "live.com",
  "icloud.com",
  "yahoo.com",
  "yahoo.co.uk",
  "me.com",
  "mail.dk",
  "protonmail.com",
  "proton.me",
];

// Damerau-Levenshtein (med transposition) — "gmial.com" er en ombytning, ikke
// to separate fejl, så den skal koste 1 og ikke 2. Begrænset til korte strenge
// (domænenavne), så den fulde matrix er billig.
export function editDistance(a, b) {
  if (a === b) return 0;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (let i = 0; i < rows; i += 1) d[i][0] = i;
  for (let j = 0; j < cols; j += 1) d[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1, // sletning
        d[i][j - 1] + 1, // indsættelse
        d[i - 1][j - 1] + cost, // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost); // transposition
      }
    }
  }

  return d[rows - 1][cols - 1];
}

// Hvor langt fra et kendt domæne vi tør gætte. 1 fanger den store klasse
// (gmal/gmial/gmai/hotmai). 2 tillades kun på længere domæner, hvor to fejl
// stadig er et entydigt gæt — ellers ville korte ægte domæner (fx "mail.dk"
// vs "mail.com") udløse falske hints.
const MAX_DISTANCE = 2;
const MIN_LENGTH_FOR_DISTANCE_2 = 9;

/**
 * Foreslå en rettet email hvis domænet ligner en tastefejl.
 *
 * @param {string} email - rå værdi fra input-feltet
 * @returns {{ suggestion: string, domain: string } | null}
 *   `suggestion` er hele den rettede adresse (klar til at indsætte i feltet),
 *   `domain` er det foreslåede domæne. `null` når adressen ser fin ud, er
 *   ufuldstændig, eller når vi ikke er sikre nok til at gætte.
 */
export function suggestEmailFix(email) {
  if (typeof email !== "string") return null;

  const trimmed = email.trim();
  // Præcis ét @ og indhold på begge sider — ellers er adressen ikke færdig, og
  // et hint ville blinke mens brugeren stadig skriver.
  const parts = trimmed.split("@");
  if (parts.length !== 2) return null;

  const [local, rawDomain] = parts;
  if (!local || !rawDomain) return null;

  const domain = rawDomain.toLowerCase();
  // Allerede et kendt domæne → ingen grund til at foreslå noget.
  if (COMMON_DOMAINS.includes(domain)) return null;
  // Uden punktum er domænet ikke skrevet færdigt endnu.
  if (!domain.includes(".")) return null;

  let best = null;
  let bestDistance = Infinity;

  for (const candidate of COMMON_DOMAINS) {
    const distance = editDistance(domain, candidate);
    if (distance === 0 || distance > MAX_DISTANCE) continue;
    if (distance === 2 && candidate.length < MIN_LENGTH_FOR_DISTANCE_2) continue;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  if (!best) return null;

  return { suggestion: `${local}@${best}`, domain: best };
}
