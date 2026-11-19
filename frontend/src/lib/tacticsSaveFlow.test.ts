// #7327: gemme-flowet for Taktik-fanen. Fixtures fra issuet: foerste write fejler,
// anden write fejler, begge lykkes, tabt svar efter commit, genforsoeg, fremmed
// versionskonflikt, egen gemning uden kvittering og redigering under request.
import test from "node:test";
import assert from "node:assert/strict";

import {
  advanceBaseline,
  classifyStages,
  dirtyOrderStages,
  keepMineAfterConflict,
  runTacticsSave,
  stageEqual,
  withConfirmedVersions,
  type Matrix,
  type RolesBody,
  type RolesPutResult,
  type TacticsSaveDeps,
  type TacticsSavePlan,
} from "./tacticsSaveFlow.ts";

const cell = (race_role: string, effort = "normal") => ({ race_role, effort });

// To redigerbare etaper, to ryttere (aliaser, ingen rigtige navne).
const BASE: Matrix = {
  2: { a: cell("captain"), b: cell("helper") },
  3: { a: cell("captain"), b: cell("helper") },
};
const DRAFT: Matrix = {
  2: { a: cell("captain", "all_out"), b: cell("helper") },
  3: { a: cell("captain"), b: cell("helper") },
};
const FOREIGN: Matrix = {
  2: { a: cell("captain"), b: cell("hunter") },
  3: { a: cell("captain"), b: cell("helper") },
};

// In-memory-server: version = JSON af etapens celler (nok til at skelne udgaver).
function fakeServer(initial: Matrix) {
  const state = { matrix: structuredClone(initial) as Matrix };
  const versionOf = (sn: number) => JSON.stringify(state.matrix[sn] ?? {});
  const body = (): RolesBody => ({
    matrix: structuredClone(state.matrix),
    stage_versions: Object.fromEntries(Object.keys(state.matrix).map((sn) => [sn, versionOf(Number(sn))])),
  });
  return { state, versionOf, body };
}

type Script = {
  server: ReturnType<typeof fakeServer>;
  sent: Matrix;
  putRoles?: Array<"ok" | "fail400" | "lostAfterCommit" | "network">;
  putOrders?: Array<"ok" | "fail">;
  readFails?: boolean;
};

function makeDeps(script: Script) {
  const calls = { putRoles: [] as Array<{ stages: number[]; base: Record<number, string> }>, putOrders: 0, readRoles: 0 };
  const rolesQueue = [...(script.putRoles ?? [])];
  const ordersQueue = [...(script.putOrders ?? [])];
  const deps: TacticsSaveDeps = {
    async putRoles(stages, base): Promise<RolesPutResult> {
      calls.putRoles.push({ stages, base });
      const mode = rolesQueue.shift() ?? "ok";
      if (mode === "network") return { ok: false, status: 0, error: null };
      if (mode === "fail400") return { ok: false, status: 400, error: "stage_roles_role_overlap" };
      for (const sn of stages) {
        if (base[sn] !== script.server.versionOf(sn)) return { ok: false, status: 409, error: "stage_roles_conflict" };
      }
      for (const sn of stages) script.server.state.matrix[sn] = structuredClone(script.sent[sn]);
      if (mode === "lostAfterCommit") return { ok: false, status: 504, error: null };
      return { ok: true };
    },
    async readRoles() {
      calls.readRoles += 1;
      if (script.readFails) return null;
      return script.server.body();
    },
    matrixOf: (b) => (b.matrix as Matrix),
    async putOrders() {
      calls.putOrders += 1;
      const mode = ordersQueue.shift() ?? "ok";
      if (mode === "fail") throw new Error("team_orders_save_failed_500");
    },
  };
  return { deps, calls };
}

const planFor = (server: ReturnType<typeof fakeServer>, over: Partial<TacticsSavePlan> = {}): TacticsSavePlan => ({
  stages: [2],
  baseVersions: { 2: server.versionOf(2) },
  sentMatrix: DRAFT,
  baselineMatrix: BASE,
  ordersNeeded: true,
  ...over,
});

test("begge dele lykkes: gemt, kvittering med nye versioner", async () => {
  const server = fakeServer(BASE);
  const { deps, calls } = makeDeps({ server, sent: DRAFT });
  const out = await runTacticsSave(planFor(server), deps);
  assert.equal(out.status, "saved");
  assert.deepEqual(out.parts, { roles: "saved", orders: "saved" });
  assert.deepEqual(out.confirmedStages, [2]);
  assert.equal(out.receipt?.stage_versions?.["2"], server.versionOf(2));
  assert.equal(calls.putOrders, 1);
});

test("anden write (ordren) fejler: delvis, intentionen bekraeftet, genforsoeg sender kun ordren", async () => {
  const server = fakeServer(BASE);
  const { deps, calls } = makeDeps({ server, sent: DRAFT, putOrders: ["fail", "ok"] });
  const first = await runTacticsSave(planFor(server), deps);
  assert.equal(first.status, "partial");
  assert.deepEqual(first.parts, { roles: "saved", orders: "failed" });
  assert.equal(first.errorKey, "team_orders_save_failed_500");

  // Kladden er uroert; baseline flyttes kun for den bekraeftede etape.
  const baseline = advanceBaseline(BASE, DRAFT, first.confirmedStages);
  assert.ok(stageEqual(baseline, DRAFT, 2));
  assert.ok(stageEqual(baseline, BASE, 3));

  // Genforsoeg: intentionen er ikke laengere aendret => kun ordren sendes, ingen konflikt.
  const retry = await runTacticsSave(planFor(server, { stages: [], baseVersions: {} }), deps);
  assert.equal(retry.status, "saved");
  assert.deepEqual(retry.parts, { roles: "notNeeded", orders: "saved" });
  assert.equal(calls.putRoles.length, 1, "intentionen skrives ikke igen");
  assert.equal(calls.putOrders, 2);
});

test("foerste write fejler (400): intet gemt, ordren forsoeges ikke", async () => {
  const server = fakeServer(BASE);
  const { deps, calls } = makeDeps({ server, sent: DRAFT, putRoles: ["fail400"] });
  const out = await runTacticsSave(planFor(server), deps);
  assert.equal(out.status, "failed");
  assert.deepEqual(out.parts, { roles: "failed", orders: "skipped" });
  assert.equal(out.errorKey, "stage_roles_role_overlap");
  assert.equal(calls.putOrders, 0);
  assert.equal(calls.readRoles, 0);
});

test("tabt svar efter commit: afklares ved genlaesning, ingen blind gentagelse", async () => {
  const server = fakeServer(BASE);
  const { deps, calls } = makeDeps({ server, sent: DRAFT, putRoles: ["lostAfterCommit"] });
  const out = await runTacticsSave(planFor(server), deps);
  assert.equal(out.status, "saved");
  assert.deepEqual(out.parts, { roles: "saved", orders: "saved" });
  assert.equal(calls.putRoles.length, 1, "ingen gentagelse af PUT");
  assert.equal(calls.readRoles, 1);
});

test("netvaerksfejl foer commit: fejlet med friske versioner, genforsoeg virker", async () => {
  const server = fakeServer(BASE);
  const { deps } = makeDeps({ server, sent: DRAFT, putRoles: ["network"] });
  const out = await runTacticsSave(planFor(server), deps);
  assert.equal(out.status, "failed");
  assert.deepEqual(out.parts, { roles: "failed", orders: "skipped" });
  assert.ok(out.receipt, "genlaesningen giver kvittering");
  const again = await runTacticsSave(planFor(server), deps);
  assert.equal(again.status, "saved");
});

test("egen gemning uden kvittering behandles ikke som fremmed aendring", async () => {
  // Foerste gem: intentionen gik igennem, men kvitteringen kunne ikke laeses
  // (versionen forbliver den gamle lokalt). Manageren aendrer saa etape 2 igen.
  const server = fakeServer(BASE);
  const staleBase = server.versionOf(2);
  const first = makeDeps({ server, sent: DRAFT, readFails: true });
  const out1 = await runTacticsSave(planFor(server, { ordersNeeded: false }), first.deps);
  assert.equal(out1.status, "saved");
  assert.equal(out1.receipt, null);

  const DRAFT2: Matrix = { ...DRAFT, 2: { a: cell("captain", "save"), b: cell("helper") } };
  const second = makeDeps({ server, sent: DRAFT2 });
  const out2 = await runTacticsSave(
    { stages: [2], baseVersions: { 2: staleBase }, sentMatrix: DRAFT2, baselineMatrix: DRAFT, ordersNeeded: false },
    second.deps,
  );
  assert.equal(out2.status, "saved", "409 paa egen version afklares og genforsoeges een gang");
  assert.equal(second.calls.putRoles.length, 2);
  assert.ok(stageEqual(server.state.matrix, DRAFT2, 2));
});

test("fremmed versionskonflikt: konflikt, intet overskrevet, ordren venter", async () => {
  const server = fakeServer(BASE);
  const plan = planFor(server);
  server.state.matrix = structuredClone(FOREIGN); // en anden fane gemte imens
  const { deps, calls } = makeDeps({ server, sent: DRAFT });
  const out = await runTacticsSave(plan, deps);
  assert.equal(out.status, "conflict");
  assert.equal(out.errorKey, "stage_roles_conflict");
  assert.deepEqual(out.parts, { roles: "failed", orders: "skipped" });
  assert.equal(calls.putRoles.length, 1, "ingen automatisk overskrivning");
  assert.equal(calls.putOrders, 0);
  assert.ok(stageEqual(server.state.matrix, FOREIGN, 2), "serverens udgave bevaret");
});

test("Behold mine: kun managerens egne etaper overskrives, efter eksplicit valg", async () => {
  const server = fakeServer(FOREIGN);
  const FOREIGN3: Matrix = { ...FOREIGN, 3: { a: cell("captain", "save"), b: cell("helper") } };
  server.state.matrix = structuredClone(FOREIGN3);
  const { draft, baseline } = keepMineAfterConflict({ draft: DRAFT, baseline: BASE, server: FOREIGN3 });
  assert.ok(stageEqual(draft, DRAFT, 2), "egen aendring paa etape 2 bevaret");
  assert.ok(stageEqual(draft, FOREIGN3, 3), "etape 3 (ikke roert af manageren) tager serverens udgave");
  assert.ok(stageEqual(baseline, FOREIGN3, 2));

  const { deps } = makeDeps({ server, sent: draft });
  const out = await runTacticsSave(
    { stages: [2], baseVersions: { 2: server.versionOf(2) }, sentMatrix: draft, baselineMatrix: baseline, ordersNeeded: true },
    deps,
  );
  assert.equal(out.status, "saved");
  assert.ok(stageEqual(server.state.matrix, FOREIGN3, 3), "etape 3 uroert");
});

test("redigering under request: baseline flyttes til det SENDTE, ikke til den nye kladde", () => {
  const sent = DRAFT;
  const editedMeanwhile: Matrix = { ...DRAFT, 2: { a: cell("captain", "save"), b: cell("helper") } };
  const baseline = advanceBaseline(BASE, sent, [2]);
  assert.ok(!stageEqual(editedMeanwhile, baseline, 2), "den nye redigering staar stadig som ugemt");
});

test("kun intentionen aendret (ordre-halvdelen gated): gemt uden ordre-kald", async () => {
  const server = fakeServer(BASE);
  const { deps, calls } = makeDeps({ server, sent: DRAFT });
  const out = await runTacticsSave(planFor(server, { ordersNeeded: false }), deps);
  assert.equal(out.status, "saved");
  assert.deepEqual(out.parts, { roles: "saved", orders: "notNeeded" });
  assert.equal(calls.putOrders, 0);
});

test("kun ordren aendret og den fejler: fejlet, ikke delvis", async () => {
  const server = fakeServer(BASE);
  const { deps } = makeDeps({ server, sent: DRAFT, putOrders: ["fail"] });
  const out = await runTacticsSave(planFor(server, { stages: [], baseVersions: {} }), deps);
  assert.equal(out.status, "failed");
  assert.deepEqual(out.parts, { roles: "notNeeded", orders: "failed" });
});

test("kvitteringen flytter kun de bekraeftede etapers version (Codex P1)", () => {
  // Etape 3 er aendret i en anden fane imens etape 2 blev gemt: dens version
  // maa IKKE adopteres, ellers ville et senere gem af etape 3 stille overskrive.
  const prev = { stage_versions: { 2: "v2-old", 3: "v3-old" } };
  const receipt = { stage_versions: { 2: "v2-new", 3: "v3-foreign" }, riders: [] };
  const next = withConfirmedVersions(prev, receipt, [2]);
  assert.deepEqual(next.stage_versions, { 2: "v2-new", 3: "v3-old" });
  assert.deepEqual(next.riders, []);
  // En bekraeftet etape uden raekker paa serveren bliver "empty".
  assert.equal(withConfirmedVersions(prev, { stage_versions: {} }, [2]).stage_versions?.["2"], "empty");
});

test("konflikt paa det automatiske genforsoeg giver en frisk kvittering (Codex P2)", async () => {
  const server = fakeServer(BASE);
  const staleBase = "stale";
  let reads = 0;
  const { deps } = makeDeps({ server, sent: DRAFT });
  const realRead = deps.readRoles;
  // Foerste genlaesning: uroert (=> genforsoeg). Imens gemmer en anden fane etape 2.
  deps.readRoles = async () => {
    reads += 1;
    const body = await realRead();
    if (reads === 1) server.state.matrix = structuredClone(FOREIGN);
    return body;
  };
  const out = await runTacticsSave(planFor(server, { baseVersions: { 2: staleBase }, ordersNeeded: false }), deps);
  assert.equal(out.status, "conflict");
  assert.equal(out.receipt?.stage_versions?.["2"], server.versionOf(2), "kvitteringen er serverens nuvaerende version");
});

test("classifyStages skelner egen, uroert og fremmed", () => {
  const v = classifyStages(FOREIGN, { stages: [2, 3], sentMatrix: DRAFT, baselineMatrix: BASE });
  assert.deepEqual(v, { 2: "foreign", 3: "committed" });
  const w = classifyStages(BASE, { stages: [2], sentMatrix: DRAFT, baselineMatrix: BASE });
  assert.deepEqual(w, { 2: "untouched" });
});

// Codex P1 (HEAD 4dafb69): en anden fane gemmer mellem vores lykkede PUT og genlaesningen.
function foreignBeforeRead(deps: TacticsSaveDeps, onRead: number, change: () => void) {
  const realRead = deps.readRoles;
  let reads = 0;
  deps.readRoles = async () => {
    reads += 1;
    if (reads === onRead) change();
    return realRead();
  };
}

test("lykket PUT men fremmed gemning foer kvitteringen: konflikt, ingen stille adoption", async () => {
  const server = fakeServer(BASE);
  const { deps, calls } = makeDeps({ server, sent: DRAFT });
  foreignBeforeRead(deps, 1, () => { server.state.matrix[2] = structuredClone(FOREIGN[2]); });
  const out = await runTacticsSave(planFor(server), deps);
  assert.equal(out.status, "conflict");
  assert.equal(out.errorKey, "stage_roles_conflict");
  assert.deepEqual(out.confirmedStages, [], "etape 2 er ikke bekraeftet: baseline og version flyttes ikke");
  assert.equal(out.receipt?.stage_versions?.["2"], server.versionOf(2), "kvitteringen til Behold mine er serverens nuvaerende");
  assert.equal(calls.putOrders, 0, "ordren venter paa afklaringen");
  assert.ok(stageEqual(server.state.matrix, FOREIGN, 2), "den anden fanes udgave er ikke overskrevet");
});

test("lykket PUT af to etaper, fremmed gemning paa den ene: kun den gemte er bekraeftet", async () => {
  const server = fakeServer(BASE);
  const sent: Matrix = { ...DRAFT, 3: { a: cell("captain", "save"), b: cell("helper") } };
  const { deps } = makeDeps({ server, sent });
  foreignBeforeRead(deps, 1, () => { server.state.matrix[3] = structuredClone(BASE[3]); });
  const out = await runTacticsSave(
    { stages: [2, 3], baseVersions: { 2: server.versionOf(2), 3: server.versionOf(3) }, sentMatrix: sent, baselineMatrix: BASE, ordersNeeded: false },
    deps,
  );
  assert.equal(out.status, "conflict", "en etape sat tilbage af en anden fane er ogsaa en fremmed aendring");
  assert.deepEqual(out.confirmedStages, [2]);
});

test("automatisk genforsoeg lykkes men fremmed gemning foer kvitteringen: konflikt", async () => {
  const server = fakeServer(BASE);
  const { deps } = makeDeps({ server, sent: DRAFT });
  // Laesning 1 = afklaring af 409 (uroert => genforsoeg); laesning 2 = kvittering efter genforsoeget.
  foreignBeforeRead(deps, 2, () => { server.state.matrix[2] = structuredClone(FOREIGN[2]); });
  const out = await runTacticsSave(planFor(server, { baseVersions: { 2: "stale" }, ordersNeeded: false }), deps);
  assert.equal(out.status, "conflict");
  assert.deepEqual(out.confirmedStages, []);
  assert.equal(out.receipt?.stage_versions?.["2"], server.versionOf(2));
});

// #8381: ordrekladden ligger pr. etape. Et gem sender alle etaper med aendrede
// ordrer, hver med sin egen kvittering, og "saved" kraever dem alle.
function ordersDeps(server: ReturnType<typeof fakeServer>, failOnce: number[] = []) {
  const { deps, calls } = makeDeps({ server, sent: DRAFT });
  const sent: Array<number | undefined> = [];
  const failing = new Set(failOnce);
  deps.putOrders = async (stage?: number) => {
    sent.push(stage);
    if (stage !== undefined && failing.delete(stage)) throw new Error("team_orders_save_failed_500");
  };
  return { deps, calls, sent };
}

test("#8381 dirtyOrderStages: alle etaper tælles, en ordre uden kvittering er ugemt", () => {
  const order = (b: boolean) => ({ breakaway_stance: "neutral", riders: [{ rider_id: "a", try_break: b }] });
  const current = { 2: order(true), 3: order(false), 4: order(false), 5: order(false) };
  const baseline = { 2: order(false), 3: order(false), 4: null, 5: order(false) };
  assert.deepEqual(dirtyOrderStages(current, baseline, [2, 3, 4, 5]), [2, 4]);
  // Kun de redigerbare etaper, og en etape uden kladde er aldrig beskidt.
  assert.deepEqual(dirtyOrderStages(current, baseline, [3, 4, 6]), [4]);
});

test("#8381 ordrer paa flere etaper: alle sendes, gemt kun naar alle er bekraeftet", async () => {
  const server = fakeServer(BASE);
  const { deps, sent } = ordersDeps(server);
  const out = await runTacticsSave(planFor(server, { orderStages: [3, 2] }), deps);
  assert.equal(out.status, "saved");
  assert.deepEqual(out.parts, { roles: "saved", orders: "saved" });
  assert.deepEqual(sent, [3, 2]);
  assert.deepEqual(out.ordersSaved, [3, 2]);
});

test("#8381 kun ordrer paa en anden etape (ingen intention aendret): sendes og kvitteres", async () => {
  const server = fakeServer(BASE);
  const { deps, calls, sent } = ordersDeps(server);
  const out = await runTacticsSave(planFor(server, { stages: [], baseVersions: {}, orderStages: [2] }), deps);
  assert.equal(out.status, "saved");
  assert.deepEqual(out.parts, { roles: "notNeeded", orders: "saved" });
  assert.deepEqual(sent, [2]);
  assert.equal(calls.putRoles.length, 0);
});

test("#8381 een etapes ordre fejler: delvis, de andre er kvitteret, genforsoeg sender kun den manglende", async () => {
  const server = fakeServer(BASE);
  const { deps, sent } = ordersDeps(server, [2]);
  const first = await runTacticsSave(planFor(server, { stages: [], baseVersions: {}, orderStages: [3, 2] }), deps);
  assert.equal(first.status, "partial", "en bekraeftet ordre og en fejlet er delvis, aldrig gemt");
  assert.deepEqual(first.parts, { roles: "notNeeded", orders: "failed" });
  assert.deepEqual(first.ordersSaved, [3]);
  assert.equal(first.errorKey, "team_orders_save_failed_500");

  const missing = [3, 2].filter((sn) => !first.ordersSaved.includes(sn));
  const retry = await runTacticsSave(planFor(server, { stages: [], baseVersions: {}, orderStages: missing }), deps);
  assert.equal(retry.status, "saved");
  assert.deepEqual(sent, [3, 2, 2]);
});

test("#8381 alle ordrer fejler uden intention: fejlet, ingen kvittering", async () => {
  const server = fakeServer(BASE);
  const { deps } = ordersDeps(server, [2, 3]);
  const out = await runTacticsSave(planFor(server, { stages: [], baseVersions: {}, orderStages: [2, 3] }), deps);
  assert.equal(out.status, "failed");
  assert.deepEqual(out.ordersSaved, []);
});

test("#8381 intentionen afvist: ingen etapes ordre sendes", async () => {
  const server = fakeServer(BASE);
  const { deps, sent } = ordersDeps(server);
  deps.putRoles = async () => ({ ok: false, status: 400, error: "stage_roles_role_overlap" });
  const out = await runTacticsSave(planFor(server, { orderStages: [2, 3] }), deps);
  assert.equal(out.status, "failed");
  assert.deepEqual(out.parts, { roles: "failed", orders: "skipped" });
  assert.deepEqual(sent, []);
});
