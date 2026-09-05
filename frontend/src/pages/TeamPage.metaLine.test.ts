// #4500 / #4498 forward-guard: de to elementer der baerte appens taetteste
// rage-click-klynger maa ikke falde tilbage til inert tekst.
//
// #4500 (/team): meta-linjen under holdnavnet stod med balancen i
// `text-cz-accent-t`. Guld-tekst er per TASTE §6 fork 3 forbeholdt quiet
// actions og aktiv fane — altsaa appens eget link-signal — men elementet var et
// <span> uden destination. Clarity 25/8-5/9 maalte 225 doede klik og 42 rage
// clicks paa netop den linje. Samme klasse som #1421 ("Loen-tal paa /team —
// rage + dead clicks, forventet drill-down") og samme svar som #3188 gav
// holdnavnet: destinationen findes, saa link i stedet for at fjerne signalet.
//
// #4498 (/riders/:id): switcher-barens hint var strengen "‹ › skift rytter".
// De to glyffer laeste som endnu et par pile-knapper ved siden af de RIGTIGE
// prev/next-knapper, og de er samtidig paa TASTE §3's forbudsliste
// ("Unicode-pile som ikoner (→ ← ↔ ↑ ↓ › «)").
//
// Kilde-regex-guards, samme moenster som NotificationsPage.typeConfigParity:
// frontend-tests koerer paa `node --test` uden DOM/JSX-transform.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const teamPageSource = readFileSync(join(here, "TeamPage.jsx"), "utf8");
const localesDir = join(here, "..", "..", "public", "locales");

// Meta-linjen: <div className="-mt-4 mb-5 flex gap-4 flex-wrap text-sm"> ... </div>
function metaLineBlock(): string {
  const start = teamPageSource.indexOf('<div className="-mt-4 mb-5 flex gap-4 flex-wrap text-sm">');
  assert.notEqual(start, -1, "meta-linjen skal kunne findes i TeamPage.jsx");
  const end = teamPageSource.indexOf("</div>", start);
  assert.notEqual(end, -1);
  return teamPageSource.slice(start, end);
}

test("#4500 balancen paa /team er et link, ikke guld-tekst uden destination", () => {
  const block = metaLineBlock();
  assert.match(
    block,
    /<Link to="\/finance" className="text-cz-accent-t font-mono font-bold/,
    "guld-balancen skal foere til /finance — guld-tekst uden destination var 42 rage clicks",
  );
});

test("#4500 loen pr. saeson og division paa /team har hver sin destination", () => {
  const block = metaLineBlock();
  assert.match(block, /<Link to="\/finance"[^>]*>\{t\("page\.salaryPerSeason"/, "loen/saeson skal foere til /finance");
  assert.match(block, /<Link to="\/standings"[^>]*>\{t\("page\.division"/, "division skal foere til /standings");
});

test("#4500 meta-linjen har ingen tilbagevendende guld-span uden destination", () => {
  const block = metaLineBlock();
  assert.doesNotMatch(
    block,
    /<span className="text-cz-accent-t/,
    "guld-tekst i meta-linjen skal vaere et link — et guld-<span> er en doed affordance",
  );
});

// #4498: begge sprog. Hintet staar mellem to rigtige prev/next-knapper, saa en
// glyf-pil dér er ikke bare et forbudsliste-brud men en falsk knap.
for (const lang of ["en", "da"]) {
  test(`#4498 rytter-switcherens hint bruger ingen glyf-pile (${lang})`, () => {
    const source = readFileSync(join(localesDir, lang, "rider.json"), "utf8");
    const rider = JSON.parse(source);
    const hint: string = rider.profile.switcher.hint;
    assert.doesNotMatch(
      hint,
      /[‹›«»→←↔↑↓]/u,
      `switcher-hintet maa ikke tegne pile som tekst-glyffer, fik: ${hint}`,
    );
    assert.ok(hint.trim().length > 0, "hintet skal stadig sige hvordan man skifter rytter");
  });
}
