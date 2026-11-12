// #6584 · butikstekster til Google Play. Grænserne er Googles (support.google.com/googleplay/
// android-developer/answer/9866151, læst 12/11/2026: kort beskrivelse højst 80 tegn; titel højst
// 30 tegn og fuld beskrivelse højst 4000 tegn jf. Play Console), og tonereglerne er projektets
// (docs/TONE_OF_VOICE.md): ingen tankestreg, aldrig "free forever", ingen "we" i brandstemmen,
// ingen døde produktnavne. Uden vagten opdages en for lang tekst først i Play Console.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

type Lang = "en" | "da";
const LIMITS = { title: 30, "short-description": 80, "full-description": 4000 } as const;

function read(lang: Lang, name: keyof typeof LIMITS): string {
  return readFileSync(new URL(`../../../docs/app/play-listing/${lang}/${name}.txt`, import.meta.url), "utf8").replace(/\r?\n$/, "");
}

for (const lang of ["en", "da"] as const) {
  for (const name of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
    test(`${lang}/${name} is within Google's limit`, () => {
      const text = read(lang, name);
      assert.ok(text.length > 0);
      assert.ok(text.length <= LIMITS[name], `${lang}/${name}: ${text.length} tegn, grænsen er ${LIMITS[name]}`);
    });
  }

  test(`${lang} listing follows the tone rules`, () => {
    const all = (Object.keys(LIMITS) as (keyof typeof LIMITS)[]).map((n) => read(lang, n)).join("\n");
    assert.ok(!all.includes("—"), "ingen tankestreg");
    assert.ok(!/free forever|gratis for altid|altid gratis|for evigt gratis/i.test(all), "aldrig 'free forever'");
    assert.ok(!/\b(we|our|us)\b/i.test(all) || lang === "da", "jeg-stemme, ikke 'we'");
    assert.ok(!/\bvi\b/i.test(all) || lang === "en", "jeg-stemme, ikke 'vi'");
    assert.ok(!/premium tier|pro analyst|patron|freemium/i.test(all.replace(/optional premium tier/i, "")), "ingen døde produktnavne");
    assert.match(all, /CZ Pro/, "ærlig om at Pro findes");
    assert.match(all, lang === "en" ? /never gives strength/ : /aldrig styrke/, "Pro giver aldrig styrke");
  });
}

// Codex P2 (#8059): live-tilstanden skriver til <out>/<sprog>/, som main() ikke opretter.
// Første writeFileSync fejlede med ENOENT; writeShot opretter mappen, også for et andet sprog
// første gang.
test("screenshot tool creates the language folder before the first shot", async () => {
  const { mkdtempSync, existsSync, readFileSync: readBack, unlinkSync, rmdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { writeShot } = await import("../../../docs/app/play-listing/tools/take-screenshots.mjs");
  const out = mkdtempSync(join(tmpdir(), "play-shots-"));
  for (const lang of ["en", "da"]) {
    const dir = join(out, lang);
    assert.equal(existsSync(dir), false);
    const path = writeShot(dir, "01-dashboard", Buffer.from("png"));
    assert.equal(readBack(path, "utf8"), "png", `${lang}: billedet blev skrevet`);
    unlinkSync(path);
    rmdirSync(dir);
  }
  rmdirSync(out);
});
