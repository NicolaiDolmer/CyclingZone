// #7982 trin 2-5: "samme resultat som foer". Dommerens proeve (AGENTS.md regel 40), skrevet foer
// foerste kodelinje. Ejes af dommeren; byggeren aendrer hverken denne fil, harnesset eller facit.
//
// Proeven koerer de faste scenarier i trainNowSameResult7982.harness.js og sammenligner felt for
// felt med det frosne facit fra main (trainNowSameResult7982.facit.json, SHA staar i filen):
//   - svaret paa hvert tryk/hver aftenkoersel (status og krop),
//   - hver skrivning og hvert kald til en databasefunktion, i raekkefoelge,
//   - sluttilstanden i alle tabeller,
//   - (trin 3) hvilke laesninger der ligger mellem hvilke skrivninger.
// Foerste afvigelse skrives ud som en sti, fx
//   stort_hold_beta_tryk > writes[9].args.p_report.riders.<rytter>#0.hash
// Facit i repoet er fingeraftryk (regel 17: ingen motortal paa GitHub). Vil man se vaerdierne, peger
// man SAME_RESULT_7982_FULL paa en fuld optagelse fra den gamle kode (se nederst), saa vises
// "forventet" og "fik" med tal.
//
// Antal databasekald pr. tryk taelles i samme koersel og skrives ud som tabel (maaletal pr. trin).
// Kald maa falde, aldrig stige; skrivningerne skal vaere de samme.
//
// Udgave til trin 3 (13/11), frosset igen fra main FOER trin 3's foerste kodelinje. Nyt i forhold til
// trin 2: laesningernes plads mellem skrivningerne, fejl i hver laesning, en database der falder ud,
// forrang mellem afvisninger, to hold og to tryk paa samme tid, en cache der ikke maa leve videre,
// ingen skrivning sendt samtidig med andet, intet loefte uden ejer, og aftenkoerslen praecis uroert.
//
//   Frys facit (kun dommeren, paa main):  SAME_RESULT_7982_WRITE=1 node --test --import ./test-setup.js lib/trainNowSameResult7982.test.js
//   Fuld optagelse med tal (privat):      SAME_RESULT_7982_DUMP=<fil.json> node --test ...
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { SCENARIOS, runScenario, fingerprint, firstDifference, digest, stableNumber, SIGNIFICANT_DIGITS, UNHANDLED_REJECTIONS } from "./trainNowSameResult7982.harness.js";

const FACIT_URL = new URL("./trainNowSameResult7982.facit.json", import.meta.url);
const WRITE = process.env.SAME_RESULT_7982_WRITE === "1";
const DUMP = process.env.SAME_RESULT_7982_DUMP ?? null;
const FULL = process.env.SAME_RESULT_7982_FULL ?? null;
const PARTS = ["steps", "writes", "finalState", "reads"];

const runs = {};
for (const name of Object.keys(SCENARIOS)) runs[name] = await runScenario(name);
const unhandledAfterFirstRun = [...UNHANDLED_REJECTIONS];

const show = (value) => { const text = JSON.stringify(value); return text === undefined ? String(value) : text.length > 600 ? `${text.slice(0, 600)} ...` : text; };
function explain(name, diff, hint = "") {
  return [`${name} afviger fra facit.`, `  Foerste afvigelse: ${name} > ${diff.path.replace(/^\./, "")}`, `  Forventet (facit): ${show(diff.expected)}`, `  Fik:               ${show(diff.actual)}`, hint].filter(Boolean).join("\n");
}

if (WRITE) {
  let sha = "ukendt";
  try { sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* best-effort: SHA'en er kun en maerkat i facit-filen */ }
  const facit = {
    note: "Frosset facit for #7982 trin 2-5 (samme resultat som foer), udgave til trin 3. Fingeraftryk, ingen motortal. Genereres kun af dommeren.",
    frozen_from_sha: sha,
    scenarios: Object.fromEntries(Object.entries(runs).map(([name, run]) => [name, fingerprint(run)])),
    calls: Object.fromEntries(Object.entries(runs).map(([name, run]) => [name, run.calls])),
  };
  await writeFile(FACIT_URL, `${JSON.stringify(facit, null, 1)}\n`);
}
if (DUMP) {
  await writeFile(DUMP, `${JSON.stringify(Object.fromEntries(Object.entries(runs).map(([name, run]) => [name, { steps: run.steps, writes: run.writes, finalState: run.finalState }])), null, 1)}\n`);
}

const facit = JSON.parse(await readFile(FACIT_URL, "utf8"));
const full = FULL ? JSON.parse(await readFile(FULL, "utf8")) : null;

test("facit daekker praecis de faste scenarier og siger hvilken commit det er frosset fra", () => {
  assert.match(facit.frozen_from_sha, /^[0-9a-f]{40}$/);
  assert.deepEqual(Object.keys(facit.scenarios).sort(), Object.keys(SCENARIOS).sort());
});

// Fingeraftrykket maa ikke afhaenge af maskinens sidste decimal (Windows og Linux regner potenser
// en anelse forskelligt), men skal stadig fange en rigtig aendring.
test("fingeraftrykket taaler regnestoej i sidste decimal, men fanger en aendring paa en milliontedel", () => {
  assert.equal(SIGNIFICANT_DIGITS, 9);
  const samples = [0.1 + 0.2, 0.4000000000000001, 12.345678901234567, 0.000123456789012345, 87.00000000000001, 1 / 3, 2.5e-7];
  for (const x of samples) {
    const up = x * (1 + 4 * Number.EPSILON), down = x * (1 - 4 * Number.EPSILON);
    assert.equal(digest({ v: up }), digest({ v: x }), `${x}: fire sidste-ciffer-trin op giver samme fingeraftryk`);
    assert.equal(digest({ v: down }), digest({ v: x }), `${x}: fire sidste-ciffer-trin ned giver samme fingeraftryk`);
    assert.notEqual(digest({ v: x * (1 + 1e-6) }), digest({ v: x }), `${x}: en milliontedel fanges`);
  }
  // Regnestoej omkring nul er nul; heltal roeres aldrig.
  assert.equal(digest({ v: 1.1102230246251565e-16 }), digest({ v: 0 }));
  assert.equal(digest({ v: -2.2e-17 }), digest({ v: 0 }));
  for (const n of [0, 1, 47, 100, 1731456000000, -3]) assert.equal(stableNumber(n), n);
  assert.notEqual(digest({ v: 47 }), digest({ v: 48 }));
  assert.notEqual(digest({ v: 47 }), digest({ v: 47.000001 }));
});

test("stedfortraederen kendte alt, koden bad om (ellers er proeven ugyldig og dommeren skal udvide den)", () => {
  for (const [name, run] of Object.entries(runs)) assert.deepEqual(run.unsupported, [], `${name}: ukendte kald ${JSON.stringify(run.unsupported)}`);
});

const READS_HINT = [
  "  En laesning ligger nu mellem to ANDRE skrivninger end foer (eller er kommet til eller forsvundet).",
  "  Laesninger maa sendes samtidig og bytte plads inden for et mellemrum, men ikke flytte hen over en",
  "  skrivning eller et funktionskald: saa ser de en anden database end foer. (Laesninger i tabeller,",
  "  trykket aldrig skriver i, er ikke med her.) Skal en laesning vaek eller flyttes, afgoer dommeren det.",
].join("\n");

for (const name of Object.keys(SCENARIOS)) {
  test(`samme resultat som foer: ${name}`, () => {
    const actual = fingerprint(runs[name]);
    const expected = facit.scenarios[name];
    for (const part of PARTS) {
      const diff = firstDifference(expected[part], actual[part], part);
      if (!diff) continue;
      let hint = part === "reads" ? READS_HINT : "  (Facit er fingeraftryk. Koer med SAME_RESULT_7982_FULL=<fuld optagelse fra main> for at se tallene.)";
      if (part !== "reads" && full?.[name]) {
        const valueDiff = firstDifference(full[name][part], { steps: runs[name].steps, writes: runs[name].writes, finalState: runs[name].finalState }[part], part);
        if (valueDiff) hint = `  Med vaerdier: ${name} > ${valueDiff.path}\n    forventet: ${show(valueDiff.expected)}\n    fik:       ${show(valueDiff.actual)}`;
      }
      assert.fail(explain(name, diff, hint));
    }
  });
}

test("scenarierne er ikke tomme: traening sker, loebsryttere venter, og afvisninger skriver intet", () => {
  const big = runs.stort_hold_beta_tryk;
  assert.equal(big.steps[0].response.status, 200);
  const commits = big.writes.filter((w) => w.kind === "rpc" && w.target.endsWith("commit_training_date_tick"));
  assert.equal(commits.length, 5, "fem gemme-kald for fem dag-felter");
  assert.ok(commits.every((c) => c.payload.p_report.riders.length >= 35), "de fleste af de 48 ryttere traenes i hvert felt");
  assert.ok(commits.some((c) => c.payload.p_abilities.length > 0), "nogen udvikler sig");
  assert.ok(commits.some((c) => c.payload.p_report.riders.some((r) => r.fatigue_rule)), "spillerens traethedsregel slaar til for mindst én rytter");
  assert.ok(commits.every((c) => c.payload.p_report.riders.every((r) => "fatigue_rule" in r)), "holdet HAR traethedsregler (feltet findes paa hver rytter)");
  const reads = (target) => runs.stort_hold_beta_tryk.calls.total.byTarget[`read:${target}`] ?? 0;
  for (const table of ["team_training_rules", "team_staff", "team_facilities", "training_plans", "training_week_plans"]) assert.ok(reads(table) >= 1, `${table} laeses af trykket`);
  assert.ok(commits.at(-1).payload.p_conditions.filter((c) => c.provisional !== true).length >= 35, "tilstanden lukkes paa sidste felt");
  assert.ok(commits.at(-1).payload.p_conditions.some((c) => c.provisional === true), "loebsryttere faar foreloebig tilstand");
  assert.ok(big.steps[0].response.body.afterRaceRiderIds.length >= 5 && big.steps[0].response.body.instantRiderIds.length >= 5);
  assert.equal(runs.stort_hold_almindeligt_tryk.steps[0].response.body.instantRiderIds, undefined);
  assert.ok(big.finalState.training_rider_ticks.length > 200);
  assert.deepEqual(runs.lille_hold_uden_loeb.finalState.training_date_work.map((w) => w.status), ["complete"]);
  assert.deepEqual(runs.tryk_saa_aftenkoersel.finalState.training_date_work.map((w) => w.status), ["complete"]);
  assert.deepEqual(runs.to_datoer.finalState.training_date_work.map((w) => w.status).sort(), ["complete", "complete"]);
  assert.match(JSON.stringify(runs.afbrudt_og_genoptaget.steps[0].response), /dommer-fejlinjektion/);
  assert.equal(runs.afbrudt_og_genoptaget.steps[1].response.status, 200);
  const refusals = runs.afvisninger.steps;
  assert.deepEqual(refusals.map((s) => `${s.label}: ${s.response.status ?? "kast"} ${s.response.body?.error ?? (s.response.body?.ok ? "ok" : "")}`), [
    "kontakt slukket: 404 not_found", "kontakt beta, ikke beta-spiller: 404 not_found", "kontakt beta, beta-spiller: 200 ok",
    "dato-afregning slukket: 409 train_now_requires_date_settlement", "ingen saeson: 409 no_active_season", "intet hold: 400 no_team",
    "parkeret hold: 409 team_parked", "hold uden pulje: 409 no_race_day_today", "korte loeb ikke bekraeftet: 409 short_races_confirm",
    "ingen ryttere: 409 no_riders", "ingen loebsdag i dag: 409 no_race_day_today", "dato allerede lukket: 409 date_settled",
    "tidligere dato aaben: 409 previous_date_open", "aftenkoerslen holder datoen: 409 training_in_progress",
  ]);
  for (const s of refusals.filter((x) => x.response.status !== 200 && x.label !== "aftenkoerslen holder datoen")) assert.equal(s.response.writes, 0, `${s.label}: en afvisning skriver intet`);
});

// ── Trin 3 ────────────────────────────────────────────────────────────────────────────────────
test("forrang mellem afvisninger: den grund, der tjekkes foerst, vinder, og intet skrives", () => {
  const steps = runs.afvisninger_forrang.steps;
  assert.deepEqual(steps.map((s) => `${s.label}: ${s.response.status ?? "kast"} ${s.response.body?.error ?? ""}`), [
    "intet hold + kontakt slukket: 400 no_team",
    "kontakt slukket + dato-afregning slukket: 404 not_found",
    "dato-afregning slukket + ingen saeson: 409 train_now_requires_date_settlement",
    "ingen saeson + parkeret hold: 409 no_active_season",
    "parkeret hold + hold uden pulje: 409 team_parked",
    "hold uden pulje + dato allerede lukket: 409 no_race_day_today",
    "dato allerede lukket + tidligere dato aaben: 409 date_settled",
    "dato allerede lukket + korte loeb ikke bekraeftet: 409 date_settled",
    "tidligere dato aaben + korte loeb ikke bekraeftet: 409 previous_date_open",
    "korte loeb ikke bekraeftet + aftenkoerslen holder datoen: 409 short_races_confirm",
    "ingen loebsdag i dag + ingen ryttere: 409 no_race_day_today",
    "ingen ryttere + aftenkoerslen holder datoen: 409 no_riders",
  ]);
  for (const s of steps) assert.equal(s.response.writes, 0, `${s.label}: en afvisning skriver intet`);
});

test("en skrivning eller et funktionskald sendes aldrig samtidig med noget andet kald", () => {
  for (const [name, run] of Object.entries(runs)) {
    assert.deepEqual(run.sharedWriteRounds, [], `${name}: sendt samtidig: ${run.sharedWriteRounds.slice(0, 3).join(" ; ")}. En skrivning skal vaere alene, ellers afgoer tilfaeldet raekkefoelgen i databasen.`);
  }
});

test("to hold, der trykker i samme oejeblik, ender hver isaer praecis som alene", () => {
  const both = runs.to_hold_samtidig;
  const { stort, lille, lilleSkrivninger, lilleSlut } = both.steps[0].response;
  assert.equal(stort.status, 200); assert.equal(lille.status, 200);
  assert.deepEqual(stort, runs.stort_hold_beta_tryk.steps[0].response, "det store holds svar er som alene");
  assert.deepEqual(lille, runs.lille_hold_uden_loeb.steps[0].response, "det lille holds svar er som alene");
  assert.equal(firstDifference(runs.stort_hold_beta_tryk.writes, both.writes, "writes"), null, "det store holds skrivninger er som alene");
  assert.equal(firstDifference(runs.stort_hold_beta_tryk.finalState, both.finalState, "finalState"), null, "det store holds sluttilstand er som alene");
  assert.equal(lilleSkrivninger, digest(runs.lille_hold_uden_loeb.writes), "det lille holds skrivninger er som alene");
  assert.equal(lilleSlut, digest(runs.lille_hold_uden_loeb.finalState), "det lille holds sluttilstand er som alene");
});

test("to tryk i samme oejeblik paa samme hold: intet dag-felt to gange, og samme slutresultat som ét tryk", () => {
  for (const s of runs.to_tryk_i_samme_oejeblik.steps) {
    assert.deepEqual(s.response, { mindstEtTrykGikIgennem: true, dobbelteDagFelter: 0, slutSomEfterEtTryk: true }, s.label);
  }
});

test("en cache lever ikke videre til naeste tryk: scenariet bider (aendringerne flytter resultatet)", () => {
  const steps = runs.cache_lever_ikke_videre.steps;
  assert.match(JSON.stringify(steps[0].response), /dommer-fejlinjektion/);
  assert.equal(steps[1].response.status, 200);
  assert.deepEqual(steps.at(-1).response, { andetSlutresultat: true });
});

test("fejl i hver laesning: hver laesning blev ramt, og trykket stopper eller fortsaetter som paa main", () => {
  const [asError, asThrow] = runs.fejl_i_hver_laesning.steps.map((s) => s.response);
  const slots = Object.keys(asError);
  assert.ok(slots.length >= 100, `kun ${slots.length} laesninger fundet i trykket`);
  assert.deepEqual(Object.keys(asThrow).sort(), [...slots].sort());
  for (const [mode, result] of [["fejlsvar", asError], ["kast", asThrow]]) {
    for (const [slot, r] of Object.entries(result)) assert.equal(r.ramt, true, `${mode}: laesningen "${slot}" blev aldrig sendt i fejl-koerslen`);
    const stopped = Object.values(result).filter((r) => r.svar === "kast").length;
    assert.ok(stopped >= slots.length * 0.8, `${mode}: de fleste fejl stopper trykket (${stopped} af ${slots.length})`);
    assert.ok(Object.values(result).every((r) => r.nytTryk === "200"), `${mode}: et nyt tryk gaar altid igennem`);
  }
});

test("databasen falder ud midt i trykket: intet nyt skrives, og et nyt tryk goer dagen faerdig", () => {
  for (const s of runs.database_falder_ud.steps) {
    const entries = Object.entries(s.response);
    assert.ok(entries.length >= 12, `${s.label}: ${entries.length} udfaldspunkter`);
    entries.forEach(([label, r], j) => {
      assert.equal(r.skrevetFoerFejlen, j, `${s.label} / ${label}: praecis ${j} skrivninger foer udfaldet`);
      assert.equal(r.gikIgennem, j === entries.length - 1, `${s.label} / ${label}: kun et udfald efter sidste skrivning lader trykket gaa igennem`);
      assert.equal(r.nytTryk, "200", `${s.label} / ${label}: et nyt tryk gaar igennem`);
    });
    // Uanset hvor databasen faldt ud, ender et nyt tryk samme sted.
    assert.equal(new Set(entries.map(([, r]) => r.efterNytTryk)).size, 1, `${s.label}: samme slutresultat efter nyt tryk uanset udfaldspunkt`);
  }
});

test("intet loefte staar uden ejer (en afvisning, ingen venter paa, vaelter serveren)", () => {
  assert.deepEqual(unhandledAfterFirstRun, [], `loefter uden ejer: ${unhandledAfterFirstRun.slice(0, 3).join(" ; ")}`);
});

test("to koersler i samme proces giver praecis samme optagelse (ingen tilfaeldighed, intet vaegur)", async () => {
  for (const name of Object.keys(SCENARIOS)) {
    const again = await runScenario(name);
    const pick = (run) => ({ steps: run.steps, writes: run.writes, finalState: run.finalState, reads: run.reads });
    const diff = firstDifference(pick(runs[name]), pick(again), name);
    assert.equal(diff, null, diff ? `${name} flimrer: ${diff.path}` : "");
  }
  assert.deepEqual(UNHANDLED_REJECTIONS, [], "loefter uden ejer i anden koersel");
});

// ── Maaletal: databasekald pr. tryk ───────────────────────────────────────────────────────────
const isSweepStep = (label) => /aftenkoersel|etapen/.test(label);
test("databasekald pr. tryk: tabel, og de maa ikke stige i forhold til facit", () => {
  const rows = [];
  for (const [name, run] of Object.entries(runs)) {
    run.calls.perStep.forEach((stepCalls, i) => {
      const before = facit.calls[name]?.perStep?.[i];
      // "Sen afvisning": facit-svaret er en afvisning, og main laeste andet end kontakter foer den.
      const refused = facit.scenarios[name]?.steps?.[i]?.response?.status >= 400;
      const senAfvisning = refused && Object.keys(before?.byTarget ?? {}).some((key) => key !== "read:app_config");
      rows.push({ scenarie: name, trin: stepCalls.label, kald: stepCalls.total, "kald main": before?.total ?? null, runder: stepCalls.rounds, "runder main": before?.rounds ?? null,
        laesninger: stepCalls.reads, skrivninger: stepCalls.writes, funktionskald: stepCalls.rpc, "skriv main": before ? before.writes + before.rpc : null, senAfvisning });
    });
  }
  // "kald" = hvert kald til databasen. "runder" = hvor mange gange koden venter paa databasen efter
  // hinanden (kald sendt samtidig taeller som én runde). Trin 2 og 4 saenker kald; trin 3 saenker runder.
  console.log("\n#7982 databasekald pr. trin (stedfortraeder, kold kontakt-cache). \"main\" = frosset facit.");
  console.table(rows.filter((r) => r.kald > 0 && !["afvisninger", "afvisninger_forrang"].includes(r.scenarie)).map(({ "skriv main": _w, senAfvisning: _s, ...row }) => row));
  for (const row of rows) {
    if (row["kald main"] == null) continue;
    assert.ok(row.runder <= row["runder main"], `${row.scenarie} / ${row.trin}: ${row.runder} runder, main havde ${row["runder main"]}. Runder pr. tryk maa ikke stige.`);
    assert.equal(row.skrivninger + row.funktionskald, row["skriv main"], `${row.scenarie} / ${row.trin}: antal skrivninger og funktionskald er aendret.`);
    // Et tryk, der afvises EFTER de foerste tjek (kontakt, saeson, hold), maa laese mere end foer: de
    // laesninger, et godkendt tryk alligevel laver, maa sendes samtidig med det tjek, der afviser.
    // Alle andre trin, ogsaa et tryk der afvises paa kontakten eller holdet, maa ikke koste flere kald.
    if (row.senAfvisning) continue;
    assert.ok(row.kald <= row["kald main"], `${row.scenarie} / ${row.trin}: ${row.kald} kald, main havde ${row["kald main"]}. Kald pr. tryk maa ikke stige.`);
  }
});

// Trin 3 samler kun TRYKKETS laesninger. Aftenkoerslen koerer for alle hold paa én gang; faar den
// ogsaa samlede laesninger, aendrer det belastningen paa databasen kl. 20. Det er et valg for sig.
test("aftenkoerslen er praecis uroert: samme antal kald og samme antal runder som i facit", () => {
  let checked = 0;
  for (const [name, run] of Object.entries(runs)) {
    run.calls.perStep.forEach((stepCalls, i) => {
      if (!isSweepStep(stepCalls.label)) return;
      const before = facit.calls[name].perStep[i];
      assert.equal(stepCalls.total, before.total, `${name} / ${stepCalls.label}: aftenkoerslens kald er aendret (${stepCalls.total} mod ${before.total})`);
      assert.equal(stepCalls.rounds, before.rounds, `${name} / ${stepCalls.label}: aftenkoerslens runder er aendret (${stepCalls.rounds} mod ${before.rounds})`);
      checked += 1;
    });
  }
  assert.ok(checked >= 10, `kun ${checked} aftenkoersels-trin fundet`);
});
