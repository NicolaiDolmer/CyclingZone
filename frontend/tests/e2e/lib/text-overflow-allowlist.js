// Undtagelser til tekst-vagten (#5383). EEN fil, smalle poster, begrundelse og
// udloebsdato paa hver enkelt.
//
// ── Reglerne for at laegge noget her ───────────────────────────────────────
//
//   1. En post daekker EET fund paa EEN side. Ingen wildcards, ingen `/.*/`,
//      ingen post uden `page` og `rule`. `matchesAllowlist` afviser dem.
//   2. `reason` skal kunne laeses af et menneske om et halvt aar: hvorfor er
//      det her IKKE en fejl, eller hvorfor er det udskudt og til hvad.
//   3. `until` er en dato. Naar den er passeret, FEJLER vagten paa selve
//      posten. Det er hele pointen med at undtagelsen er tidsbegraenset: en
//      udskudt rettelse skal komme tilbage og banke paa, ikke falde i glemslen.
//   4. En post der ikke matcher noget fund laengere er ogsaa en fejl. Er
//      fladen rettet, skal posten vaek — ellers lyver listen om hvad der
//      mangler.
//
// Felter:
//   page       navnet fra PAGES i 5383-text-overflow-guard.spec.js
//   rule       "clipped" | "outside-container" | "unreadable" | "raw-i18n-key"
//   match      streng (delstreng) eller RegExp, proevet mod
//              `${selector} | ${text} | ${detail}`
//   langs      valgfri liste, fx ["da"]
//   viewports  valgfri liste, fx ["mobil"]
//   reason     paakraevet
//   until      paakraevet, ISO-dato

export const TEXT_OVERFLOW_ALLOWLIST = [];

const REQUIRED_FIELDS = ["page", "rule", "match", "reason", "until"];

/** Fejlene i selve listen — kaldes af vagten foer den doemmer sider. */
export function allowlistProblems(entries = TEXT_OVERFLOW_ALLOWLIST, today = new Date()) {
  const problems = [];
  entries.forEach((entry, index) => {
    const where = `post #${index + 1} (${entry.page ?? "uden side"} / ${entry.rule ?? "uden regel"})`;
    for (const field of REQUIRED_FIELDS) {
      if (entry[field] === undefined || entry[field] === null || entry[field] === "") {
        problems.push(`${where}: mangler "${field}"`);
      }
    }
    if (typeof entry.reason === "string" && entry.reason.trim().length < 20) {
      problems.push(`${where}: "reason" er for kort til at forklare noget`);
    }
    const source = entry.match instanceof RegExp ? entry.match.source : String(entry.match ?? "");
    if (source.length < 4 || source === ".*" || source === ".") {
      problems.push(`${where}: "match" er for bred — undtagelser skal ramme EET fund`);
    }
    const until = new Date(`${entry.until}T23:59:59`);
    if (Number.isNaN(until.getTime())) {
      problems.push(`${where}: "until" er ikke en dato`);
    } else if (until < today) {
      problems.push(
        `${where}: undtagelsen udloeb ${entry.until}. Ret fladen, eller forny posten med en ny begrundelse.`,
      );
    }
  });
  return problems;
}

/**
 * @param {{rule: string, selector: string, text: string, detail: string}} finding
 * @param {{page: string, lang: string, viewport: string}} context
 * @returns {number} indeks paa den post der daekker fundet, ellers -1
 */
export function matchesAllowlist(finding, context, entries = TEXT_OVERFLOW_ALLOWLIST) {
  const haystack = `${finding.selector} | ${finding.text} | ${finding.detail}`;
  return entries.findIndex((entry) => {
    if (entry.page !== context.page) return false;
    if (entry.rule !== finding.rule) return false;
    if (entry.langs && !entry.langs.includes(context.lang)) return false;
    if (entry.viewports && !entry.viewports.includes(context.viewport)) return false;
    return entry.match instanceof RegExp ? entry.match.test(haystack) : haystack.includes(entry.match);
  });
}
