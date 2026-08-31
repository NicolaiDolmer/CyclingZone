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

// #3300-rework: ugeplan-knappen får sin egen kolonne (ejer-feedback, samme
// session som badge-flytningen ovenfor) — "colWeekPlan" er den nye header-nøgle.
test("#3300-rework individuel ugeplan-knap har sin egen kolonne", () => {
  assert.match(src, /"colWeekPlan"/, "skal have en dedikeret kolonne-header for ugeplan-knappen");
  // #3815 lagde Alder-kolonnen oveni, så tallet er 11.
  assert.match(src, /const ROSTER_COLS = 11;/, "kolonnetal skal være opdateret til den nye kolonne");

  const weekPlanCellStart = src.indexOf("Individuel ugeplan — egen kolonne");
  assert.ok(weekPlanCellStart > -1, "ugeplan-kolonnens celle skal have sin egen kommentar");
  const weekPlanTdStart = src.indexOf("<td", weekPlanCellStart);
  const weekPlanTdEnd = src.indexOf("</td>", weekPlanTdStart);
  const weekPlanCellSrc = src.slice(weekPlanTdStart, weekPlanTdEnd);
  assert.match(weekPlanCellSrc, /toggleRiderWeekPlan\(rider\.id\)/, "ugeplan-toggle-knappen skal stå i sin egen kolonne");
  assert.match(weekPlanCellSrc, /individualWeekPlanToggleOpen/, "knap-teksten skal genbruges uændret");
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
  assert.match(src, /groupByType\s*\?\s*groupRidersByType\(riders\)/);
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

test("#1895.2 roster-tabellen har en toggle-knap pr. rytter til individuel ugeplan", () => {
  assert.match(src, /toggleRiderWeekPlan\(rider\.id\)/);
  assert.match(src, /t\("individualWeekPlanToggleOpen"\)/);
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
  assert.match(src, /sm:hidden[^`]*mb-3/, "skal have et sm:hidden-wrapper (samme klassenavne-mønster som RidersPage)");
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

// ── #3709 trin 1: kvitteringen på roster-rækken ───────────────────────────────
test("#3709 roster-kolonnen viser kvitteringen pr. evne i fokusset, ikke én aggregeret bar", () => {
  assert.match(src, /import AbilityReceiptRow from "\.\.\/components\/training\/AbilityReceiptRow\.jsx"/);
  assert.match(src, /focusAbilityReceipt\(plan\?\.focus, \{/, "rækkerne skal komme fra den delte helper");
  assert.match(src, /seasonAbilityGains\(history\.seasonRuns, r\.id, history\.seasonStart\)/,
    "sæson-point skal filtreres på den AKTIVE sæsons start, ikke bare 30 dage");
  assert.match(src, /t\("receipt\.title"\)/, "kolonne-headeren skal være kvitteringens titel");
});

// De tre loft-tekster er slettet: de lovede spilleren at en evne aldrig steg
// igen. Det var sandt under den gamle model og bliver usandt under den nye
// (#3649/#3659 spec §5.3). Guarden holder dem ude af begge flader.
test("#3709 de tre loft-tekster er væk fra trænings-fladen", () => {
  for (const key of ["focusOptionCapped", "focusCappedTitle", "focusPartiallyCappedTitle", "focusCapped", "focusPartiallyCapped"]) {
    assert.doesNotMatch(src, new RegExp(`t\\("${key}"`), `${key} skal være slettet, ikke bare skjult`);
  }
});
