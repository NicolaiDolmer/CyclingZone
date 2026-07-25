import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "Card.jsx"), "utf8");

test("Card er hairline (border + cz-card), skarp radius, ingen glow", () => {
  assert.match(src, /border-cz-border/);
  assert.match(src, /bg-cz-card/);
  assert.match(src, /rounded-cz/);
  assert.ok(!/shadow-\[0_0/.test(src), "Card maa ikke have glow");
});

test("Card tager border-farven som prop, ikke via className", () => {
  assert.match(src, /borderClass\s*=\s*"border-cz-border"/, "borderClass skal have hairline som default");
  assert.match(src, /border \$\{borderClass\}/, "base-klassen skal interpolere borderClass");
});

// #2849 bølge 6 forward-guard. Tailwind emitterer `.border-cz-border` EFTER
// `.border-cz-accent-t` og `.border-cz-accent/{30,40}`, så en border-farve sendt
// gennem Cards/Sections `className` taber cascaden og forsvinder TAVST. Det ramte
// 3 rigtige flader (auktionernes "du fører"-markering, Boards udløbne tilbud,
// Transfers' bulk-editor) uden at nogen opdagede det. Brug `borderClass`-proppen.
// Kun `group-hover:`-varianter er undtaget — de emitteres langt senere og vinder.
test("ingen side sender en border-farve til Card/Section via className", () => {
  const srcRoot = join(here, "..", "..");
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith(".jsx")) continue;
      if (full.includes(join("components", "ui"))) continue;
      const text = readFileSync(full, "utf8");
      const re = /<(?:Card|Section)\b[^>]*className="[^"]*(?<!group-hover:)border-cz-(?:accent|success|danger|warning|info)/g;
      if (re.test(text)) offenders.push(full.slice(srcRoot.length + 1));
    }
  };
  walk(srcRoot);
  assert.deepEqual(offenders, [], `send border-farven som borderClass-prop i stedet: ${offenders.join(", ")}`);
});
