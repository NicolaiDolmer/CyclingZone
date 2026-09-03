import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Source-string-guard for de tre #1480-krav på træningssiden:
//   1) vis ryttertype  2) gruppér efter type  3) rediger flere ad gangen.
// Spejler StatBar-guard-mønstret (RidersPage.statBar.test.js).
const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "TrainingPage.jsx"), "utf8");

test("#1480.1 roster-query henter ryttertype-kolonnerne", () => {
  assert.match(
    src,
    /\.select\(`id, firstname, lastname, birthdate, contract_end_season, primary_type, secondary_type, is_academy, \$\{ABILITY_SELECT\}`\)/,
    "querien skal hente primary_type/secondary_type så typen kan vises, + is_academy (#3300)"
      + " + evne-kolonnerne via det delte ABILITY_SELECT-embed (#3709 trin 1: kvitteringens 'nu'-tal)"
      + " + birthdate (#3721 Development-fanen, #3815 roster-tabellens alders-kolonne)"
      + " + contract_end_season (#3761: Status-cellens contractExpiring-badge)",
  );
  // #3709 trin 1: evnerne skal fladtgøres med den DELTE helper, ikke håndrulles,
  // så embed-formen (array vs objekt) håndteres ét sted.
  assert.match(src, /import \{ ABILITY_SELECT, flattenAbilities \} from "\.\.\/lib\/abilities\.js"/);
  assert.match(src, /setRiders\(\(data \|\| \[\]\)\.map\(flattenAbilities\)\)/);
});

// #3300 (rework efter ejer-feedback): akademi-status pr. rytter-række —
// is_academy medtages read-only i den eksisterende roster-query (INGEN ny
// query/migration) og vises via den eksisterende RiderBadges-recipe (samme
// "academy"-badge som TeamPage/TeamProfilePage). Ejer afviste v1 (badge inline
// i navne-cellen) — badgen skal stå i sin EGEN kolonne, "på samme måde som
// badges andre steder" (TeamPages Status-kolonne, der bundler badges via
// RiderBadges). Guarden tjekker derfor BÅDE at RiderBadges bruges, OG at den
// ikke længere ligger inde i den sticky navne-celle.
test("#3300 roster-rækken viser akademi-status via den delte RiderBadges-recipe, i sin egen kolonne", () => {
  assert.match(src, /import RiderBadges from "\.\.\/components\/rider\/RiderBadges\.jsx"/);
  assert.match(
    src,
    /<RiderBadges badges=\{\[[\s\S]*?rider\.is_academy && "academy",/,
    "skal genbruge den eksisterende academy-badge-nøgle, ikke en ny visuel",
  );

  // Navne-cellen (sticky left-10) må IKKE længere indeholde RiderBadges eller
  // ugeplan-toggle-knappen — begge er flyttet til deres egne kolonner.
  const nameCellStart = src.indexOf("sticky-name-cell sticky left-10");
  assert.ok(nameCellStart > -1, "navne-cellen skal stadig eksistere");
  const nameCellEnd = src.indexOf("</td>", nameCellStart);
  const nameCellSrc = src.slice(nameCellStart, nameCellEnd);
  assert.doesNotMatch(nameCellSrc, /RiderBadges/, "akademi-badgen må ikke længere ligge i navne-cellen");
  assert.doesNotMatch(nameCellSrc, /toggleRiderWeekPlan/, "ugeplan-toggle-knappen må ikke længere ligge i navne-cellen");

  // Badgen skal stå i "Status"-kolonnen (samme header-mønster som TeamPage).
  assert.match(src, /t\("colStatus"\)/, "Status-kolonnen skal stadig have sin header");
  const statusCellStart = src.indexOf("Status: akademi");
  assert.ok(statusCellStart > -1, "Status-kolonnen skal have en kommentar der forklarer akademi+badges-bundlingen");
  const statusCellTdStart = src.indexOf("<td", statusCellStart);
  const statusCellEnd = src.indexOf("</td>", statusCellTdStart);
  const statusCellSrc = src.slice(statusCellTdStart, statusCellEnd);
  assert.match(statusCellSrc, /<RiderBadges badges=\{\[[\s\S]*?rider\.is_academy && "academy",/, "akademi-badgen skal stå i Status-kolonnen");
});

// #3761: Status-cellen viste kun akademi-badgen. Kontraktudløb + pensionsrisiko
// er de to badges der afgør om træning på rytteren overhovedet er en
// investering værd, og begge findes allerede som beregnede helpers i
// riderAge.js (samme kald-form som TeamPage.jsx). Guarden låser at de sendes
// ind i det EKSISTERENDE RiderBadges — ikke som ny håndrullet markup — og at
// akademiryttere undtages, ligesom på TeamPage (squad-risk-spærren #2748
// tæller kun senior-ryttere).
test("#3761 Status-cellen viser kontraktudloeb + pensionsrisiko via de delte helpers", () => {
  assert.match(
    src,
    /import \{ ageForSeason, retirementRiskBadgeKey, contractExpiringBadgeKey, seasonNumberFromReferenceYear \} from "\.\.\/lib\/riderAge\.js"/,
    "badge-nøglerne skal komme fra den delte riderAge.js, ikke genberegnes lokalt",
  );
  assert.match(
    src,
    /const activeSeasonNumber = seasonNumberFromReferenceYear\(seasonYear\);/,
    "contract_end_season er et sæson-NUMMER — nummeret udledes af det allerede hentede referenceår, ingen ekstra kald",
  );

  const statusCellStart = src.indexOf("Status: akademi");
  const statusCellTdStart = src.indexOf("<td", statusCellStart);
  const statusCellEnd = src.indexOf("</td>", statusCellTdStart);
  const statusCellSrc = src.slice(statusCellTdStart, statusCellEnd);
  assert.match(
    statusCellSrc,
    /!rider\.is_academy && retirementRiskBadgeKey\(rider, seasonYear\)/,
    "pensionsrisiko-badgen skal stå i Status-kolonnen, og ikke på akademiryttere",
  );
  assert.match(
    statusCellSrc,
    /!rider\.is_academy && contractExpiringBadgeKey\(rider, activeSeasonNumber\)/,
    "kontraktudløb-badgen skal stå i Status-kolonnen, og ikke på akademiryttere",
  );
});

// #3815: alderen er den vigtigste enkeltvariabel når man vælger hvem der skal
// trænes hårdt, og manglede på den flade hvor valget træffes (@knud_r_flink,
// Discord 15/8). #1674 lukkede hullet på rytteroverblik + transferliste, men
// ikke her. Kolonnen skal være sorterbar som de øvrige (SortTh +
// rosterAccessors) og eksponeres i mobil-sortkontrollen, jf. #3706.
test("#3815 roster-tabellen har en sorterbar Alder-kolonne", () => {
  assert.match(src, /"colAge"/, "kolonnen skal have sin egen locale-nøgle");
  assert.match(
    src,
    /<SortTh sortKey="age"/,
    "alderen skal bruge den delte SortTh, ikke et bart <th> (samme fejl som #3706 rettede)",
  );
  assert.match(
    src,
    /age: \(r\) => ageForSeason\(r\.birthdate, seasonYear\),/,
    "sorteringen skal bruge samme helper som cellen viser, så rækkefølgen ikke kan drive fra tallet",
  );
  assert.match(
    src,
    /\{ key: "age", label: t\("colAge"\) \}/,
    "mobil-sortkontrollen skal eksponere præcis de samme nøgler som desktop-headerne (#3706)",
  );
  assert.match(
    src,
    /ageForSeason\(rider\.birthdate, seasonYear\) \?\? "—"/,
    "cellen skal vise sæson-alderen med '—' når sæson-året mangler (#3071: aldrig et gættet tal)",
  );
  assert.match(
    src,
    /ROSTER_DESC_FIRST = new Set\(\["age",/,
    "alder er numerisk og følger sidens desc-først-konvention: ét klik = de ældste øverst",
  );
});

// #3300-rework gav ugeplan-knappen sin EGEN kolonne. #4613 (retning B,
// ejer-valgt 3/9) erstatter den kolonne med uge-strimlen: cellen bærer nu BÅDE
// svaret (de næste 7 dage) og vejen videre (rytterens egen ugeplan, som bor på
// Ugeplan-fanen). Kravet bag #3300-rework er uændret — knappen må ikke ligge i
// navne-cellen, og rækken må ikke have to celler til den samme ting.
test("#4613 uge-kolonnen bærer strimlen OG indgangen til rytterens egen ugeplan", () => {
  assert.match(src, /"colWeek"/, "uge-kolonnen skal have sin egen locale-nøgle");
  // #4613: kvitterings-kolonnen flyttede til Udvikling-fanen og ugeplan-knappens
  // egen kolonne blev uge-strimlen, så tallet er 10.
  assert.match(src, /const ROSTER_COLS = 10;/, "kolonnetal skal matche de faktiske kolonner");

  const weekCellStart = src.indexOf("#4613 — Uge:");
  assert.ok(weekCellStart > -1, "uge-kolonnens celle skal have sin egen kommentar");
  const weekTdStart = src.indexOf("<td", weekCellStart);
  const weekTdEnd = src.indexOf("</td>", weekTdStart);
  const weekCellSrc = src.slice(weekTdStart, weekTdEnd);
  assert.match(weekCellSrc, /openRiderWeekPlan\(rider\.id\)/, "cellen er indgangen til rytterens egen ugeplan");
  assert.match(weekCellSrc, /individualWeekPlanToggleOpen/, "knap-teksten skal genbruges uændret");
  assert.match(weekCellSrc, /<TrainingWeekStrip days=\{weekStripDays\}/, "cellen skal vise de næste 7 dage");
});

// #4613: strimlen må ALDRIG opfinde en kalender fremad — kun I DAG kan bære en
// løbsmarkering, fordi racingToday er det eneste løbsdata fladen har.
test("#4613 uge-strimlen bygges af den delte, unit-testede helper", () => {
  assert.match(src, /import \{ riderWeekStrip \} from "\.\.\/lib\/trainingWeekStrip\.js"/);
  assert.match(src, /const weekStripDays = riderWeekStrip\(\{/, "rækken må ikke lagdele dagene selv");
  assert.match(src, /racingToday: !!raceToday,/, "løbsdagen er den samme kilde som badgen på rækken");
});

// #4613: overbliksfladen. Den slanke stribe + den kanoniske FilterBar +
// status-segmentet i tabellens toolbar ERSTATTER de løsrevne kontrol-rækker
// (gruppér-checkbox, hjælpe-link, mobil-sort, bulk-bjælke) der lå mellem
// sidehovedet og tabellen ("no orphan action rows", PAGE_TEMPLATES).
test("#4613 overbliksfanen bruger den kanoniske FilterBar + Segmented i tabellens toolbar", () => {
  assert.match(src, /import \{[\s\S]*?FilterBar, Segmented,/, "skal bruge kittets primitiver, ikke håndrullede filtre");
  assert.match(src, /<FilterBar/, "filterlinjen skal være FilterBar-recepten");
  assert.match(src, /t\("overview\.searchPlaceholder"\)/, "søgefeltet skal have sin egen locale-nøgle");
  assert.match(src, /<Segmented/, "status-spørgsmålet skal være kittets Segmented");
  assert.match(src, /ROSTER_VIEWS = Object\.freeze\(\["all", "noplan", "risk", "racing"\]\)/);
  assert.match(src, /t\("overview\.showing"/, "tælle-linjen skal sige hvor mange af hvor mange");
});

// #4613: tabellen er `dense` (T2's ENE opt-in for rosters hvor rækker-pr-skærm
// ER pointen) og bærer et filter-tomt-tbody i stedet for at swappe hele kortet
// — ellers ryger toolbaren med, og filteret kan ikke slås fra igen.
test("#4613 roster-tabellen er dense og swapper <tbody> ved et tomt filter", () => {
  assert.match(src, /thClass\(\{ dense: true \}\)/, "headeren skal bruge dense-rytmen");
  assert.match(src, /tdClass\(\{ dense: true \}\)/, "cellerne skal bruge dense-rytmen");
  assert.match(src, /filteredRiders\.length === 0 \? \(/, "tom-tilstanden skal bo i <tbody>");
  assert.match(src, /t\("overview\.clearFilters"\)/, "tom-tilstanden skal have ÉN handling (TASTE fork 4)");
});

// #4613: fanelisten er data-drevet, så Program (#4629) og Løbsdag (#4632) kan
// kobles på som ét element hver. Ingen tomme placeholder-faner i mellemtiden.
test("#4613 fanelisten er data-drevet og har ingen tomme placeholder-faner", () => {
  assert.match(src, /const TRAINING_TAB_DEFS = Object\.freeze\(\[/);
  assert.match(src, /const TRAINING_TABS = TRAINING_TAB_DEFS\.map\(\(tab\) => tab\.value\);/);
  assert.match(src, /TRAINING_TAB_DEFS\.map\(\(tab\) => \(\s*<Tab key=\{tab\.value\} value=\{tab\.value\}>/);
  for (const value of ["today", "weekplan", "development", "history"]) {
    assert.match(src, new RegExp(`value: "${value}"`), `?tab=${value} skal stadig være et gyldigt dyb-link`);
  }
  assert.doesNotMatch(src, /comingSoon|placeholderTab/i, "en ubygget fane vises ikke som en tom fane (TASTE P11)");
});

test("#1480.1 hver række renderer en RiderTypeBadge", () => {
  assert.match(src, /import RiderTypeBadge from/);
  assert.match(
    src,
    /<RiderTypeBadge primaryType=\{rider\.primary_type\} secondaryType=\{rider\.secondary_type\} \/>/,
  );
});

test("#1480.2 group-by-type-toggle styrer grupperet visning via groupRidersByType", () => {
  assert.match(src, /import \{ groupRidersByType, UNTYPED_KEY \} from/);
  // #4613: grupperingen kører på den FILTREREDE liste, så gruppe-tællingerne
  // matcher det man ser (en gruppe kan ikke sige 4 og vise 1).
  assert.match(src, /groupByType\s*\?\s*groupRidersByType\(filteredRiders\)/);
  assert.match(src, /t\("groupByType"\)/);
});

test("#1480.3 multi-select + bulk-apply via setPlanBulk", () => {
  assert.match(src, /setPlanBulk/, "skal bruge bulk-handleren");
  assert.match(src, /handleBulkApply/);
  assert.match(src, /t\("bulkApply"/);
  // Select-all + per-række checkbox.
  assert.match(src, /toggleSelectAll/);
  assert.match(src, /toggleSelect\(rider\.id\)/);
});

// #1894 variant 1: hint under fokus-dropdown for ryttere UDEN plan — viser hvilket
// fokus assistenten rent faktisk træner dem med (backend-leveret smartDefaultFocus,
// ingen frontend-dublet af type→fokus-reglen).
// #3721: fokus-knappen (og dermed hint-betingelsen) er ekstraheret til den
// delte FocusOpenButton-komponent (genbrugt af Development-fanen) — betingelsen
// bruger nu den generiske `smartFocus`-prop i stedet for det inlinede
// `smartDefaultFocus[rider.id]`-udtryk, men VÆRDIEN kommer stadig UÆNDRET fra
// smartDefaultFocus ved kaldestedet (samme guard, kun flyttet).
test("#1894.1 smart-fokus-hint vises for ryttere uden plan, kun fra backend-leveret data", () => {
  assert.match(src, /smartDefaultFocus/, "skal bruge useTraining's smartDefaultFocus-map");
  assert.match(src, /t\("smartFocusHint"/);
  assert.match(src, /!plan\?\.focus\s*&&\s*smartFocus/, "hint kun uden aktiv plan (FocusOpenButton-props)");
  assert.match(src, /smartFocus=\{smartDefaultFocus\[rider\.id\]\}/, "roster-rækken skal sende smartDefaultFocus[rider.id] uændret ind i FocusOpenButton");
});

// #1894 variant 3: bulk-barens fokus-select har en "smart"-mode-mulighed der
// resolves server-side (frontend sender blot focus="smart").
test("#1894.3 bulk-select har smart-fokus-mulighed + viser skipped-med-plan", () => {
  assert.match(src, /<option value="smart">\{t\("bulkSmartFocusOption"\)\}<\/option>/);
  assert.match(src, /bulkSmartSkippedHasPlan/);
  assert.match(src, /skippedHasPlan/);
});

// #1895 PR 1: ugentlig træningsrytme — panel med 7 dags-selects + gem/nulstil,
// wired mod useTraining's setWeekPlan/clearWeekPlan (aldrig frontend-fokus-logik).
test("#1895 ugerytme-panel har 7 ugedags-selects + gem/nulstil wired mod useTraining", () => {
  assert.match(src, /weekPlan, savingWeekPlan, setWeekPlan, clearWeekPlan/, "skal destrukturere ugerytme-state fra useTraining");
  assert.match(src, /t\("weekRhythmTitle"\)/);
  assert.match(src, /WEEKDAY_KEYS\.map\(\(weekday\)/, "skal rendere én select pr. WEEKDAY_KEYS-nøgle");
  assert.match(src, /handleSaveWeekPlan/);
  assert.match(src, /handleResetWeekPlan/);
  assert.match(src, /setWeekPlan\(days\)/, "gem skal kalde useTraining's setWeekPlan");
  assert.match(src, /clearWeekPlan\(\)/, "nulstil skal kalde useTraining's clearWeekPlan");
});

test("#1895/#2438 roster-rækker viser altid dagens effektive intensitet + kilde, når holdet har en ugerytme (ren visning)", () => {
  assert.match(src, /resolveDayIntensityDisplay/, "skal genbruge den delte lagdelings-funktion (samme regel som motoren)");
  assert.match(src, /resolveDayIntensitySource/, "#2438: skal genbruge kilde-funktionen (individualPlan/ownSetting/teamRhythm)");
  assert.match(src, /teamRhythmActive/, "hint vises altid når holdet HAR en ugerytme (ikke kun ved 'differs')");
  // #2438: hint-nøglen er dynamisk (todayHintKey) og skelner nu mellem individuel
  // ugeplan, rytterens egen eksplicitte plan (der overtrumfer rytmen) og holdrytmen.
  assert.match(src, /t\(todayHintKey,/);
  assert.match(src, /weekRhythmTodayHint"/);
  assert.match(src, /weekRhythmTodayHintPlan"/, "#2438: ny variant for rytterens egen indstilling, der overtrumfer holdrytmen");
});

// ── #1895 PR 2: individuel ugeplan pr. rytter (rider_id-override) ─────────────
test("#1895.2 individuel ugeplan wired mod useTraining's riderWeekPlans/setRiderWeekPlan/clearRiderWeekPlan", () => {
  assert.match(
    src,
    /riderWeekPlans, savingRiderWeekPlanId, setRiderWeekPlan, clearRiderWeekPlan/,
    "skal destrukturere pr-rytter-ugeplan-state fra useTraining",
  );
  assert.match(src, /handleSaveRiderWeekPlan/);
  assert.match(src, /handleRemoveRiderWeekPlan/);
  assert.match(src, /setRiderWeekPlan\(riderId, days\)/, "gem skal kalde useTraining's setRiderWeekPlan");
  assert.match(src, /clearRiderWeekPlan\(riderId\)/, "fjern skal kalde useTraining's clearRiderWeekPlan");
});

// #4613: editoren flyttede fra roster-rækkens udvidelige række til Ugeplan-
// fanen (samme state, samme handlers, ÉN rytter udvidet ad gangen). Uge-cellen
// i rosteret er genvejen dertil, se #4613-guarden ovenfor.
test("#1895.2 der er en toggle-knap pr. rytter til den individuelle ugeplan", () => {
  assert.match(src, /toggleRiderWeekPlan\(rider\.id\)/);
  assert.match(src, /t\("individualWeekPlanToggleOpen"\)/);
  assert.match(src, /function openRiderWeekPlan\(riderId\)/, "rosteret skal have en genvej til fanen");
  assert.match(src, /setExpandedRiderId\(riderId\);\s*\n\s*setTab\("weekplan"\);/, "genvejen åbner netop den rytter");
});

test("#1895.2 ryttere MED egen ugeplan markeres i rosteret (badge)", () => {
  assert.match(src, /hasOwnWeekPlan/, "skal beregne om rytteren har egen override");
  assert.match(src, /t\("individualWeekPlanBadge"\)/);
});

test("#1895.2 dagens-hint tager højde for rytter-override (samme opløsningsrækkefølge som motoren)", () => {
  assert.match(src, /riderOverrideDays/, "skal sende rytterens egen override til resolveDayIntensityDisplay");
  assert.match(src, /weekRhythmTodayHintOwn/);
});

// #3299: Form/Træthed-kolonnerne foldes ind i portræt (#3045-kontrakten, "hidden
// sm:table-cell" på både header og celle), men uden en mobil-sort-kontrol kunne
// spilleren ikke sortere på træthed i portræt — kun se værdien som ren tekst i
// navne-underlinjen. Samme mønster som RidersPage's MobileSortControl: eksponerer
// PRÆCIS de samme sort-nøgler (rosterSort.handleSort) som desktop-headerne, kun
// synlig under sm-breakpointet.
test("#3299 mobil-sort-kontrol eksponerer træthed (+ form) via rosterSort, kun synlig i portræt", () => {
  // #4613: kontrollen bor nu i tabellens toolbar-slot (inde i hairline-rammen)
  // i stedet for som en løsrevet række over tabellen — stadig sm:hidden.
  assert.match(src, /sm:hidden[^`]*items-end/, "skal have et sm:hidden-wrapper (samme klassenavne-mønster som RidersPage)");
  assert.match(src, /key:\s*"fatigue"/, "sort-options skal inkludere fatigue-nøglen");
  assert.match(src, /key:\s*"form"/, "sort-options skal inkludere form-nøglen");
  assert.match(src, /onSort=\{rosterSort\.handleSort\}/, "skal skrive til samme sort-state som desktop-headerne (ingen ny sort-logik)");
});

// ── #3706: Status-kolonnen kunne klikkes uden at sortere ──────────────────────
//
// @cybersimon, Discord #feedback-and-ideas 13/8: "if you press on status it
// would show academy first or last, right now it is doing nothing." Verificeret
// i koden: overskriften var et bart <th>, ikke en SortTh, og der fandtes ingen
// comparator for kolonnen. De øvrige ikke-sorterbare kolonner (fokus,
// intensitet, kvittering, ugeplan) er ligeledes bare <th> og ser derfor heller
// ikke klikbare ud, så Status var den eneste egentlige mangel.
test("#3706 Status-kolonnen er sorterbar via samme SortTh/useSortState-mønster som resten", () => {
  assert.match(
    src,
    /<SortTh sortKey="status" sort=\{rosterSort\.sort\} sortDir=\{rosterSort\.sortDir\} onSort=\{rosterSort\.handleSort\}/,
    "Status-headeren skal være en SortTh, ikke et bart <th>",
  );
  assert.match(src, /status: \(r\) => \(r\.is_academy \? STATUS_ACADEMY_WEIGHT : 0\)/,
    "comparatoren skal vægte akademi-flaget, så akademi-rytterne samles");
  // #3815 tilføjede "age" til samme sæt (numerisk kolonne, samme konvention);
  // det afgørende her er at "status" stadig er desc-først.
  assert.match(src, /ROSTER_DESC_FIRST = new Set\(\[(?:[^\]]*, )?"status"\]\)/,
    "første klik skal give akademi ØVERST (desc-først), som spilleren beskrev");
  assert.match(src, /key:\s*"status"/, "mobil-sort-kontrollen skal eksponere den samme nøgle");
});

// ── #3709 trin 1: kvitteringen pr. evne ───────────────────────────────────────
// #4613: kvitteringen flyttede fra roster-kolonnen til Udvikling-fanen — det er
// samme spørgsmål som fanen allerede svarer på, og overbliksrækken kunne ikke
// bære 3-4 linjer pr. rytter. Selve helperen og tallene er UÆNDREDE.
test("#3709 kvitteringen vises pr. evne i fokusset, ikke som én aggregeret bar", () => {
  assert.match(src, /import AbilityReceiptRow from "\.\.\/components\/training\/AbilityReceiptRow\.jsx"/);
  assert.match(src, /focusAbilityReceipt\(plan\?\.focus, \{/, "rækkerne skal komme fra den delte helper");
  assert.match(src, /seasonAbilityGains\(history\.seasonRuns, r\.id, history\.seasonStart\)/,
    "sæson-point skal filtreres på den AKTIVE sæsons start, ikke bare 30 dage");
  assert.match(src, /t\("receipt\.title"\)/, "blokken skal bære kvitteringens titel");
  // Kvitteringen står på Udvikling-fanens rækker, ikke i roster-tabellen.
  const devPanelStart = src.indexOf('<TabPanel value="development">');
  assert.ok(devPanelStart > -1, "Udvikling-fanen skal findes");
  assert.ok(
    src.indexOf("<AbilityReceiptRow") > devPanelStart,
    "kvitteringens rækker skal rendres inde i Udvikling-fanen",
  );
});

// De tre loft-tekster er slettet: de lovede spilleren at en evne aldrig steg
// igen. Det var sandt under den gamle model og bliver usandt under den nye
// (#3649/#3659 spec §5.3). Guarden holder dem ude af begge flader.
test("#3709 de tre loft-tekster er væk fra trænings-fladen", () => {
  for (const key of ["focusOptionCapped", "focusCappedTitle", "focusPartiallyCappedTitle", "focusCapped", "focusPartiallyCapped"]) {
    assert.doesNotMatch(src, new RegExp(`t\\("${key}"`), `${key} skal være slettet, ikke bare skjult`);
  }
});
