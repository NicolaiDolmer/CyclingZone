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
    /\.select\(`id, firstname, lastname, birthdate, contract_end_season, primary_type, secondary_type, is_academy, squad, \$\{ABILITY_SELECT\}`\)/,
    "querien skal hente primary_type/secondary_type så typen kan vises, + is_academy (#3300)"
      + " + squad (#5763: U23/JR-mærket i træningstabellen, ALDRIG alder alene)"
      + " + evne-kolonnerne via det delte ABILITY_SELECT-embed (#3709 trin 1: kvitteringens 'nu'-tal)"
      + " + birthdate (#3721 Development-fanen, #3815 roster-tabellens alders-kolonne)"
      + " + contract_end_season (#3761: Status-cellens contractExpiring-badge)",
  );
  // #3709 trin 1: evnerne skal fladtgøres med den DELTE helper, ikke håndrulles,
  // så embed-formen (array vs objekt) håndteres ét sted.
  assert.match(src, /import \{ ABILITY_SELECT, flattenAbilities \} from "\.\.\/lib\/abilities\.js"/);
  assert.match(src, /setRiders\(\(data \|\| \[\]\)\.map\(flattenAbilities\)\)/);
});

// #3300/#3761: akademi-status, kontraktudløb og pensionsrisiko vises via den
// delte RiderBadges-recipe (samme nøgler som TeamPage), ikke håndrullet markup.
// Akademiryttere undtages fra de to risiko-badges (squad-risk-spærren #2748
// tæller kun senior-ryttere). #6030: D-047-roster-rækkens Status-kolonne er
// slettet med flaget training_mobile_table; badgerne står i rytterkortet.
test("#3300/#3761 rytterkortet viser akademi, kontraktudløb og pensionsrisiko via de delte helpers", () => {
  assert.match(src, /import RiderBadges from "\.\.\/components\/rider\/RiderBadges\.jsx"/);
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
  assert.match(
    src,
    /<RiderBadges badges=\{\[\s*rider\.is_academy && "academy",\s*!rider\.is_academy && retirementRiskBadgeKey\(rider, seasonYear\),\s*!rider\.is_academy && contractExpiringBadgeKey\(rider, activeSeasonNumber\),/,
  );
});

// #3815: alderen er den vigtigste enkeltvariabel når man vælger hvem der skal
// trænes hårdt (@knud_r_flink, Discord 15/8). Sorteringen bruger samme helper
// som visningen og eksponeres i mobil-sortkontrollen, jf. #3706.
test("#3815 alderen er sorterbar med samme helper som visningen", () => {
  assert.match(src, /age: \(r\) => ageForSeason\(r\.birthdate, seasonYear\),/,
    "sorteringen skal bruge samme helper som cellen viser, så rækkefølgen ikke kan drive fra tallet");
  assert.match(src, /\{ key: "age", label: t\("colAge"\) \}/,
    "mobil-sortkontrollen skal eksponere præcis de samme nøgler som desktop-headerne (#3706)");
  assert.match(src, /ROSTER_DESC_FIRST = new Set\(\["age",/,
    "alder er numerisk og følger sidens desc-først-konvention: ét klik = de ældste øverst");
});

test("#1480.1 rytterens type vises fra primary_type/secondary_type", () => {
  assert.match(src, /function riderTypeLine\(rider\) \{/);
  assert.match(src, /tTypes\(`types\.\$\{rider\.primary_type\}`\)/);
});

test("#1480.2 group-by-type-toggle styrer grupperet visning via groupRidersByType", () => {
  assert.match(src, /import \{ groupRidersByType, UNTYPED_KEY \} from/);
  assert.match(src, /groupByType\s*\?\s*groupRidersByType\(visibleRiders\)/);
  assert.match(src, /t\("groupByType"\)/);
});

test("#1480.3 multi-select + bulk-apply via setPlanBulk", () => {
  assert.match(src, /setPlanBulk/, "skal bruge bulk-handleren");
  assert.match(src, /handleBulkApply/);
  assert.match(src, /t\("today\.applyTo"/);
  // Select-all + per-række checkbox (TrainingTodayTable).
  assert.match(src, /onToggleAll=\{toggleSelectAll\}/);
  assert.match(src, /onToggleSelect=\{toggleSelect\}/);
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

// #1895 PR 1: ugentlig træningsrytme — gem/nulstil wired mod useTraining's
// setWeekPlan/clearWeekPlan (aldrig frontend-fokus-logik). #5932/#6030: holdets
// plan redigeres i Program-fanens Plan-kort (TrainingPlanCard, "Plan for: Team").
test("#1895 ugerytmen gemmes/nulstilles mod useTraining", () => {
  assert.match(src, /weekPlan, savingWeekPlan, setWeekPlan, clearWeekPlan/, "skal destrukturere ugerytme-state fra useTraining");
  assert.match(src, /<TrainingPlanCard/);
  assert.match(src, /onSave: \(\) => \(isTeam \? handleSaveWeekPlan\(\) : handleSaveRiderWeekPlan\(key\)\)/);
  assert.match(src, /handleResetWeekPlan/);
  assert.match(src, /setWeekPlan\(days\)/, "gem skal kalde useTraining's setWeekPlan");
  assert.match(src, /clearWeekPlan\(\)/, "nulstil skal kalde useTraining's clearWeekPlan");
});

// #1895/#2438: D-047-roster-rækkens dags-hint (resolveDayIntensityDisplay) er
// slettet med grenen (#6030); dagens celle viser nu dagstypen direkte.

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

test("#1895.2 ryttere MED egen ugeplan markeres (badge) i Plan for og i dagens række", () => {
  assert.match(src, /const hasOwn = \(r\) => riderWeekPlans\[r\.id\] != null/, "skal beregne om rytteren har egen override");
  assert.match(src, /t\("individualWeekPlanBadge"\)/);
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

// ── #3706: Status-sorteringen ─────────────────────────────────────────────────
// @cybersimon, Discord #feedback-and-ideas 13/8: Status skulle kunne sorteres
// (akademi først/sidst). #6030: D-047-roster-rækkens bare <th>/SortTh er slettet
// med flaget training_mobile_table; sorteringen lever i rosterAccessors og
// mobil-sortkontrollen, som dagens tabel og telefonens rækker deler.
test("#3706 Status-sorteringen vægter akademi og er desc-først", () => {
  assert.match(src, /status: \(r\) => \(r\.is_academy \? STATUS_ACADEMY_WEIGHT : 0\)/,
    "comparatoren skal vægte akademi-flaget, så akademi-rytterne samles");
  assert.match(src, /ROSTER_DESC_FIRST = new Set\(\[(?:[^\]]*, )?"status"\]\)/,
    "første klik skal give akademi ØVERST (desc-først), som spilleren beskrev");
  assert.match(src, /key:\s*"status"/, "mobil-sort-kontrollen skal eksponere den samme nøgle");
});

// ── #3709 trin 1: kvitteringen pr. evne ───────────────────────────────────────
test("#3709 kvitteringen viser fremgang pr. evne i fokusset via den delte helper", () => {
  assert.match(src, /focusAbilityReceipt\(planFor\(riderId\)\?\.focus, \{/, "rækkerne skal komme fra den delte helper");
  assert.match(src, /seasonAbilityGains\(history\.seasonRuns, r\.id, history\.seasonStart\)/,
    "sæson-point skal filtreres på den AKTIVE sæsons start, ikke bare 30 dage");
});

// De tre loft-tekster er slettet: de lovede spilleren at en evne aldrig steg
// igen. Det var sandt under den gamle model og bliver usandt under den nye
// (#3649/#3659 spec §5.3). Guarden holder dem ude af begge flader.
test("#3709 de tre loft-tekster er væk fra trænings-fladen", () => {
  for (const key of ["focusOptionCapped", "focusCappedTitle", "focusPartiallyCappedTitle", "focusCapped", "focusPartiallyCapped"]) {
    assert.doesNotMatch(src, new RegExp(`t\\("${key}"`), `${key} skal være slettet, ikke bare skjult`);
  }
});

// ── #4699: assistent-panelets to accept-stier ────────────────────────────────
// Begge stier skrev gennem smart-bulk, som springer ryttere med managerens egen
// plan over server-side. Panelet tilbød dem alligevel, så et fuldt planlagt hold
// fik "Updated 0 riders" på både enkelt-markering og "Accept all". Guarden
// pinner at BEGGE stier går gennem det acceptable sæt fra den delte helper.
test("#4699 begge accept-stier sender kun de ryttere serveren kan skrive", () => {
  assert.match(
    src,
    /import \{[^}]*acceptableSuggestionIds[^}]*acceptableSelectionIds[^}]*\} from "\.\.\/lib\/assistantTrainingSuggestions\.js"/,
    "begge accept-helpers skal komme fra den delte, unit-testede lib-fil",
  );
  assert.match(
    src,
    /assistantAcceptableIds = useMemo\(\s*\(\) => new Set\(acceptableSuggestionIds\(assistantVisibleRows\)\)/,
    "det acceptable sæt skal udledes af de SYNLIGE rækker",
  );
  // "Accept all" må ikke længere sende hele visningen.
  assert.match(src, /applyAssistantSuggestions\(\[\.\.\.assistantAcceptableIds\]\)/,
    "'Accept all' skal sende det acceptable sæt");
  assert.doesNotMatch(src, /applyAssistantSuggestions\(assistantVisibleRows\.map\(/,
    "'Accept all' må ikke sende hele visningen igen");
  // Enkelt-markeringen beskæres af samme kilde.
  assert.match(src, /applyAssistantSuggestions\(acceptableSelectionIds\(assistantSelected, assistantVisibleRows\)\)/,
    "'Accept selected' skal beskæres til det acceptable");
  assert.doesNotMatch(src, /applyAssistantSuggestions\(\[\.\.\.assistantSelected\]\)/,
    "'Accept selected' må ikke sende et ubeskåret valg igen");
  // En række serveren springer over må ikke kunne markeres.
  assert.match(src, /if \(!assistantAcceptableIds\.has\(riderId\)\) return;/,
    "toggleAssistantSelect skal afvise en uacceptabel rytter");
  assert.match(src, /acceptableCount=\{assistantAcceptableIds\.size\}/,
    "panelet skal kende antallet, så knappen kan slås fra i stedet for at skrive 0 rækker");
});
