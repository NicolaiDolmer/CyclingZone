import test from "node:test";
import assert from "node:assert/strict";
import {
  SEVERITY_META,
  pickNoticeCopy,
  pickSeasonChangeNotice,
  bannerNoticesForPath,
  opsNoticeDismissKey,
  readOpsNoticeDismissed,
  writeOpsNoticeDismissed,
} from "./opsNotices.js";

test("pickNoticeCopy: vælger DA når sproget starter med da", () => {
  const notice = { title_en: "Auction lag", title_da: "Auktionslag", body_en: "en-body", body_da: "da-body" };
  assert.deepEqual(pickNoticeCopy(notice, "da"), { title: "Auktionslag", body: "da-body" });
  assert.deepEqual(pickNoticeCopy(notice, "en"), { title: "Auction lag", body: "en-body" });
});

test("pickNoticeCopy: falder tilbage til den anden hvis den valgte er tom", () => {
  const notice = { title_en: "", title_da: "Auktionslag", body_en: "", body_da: "da-body" };
  assert.deepEqual(pickNoticeCopy(notice, "en"), { title: "Auktionslag", body: "da-body" });
});

test("pickNoticeCopy: tomt input giver tomme strenge, ikke undefined", () => {
  assert.deepEqual(pickNoticeCopy(null, "en"), { title: "", body: "" });
  assert.deepEqual(pickNoticeCopy(undefined, "da"), { title: "", body: "" });
});

test("SEVERITY_META: dækker de tre lovlige severity-værdier med en statisk klassestreng hver", () => {
  assert.deepEqual(Object.keys(SEVERITY_META).sort(), ["incident", "info", "warning"]);
  for (const meta of Object.values(SEVERITY_META)) {
    assert.equal(typeof meta.classes, "string");
    assert.ok(meta.classes.length > 0);
    assert.equal(typeof meta.badgeState, "string");
  }
});

test("opsNoticeDismissKey: nøglen er pr. notice, så to notices aldrig deler dismiss-state", () => {
  assert.notEqual(opsNoticeDismissKey("n1"), opsNoticeDismissKey("n2"));
  assert.match(opsNoticeDismissKey("n1"), /n1$/);
});

test("readOpsNoticeDismissed/writeOpsNoticeDismissed: round-trip via localStorage, isoleret pr. id", () => {
  const store = new Map();
  const originalLocalStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  };
  try {
    assert.equal(readOpsNoticeDismissed("n1"), false);
    writeOpsNoticeDismissed("n1");
    assert.equal(readOpsNoticeDismissed("n1"), true);
    assert.equal(readOpsNoticeDismissed("n2"), false);
  } finally {
    globalThis.localStorage = originalLocalStorage;
  }
});

test("readOpsNoticeDismissed: uden id eller uden localStorage fejler stille (false)", () => {
  assert.equal(readOpsNoticeDismissed(null), false);
  assert.equal(readOpsNoticeDismissed(undefined), false);
});

test("pickSeasonChangeNotice (#7153): finder sæsonskifte-banneret på den engelske titel", () => {
  const notices = [
    { id: "a", title_en: "Race delay on stage 3" },
    { id: "b", title_en: "Season change tonight, 20:30-22:30" },
    { id: "c", title_en: "Season change in progress" },
  ];
  assert.equal(pickSeasonChangeNotice(notices)?.id, "b");
  assert.equal(pickSeasonChangeNotice([{ id: "d", title_en: "  season CHANGE in progress" }])?.id, "d");
  assert.equal(pickSeasonChangeNotice([{ id: "e", title_en: "Race control" }]), null);
  assert.equal(pickSeasonChangeNotice(null), null);
});

test("bannerNoticesForPath (#7153): sæsonskiftet vises ikke i topbanneret på dashboardet, men på andre sider", () => {
  const notices = [
    { id: "s", title_en: "Season change tonight, 20:30-22:30" },
    { id: "i", title_en: "Race delay on stage 3" },
  ];
  assert.deepEqual(bannerNoticesForPath(notices, "/dashboard").map((n) => n.id), ["i"]);
  assert.deepEqual(bannerNoticesForPath(notices, "/training").map((n) => n.id), ["s", "i"]);
  assert.deepEqual(bannerNoticesForPath(null, "/dashboard"), []);
});

test("bannerNoticesForPath (#7153, Codex P2): har spilleren skjult Næste træk, bliver sæsonskiftet i topbanneret", () => {
  const notices = [
    { id: "s", title_en: "Season change tonight, 20:30-22:30" },
    { id: "i", title_en: "Race engine paused" },
  ];
  assert.deepEqual(bannerNoticesForPath(notices, "/dashboard", false).map((n) => n.id), ["s", "i"]);
  assert.deepEqual(bannerNoticesForPath(notices, "/dashboard", true).map((n) => n.id), ["i"]);
});
