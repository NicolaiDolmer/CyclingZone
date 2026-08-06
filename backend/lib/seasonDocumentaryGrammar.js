// #3402 — Sæsondokumentaren, DETERMINISTISK fundament (issue-AC lag a).
//
// Ren funktion: samme `facts` (get_season_documentary_facts, #2891/#2863-
// mønsteret) + samme `ctx` giver ALTID samme paragraffer, på begge sprog, i
// samme kald. Ingen rng, ingen Date.now(), ingen DB/fetch — genkørsel er
// derfor idempotent per konstruktion, og dette ER fallbacken issue #3402
// kræver skal "ALTID virke" alene, uden LLM-nøgle.
//
// HALLUCINATIONS-GARDE (struktur > digtning): hver sætning her sætter tal og
// navne direkte ind fra `facts` — modulet opfinder ALDRIG et navn eller tal.
// LLM-laget (seasonDocumentaryLLM.js) må kun omformulere DENNE tekst, ikke
// generere nye påstande — det er netop derfor denne fil skal være god nok
// til at shippe helt uden LLM-laget.
//
// TEKSTUR UDEN AT VÆRE TILF�ældig: ~150 hold får hver sin dokumentar, og en
// ordret-identisk skabelon for alle ville føles som database-tekst, ikke en
// årbog. `variantIndex(teamId, section)` vælger deterministisk mellem et par
// alternative formuleringer pr. afsnit ud fra en simpel streng-hash af
// team_id — samme hold+afsnit giver ALTID samme variant (idempotent), men to
// forskellige hold i samme division læser sjældent identisk prosa.

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function variantIndex(teamId, section, count) {
  if (!teamId || count <= 1) return 0;
  return hashString(`${teamId}:${section}`) % count;
}

// Simpel, ASCII-sikker tusind-gruppering — undgår Intl-lokalitetsdrift mellem
// Node-versioner/OS'er i en batch-cron-kontekst (samme forbehold som andre
// backend-lib'er der formaterer beløb uden for request/response-laget).
function formatAmount(n, lang) {
  const v = Math.round(Number(n) || 0);
  const sep = lang === "da" ? "." : ",";
  const s = Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  return `${v < 0 ? "-" : ""}${s} CZ$`;
}

function formatNumber(n, lang) {
  const v = Math.round(Number(n) || 0);
  const sep = lang === "da" ? "." : ",";
  return v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

function ordinal(n, lang) {
  if (lang === "da") return `${n}.`;
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

const RESULT_LABEL = {
  en: {
    gc: () => "won the general classification",
    points: () => "won the points classification",
    mountain: () => "won the mountains classification",
    young: () => "won the young rider classification",
    team: () => "won the team classification",
    stage: (n) => `won stage ${n ?? "?"}`,
  },
  da: {
    gc: () => "vandt sammenlagt",
    points: () => "vandt pointkonkurrencen",
    mountain: () => "vandt bjergtrøjen",
    young: () => "vandt ungdomstrøjen",
    team: () => "vandt holdkonkurrencen",
    stage: (n) => `vandt etape ${n ?? "?"}`,
  },
};

function resultLabel(resultType, stageNumber, lang) {
  const fn = RESULT_LABEL[lang]?.[resultType];
  if (!fn) return lang === "da" ? "fik et topresultat" : "posted a top result";
  return fn(stageNumber);
}

// ── Afsnit 1: åbning (slutstilling) ────────────────────────────────────────
function paragraphOpening({ teamName, seasonNumber, standing }, lang, variant) {
  if (!standing) {
    return lang === "da"
      ? `Sæson ${seasonNumber} er slut for ${teamName} — ingen slutstilling fundet for holdet denne sæson.`
      : `Season ${seasonNumber} is over for ${teamName} — no final standing found for the team this season.`;
  }
  const rank = ordinal(standing.rank_in_division, lang);
  const points = formatNumber(standing.total_points, lang);
  if (lang === "da") {
    return variant === 0
      ? `Sæson ${seasonNumber} er slut for ${teamName}: ${rank} plads i Division ${standing.division} med ${points} point fra ${standing.races_completed ?? 0} løbsdage.`
      : `${teamName} lukker sæson ${seasonNumber} som nummer ${standing.rank_in_division} i Division ${standing.division} — ${points} point i banken efter ${standing.races_completed ?? 0} løbsdage.`;
  }
  return variant === 0
    ? `Season ${seasonNumber} is done for ${teamName}: ${rank} in Division ${standing.division} on ${points} points from ${standing.races_completed ?? 0} race days.`
    : `${teamName} close out season ${seasonNumber} in ${rank} place in Division ${standing.division} — ${points} points from ${standing.races_completed ?? 0} race days on the road.`;
}

// ── Afsnit 2: signings (auktion/transfer) ──────────────────────────────────
function paragraphSignings({ signings }, lang, variant) {
  if (!signings?.length) {
    return lang === "da"
      ? "Ingen store signings denne sæson — truppen der startede året, sluttede det også."
      : "No marquee signings this season — the squad that started the year finished it.";
  }
  const [first, second] = signings;
  const firstAmt = formatAmount(first.amount, lang);
  if (lang === "da") {
    const lead = variant === 0
      ? `Sæsonens største investering: ${first.riderName} for ${firstAmt}`
      : `${first.riderName} var sæsonens dyreste kort — ${firstAmt}`;
    const via = first.source === "auction" ? "på auktion" : "på transfermarkedet";
    const tail = second ? `, fulgt af ${second.riderName} for ${formatAmount(second.amount, lang)}.` : ` ${via}.`;
    return `${lead} ${via}${second ? "" : "."}${second ? tail : ""}`.replace(/\s+\./g, ".");
  }
  const via = first.source === "auction" ? "at auction" : "on the transfer market";
  const lead = variant === 0
    ? `The season's biggest bet: ${first.riderName} for ${firstAmt}`
    : `${first.riderName} was the season's priciest addition — ${firstAmt}`;
  const tail = second ? `, followed by ${second.riderName} for ${formatAmount(second.amount, lang)}.` : ` ${via}.`;
  return `${lead} ${via}${second ? "" : "."}${second ? tail : ""}`.replace(/\s+\./g, ".");
}

// ── Afsnit 3: biggest result (individuel) ──────────────────────────────────
function paragraphBiggestResult({ biggestResult, signings }, lang, variant) {
  if (!biggestResult) {
    return lang === "da"
      ? "Ingen enkeltsejr at pege på i år — historien blev skrevet løb for løb, ikke på én stor dag."
      : "No single win to point to this year — the story was written race by race, not on one big day.";
  }
  const label = resultLabel(biggestResult.result_type, biggestResult.stage_number, lang);
  const name = biggestResult.rider_name;
  const race = biggestResult.race_name;
  const paidOff = signings?.some((s) => s.riderName && name && s.riderName === name);
  const base = lang === "da"
    ? (variant === 0
        ? `Højdepunktet: ${name} ${label} ved ${race}.`
        : `${race} leverede sæsonens højdepunkt, da ${name} ${label}.`)
    : (variant === 0
        ? `The high point: ${name} ${label} at ${race}.`
        : `${race} delivered the season's high point, when ${name} ${label}.`);
  if (!paidOff) return base;
  return lang === "da"
    ? `${base} Den dyre signing betalte sig hurtigt tilbage.`
    : `${base} The marquee signing paid off in a hurry.`;
}

// ── Afsnit 4: bedste løbsdag / vendepunkt ──────────────────────────────────
function paragraphTurningPoint({ bestRaceDay, standing }, lang, variant) {
  if (!bestRaceDay) {
    return lang === "da"
      ? `Ingen enkelt dag definerede sæsonen — mere et jævnt slid over ${standing?.races_completed ?? "alle"} løbsdage.`
      : `No single day defined the season — more a steady grind across ${standing?.races_completed ?? "all"} race days.`;
  }
  const points = formatNumber(bestRaceDay.total_points, lang);
  const riders = bestRaceDay.riders_scoring;
  if (lang === "da") {
    return variant === 0
      ? `Vendepunktet kom ved ${bestRaceDay.race_name}, hvor ${riders} ryttere tilsammen hentede ${points} point — holdets bedste dag i sæsonen.`
      : `${bestRaceDay.race_name} blev sæsonens bedste dag: ${riders} ryttere i mål med point, ${points} point i alt.`;
  }
  return variant === 0
    ? `The turning point came at ${bestRaceDay.race_name}, where ${riders} riders combined for ${points} points — the team's best day of the season.`
    : `${bestRaceDay.race_name} was the season's best day: ${riders} riders scoring, ${points} points in total.`;
}

// ── Afsnit 5: rival ─────────────────────────────────────────────────────────
function paragraphRival({ rival, standing }, lang, variant) {
  if (!rival) {
    return lang === "da"
      ? "Ingen tæt rival i år — divisionen var helt for sig selv i toppen af tabellen."
      : "No close rival this year — the division was theirs alone at the top of the table.";
  }
  const gap = formatNumber(rival.gap, lang);
  const above = rival.total_points > (standing?.total_points ?? 0);
  if (lang === "da") {
    const dir = above ? "foran" : "bagved";
    return variant === 0
      ? `Sæsonens tætteste rivalisering: ${rival.team_name}, kun ${gap} point ${dir} i slutstillingen.`
      : `${rival.team_name} var pusten i nakken hele vejen — ${gap} point ${dir} ved sæsonens afslutning.`;
  }
  const dir = above ? "ahead" : "behind";
  return variant === 0
    ? `The season's closest rivalry: ${rival.team_name}, just ${gap} points ${dir} in the final standings.`
    : `${rival.team_name} were breathing down their neck all year — ${gap} points ${dir} at season's end.`;
}

const SECTIONS = [
  { key: "opening", fn: paragraphOpening, variants: 2 },
  { key: "signings", fn: paragraphSignings, variants: 2 },
  { key: "biggestResult", fn: paragraphBiggestResult, variants: 2 },
  { key: "turningPoint", fn: paragraphTurningPoint, variants: 2 },
  { key: "rival", fn: paragraphRival, variants: 2 },
];

/**
 * Bygger dokumentarens paragraffer for ÉT sprog.
 * @param {object} facts  get_season_documentary_facts-outputtet (signings, biggestResult, bestRaceDay, rival, myStanding)
 * @param {object} ctx    { teamId, teamName, seasonNumber }
 * @param {"en"|"da"} lang
 * @returns {string[]}
 */
export function buildSeasonDocumentaryParagraphs(facts, ctx, lang) {
  const standing = facts?.myStanding ?? null;
  const args = {
    teamName: ctx?.teamName ?? "—",
    seasonNumber: ctx?.seasonNumber ?? "?",
    standing,
    signings: facts?.signings ?? [],
    biggestResult: facts?.biggestResult ?? null,
    bestRaceDay: facts?.bestRaceDay ?? null,
    rival: facts?.rival ?? null,
  };
  return SECTIONS.map(({ key, fn, variants }) =>
    fn(args, lang, variantIndex(ctx?.teamId, key, variants))
  );
}

/**
 * Bygger BEGGE sprog i ét kald — den form season_documentaries.deterministic_en/da
 * persisteres som, og som seasonDocumentaryGenerate.js/LLM-laget arbejder videre på.
 * @returns {{ en: string[], da: string[] }}
 */
export function buildSeasonDocumentary(facts, ctx) {
  return {
    en: buildSeasonDocumentaryParagraphs(facts, ctx, "en"),
    da: buildSeasonDocumentaryParagraphs(facts, ctx, "da"),
  };
}

export const __internal = { formatAmount, formatNumber, ordinal, hashString };
