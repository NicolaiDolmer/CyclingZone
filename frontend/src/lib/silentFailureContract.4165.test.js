import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// #4165 - en spiller kunne ikke komme ind i planlægnings-hubben. Rodårsagen var
// ikke mobil-specifik: hubbens indgange hentede deres flade UDEN nogen
// fejl-state overhovedet. Manglende token, ikke-2xx svar og netværksfejl
// returnerede alle tavst, og render-grenen `if (!data?.enabled) return null`
// tegnede derefter intet - den blandede "feature-flag off" sammen med "kaldet
// lykkedes ikke". (Om en genindlæsning hjalp den aften er IKKE afgjort; tråden
// siger to forskellige ting. Se postmortem'en - gæt det ikke her.)
//
// Denne fil er forward-guarden for hubbens flader. For de fire der har hele
// loadError-kontrakten pinnes fire ting pr. flade:
//   1. alle fejl-grene sætter loadError (ingen tavs return),
//   2. fejlen rapporteres, så en gentagelse kan diagnosticeres,
//   3. fejl-render-grenen ligger FØR flag-/tom-grenen - rækkefølgen er hele bugget,
//   4. fejl-fladen beholder sin navigation, så den ikke er en blindgyde.
//
// De to øvrige flader INDE i hubben (Formplan-fanen via usePlanner og
// Holdudtagelses-fanens sæson-visning) havde hver deres egen fejl-state fra før,
// men deres AUTH-gren returnerede stadig tavst - så en manglende session blev
// tegnet som henholdsvis "feature ikke live endnu" og "ingen løb på kalenderen
// endnu". De guardes nedenfor i deres egen form.
//
// Source-string-guards, samme form som silentFailureContract.2465.test.js:
// der er ingen jsdom i denne kodebase, så komponenterne kan ikke rendres i
// node --test.
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const raceHubBoard = read("../components/racehub/RaceHubBoard.jsx");
const divisionStartLists = read("../components/racehub/DivisionStartLists.jsx");
const strategyPage = read("../pages/StrategyPage.jsx");
const calendarPage = read("../pages/CalendarPage.jsx");
const actionTelemetry = read("./actionTelemetry.js");

// Fladerne, deres telemetri-slug, den i18n-rod fejl-copyen ligger under, og den
// LEGITIME tom-/flag-gren fejl-grenen skal ligge før. Tom-grenen er ikke ens på
// tværs: tre skjuler sig bag et slukket flag, kalenderen bag "ingen sæson".
// Listen SKAL rumme hver flade der har kontrakten - står en flade uden for den,
// er guarden skrevet til at acceptere hullet i stedet for at fange det.
const SURFACES = [
  { name: "RaceHubBoard", source: raceHubBoard, slug: "racehub_board", i18n: "racehub", emptyBranch: "if (!data?.enabled) return null" },
  { name: "DivisionStartLists", source: divisionStartLists, slug: "racehub_browse", i18n: "browse", emptyBranch: "if (!data?.enabled) return null" },
  { name: "StrategyPage", source: strategyPage, slug: "strategy_page", i18n: "strategy", emptyBranch: "if (!data?.enabled) return null" },
  { name: "CalendarPage", source: calendarPage, slug: "calendar_page", i18n: "calendar", emptyBranch: "if (!data?.season) {" },
];

for (const { name, source, slug, emptyBranch } of SURFACES) {
  test(`${name}: ingen af de fire fejl-grene returnerer tavst`, () => {
    // Manglende token må ikke bare stoppe spinneren og efterlade en tom flade.
    assert.doesNotMatch(
      source,
      /if \(!headers\) \{ setLoading\(false\); return; \}/,
      "et manglende token skal sætte loadError, ikke kun stoppe spinneren",
    );
    assert.match(source, /setLoadError\(\{ kind: "auth" \}\)/);

    // Et ikke-2xx svar skal have en eksplicit fejl-gren. `if (res.ok) setData(...)`
    // uden else var præcis den gren der tegnede intet.
    assert.match(source, /if \(!res\.ok\) \{/);
    assert.match(source, /setLoadError\(\{ kind: "http", status: res\.status \}\)/);

    // Netværks-catch må ikke være tom.
    assert.doesNotMatch(source, /catch \{\s*\/\* netværk[^}]*\}/);
    assert.match(source, /catch \(cause\) \{/);
    assert.match(source, /setLoadError\(\{ kind: "network" \}\)/);

    // setLoading(false) skal ligge i finally, ellers hænger fladen i spinneren
    // når en fejl-gren returnerer tidligt. (Kalenderen hentes i en effekt med
    // en alive-vagt, så dens finally er `if (alive) setLoading(false)`.)
    assert.match(source, /\} finally \{\s*\n\s*(if \(alive\) )?setLoading\(false\);/);
  });

  test(`${name}: en malformet 2xx-krop tagges "parse", ikke "network"`, () => {
    // Lå res.json() i den ydre try, blev en ugyldig JSON-krop rapporteret som
    // spillerens netværksfejl - forkert triage i netop det signal fixet bygger.
    assert.doesNotMatch(
      source,
      /setData\(await res\.json\(\)\);/,
      "parsningen skal have sin egen gren, ikke dele catch med netværksfejlen",
    );
    assert.match(
      source,
      new RegExp(`reportLoadFailure\\("${slug}", \\{ kind: "parse", status: res\\.status`),
    );
  });

  test(`${name}: fejlen rapporteres med fladens eget slug`, () => {
    assert.match(source, /import \{ reportLoadFailure \} from ".*actionTelemetry\.js"/);
    for (const kind of ["auth", "http", "network", "parse"]) {
      assert.match(
        source,
        new RegExp(`reportLoadFailure\\("${slug}", \\{ kind: "${kind}"`),
        `${kind}-grenen skal rapporteres, ellers er udløseren usynlig igen`,
      );
    }
  });

  test(`${name}: fejl-grenen renderes FØR flag-/tom-grenen`, () => {
    const errorIdx = source.indexOf("if (loadError) {");
    const flagIdx = source.indexOf(emptyBranch);
    assert.ok(errorIdx > 0, "der skal findes en fejl-render-gren");
    assert.ok(flagIdx > 0, `den legitime tom-gren (${emptyBranch}) skal bevares`);
    assert.ok(
      errorIdx < flagIdx,
      "ligger tom-grenen først, tegnes en fejlet hentning igen som en tom flade",
    );
    // ErrorState + secondary retry, kanonisk mønster fra SeasonPlannerPage.
    const branch = source.slice(errorIdx, flagIdx);
    assert.match(branch, /<ErrorState/);
    assert.match(branch, /role="alert"/);
    assert.match(branch, /onClick=\{retryLoad\}/);
    // ErrorState uden title falder tilbage på komponentens hardkodede engelske
    // default - engelsk overskrift over dansk brødtekst (ErrorState.jsx:8).
    assert.match(branch, /<ErrorState\s*\n\s*(\/\/[^\n]*\n\s*)*title=\{t\(/);
  });

  // #4165, runde 2: fejl-fladen må ikke rive navigationen ned. Fandtes vælgerne
  // kun i success-grenen, efterlod en fejlet hentning manageren med én knap -
  // "Prøv igen" - der gentager præcis det samme fejlende kald med samme dag,
  // pulje og scope. Et faneskift i hubben redder ikke: changeTab rydder kun
  // ?view og ?season, ikke ?scope/?pool/?day (PlanningHubPage.jsx).
  test(`${name}: fejl-fladen beholder sin navigation`, () => {
    const errorIdx = source.indexOf("if (loadError) {");
    const branch = source.slice(errorIdx, source.indexOf(emptyBranch));
    const NAV = {
      RaceHubBoard: ["<ContextBand"],
      DivisionStartLists: ["<ContextBand", "<PoolPicker"],
      // Strategi-fanen har ingen indre navigation at miste: fanerækken i hubben
      // ER dens navigation, og den ejes af PlanningHubPage over fladen.
      StrategyPage: [],
      CalendarPage: ["<CalendarControls"],
    }[name];
    for (const marker of NAV) {
      assert.ok(
        branch.includes(marker),
        `${name}: ${marker} skal også monteres i fejl-grenen, ellers er fejlen en blindgyde`,
      );
    }
  });
}

test("retryLoad viser spinneren igen, så knappen har en synlig effekt", () => {
  for (const { name, source } of SURFACES) {
    assert.match(
      source,
      /const retryLoad = \(\) => \{\s*\n\s*setLoading\(true\);\s*\n\s*setLoadError\(null\);/,
      `${name}: retry uden setLoading(true) ser ud som om intet skete`,
    );
  }
});

test("en `loading && !data`-spinnergate skal rydde data ved retry", () => {
  // Ellers springer retry'et både spinneren og fejl-grenen over og tegner de
  // GAMLE data under den nye markering, indtil kaldet lander.
  for (const { name, source } of SURFACES) {
    if (!/if \(loading && !data\)/.test(source)) continue;
    assert.match(
      source,
      /const retryLoad = \(\) => \{[^}]*setData\(null\);/,
      `${name}: retry med gamle data i state viser den forrige visning som om den var ny`,
    );
  }
});

test("reportLoadFailure sender en exception (ikke en breadcrumb) med lav-kardinale tags", () => {
  // En fejlet hentning er ikke en afvisning: spilleren ramte ingen regel, fladen
  // er nede for netop ham. Derfor exception, modsat `rejected` i samme modul.
  assert.match(actionTelemetry, /export function reportLoadFailure\(surface, detail = \{\}\)/);
  assert.match(actionTelemetry, /Sentry\.captureException\(error, \{/);
  assert.match(actionTelemetry, /tags: \{ load_failure: surface, load_failure_kind: kind/);
  // #3767's støjkilde må ikke genindføres ad denne vej.
  assert.doesNotMatch(actionTelemetry, /Sentry\.captureMessage/);
});

// --- Hubbens to øvrige flader: auth-grenen må ikke returnere tavst ---------
// Samme fejlklasse, anden form. Begge havde `if (!headers) { setLoading(false);
// return; }` og faldt derefter igennem til en tom-state der påstod at fladen var
// slukket / kalenderen tom.
const usePlanner = read("./usePlanner.js");
const seasonPlannerPage = read("../pages/SeasonPlannerPage.jsx");
const seasonView = read("../components/racehub/SeasonView.jsx");

const TACIT_AUTH_RETURN = /if \(!headers\) \{ setLoading\(false\); return; \}/;

test("usePlanner: manglende session sætter error i stedet for at returnere tavst", () => {
  assert.doesNotMatch(
    usePlanner,
    TACIT_AUTH_RETURN,
    "auth-grenen efterlod error=null og enabled=false -> planlæggeren så slukket ud",
  );
  assert.match(usePlanner, /setError\("auth"\)/);
  assert.match(usePlanner, /import \{ reportLoadFailure \} from "\.\/actionTelemetry\.js"/);
  // "parse" er med i listen med vilje. Uden den accepterede guarden hullet:
  // res.json() lå i den ydre try, så en malformet 2xx-krop blev tagget
  // "network" - spillerens forbindelse - for en fejl der kom fra serveren.
  for (const kind of ["auth", "http", "network", "parse"]) {
    assert.match(
      usePlanner,
      new RegExp(`reportLoadFailure\\("season_planner_board", \\{ kind: "${kind}"`),
      `${kind}-grenen skal rapporteres`,
    );
  }
  assert.doesNotMatch(
    usePlanner,
    /const data = await res\.json\(\);/,
    "parsningen skal have sin egen gren, ikke dele catch med netværksfejlen",
  );
});

test("SeasonPlannerPage: fejl-grenen ligger FØR flag-grenen", () => {
  const errorIdx = seasonPlannerPage.indexOf("if (error) {");
  const flagIdx = seasonPlannerPage.indexOf("if (!enabled) {");
  assert.ok(errorIdx > 0, "der skal findes en fejl-render-gren");
  assert.ok(flagIdx > 0, "flag-off-grenen er en legitim tom tilstand og skal bevares");
  assert.ok(
    errorIdx < flagIdx,
    "ligger flag-grenen først, tegnes en fejlet hentning igen som 'ikke live endnu'",
  );
  // Auth får sin egen besked - "prøv igen" alene kan ikke opfylde sin instruks
  // når sessionen faktisk er væk.
  assert.match(seasonPlannerPage, /t\("error\.session"\)/);
});

test("SeasonView: manglende session sætter failed i stedet for at returnere tavst", () => {
  assert.doesNotMatch(
    seasonView,
    TACIT_AUTH_RETURN,
    "auth-grenen efterlod data=null -> sæson-visningen sagde 'ingen løb på kalenderen endnu'",
  );
  assert.match(seasonView, /setFailed\("auth"\)/);
  // "parse" er med i listen med vilje - se kommentaren i usePlanner-testen.
  for (const kind of ["auth", "http", "network", "parse"]) {
    assert.match(
      seasonView,
      new RegExp(`reportLoadFailure\\("racehub_season_view", \\{ kind: "${kind}"`),
      `${kind}-grenen skal rapporteres`,
    );
  }
  assert.doesNotMatch(
    seasonView,
    /const json = await res\.json\(\);/,
    "parsningen skal have sin egen gren, ikke dele catch med netværksfejlen",
  );
  // failed må ikke falde tilbage til et boolean: så mister auth sin egen copy.
  assert.match(seasonView, /const \[failed, setFailed\] = useState\(null\)/);
});

test("SeasonView: retry på auth-grenen har en synlig effekt", () => {
  // setFailed("auth") sætter SAMME værdi ved et retry, så React bailer ud af
  // re-renderen. Lå setLoading(true) efter session-tjekket - som den gjorde -
  // flyttede intet på skærmen, og knappen var i praksis inert. Spinneren skal
  // tændes FØR authHeaders() awaites.
  const effect = seasonView.slice(seasonView.indexOf("useEffect(() => {"));
  const loadingIdx = effect.indexOf("setLoading(true);");
  const headersIdx = effect.indexOf("const headers = await authHeaders();");
  assert.ok(loadingIdx > 0 && headersIdx > 0, "både spinner-flag og session-tjek skal findes i effekten");
  assert.ok(
    loadingIdx < headersIdx,
    "setLoading(true) skal ligge før session-tjekket, ellers er 'Prøv igen' inert på auth-grenen",
  );
});

test("SeasonView: fejl-fladen beholder header og har en oversat titel", () => {
  // Samme blindgyde-regel som hubbens øvrige flader: uden headeren kunne en
  // fejlet sæson-hentning ikke forlades - hverken til dags-boardet eller til en
  // anden sæson - og "Prøv igen" henter netop den sæson der lige fejlede.
  const branch = seasonView.slice(
    seasonView.indexOf("if (failed) {"),
    seasonView.indexOf("if (!data?.season || !model || model.empty)"),
  );
  assert.ok(branch.includes("{header}"), "headeren skal også monteres i fejl-grenen");
  assert.match(branch, /title=\{t\("seasonView\.errorTitle"\)\}/);
});

test("SeasonView: fejl-grenen ligger FØR den tomme gren", () => {
  const errorIdx = seasonView.indexOf("if (failed) {");
  const emptyIdx = seasonView.indexOf("if (!data?.season || !model || model.empty)");
  assert.ok(errorIdx > 0, "der skal findes en fejl-render-gren");
  assert.ok(emptyIdx > 0, "den tomme kalender er en legitim tilstand og skal bevares");
  assert.ok(
    errorIdx < emptyIdx,
    "ligger den tomme gren først, tegnes en fejlet hentning igen som en tom kalender",
  );
  assert.match(seasonView, /t\("seasonView\.errorSession"\)/);
});

test("hubbens to øvrige flader har fejl-copy i BEGGE sprog", () => {
  const en = JSON.parse(readFileSync(new URL("../../public/locales/en/races.json", import.meta.url), "utf8"));
  const da = JSON.parse(readFileSync(new URL("../../public/locales/da/races.json", import.meta.url), "utf8"));
  const enP = JSON.parse(readFileSync(new URL("../../public/locales/en/planner.json", import.meta.url), "utf8"));
  const daP = JSON.parse(readFileSync(new URL("../../public/locales/da/planner.json", import.meta.url), "utf8"));

  assert.ok(en.seasonView.errorSession, "en mangler seasonView.errorSession");
  assert.ok(da.seasonView.errorSession, "da mangler seasonView.errorSession");
  assert.notEqual(en.seasonView.errorSession, da.seasonView.errorSession);

  // Titlen er ikke valgfri: uden den skriver ErrorState sin engelske default.
  assert.ok(en.seasonView.errorTitle, "en mangler seasonView.errorTitle");
  assert.ok(da.seasonView.errorTitle, "da mangler seasonView.errorTitle");
  assert.notEqual(en.seasonView.errorTitle, da.seasonView.errorTitle);

  // ErrorState-anatomien (PAGE_TEMPLATES.md): titlen siger HVAD der fejlede,
  // beskrivelsen hvad der er sikkert. Gentager beskrivelsen titlen, er copyen
  // ikke bare redundant - den gør også e2e's getByText(..., {exact:false})
  // tvetydig, fordi to elementer så matcher den samme streng.
  for (const [lang, dict] of [["en", en], ["da", da]]) {
    assert.ok(
      !dict.seasonView.error.includes(dict.seasonView.errorTitle),
      `${lang}: seasonView.error må ikke gentage titlen`,
    );
    assert.ok(
      !dict.seasonView.errorSession.includes(dict.seasonView.errorTitle),
      `${lang}: seasonView.errorSession må ikke gentage titlen`,
    );
  }

  assert.ok(enP.error.session, "en mangler planner error.session");
  assert.ok(daP.error.session, "da mangler planner error.session");
  assert.notEqual(enP.error.session, daP.error.session);
});

test("Kalender-fanen har fejl-copy i BEGGE sprog", () => {
  const en = JSON.parse(readFileSync(new URL("../../public/locales/en/calendar.json", import.meta.url), "utf8"));
  const da = JSON.parse(readFileSync(new URL("../../public/locales/da/calendar.json", import.meta.url), "utf8"));

  for (const key of ["title", "description", "session", "retry"]) {
    assert.ok(en.error[key], `en mangler calendar error.${key}`);
    assert.ok(da.error[key], `da mangler calendar error.${key}`);
  }
  assert.notEqual(en.error.title, da.error.title);
  assert.notEqual(en.error.session, da.error.session);
  // Tom-tilstandene er legitime og skal bevares - de må bare ikke længere kunne
  // nås af en fejlet hentning.
  assert.ok(en.noSeason.title && da.noSeason.title, "noSeason er en legitim tom tilstand");
});

test("fejl-copyen findes i BEGGE sprog (key-parity)", () => {
  const en = JSON.parse(readFileSync(new URL("../../public/locales/en/races.json", import.meta.url), "utf8"));
  const da = JSON.parse(readFileSync(new URL("../../public/locales/da/races.json", import.meta.url), "utf8"));

  for (const key of ["title", "body", "session", "retry"]) {
    assert.ok(en.racehub.error[key], `en mangler racehub.error.${key}`);
    assert.ok(da.racehub.error[key], `da mangler racehub.error.${key}`);
    assert.ok(en.browse.error[key], `en mangler browse.error.${key}`);
    assert.ok(da.browse.error[key], `da mangler browse.error.${key}`);
  }
  for (const key of ["loadTitle", "loadBody", "session", "retry"]) {
    assert.ok(en.strategy.error[key], `en mangler strategy.error.${key}`);
    assert.ok(da.strategy.error[key], `da mangler strategy.error.${key}`);
  }
  // Fejl-copy må ikke være identisk på tværs af sprog (glemt oversættelse).
  assert.notEqual(en.racehub.error.title, da.racehub.error.title);
  assert.notEqual(en.browse.error.title, da.browse.error.title);
  assert.notEqual(en.strategy.error.loadTitle, da.strategy.error.loadTitle);

  // Samme anatomi-regel som for sæson-visningen: brødteksten gentager ikke
  // overskriften.
  for (const dict of [en, da]) {
    for (const [title, body] of [
      [dict.racehub.error.title, dict.racehub.error.body],
      [dict.browse.error.title, dict.browse.error.body],
      [dict.strategy.error.loadTitle, dict.strategy.error.loadBody],
    ]) {
      assert.ok(!body.includes(title), `brødteksten må ikke gentage titlen: "${title}"`);
    }
  }
});
