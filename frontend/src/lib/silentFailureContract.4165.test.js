import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// #4165 - planlægnings-hubben blankede for en spiller, og en genindlæsning
// hjalp ikke. Rodårsagen var ikke mobil-specifik: tre af hubbens fire indgange
// hentede deres flade UDEN nogen fejl-state overhovedet. Manglende token,
// ikke-2xx svar og netværksfejl returnerede alle tavst, og render-grenen
// `if (!data?.enabled) return null` tegnede derefter intet - den blandede
// "feature-flag off" sammen med "kaldet lykkedes ikke".
//
// Denne fil er forward-guarden for hubbens flader. For de tre der fik hele
// loadError-kontrakten pinnes tre ting pr. flade:
//   1. begge fejl-grene sætter loadError (ingen tavs return),
//   2. fejlen rapporteres, så en gentagelse kan diagnosticeres,
//   3. fejl-render-grenen ligger FØR flag-grenen - rækkefølgen er hele bugget.
//
// De to sidste flader INDE i hubben (Formplan-fanen via usePlanner og
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
const actionTelemetry = read("./actionTelemetry.js");

// Fladerne, deres telemetri-slug og den i18n-rod fejl-copyen ligger under.
const SURFACES = [
  { name: "RaceHubBoard", source: raceHubBoard, slug: "racehub_board", i18n: "racehub" },
  { name: "DivisionStartLists", source: divisionStartLists, slug: "racehub_browse", i18n: "browse" },
  { name: "StrategyPage", source: strategyPage, slug: "strategy_page", i18n: "strategy" },
];

for (const { name, source, slug } of SURFACES) {
  test(`${name}: ingen af de tre fejl-grene returnerer tavst`, () => {
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
    // når en fejl-gren returnerer tidligt.
    assert.match(source, /\} finally \{\s*\n\s*setLoading\(false\);/);
  });

  test(`${name}: fejlen rapporteres med fladens eget slug`, () => {
    assert.match(source, /import \{ reportLoadFailure \} from ".*actionTelemetry\.js"/);
    for (const kind of ["auth", "http", "network"]) {
      assert.match(
        source,
        new RegExp(`reportLoadFailure\\("${slug}", \\{ kind: "${kind}"`),
        `${kind}-grenen skal rapporteres, ellers er udløseren usynlig igen`,
      );
    }
  });

  test(`${name}: fejl-grenen renderes FØR flag-grenen`, () => {
    const errorIdx = source.indexOf("if (loadError) {");
    const flagIdx = source.indexOf("if (!data?.enabled) return null");
    assert.ok(errorIdx > 0, "der skal findes en fejl-render-gren");
    assert.ok(flagIdx > 0, "flag-off-grenen skal bevares - den er en legitim tom tilstand");
    assert.ok(
      errorIdx < flagIdx,
      "ligger flag-grenen først, tegnes en fejlet hentning igen som en tom flade",
    );
    // ErrorState + secondary retry, kanonisk mønster fra SeasonPlannerPage.
    assert.match(source, /<ErrorState/);
    assert.match(source, /role="alert"/);
    assert.match(source, /onClick=\{retryLoad\}/);
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
  for (const kind of ["auth", "http", "network"]) {
    assert.match(
      usePlanner,
      new RegExp(`reportLoadFailure\\("season_planner_board", \\{ kind: "${kind}"`),
      `${kind}-grenen skal rapporteres`,
    );
  }
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
  for (const kind of ["auth", "http", "network"]) {
    assert.match(
      seasonView,
      new RegExp(`reportLoadFailure\\("racehub_season_view", \\{ kind: "${kind}"`),
      `${kind}-grenen skal rapporteres`,
    );
  }
  // failed må ikke falde tilbage til et boolean: så mister auth sin egen copy.
  assert.match(seasonView, /const \[failed, setFailed\] = useState\(null\)/);
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

  assert.ok(enP.error.session, "en mangler planner error.session");
  assert.ok(daP.error.session, "da mangler planner error.session");
  assert.notEqual(enP.error.session, daP.error.session);
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
});
