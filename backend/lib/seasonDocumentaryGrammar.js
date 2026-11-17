// #3402: Sæsondokumentaren, DETERMINISTISK fundament (issue-AC lag a).
//
// Ren funktion: samme `facts` (get_season_documentary_facts, #2891/#2863-
// mønsteret) + samme `ctx` giver ALTID samme paragraffer, på begge sprog, i
// samme kald. Ingen rng, ingen Date.now(), ingen DB/fetch. Genkørsel er
// derfor idempotent per konstruktion, og dette ER fallbacken issue #3402
// kræver skal "ALTID virke" alene, uden LLM-nøgle.
//
// HALLUCINATIONS-GARDE (struktur > digtning): hver sætning her sætter tal og
// navne direkte ind fra `facts`, og modulet opfinder ALDRIG et navn eller tal.
// LLM-laget (seasonDocumentaryLLM.js) må kun omformulere DENNE tekst, ikke
// generere nye påstande. Netop derfor skal denne fil være god nok til at
// shippe helt uden LLM-laget.
//
// SANDHED FØR DÆKNING (#8361): en sætning der ikke er sand for spilleren,
// udelades hellere end at stå der. Rivalen skal være en reel nabo i holdets
// egen pulje, og et topresultat der ikke var en sejr, kaldes ikke en sejr.
//
// TONE (#8361, docs/TONE_OF_VOICE.md): ingen lange tankestreger nogen steder,
// og ingen engelske låneord i den danske tekst. Testen låser begge dele.
//
// TEKSTUR UDEN AT VÆRE TILFÆLDIG: ~150 hold får hver sin dokumentar, og en
// ordret-identisk skabelon for alle ville føles som database-tekst, ikke en
// årbog. `variantIndex(teamId, section)` vælger deterministisk mellem et par
// alternative formuleringer pr. afsnit ud fra en simpel streng-hash af
// team_id. Samme hold+afsnit giver ALTID samme variant (idempotent), men to
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

// Simpel, ASCII-sikker tusind-gruppering. Undgår Intl-lokalitetsdrift mellem
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
    mountain: () => "vandt bjergkonkurrencen",
    young: () => "vandt ungdomskonkurrencen",
    team: () => "vandt holdkonkurrencen",
    stage: (n) => `vandt etape ${n ?? "?"}`,
  },
};

// #8361: biggestResult er holdets højest vurderede resultat, og det er ikke
// altid en sejr. En placering skrives som en placering.
const PLACING_LABEL = {
  en: {
    gc: (r) => `finished ${r} overall`,
    points: (r) => `finished ${r} in the points classification`,
    mountain: (r) => `finished ${r} in the mountains classification`,
    young: (r) => `finished ${r} in the young rider classification`,
    team: (r) => `finished ${r} in the team classification`,
    stage: (r, n) => `finished ${r} on stage ${n ?? "?"}`,
  },
  da: {
    gc: (r) => `blev nummer ${r} sammenlagt`,
    points: (r) => `blev nummer ${r} i pointkonkurrencen`,
    mountain: (r) => `blev nummer ${r} i bjergkonkurrencen`,
    young: (r) => `blev nummer ${r} i ungdomskonkurrencen`,
    team: (r) => `blev nummer ${r} i holdkonkurrencen`,
    stage: (r, n) => `blev nummer ${r} på etape ${n ?? "?"}`,
  },
};

function isWin(result) {
  return Number(result?.rank) === 1;
}

function resultLabel(result, lang) {
  const type = result?.result_type;
  const rank = Number(result?.rank);
  if (Number.isFinite(rank) && rank > 1) {
    const placing = PLACING_LABEL[lang]?.[type];
    if (placing) return placing(lang === "da" ? rank : ordinal(rank, "en"), result.stage_number);
  }
  const fn = RESULT_LABEL[lang]?.[type];
  if (!fn) return lang === "da" ? "fik et topresultat" : "posted a top result";
  return fn(result.stage_number);
}

// ── Afsnit 1: åbning (slutstilling) ────────────────────────────────────────
function paragraphOpening({ teamName, seasonNumber, standing }, lang, variant) {
  if (!standing) {
    return lang === "da"
      ? `Sæson ${seasonNumber} er slut for ${teamName}. Holdet har ingen slutstilling i denne sæson.`
      : `Season ${seasonNumber} is over for ${teamName}. The team has no final standing this season.`;
  }
  const rank = ordinal(standing.rank_in_division, lang);
  const points = formatNumber(standing.total_points, lang);
  const days = standing.races_completed ?? 0;
  if (lang === "da") {
    return variant === 0
      ? `Sæson ${seasonNumber} er slut for ${teamName}: ${rank} plads i Division ${standing.division} med ${points} point fra ${days} løbsdage.`
      : `${teamName} slutter sæson ${seasonNumber} som nummer ${standing.rank_in_division} i Division ${standing.division}, med ${points} point fra ${days} løbsdage.`;
  }
  return variant === 0
    ? `Season ${seasonNumber} is done for ${teamName}: ${rank} in Division ${standing.division} on ${points} points from ${days} race days.`
    : `${teamName} close out season ${seasonNumber} in ${rank} place in Division ${standing.division}, with ${points} points from ${days} race days.`;
}

// ── Afsnit 2: holdets indkøb (auktion/transfer) ────────────────────────────
function paragraphSignings({ signings }, lang, variant) {
  if (!signings?.length) {
    return lang === "da"
      ? "Ingen store indkøb i denne sæson. Truppen, der startede året, sluttede det også."
      : "No marquee signings this season. The squad that started the year finished it.";
  }
  const [first, second] = signings;
  const firstAmt = formatAmount(first.amount, lang);
  if (lang === "da") {
    const via = first.source === "auction" ? "på auktion" : "på transfermarkedet";
    const lead = variant === 0
      ? `Sæsonens største investering: ${first.riderName} for ${firstAmt} ${via}`
      : `${first.riderName} var sæsonens dyreste køb: ${firstAmt} ${via}`;
    return second
      ? `${lead}, fulgt af ${second.riderName} for ${formatAmount(second.amount, lang)}.`
      : `${lead}.`;
  }
  const via = first.source === "auction" ? "at auction" : "on the transfer market";
  const lead = variant === 0
    ? `The season's biggest bet: ${first.riderName} for ${firstAmt} ${via}`
    : `${first.riderName} was the season's priciest addition: ${firstAmt} ${via}`;
  return second
    ? `${lead}, followed by ${second.riderName} for ${formatAmount(second.amount, lang)}.`
    : `${lead}.`;
}

// ── Afsnit 3: største resultat ─────────────────────────────────────────────
function paragraphBiggestResult({ biggestResult, signings, teamName }, lang, variant) {
  if (!biggestResult) {
    return lang === "da"
      ? "Ingen enkeltsejr at pege på i år. Historien blev skrevet løb for løb, ikke på én stor dag."
      : "No single win to point to this year. The story was written race by race, not on one big day.";
  }
  const label = resultLabel(biggestResult, lang);
  // Holdkonkurrencen har ingen rytter: subjektet er holdet selv.
  const name = biggestResult.rider_name || teamName;
  const race = biggestResult.race_name;
  const base = lang === "da"
    ? (variant === 0
        ? `Højdepunktet: ${name} ${label} ved ${race}.`
        : `${race} leverede sæsonens højdepunkt, da ${name} ${label}.`)
    : (variant === 0
        ? `The high point: ${name} ${label} at ${race}.`
        : `${race} delivered the season's high point, when ${name} ${label}.`);
  const paidOff = isWin(biggestResult)
    && signings?.some((s) => s.riderName && biggestResult.rider_name && s.riderName === biggestResult.rider_name);
  if (!paidOff) return base;
  return lang === "da"
    ? `${base} Det dyre køb betalte sig hurtigt tilbage.`
    : `${base} The marquee signing paid off in a hurry.`;
}

// ── Afsnit 4: bedste løb ───────────────────────────────────────────────────
function paragraphTurningPoint({ bestRaceDay, standing }, lang, variant) {
  if (!bestRaceDay) {
    return lang === "da"
      ? `Intet enkelt løb definerede sæsonen. Det var et jævnt slid over ${standing?.races_completed ?? "alle"} løbsdage.`
      : `No single race defined the season. It was a steady grind across ${standing?.races_completed ?? "all"} race days.`;
  }
  const points = formatNumber(bestRaceDay.total_points, lang);
  const riders = bestRaceDay.riders_scoring;
  if (lang === "da") {
    return variant === 0
      ? `Holdets bedste løb var ${bestRaceDay.race_name}, hvor ${riders} ryttere tilsammen hentede ${points} point.`
      : `${bestRaceDay.race_name} blev sæsonens bedste løb: ${riders} ryttere fik point, ${points} i alt.`;
  }
  return variant === 0
    ? `The team's best race was ${bestRaceDay.race_name}, where ${riders} riders combined for ${points} points.`
    : `${bestRaceDay.race_name} was the season's best race: ${riders} riders scored, ${points} points in total.`;
}

// ── Afsnit 5: rival ─────────────────────────────────────────────────────────
// #8361: rivalen er kun sand, hvis den står i holdets EGEN pulje og lige over
// eller under holdet i stillingen. Facts fra før migrationen (uden pulje på
// rivalen) eller fra et hold uden pulje giver ingen rival-sætning.
export function isRealNeighbour(rival, standing) {
  if (!rival || !standing) return false;
  const pool = standing.league_division_id;
  if (pool === null || pool === undefined) return false;
  if (rival.league_division_id === null || rival.league_division_id === undefined) return false;
  if (String(rival.league_division_id) !== String(pool)) return false;
  const myRank = Number(standing.rank_in_division);
  const theirRank = Number(rival.rank_in_division);
  if (!Number.isFinite(myRank) || !Number.isFinite(theirRank)) return false;
  return Math.abs(myRank - theirRank) === 1;
}

// Naboen kan ligge langt fra i point, så teksten siger kun det der er sandt:
// pladsen og afstanden. Ingen "tæt kamp" eller "i hælene", som ikke altid holder.
function paragraphRival({ rival, standing }, lang, variant) {
  if (!isRealNeighbour(rival, standing)) return null;
  const ahead = Number(rival.rank_in_division) < Number(standing.rank_in_division);
  // Stillingen rangerer efter point minus strafpoint, så afstanden gør det samme.
  const effective = (s) => (Number(s.total_points) || 0) - (Number(s.penalty_points) || 0);
  const gapValue = Math.abs(Math.round(effective(rival) - effective(standing)));
  const gap = formatNumber(gapValue, lang);
  const level = gapValue === 0;
  const name = rival.team_name;
  if (lang === "da") {
    if (ahead) {
      return variant === 0
        ? `Nærmeste konkurrent i puljen var ${name}, én plads foran ${level ? "på samme pointtal" : `med ${gap} point mere`}.`
        : `${name} sluttede én plads foran i puljen, ${level ? "på samme pointtal" : `${gap} point længere fremme`}.`;
    }
    return variant === 0
      ? `Nærmeste konkurrent i puljen var ${name}, én plads bagved ${level ? "på samme pointtal" : `med ${gap} point mindre`}.`
      : `${name} sluttede én plads bagved i puljen, ${level ? "på samme pointtal" : `${gap} point efter`}.`;
  }
  if (ahead) {
    return variant === 0
      ? `The nearest rival in the pool was ${name}, one place ahead ${level ? "level on points" : `with ${gap} more points`}.`
      : `${name} finished one place ahead in the pool, ${level ? "level on points" : `${gap} points clear`}.`;
  }
  return variant === 0
    ? `The nearest rival in the pool was ${name}, one place behind ${level ? "level on points" : `with ${gap} fewer points`}.`
    : `${name} finished one place behind in the pool, ${level ? "level on points" : `${gap} points back`}.`;
}

const SECTIONS = [
  { key: "opening", fn: paragraphOpening, variants: 2 },
  { key: "signings", fn: paragraphSignings, variants: 2 },
  { key: "biggestResult", fn: paragraphBiggestResult, variants: 2 },
  { key: "turningPoint", fn: paragraphTurningPoint, variants: 2 },
  { key: "rival", fn: paragraphRival, variants: 2 },
];

/**
 * Bygger dokumentarens paragraffer for ÉT sprog. Et afsnit der ikke har en
 * sand sætning at sige (i dag kun rivalen), udelades, så længden er 4 eller 5.
 * @param {object} facts  get_season_documentary_facts-outputtet (signings, biggestResult, bestRaceDay, rival, myStanding)
 * @param {object} ctx    { teamId, teamName, seasonNumber }
 * @param {"en"|"da"} lang
 * @returns {string[]}
 */
export function buildSeasonDocumentaryParagraphs(facts, ctx, lang) {
  const standing = facts?.myStanding ?? null;
  const args = {
    // Intet holdnavn: et neutralt subjekt i stedet for en tom-glyf midt i prosaen.
    teamName: ctx?.teamName || (lang === "da" ? "Holdet" : "The team"),
    seasonNumber: ctx?.seasonNumber ?? "?",
    standing,
    signings: facts?.signings ?? [],
    biggestResult: facts?.biggestResult ?? null,
    bestRaceDay: facts?.bestRaceDay ?? null,
    rival: facts?.rival ?? null,
  };
  return SECTIONS
    .map(({ key, fn, variants }) => fn(args, lang, variantIndex(ctx?.teamId, key, variants)))
    .filter((p) => typeof p === "string" && p.length > 0);
}

/**
 * Bygger BEGGE sprog i ét kald, den form season_documentaries.deterministic_en/da
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
