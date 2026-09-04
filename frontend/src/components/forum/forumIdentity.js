// #4751 · Rene hjaelpere for profil-identiteten i forummet (ejer-direktiv 3/9:
// "Managernavn og holdnavn skal vaere klikbart inde paa forummet" + auto-
// signatur). Holdt uden JSX og uden React-import, saa reglerne kan koeres
// direkte under `node --test` (samme moenster som lib/avatarStyles.js).

/**
 * Datoformat for forummet. Altid Europe/Copenhagen — spillet er dansk-drevet,
 * og en trad-tidslinje maa ikke skifte betydning med browserens tidszone.
 * Bor her (ikke i ForumPage.jsx) fordi baade listen, traaden og
 * forfatterlinjen bruger den; en side skal ikke vaere kilde for en komponent.
 */
export function formatForumDate(iso, language) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(language === "da" ? "da-DK" : "en-GB", {
    timeZone: "Europe/Copenhagen",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Visningsnavnet paa forfatterlinjen: managernavn, ellers holdnavn. */
export function authorDisplayName(author) {
  return author?.username || author?.team_name || "?";
}

/**
 * Holdnavnet vises kun som SIT EGET element naar der ogsaa er et managernavn —
 * ellers ville samme streng staa to gange paa linjen (TASTE §3, data-slop).
 */
export function showsSeparateTeamName(author) {
  return Boolean(author?.team_name && author?.username);
}

function normalize(text) {
  return String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Auto-signatur (holdnavn + division) under indlaegget — men KUN hvis
 * skribenten ikke allerede har skrevet holdnavnet i selve teksten. Skriver man
 * sin egen signatur, skal spillet ikke laegge en dublet under den.
 *
 * Substring-match (ikke ordgraense): et holdnavn kan indeholde tegnsaetning og
 * tal, og den konservative retning er at UNDLADE en signatur for meget — en
 * manglende signatur er usynlig, en dubleret er stoej.
 */
export function shouldShowSignature(body, author) {
  if (!author?.team_name) return false;
  if (author.division == null) return false;
  const team = normalize(author.team_name);
  if (!team) return false;
  return !normalize(body).includes(team);
}
