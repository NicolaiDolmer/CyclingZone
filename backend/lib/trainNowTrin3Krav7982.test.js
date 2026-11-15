// #7982 trin 3: dommerens KRAV-proever. Skrevet FOER foerste kodelinje (AGENTS.md regel 40).
// Ejes af dommeren; byggeren aendrer ikke filen.
//
// Til forskel fra "samme resultat som foer" (trainNowSameResult7982.test.js, groen paa main) er
// disse proever ROEDE paa main med vilje. De siger, hvad trin 3 skal levere, og skal vaere groenne
// paa trin 3's PR:
//   K1  Trykket venter faerre gange paa databasen (runder), uden at aftenkoerslen aendres.
//   K2  Trykkets laese-cache toemmes ogsaa, naar en skrivning er FAERDIG, ikke kun naar den sendes.
//   K3  Et spoergsmaals vaerdier laases, naar spoergsmaalet stilles (som den rigtige klient goer).
//   K4  catch/finally paa et spoergsmaal gennem cachen toemmer ikke cachen og sender intet ekstra.
// K2 til K4 er de tre huller fra dommen over trin 2 (og lederens note om catch/finally). Ingen af dem
// kan ramme i dag, fordi trykket laeser ét kald ad gangen; naar laesninger sendes samtidig, kan de.
import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { createPressReadCache } from "./trainNow.js";
import { runScenario } from "./trainNowSameResult7982.harness.js";

// ── K1: runder ────────────────────────────────────────────────────────────────────────────────
// Paa main (5bfb76b6): stort hold beta-tryk 119 runder, almindeligt 116, lille hold 104. Loftet er
// sat, saa mindst hver tredje ventetid skal vaere vaek. Dommerens skoen for, hvad der kan naas uden
// at flytte en laesning hen over en skrivning, er 64 til 72 for det store hold og under 60 for det lille.
// Kan loftet ikke naas inden for reglerne, saa stop og kom til dommeren; flyt ikke en laesning for at naa det.
const ROUND_CEILINGS = [
  ["stort_hold_beta_tryk", 0, 80], ["stort_hold_almindeligt_tryk", 0, 78], ["lille_hold_uden_loeb", 0, 70],
];
for (const [name, stepIndex, ceiling] of ROUND_CEILINGS) {
  test(`K1 faerre ventetider paa databasen: ${name}${stepIndex ? " (gentaget tryk)" : ""} hoejst ${ceiling} runder`, async () => {
    const run = await runScenario(name);
    const calls = run.calls.perStep[stepIndex];
    assert.ok(calls.rounds <= ceiling, `${name} / ${calls.label}: ${calls.rounds} runder (${calls.total} kald). Trin 3 skal ned paa hoejst ${ceiling}.`);
  });
}

// ── Den rigtige databaseklient med et netvaerk, dommeren styrer (ingen server, ingen noegle) ──
function realClient(handler) {
  const sent = [];
  const fetchStub = async (url, init = {}) => {
    const request = { method: init.method ?? "GET", url: decodeURIComponent(String(url)) };
    sent.push(request);
    return handler(request);
  };
  const client = createClient("http://dommer.invalid", "dommer-ingen-rigtig-noegle", { global: { fetch: fetchStub }, auth: { persistSession: false, autoRefreshToken: false } });
  return { client, sent };
}
const json = (value) => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
const tick = () => new Promise((resolve) => { setImmediate(resolve); });

// ── K2: cachen toemmes ogsaa, naar skrivningen er faerdig ─────────────────────────────────────
for (const [label, startWrite] of [
  ["en skrivning i en gemt tabel", (cache) => cache.from("teams").update({ name: "ny" }).eq("id", "t1")],
  ["en databasefunktion, trykket ikke plejer at kalde", (cache) => cache.rpc("en_anden_funktion", { p_team_id: "t1" })],
]) {
  test(`K2 en laesning startet, mens ${label} er undervejs, genbruges ikke bagefter`, async () => {
    let release; const gate = new Promise((resolve) => { release = resolve; });
    let stored = "gammel";
    const { client, sent } = realClient(async ({ method }) => {
      if (method === "GET") return json([{ id: "t1", name: stored }]);
      await gate; stored = "ny";
      return method === "PATCH" ? new Response(null, { status: 204 }) : json(null);
    });
    const cache = createPressReadCache(client);
    const read = () => cache.from("teams").select("id, name").eq("id", "t1");
    assert.equal((await read()).data[0].name, "gammel");
    const writing = Promise.resolve(startWrite(cache)); // skrivningen er sendt og venter i "databasen"
    await tick();
    assert.equal(sent.filter((r) => r.method !== "GET").length, 1, "skrivningen er sendt");
    assert.equal((await read()).data[0].name, "gammel", "laest mens skrivningen er undervejs: databasen har stadig den gamle vaerdi");
    release();
    assert.equal((await writing).error, null);
    const after = await read();
    assert.equal(after.data[0].name, "ny", "efter at skrivningen er faerdig, maa den gamle vaerdi ikke komme fra cachen");
  });
}

// ── K3: vaerdierne laases, naar spoergsmaalet stilles ─────────────────────────────────────────
test("K3 et spoergsmaals vaerdier er dem, der gjaldt, da spoergsmaalet blev stillet (som klienten selv)", async () => {
  const ask = async (make) => {
    const { client, sent } = realClient(async () => json([{ id: "a" }]));
    const target = make(client);
    const ids = ["a", "b"];
    const query = target.from("races").select("id").in("id", ids);
    ids.push("c"); // kalderen genbruger sin liste, foer svaret hentes
    await query;
    return { target, sent };
  };
  const direct = await ask((client) => client);
  const viaCache = await ask((client) => createPressReadCache(client));
  assert.match(direct.sent[0].url, /id=in\.\(a,b\)$/, "klienten selv sender de vaerdier, der gjaldt, da spoergsmaalet blev stillet");
  assert.deepEqual(viaCache.sent, direct.sent, "cachen skal sende praecis det samme som klienten selv");
  // Og svaret er gemt under det spoergsmaal, der blev stillet: (a,b) er et hit, (a,b,c) er et nyt spoergsmaal.
  await viaCache.target.from("races").select("id").in("id", ["a", "b"]);
  assert.equal(viaCache.sent.length, 1, "samme spoergsmaal igen: fra cachen");
  await viaCache.target.from("races").select("id").in("id", ["a", "b", "c"]);
  assert.equal(viaCache.sent.length, 2, "et andet spoergsmaal: til databasen");
});

// ── K4: catch og finally ──────────────────────────────────────────────────────────────────────
// Den rigtige klients spoergsmaal har kun `then`. Cachens spoergsmaal skal enten opfoere sig som
// klientens (catch/finally findes ikke: TypeError med det samme) eller som et rigtigt loefte. Det
// maa ikke, som paa main, tage imod kaldet i stilhed, toemme hele cachen og foerst fejle senere.
for (const method of ["catch", "finally"]) {
  test(`K4 .${method}() paa et spoergsmaal gennem cachen toemmer ikke cachen og sender intet ekstra`, async () => {
    const { client, sent } = realClient(async () => json([{ id: "t1" }]));
    const cache = createPressReadCache(client);
    const read = () => cache.from("teams").select("id").eq("id", "t1");
    const first = await read();
    assert.equal(sent.length, 1);
    let called = 0; let result; let typeError = false;
    try {
      const chained = read()[method](() => { called += 1; return "fra kalderen"; });
      result = await chained;
    } catch (err) {
      if (!(err instanceof TypeError)) throw err;
      typeError = true;
    }
    if (!typeError) {
      // Loefte-opfoersel: catch paa et svar, der lykkedes, giver svaret; finally kalder sin funktion én gang.
      assert.deepEqual(result, first);
      assert.equal(called, method === "finally" ? 1 : 0);
    }
    await read();
    assert.equal(sent.length, 1, `.${method}() maa hverken toemme cachen eller sende noget til databasen (sendt: ${sent.length})`);
  });
}
