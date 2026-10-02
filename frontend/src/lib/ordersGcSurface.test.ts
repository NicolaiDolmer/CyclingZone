// #6067: taktik-mapping og filmlinjer for orders_gc_v1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ORDERS_GC_REVISION,
  breakawayStanceLabelKey,
  describeGcReactionEvent,
  isOrdersGcRevision,
  ordersVisible,
  raceRulesRevision,
} from "./ordersGcSurface.ts";
import { collectRiderIds, describeEvent } from "./stageTimelineFilm.js";

const locales = {
  en: JSON.parse(readFileSync(new URL("../../public/locales/en/races.json", import.meta.url), "utf8")),
  da: JSON.parse(readFileSync(new URL("../../public/locales/da/races.json", import.meta.url), "utf8")),
};
const at = (obj: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);

test("regel-revision: kun orders_gc_v1 er de nye regler; null/ukendt/legacy er legacy", () => {
  assert.equal(raceRulesRevision(ORDERS_GC_REVISION), "orders_gc_v1");
  for (const raw of [null, undefined, "", "legacy", "orders_gc_v3", 1, {}]) {
    assert.equal(raceRulesRevision(raw), "legacy", String(raw));
    assert.equal(isOrdersGcRevision(raw), false);
  }
  assert.equal(isOrdersGcRevision("orders_gc_v1"), true);
  // #6084: orders_gc_v2 = orders_gc_v1-pakken + bjergselektionen; samme flader.
  assert.equal(raceRulesRevision("orders_gc_v2"), "orders_gc_v1");
  assert.equal(isOrdersGcRevision("orders_gc_v2"), true);
});

test("ordre-halvdelen: preview-gaten gælder legacy, orders_gc_v1 viser altid ordrerne", () => {
  assert.equal(ordersVisible({ showOrders: false, revision: "legacy" }), false);
  assert.equal(ordersVisible({ showOrders: false, revision: null }), false);
  assert.equal(ordersVisible({ showOrders: true, revision: "legacy" }), true);
  assert.equal(ordersVisible({ showOrders: false, revision: "orders_gc_v1" }), true);
  assert.equal(ordersVisible({ showOrders: undefined, revision: "orders_gc_v1" }), true);
});

test("jagt-stance: spec'ens labels under orders_gc_v1, uændrede labels for legacy (EN + DA)", () => {
  const expected = {
    en: { chase: "Chase", neutral: "Read the race", let_go: "Leave the chase to others" },
    da: { chase: "Jag", neutral: "Vurder undervejs", let_go: "Overlad jagten til andre" },
  } as const;
  for (const stance of ["chase", "neutral", "let_go"] as const) {
    assert.equal(breakawayStanceLabelKey(stance, "legacy"), `tacticsOrders.breakaway.${stance}`);
    assert.equal(breakawayStanceLabelKey(stance, null), `tacticsOrders.breakaway.${stance}`);
    const key = breakawayStanceLabelKey(stance, "orders_gc_v1");
    assert.equal(key, `tacticsOrders.ordersGc.stance.${stance}`);
    for (const lang of ["en", "da"] as const) assert.equal(at(locales[lang], key), expected[lang][stance]);
  }
});

const names = new Map([["gc", "Ada Leader"], ["t1", "Bo Rival"], ["t2", "Cy Rival"]]);
const nameOf = (id: unknown) => names.get(String(id)) ?? null;
const reaction = (params: Record<string, unknown>) => ({ km: 40, type: "gc_reaction", params: { team_id: "team-x", ...params } });

test("filmlinjer: hver kvittering fra motoren får sin nøgle, uden tal", () => {
  assert.deepEqual(
    describeGcReactionEvent(reaction({ status: "started", reason: "rival_ahead", protected_rider_id: "gc", rider_ids: ["t1", "t2"] }), nameOf),
    { key: "gc_reaction_started_threat", params: { rider: "Ada Leader", threats: "Bo Rival, Cy Rival", count: 2 } },
  );
  assert.deepEqual(
    describeGcReactionEvent(reaction({ status: "started", reason: "rival_ahead", protected_rider_id: "gc", rider_ids: ["ukendt"] }), nameOf),
    { key: "gc_reaction_started", params: { rider: "Ada Leader" } },
  );
  assert.equal(describeGcReactionEvent(reaction({ status: "stopped", reason: "contained", protected_rider_id: "gc" }), nameOf)?.key, "gc_reaction_contained");
  assert.equal(describeGcReactionEvent(reaction({ status: "stopped", reason: "rival_close", protected_rider_id: "gc" }), nameOf)?.key, "gc_reaction_stopped");
  assert.equal(describeGcReactionEvent(reaction({ status: "exhausted", reason: "budget_exhausted", protected_rider_id: "gc" }), nameOf)?.key, "gc_reaction_exhausted");
  assert.equal(describeGcReactionEvent(reaction({ status: "unavailable", reason: "no_workers", protected_rider_id: "gc" }), nameOf)?.key, "gc_reaction_no_workers");
  assert.deepEqual(describeGcReactionEvent({ km: 0, type: "gc_context", params: { status: "missing" } }, nameOf), { key: "gc_context_missing", params: {} });
});

test("filmlinjer: intet opdigtet. Ukendt navn, ukendt status og normal GC-kontekst giver ingen linje", () => {
  assert.equal(describeGcReactionEvent(reaction({ status: "started", protected_rider_id: "ukendt" }), nameOf), null);
  assert.equal(describeGcReactionEvent(reaction({ status: "started" }), nameOf), null);
  assert.equal(describeGcReactionEvent(reaction({ status: "noget_nyt", protected_rider_id: "gc" }), nameOf), null);
  for (const status of ["standings", "first_stage", "one_day"]) {
    assert.equal(describeGcReactionEvent({ type: "gc_context", params: { status } }, nameOf), null, status);
  }
  assert.equal(describeGcReactionEvent({ type: "breakaway_formed", params: {} }, nameOf), null);
  assert.equal(describeGcReactionEvent(null, nameOf), null);
});

test("løbsfilmen: describeEvent og collectRiderIds kender gc_reaction/gc_context", () => {
  const events = [
    reaction({ status: "started", reason: "rival_ahead", protected_rider_id: "gc", rider_ids: ["t1"] }),
    { km: 0, type: "gc_context", params: { status: "missing" } },
  ];
  const ids = collectRiderIds(events);
  assert.ok(ids.includes("gc") && ids.includes("t1"));
  assert.equal(describeEvent(events[0], { riderNameById: names })?.key, "gc_reaction_started_threat");
  assert.equal(describeEvent(events[1], { riderNameById: names })?.key, "gc_context_missing");
});

test("filmlinjernes tekst findes på begge sprog, uden tal og uden em-dash", () => {
  const keys = [
    "gc_reaction_started", "gc_reaction_started_threat", "gc_reaction_contained", "gc_reaction_stopped",
    "gc_reaction_exhausted", "gc_reaction_no_workers", "gc_context_missing",
  ];
  for (const lang of ["en", "da"] as const) {
    for (const key of keys) {
      const text = at(locales[lang], `detail.film.event.${key}`);
      assert.equal(typeof text, "string", `${lang}:${key}`);
      assert.doesNotMatch(String(text), /\d/, `${lang}:${key} har et tal`);
      assert.doesNotMatch(String(text), /—/, `${lang}:${key} har em-dash`);
    }
    for (const key of ["rulesLabel", "rulesName", "rulesHelp", "stanceLabel", "gcNote", "breakNote"]) {
      assert.equal(typeof at(locales[lang], `tacticsOrders.ordersGc.${key}`), "string", `${lang}:${key}`);
    }
  }
});
