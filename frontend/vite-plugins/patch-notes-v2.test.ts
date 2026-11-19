// #8049: filerne den nye patch notes-side henter. Størrelsen er selve løftet på issuet
// ("åbning henter under 80 KB patch note-data"), så den låses her og vokser ikke stille.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PATCHES } from "../src/data/patchNotes.js";
import { buildPatchNotesV2Files, buildLangFiles, buildSeenKeys, latestSeenKeyOf, RECENT_WEEKS } from "./patch-notes-v2.ts";
import patchNotesV2Plugin from "./patch-notes-v2.ts";
// @ts-expect-error nummereringsscriptet er ren .mjs uden typer
import { numberFragments, parsePatchesSource, validateFragment } from "../../scripts/patch-notes-number.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(HERE, "..", "src", "data", "patchNotes.js");
const PENDING_DIR = join(HERE, "..", "src", "data", "patch-notes", "pending");

const RECENT_GZIP_BUDGET = 40 * 1024;

test("åbning henter kun recent, under 40 KB pakket pr. sprog", () => {
  const files = buildPatchNotesV2Files(PATCHES);
  for (const lang of ["en", "da"]) {
    const source = files[`patch-notes-data/recent.${lang}.json`];
    assert.ok(source, `recent.${lang}`);
    const gz = gzipSync(source).length;
    assert.ok(gz < RECENT_GZIP_BUDGET, `recent.${lang}.json er ${gz} bytes pakket (budget ${RECENT_GZIP_BUDGET})`);
  }
});

test("recent dækker de seneste 6 uger; index har resten; månederne har alt", () => {
  const files = buildLangFiles(PATCHES, "en");
  const recent = files["recent.en.json"];
  const index = files["index.en.json"];
  const players = PATCHES.flatMap((p) => p.changes.filter((c) => c.audience === "player"));
  assert.equal(recent.items.length + index.items.length, players.length);
  const recentKeys = new Set(recent.items.map((i) => i.k));
  assert.ok(index.items.every((i) => !recentKeys.has(i.k)));
  assert.ok(recent.items.every((i) => i.d >= recent.recentStart));
  assert.ok(index.items.every((i) => i.d < recent.recentStart));
  assert.equal(RECENT_WEEKS, 6);
  const monthTotal = recent.months.reduce((s, m) => s + m.n, 0);
  assert.equal(monthTotal, players.length);
  for (const { m, n } of recent.months) assert.equal(files[`${m}.en.json`].items.length, n, m);
});

test("punkterne bærer ingen interne noter og ingen ukendte felter", () => {
  const { items } = buildLangFiles(PATCHES, "da")["recent.da.json"];
  const allowed = new Set(["k", "v", "d", "s", "a", "c", "r", "f", "ti", "b", "fb", "img", "hl", "rp"]);
  for (const it of items) {
    for (const key of Object.keys(it)) assert.ok(allowed.has(key), `${it.k}: ${key}`);
    assert.ok(it.a, `${it.k} mangler område`);
  }
});

test("seenKey = dato + løbenummer inden for dagen, stigende med versionen", () => {
  const keys = buildSeenKeys([
    { version: "7.10", date: "2026-11-16" },
    { version: "7.9", date: "2026-11-16" },
    { version: "7.8", date: "2026-11-15" },
  ]);
  assert.equal(keys.get("7.9"), "2026-11-16T00:01");
  assert.equal(keys.get("7.10"), "2026-11-16T00:02");
  assert.equal(keys.get("7.8"), "2026-11-15T00:01");
  assert.equal(latestSeenKeyOf([{ version: "7.10", date: "2026-11-16" }, { version: "7.9", date: "2026-11-16" }]), "2026-11-16T00:02");
  // Passer i serverens markør-mønster (backend/lib/seenMarkers6515.js).
  assert.match(latestSeenKeyOf(PATCHES), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
});

// #8346 + #8049: fragmenter (ventende noter) og den nye side skal virke sammen.
// 1) Et fragment, når merge-toget har nummereret det ind i den RIGTIGE patchNotes.js, havner på den
//    nye side med sit eget område. 2) Før det har fået nummer, når det aldrig spillerne.
test("et nummereret fragment ender i recent med sit område og sit løbenummer", () => {
  const fragment = {
    changes: [{
      category: "improved", audience: "player", rollout: "live", topic: "Economy", area: "economy",
      en: { title: "Fragment-test unique EN title", body: "A short body." },
      da: { title: "Fragment-test unik DA-titel", body: "En kort tekst." },
      refs: [8049],
    }],
  };
  const checked = validateFragment("8049-fragment-test.json", JSON.stringify(fragment));
  assert.deepEqual(checked.errors, []);
  const source = readFileSync(DATA_FILE, "utf8");
  const before = parsePatchesSource(source);
  const { source: numbered, assigned } = numberFragments(source, [
    { path: "pending/8049-fragment-test.json", data: checked.data, order: 1, date: "2026-12-01" },
  ]);
  const after = parsePatchesSource(numbered);
  assert.equal(after.length, before.length + 1);
  assert.equal(after[0].version, assigned[0].version);

  for (const lang of ["en", "da"] as const) {
    const recent = buildLangFiles(after, lang)[`recent.${lang}.json`];
    const item = recent.items.find((i: { ti: string }) => i.ti.startsWith(lang === "en" ? "Fragment-test unique" : "Fragment-test unik"));
    assert.ok(item, `${lang}: det nummererede fragment mangler i recent`);
    assert.equal(item.a, "economy");
    assert.equal(item.v, assigned[0].version);
    assert.ok(recent.items.every((i: { a: string }) => i.a), "alle punkter har et område");
  }
});

test("ventende fragmenter i pending/ udsendes aldrig til spillerne", async () => {
  const fragments = readdirSync(PENDING_DIR).filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(PENDING_DIR, f), "utf8")));
  // Pluginet læser kun den nummererede patchNotes.js; ingen kode peger på pending/.
  const pluginSource = readFileSync(join(HERE, "patch-notes-v2.ts"), "utf8");
  assert.doesNotMatch(pluginSource, /patch-notes[\\/]pending|PENDING_DIR/);
  assert.doesNotMatch(readFileSync(join(HERE, "patch-notes-json.js"), "utf8"), /patch-notes[\\/]pending|PENDING_DIR/);

  const plugin = patchNotesV2Plugin() as unknown as {
    configResolved: (c: unknown) => void;
    generateBundle: (this: { emitFile: (f: { fileName: string; source: string }) => void }) => Promise<void>;
  };
  plugin.configResolved({ build: {} });
  const emitted: { fileName: string; source: string }[] = [];
  await plugin.generateBundle.call({ emitFile: (f) => emitted.push(f) });
  assert.ok(emitted.length > 0, "pluginet udsendte ingen filer");
  const all = emitted.map((f) => String(f.source)).join("\n");
  for (const fragment of fragments) {
    for (const change of fragment.changes) {
      for (const lang of ["en", "da"] as const) {
        const title = change[lang]?.title;
        if (title) assert.ok(!all.includes(JSON.stringify(title).slice(1, -1)), `ventende note vist: ${title}`);
      }
    }
  }
});
