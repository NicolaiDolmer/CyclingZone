import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findDanishLines,
  stripComments,
  stripOpsLogging,
  scan,
  SCANNED_FILES,
  findUnkeyedNotificationCalls,
  scanUnkeyedNotifications,
  compareToBaseline,
  BASELINE_PATH,
} from "./i18n-check-backend-player-strings.mjs";

// #4734 · Guarden er kun noget vaerd hvis den FANGER en bevidst leak og IKKE
// fanger de tre ting der lovligt er danske i backend: kommentarer, ops-logning
// og de dokumenterede undtagelser.

test("fanger en hardkodet dansk streng i spillervendt kode", () => {
  const src = 'const t = { title: "Auktion annulleret på grund af fuldt hold" };\n';
  assert.deepEqual(findDanishLines(src), [1]);
});

test("danske kommentarer taeller ikke", () => {
  const src = "// Vi annullerer auktionen her\nconst a = 1;\n/* flerlinjet\n   dansk forklaring */\nconst b = 2;\n";
  assert.deepEqual(findDanishLines(src), []);
});

test("linjenumre peger paa den rigtige kildelinje efter comment-stripping", () => {
  const src = "/* dansk\n   blok\n   over flere linjer */\nconst ok = 1;\nconst bad = \"forsøg\";\n";
  assert.deepEqual(findDanishLines(src), [5]);
});

test("ops-logning er lovligt dansk — ogsaa flerlinjet", () => {
  const src = [
    'console.error(',
    '  `  ⚠️  Notifikation fejlede for ${id} (ikke-fatal):`,',
    '  err.message',
    ');',
    'const x = 1;',
  ].join("\n");
  assert.deepEqual(findDanishLines(src), []);
});

test("en dansk streng LIGE efter et ops-log-kald fanges stadig", () => {
  const src = 'console.warn("dansk log");\nconst t = "Auktion udløb";\n';
  assert.deepEqual(findDanishLines(src), [2]);
});

test("de dokumenterede undtagelser bevogter stadig resten af filen", () => {
  const rel = "backend/lib/auctionFinalization.js";
  const src = '        description: `Købt på auktion`,\n        title: "Vundet på auktion",\n';
  // description-linjen er undtaget (finance-legacy), title-linjen er ikke.
  assert.deepEqual(findDanishLines(src, rel), [2]);
});

test("stripComments og stripOpsLogging bevarer linjeantallet", () => {
  const src = "/* a\nb */\nconsole.log(\n  1\n);\nx\n";
  assert.equal(stripOpsLogging(stripComments(src)).split("\n").length, src.split("\n").length);
});

test("repoet er groent, og guarden peger paa filer der findes", () => {
  const { leaks, missing } = scan();
  assert.deepEqual(missing, [], "SCANNED_FILES peger paa en fil der ikke findes");
  assert.deepEqual(leaks, [], `dansk prosa i ${leaks.map((l) => l.file).join(", ")}`);
  assert.ok(SCANNED_FILES.length >= 5);
});

// #6801 · Del 2: notifikations-kald uden noegle. Fanger det Del 1 ikke ser:
// dansk uden ae/oe/aa, engelsk hardkodet til alle, og filer uden for listen.

test("fanger en positionel notifikation med hardkodet engelsk titel (ingen danske tegn)", () => {
  const src = 'await notifyTeamOwner(teamId, "squad_enforced", "Squad size enforced", lines.join("\\n"), null);\n';
  assert.deepEqual(findUnkeyedNotificationCalls(src).map((h) => h.line), [1]);
});

test("fanger dansk uden ae/oe/aa som Del 1 ikke ser", () => {
  const src = 'notifyUser({ userId, type: "x", title: "Auktion annulleret", message: m });\n';
  assert.equal(findUnkeyedNotificationCalls(src).length, 1);
  assert.deepEqual(findDanishLines(src), []);
});

test("et kald med titleCode/messageCode er noeglet og fanges ikke, selv med EN-fallback", () => {
  const src = [
    "await notifyTeamOwner(teamId, type, 'You won the auction', 'Rider is now on your team', id, {",
    "  titleCode: 'notif.auction.wonTitle',",
    "  messageCode: 'notif.auction.wonMessage',",
    "});",
  ].join("\n");
  assert.deepEqual(findUnkeyedNotificationCalls(src), []);
});

test("kald uden prosa (type-konstanter, payload-variable) fanges ikke", () => {
  const src = 'await notifyTeamOwner(teamId, payload.type, payload.title, payload.message, id, payload.metadata);\nnotify(userId, "auction_won", t, m);\n';
  assert.deepEqual(findUnkeyedNotificationCalls(src), []);
});

test("flerlinjede kald og ${}-udtryk med parenteser i template-strenge taeller korrekt", () => {
  const src = [
    "const a = 1;",
    "await notifyTeamOwner(",
    "  id,",
    '  "bid_received",',
    '  "New bid",',
    "  `${fmt(x)} placed a bid (auto)`,",
    "  rid,",
    ");",
    "const b = fn(2);",
  ].join("\n");
  assert.deepEqual(findUnkeyedNotificationCalls(src).map((h) => h.line), [2]);
});

test("kommentarer og funktions-definitioner med notify-navn giver ingen falske fund", () => {
  const src = [
    '// notifyUser(a, "x", "Dette er en kommentar", "med prosa")',
    "async function notifyTeamOwner(teamId, type, title, message, relatedId = null, metadata = null) {",
    "  return 1;",
    "}",
  ].join("\n");
  assert.deepEqual(findUnkeyedNotificationCalls(src), []);
});

test("metodekald paa objekter (obj.notify(...)) ignoreres", () => {
  const src = 'emitter.notify("hello world", "second words");\n';
  assert.deepEqual(findUnkeyedNotificationCalls(src), []);
});

test("compareToBaseline: nye kald fejler, faerre kald er stale, lige mange er groent", () => {
  const perFile = {
    "backend/lib/a.js": [{ line: 1 }, { line: 2 }],
    "backend/lib/b.js": [{ line: 3 }],
    "backend/lib/new.js": [{ line: 4 }],
  };
  const { added, stale } = compareToBaseline(perFile, {
    "backend/lib/a.js": 2,
    "backend/lib/b.js": 3,
    "backend/lib/gone.js": 1,
  });
  assert.deepEqual(added.map((a) => a.file), ["backend/lib/new.js"]);
  assert.deepEqual(stale.map((s) => s.file).sort(), ["backend/lib/b.js", "backend/lib/gone.js"]);
});

test("scanUnkeyedNotifications scanner lib, routes og cron.js men springer tests over", () => {
  const root = mkdtempSync(join(tmpdir(), "bps-"));
  try {
    mkdirSync(join(root, "backend", "lib"), { recursive: true });
    mkdirSync(join(root, "backend", "routes"), { recursive: true });
    const bad = 'notifyUser({ title: "Hello there friend", message: "Second words here" });\n';
    writeFileSync(join(root, "backend", "lib", "x.js"), bad);
    writeFileSync(join(root, "backend", "lib", "x.test.js"), bad);
    writeFileSync(join(root, "backend", "routes", "r.js"), bad);
    writeFileSync(join(root, "backend", "cron.js"), bad);
    const found = Object.keys(scanUnkeyedNotifications({ root })).sort();
    assert.deepEqual(found, ["backend/cron.js", "backend/lib/x.js", "backend/routes/r.js"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("repoet matcher baselinen (ingen nye hardkodede notifikations-kald)", () => {
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")).files;
  const { added } = compareToBaseline(scanUnkeyedNotifications(), baseline);
  assert.deepEqual(
    added.map((a) => `${a.file} (${a.count} > ${a.allowed})`),
    [],
    "nyt notifikations-kald med hardkodet tekst: giv det en noegle (se scriptets fejlbesked)",
  );
});

test("et kald med kun den ene kode fanges stadig (Codex #6810)", () => {
  const src = 'notifyUser({ userId, titleCode: "notif.x.title", message: "Hard coded player message" });\n';
  assert.equal(findUnkeyedNotificationCalls(src).length, 1);
});

test("en navngiven titel med titleCode og en variabel besked er noeglet pr. felt", () => {
  const src = 'notify({ userId, title: "Reply from the developer", message: trimmed, metadata: { titleCode: "notif.x.title" } });\n';
  assert.deepEqual(findUnkeyedNotificationCalls(src), []);
});

test("positionelt kald med kun den ene kode fanges", () => {
  const src = "await notifyTeamOwner(teamId, type, 'You won the auction', 'Rider is now on your team', id, { titleCode: 'notif.a.t' });\n";
  assert.equal(findUnkeyedNotificationCalls(src).length, 1);
});
