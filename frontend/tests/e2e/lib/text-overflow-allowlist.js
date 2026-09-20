// Undtagelser til tekst-vagten (#5383). EEN fil, smalle poster, begrundelse og
// udloebsdato paa hver enkelt.
//
// Listen har to dele, fordi de daekker to forskellige slags gaeld:
//
//   TEXT_OVERFLOW_ALLOWLIST   EET sted paa EEN side. Bruges naar en konkret
//                             flade er kendt i stykker og rettelsen ligger
//                             uden for den PR der indfoerte vagten.
//   KNOWN_CONTRAST_DEBT       EET farvepar i design-tokens. Kontrast er ikke et
//                             side-problem: `--text-3` paa kortbaggrunden er
//                             det samme fund paa 11 sider og 1.300 elementer,
//                             og rettelsen er EEN token-vaerdi. Derfor doemmes
//                             kontrast pr. FARVEPAR: de kendte par staar her
//                             med maalt ratio og foreslaaet ny vaerdi, og et
//                             par der IKKE staar her fejler. Vagten er dermed
//                             stadig en aegte forward-guard — den kan bare ikke
//                             kraeve at hele paletten rettes i samme PR.
//
// ── Reglerne for at laegge noget her ───────────────────────────────────────
//
//   1. En post daekker EET sted eller EET farvepar. Ingen wildcards.
//   2. `reason` skal kunne laeses af et menneske om et halvt aar: hvorfor er
//      det her IKKE en fejl, eller hvorfor er det udskudt og til hvad.
//   3. `until` er en dato. Naar den er passeret, FEJLER vagten paa selve
//      posten. Det er hele pointen med at undtagelsen er tidsbegraenset: en
//      udskudt rettelse skal komme tilbage og banke paa, ikke falde i glemslen.
//   4. En side-post der ikke matcher noget fund laengere er ogsaa en fejl. Er
//      fladen rettet, skal posten vaek — ellers lyver listen om hvad der
//      mangler.
//
// Felter i TEXT_OVERFLOW_ALLOWLIST:
//   page       navnet fra PAGES i 5383-text-overflow-guard.spec.js
//   rule       "clipped" | "outside-container" | "unreadable" | "raw-i18n-key",
//              eller en liste af dem naar EET layout-problem kan raabe paa mere
//              end een regel afhaengigt af sprogets ordlaengde
//   match      streng (delstreng) eller RegExp, proevet mod
//              `${selector} | ${text} | ${detail}`
//   langs      valgfri liste, fx ["da"]
//   viewports  valgfri liste, fx ["mobil"]
//   reason     paakraevet
//   until      paakraevet, ISO-dato

export const TEXT_OVERFLOW_ALLOWLIST = [
  {
    page: "traening",
    // To regler i EEN post med vilje: det er EET layout-problem, og hvilken af
    // de to der raaber foerst afhaenger af ordlaengden i sproget. "Vaelg dag"
    // bliver klippet; "Choose day" er saa langt at det ogsaa lander uden for
    // knappen. To poster ville betyde at den ene altid stod som "matcher intet".
    rule: ["clipped", "outside-container"],
    match: /truncate\.text-\[13px\]|a\.text-cz-1\.font-medium\.hover:text-cz-accent/,
    viewports: ["mobil"],
    reason:
      "Traeningssidens dag-kolonne er 15vw (~62 px paa 412 px). Cellens px-4 spiser 32 px og knappens " +
      "egen padding 20 px, saa der er under 10 px tilbage til labelen 'Vaelg dag' — den klippes (16 px DA, " +
      "32 px EN) og stikker 23 px ud over knappen; rytternavnet i samme tabels navnecelle stikker 9-14 px " +
      "ud over sin <td>. Tabellen er haandrullet (ikke DataTable), saa D-047-rettelsen i renderStickyCell " +
      "naar den ikke. Det er den GAMLE mobil-gren: ejeren valgte 18/9 (#3643) en helt ny " +
      "mobil-traeningstabel bag stadie-flaget training_mobile_table, som erstatter netop disse celler. " +
      "At omforme den doede gren nu ville vaere spildt arbejde. Refs #5383, #3643.",
    until: "2026-12-31",
  },
  {
    page: "traening",
    // Fundet af den NYE regel `spilling-text` (#4851, 20/9), som blev tilfoejet
    // fordi ingen af de tre oevrige regler kunne se tekst der males uden for en
    // kasse med synligt overflow. Reglen fandt PRAECIS eet sted i hele appen ud
    // over den flade den blev skrevet til — dette.
    rule: "spilling-text",
    match: /max-w-\[40vw\]/,
    viewports: ["mobil"],
    reason:
      "Rytterens meta-linje i den GAMLE mobil-traeningsliste ('Sprinter/Rouleur · Alder 24 · Form — · " +
      "Traethed —') staar i en max-w-[40vw]-kasse uden bryde-mulighed og males 53-58 px uden for den. " +
      "Sagt hoejt, saa det ikke skjules: den gren er LIVE for spillere uden beta-flaget " +
      "training_mobile_table, saa det er ikke doed kode for dem. Rettelsen er een klasse (break-words) i " +
      "frontend/src/pages/TrainingPage.jsx — en fil denne lane ikke ejer, og som en parallel lane kan " +
      "have aabne aendringer i. Derfor udskudt EN gang, med kort snor: posten udloeber 31/10 og faelder " +
      "vagten hvis grenen stadig staar. Refs #4851, #5383, #3643.",
    until: "2026-10-31",
  },
];

// Kendt kontrast-gaeld pr. FARVEPAR. `pair` skal matche maalerens egen
// formulering praecist: "tekst #xxxxxx paa #yyyyyy".
export const KNOWN_CONTRAST_DEBT = [
  {
    pair: "tekst #9896b0 paa #fcfbf7",
    ratio: 2.77,
    token: "--text-3 paa --bg-card",
    fix: "--text-3: #807ea0 giver 3.75:1 her og >=3.2:1 paa alle fire lyse flader",
    pages: "akademi, auktioner, bestyrelse, dashboard, indstillinger, kalender, mit-hold, oekonomi, rytterdatabase, rytterprofil, traening",
    reason:
      "Lyst temas --text-3 er aldrig blevet kontrast-rettet. Moerkt tema ER (D-TEXT3, se index.css: " +
      "'was #6b6d7e (3.75:1, FAILed AA)'), saa det er en kendt, halvt udfoert oprydning. At aendre " +
      "tokenet er et palet-valg ejeren skal se, og det roerer hvert eneste pixel-snapshot i alle tre " +
      "playwright-projekter — det hoerer hjemme i sin egen PR med snapshot-refresh, ikke i den PR der " +
      "indfoerer vagten. Refs #5383.",
    until: "2026-12-31",
  },
  {
    pair: "tekst #9896b0 paa #f4f2ec",
    ratio: 2.56,
    token: "--text-3 paa --bg-body",
    fix: "samme token-rettelse som ovenfor (--text-3: #807ea0 giver 3.47:1 her)",
    pages: "auktioner, bestyrelse, hjaelp, indbakke, indstillinger, kalender, mit-hold, oekonomi, sponsorer, traening, transfers",
    reason: "Samme token som posten ovenfor, maalt mod sidens canvas i stedet for kortet. Refs #5383.",
    until: "2026-12-31",
  },
  {
    pair: "tekst #9896b0 paa #ece9e1",
    ratio: 2.36,
    token: "--text-3 paa --bg-subtle",
    fix: "samme token-rettelse som ovenfor (--text-3: #807ea0 giver 3.20:1 her — det daarligste af de fire)",
    pages: "auktioner, bestyrelse, dashboard, indstillinger, kalender, oekonomi, rytterdatabase, rytterprofil, transfers",
    reason: "Samme token som posten ovenfor, maalt mod den nedsaenkede flade. Refs #5383.",
    until: "2026-12-31",
  },
  {
    pair: "tekst #9896b0 paa #faf6e5",
    ratio: 2.64,
    token: "--text-3 paa guld-tonet flade",
    fix: "samme token-rettelse som ovenfor (--text-3: #807ea0 giver 3.58:1 her)",
    pages: "indstillinger",
    reason: "Samme token som posten ovenfor, maalt mod den guld-tonede valgt-flade. Refs #5383.",
    until: "2026-12-31",
  },
  {
    pair: "tekst #b29231 paa #fcfbf7",
    ratio: 2.87,
    token: "--accent-t ved 80 % alfa paa --bg-card",
    fix: "brug guld-tokenet ved fuld alfa i den aktive sorteringsoverskrift (#a07800 giver 3.91:1)",
    pages: "mit-hold, rytterdatabase",
    reason:
      "Kun den AKTIVE sorterings-kolonneoverskrift i DataTable. Guld er brandfarve og staar i " +
      "TASTE §6 som ejer-laast, saa selv en alfa-aendring er et synligt guld-valg — og den flytter " +
      "pixels i tabel-snapshots paa tvaers af projekterne. Refs #5383.",
    until: "2026-12-31",
  },
  {
    pair: "tekst #53576a paa #1a1f38",
    ratio: 2.27,
    token: "--text-sidebar-3 (hvid ved 25 %) paa --bg-sidebar",
    fix: "hvid ved 35 % giver 3.16:1",
    pages: "app-skal",
    reason:
      "Sidebarens tertiaere tekst (saldo-label, division, online-taeller). Samme klasse som --text-3: " +
      "een token-vaerdi, men den staar paa hver eneste side og dermed i hvert eneste snapshot. Refs #5383.",
    until: "2026-12-31",
  },
  {
    pair: "tekst #66637a paa #1a1f38",
    ratio: 2.8,
    token: "--text-2 (LYST temas) brugt paa den moerke topbar",
    fix: "sprogvaelgeren skal bruge --text-sidebar-2, ikke --text-2",
    pages: "app-skal",
    reason:
      "Sprogvaelgerens 'da'/'en' i topbaren bruger det lyse temas sekundaere tekstfarve paa den moerke " +
      "bjaelke — en token-forveksling, ikke et palet-valg. Rettelsen er lille, men den flytter pixels i " +
      "sidehovedet paa hvert eneste snapshot, saa den foelger med den samme snapshot-runde som resten " +
      "af kontrast-gaelden. Refs #5383.",
    until: "2026-12-31",
  },
];

const REQUIRED_FIELDS = ["page", "rule", "match", "reason", "until"];
const REQUIRED_DEBT_FIELDS = ["pair", "ratio", "token", "fix", "pages", "reason", "until"];

function expiryProblem(entry, where, today) {
  const until = new Date(`${entry.until}T23:59:59`);
  if (Number.isNaN(until.getTime())) return `${where}: "until" er ikke en dato`;
  if (until < today) {
    return `${where}: undtagelsen udloeb ${entry.until}. Ret fladen, eller forny posten med en ny begrundelse.`;
  }
  return null;
}

/** Fejlene i selve listen — kaldes af vagten foer den doemmer sider. */
export function allowlistProblems(
  entries = TEXT_OVERFLOW_ALLOWLIST,
  debt = KNOWN_CONTRAST_DEBT,
  today = new Date(),
) {
  const problems = [];

  entries.forEach((entry, index) => {
    const where = `post #${index + 1} (${entry.page ?? "uden side"} / ${entry.rule ?? "uden regel"})`;
    for (const field of REQUIRED_FIELDS) {
      if (entry[field] === undefined || entry[field] === null || entry[field] === "") {
        problems.push(`${where}: mangler "${field}"`);
      }
    }
    if (typeof entry.reason === "string" && entry.reason.trim().length < 40) {
      problems.push(`${where}: "reason" er for kort til at forklare noget`);
    }
    const source = entry.match instanceof RegExp ? entry.match.source : String(entry.match ?? "");
    if (source.length < 4 || source === ".*" || source === ".") {
      problems.push(`${where}: "match" er for bred — undtagelser skal ramme EET sted`);
    }
    const expired = expiryProblem(entry, where, today);
    if (expired) problems.push(expired);
  });

  debt.forEach((entry, index) => {
    const where = `kontrast-gaeld #${index + 1} (${entry.pair ?? "uden farvepar"})`;
    for (const field of REQUIRED_DEBT_FIELDS) {
      if (entry[field] === undefined || entry[field] === null || entry[field] === "") {
        problems.push(`${where}: mangler "${field}"`);
      }
    }
    if (!/^tekst #[0-9a-f]{6} paa #[0-9a-f]{6}$/.test(String(entry.pair ?? ""))) {
      problems.push(`${where}: "pair" skal vaere praecis 'tekst #xxxxxx paa #yyyyyy'`);
    }
    if (typeof entry.reason === "string" && entry.reason.trim().length < 40) {
      problems.push(`${where}: "reason" er for kort til at forklare noget`);
    }
    const expired = expiryProblem(entry, where, today);
    if (expired) problems.push(expired);
  });

  return problems;
}

/**
 * @param {{rule: string, selector: string, text: string, detail: string}} finding
 * @param {{page: string, lang: string, viewport: string}} context
 * @returns {number} indeks paa den post der daekker fundet, ellers -1.
 *          Kontrast-gaeld returnerer -1 for indekset men daekker stadig fundet,
 *          derfor `isCovered` nedenfor.
 */
export function matchesAllowlist(finding, context, entries = TEXT_OVERFLOW_ALLOWLIST) {
  const haystack = `${finding.selector} | ${finding.text} | ${finding.detail}`;
  return entries.findIndex((entry) => {
    if (entry.page !== context.page) return false;
    const rules = Array.isArray(entry.rule) ? entry.rule : [entry.rule];
    if (!rules.includes(finding.rule)) return false;
    if (entry.langs && !entry.langs.includes(context.lang)) return false;
    if (entry.viewports && !entry.viewports.includes(context.viewport)) return false;
    return entry.match instanceof RegExp ? entry.match.test(haystack) : haystack.includes(entry.match);
  });
}

/** Er fundet et kendt farvepar fra kontrast-gaelden? */
export function isKnownContrastDebt(finding, debt = KNOWN_CONTRAST_DEBT) {
  if (!finding.detail.includes("kontrast")) return false;
  return debt.some((entry) => finding.detail.includes(entry.pair));
}
