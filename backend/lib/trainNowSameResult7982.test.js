// #7982 trin 2-5: "samme resultat som foer". Dommerens proeve (AGENTS.md regel 40), skrevet foer
// foerste kodelinje. Ejes af dommeren; byggeren aendrer hverken denne fil, harnesset eller facit.
//
// Proeven koerer de faste scenarier i trainNowSameResult7982.harness.js og sammenligner felt for
// felt med det frosne facit fra main (trainNowSameResult7982.facit.json, SHA staar i filen):
//   - svaret paa hvert tryk/hver aftenkoersel (status og krop),
//   - hver skrivning og hvert kald til en databasefunktion, i raekkefoelge,
//   - sluttilstanden i alle tabeller.
// Foerste afvigelse skrives ud som en sti, fx
//   stort_hold_beta_tryk > writes[9].args.p_report.riders.<rytter>#0.hash
// Facit i repoet er fingeraftryk (regel 17: ingen motortal paa GitHub). Vil man se vaerdierne, peger
// man SAME_RESULT_7982_FULL paa en fuld optagelse fra den gamle kode (se nederst), saa vises
// "forventet" og "fik" med tal.
//
// Antal databasekald pr. tryk taelles i samme koersel og skrives ud som tabel (maaletal pr. trin).
// Kald maa falde, aldrig stige; skrivningerne skal vaere de samme.
//
//   Frys facit (kun dommeren, paa main):  SAME_RESULT_7982_WRITE=1 node --test --import ./test-setup.js lib/trainNowSameResult7982.test.js
//   Fuld optagelse med tal (privat):      SAME_RESULT_7982_DUMP=<fil.json> node --test ...
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { SCENARIOS, runScenario, fingerprint, firstDifference } from "./trainNowSameResult7982.harness.js";

const FACIT_URL = new URL("./trainNowSameResult7982.facit.json", import.meta.url);
const WRITE = process.env.SAME_RESULT_7982_WRITE === "1";
const DUMP = process.env.SAME_RESULT_7982_DUMP ?? null;
const FULL = process.env.SAME_RESULT_7982_FULL ?? null;

const runs = {};
for (const name of Object.keys(SCENARIOS)) runs[name] = await runScenario(name);

const show = (value) => { const text = JSON.stringify(value); return text === undefined ? String(value) : text.length > 600 ? `${text.slice(0, 600)} ...` : text; };
function explain(name, diff, hint = "") {
  return [`${name} afviger fra facit.`, `  Foerste afvigelse: ${name} > ${diff.path.replace(/^\./, "")}`, `  Forventet (facit): ${show(diff.expected)}`, `  Fik:               ${show(diff.actual)}`, hint].filter(Boolean).join("\n");
}

if (WRITE) {
  let sha = "ukendt";
  try { sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* best-effort: SHA'en er kun en maerkat i facit-filen */ }
  const facit = {
    note: "Frosset facit for #7982 trin 2-5 (samme resultat som foer). Fingeraftryk, ingen motortal. Genereres kun af dommeren.",
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

test("stedfortraederen kendte alt, koden bad om (ellers er proeven ugyldig og dommeren skal udvide den)", () => {
  for (const [name, run] of Object.entries(runs)) assert.deepEqual(run.unsupported, [], `${name}: ukendte kald ${JSON.stringify(run.unsupported)}`);
});

for (const name of Object.keys(SCENARIOS)) {
  test(`samme resultat som foer: ${name}`, () => {
    const actual = fingerprint(runs[name]);
    const expected = facit.scenarios[name];
    for (const part of ["steps", "writes", "finalState"]) {
      const diff = firstDifference(expected[part], actual[part], part);
      if (!diff) continue;
      let hint = "  (Facit er fingeraftryk. Koer med SAME_RESULT_7982_FULL=<fuld optagelse fra main> for at se tallene.)";
      if (full?.[name]) {
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

test("to koersler i samme proces giver praecis samme optagelse (ingen tilfaeldighed, intet vaegur)", async () => {
  for (const name of Object.keys(SCENARIOS)) {
    const again = await runScenario(name);
    const diff = firstDifference({ steps: runs[name].steps, writes: runs[name].writes, finalState: runs[name].finalState }, { steps: again.steps, writes: again.writes, finalState: again.finalState }, name);
    assert.equal(diff, null, diff ? `${name} flimrer: ${diff.path}` : "");
  }
});

// ── Maaletal: databasekald pr. tryk ───────────────────────────────────────────────────────────
test("databasekald pr. tryk: tabel, og de maa ikke stige i forhold til facit", () => {
  const rows = [];
  for (const [name, run] of Object.entries(runs)) {
    run.calls.perStep.forEach((stepCalls, i) => {
      const before = facit.calls[name]?.perStep?.[i];
      rows.push({ scenarie: name, trin: stepCalls.label, kald: stepCalls.total, "kald main": before?.total ?? null, runder: stepCalls.rounds, "runder main": before?.rounds ?? null,
        laesninger: stepCalls.reads, skrivninger: stepCalls.writes, funktionskald: stepCalls.rpc });
    });
  }
  // "kald" = hvert kald til databasen. "runder" = hvor mange gange koden venter paa databasen efter
  // hinanden (kald sendt samtidig taeller som én runde). Trin 2 og 4 saenker kald; trin 3 saenker runder.
  console.log("\n#7982 databasekald pr. trin (stedfortraeder, kold kontakt-cache). \"main\" = frosset facit.");
  console.table(rows.filter((r) => r.scenarie !== "afvisninger"));
  for (const row of rows) {
    if (row["kald main"] == null) continue;
    assert.ok(row.kald <= row["kald main"], `${row.scenarie} / ${row.trin}: ${row.kald} kald, main havde ${row["kald main"]}. Kald pr. tryk maa ikke stige.`);
    assert.ok(row.runder <= row["runder main"], `${row.scenarie} / ${row.trin}: ${row.runder} runder, main havde ${row["runder main"]}. Runder pr. tryk maa ikke stige.`);
  }
});
