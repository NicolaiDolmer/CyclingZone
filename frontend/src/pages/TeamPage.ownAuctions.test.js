import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #2183 — Egen holdside skal vise en tydelig indikator når egne ryttere er
// under aktiv auktion (badge + højeste bud + tid tilbage + link til
// auktionen), i stedet for at manageren selv skal opdage det på /auctions.

const __dirname = dirname(fileURLToPath(import.meta.url));
const teamPageSource = readFileSync(join(__dirname, "TeamPage.jsx"), "utf8");

test("TeamPage henter aktive/forlængede auktioner på egne ryttere (#2183)", () => {
  assert.match(
    teamPageSource,
    /\.from\("auctions"\)\s*\.select\("id, rider_id, current_price, calculated_end, status, is_flash"\)/,
    "loadOwnAuctions skal selecte de felter badget/tooltippen viser (pris, sluttid, status)",
  );
  assert.match(
    teamPageSource,
    /\.in\("rider_id", riderIds\)\s*\.in\("status", \["active", "extended"\]\)/,
    "auktions-opslaget skal filtrere på egne rytter-id'er + status active/extended (samme statusser som /auctions)",
  );
});

test("TeamPage kalder loadOwnAuctions fra loadAll (#2183)", () => {
  assert.match(
    teamPageSource,
    /loadOwnAuctions\(currentRiders\.map\(r => r\.id\)\)/,
    "ownAuctions skal genindlæses hver gang loadAll() kører (fx efter en ny auktion er startet fra RiderActionModal)",
  );
});

test("TeamPage abonnerer på realtime-opdateringer for auctions-tabellen (#2183)", () => {
  assert.match(
    teamPageSource,
    /supabase\.channel\("team-own-auctions"\)/,
    "budstatus/tid skal holdes friske uden fuld reload mens manageren står på holdsiden",
  );
});

test("Holdsidens auktions-badge linker til /auctions?tab=my-situation (#2183)", () => {
  assert.match(
    teamPageSource,
    /to="\/auctions\?tab=my-situation"/,
    "badget/banneret skal linke direkte til auktionen (Min situation-fanen, hvor egne solgte ryttere står som sælger)",
  );
});

test("Holdsidens auktions-badge stopper klik-propagation (#2183)", () => {
  // Rækken har sin egen onClick der navigerer til /riders/:id — uden stopPropagation
  // ville et klik på badget navigere til rytterprofilen i stedet for /auctions.
  assert.match(
    teamPageSource,
    /onClick=\{e => e\.stopPropagation\(\)\}[\s\S]{0,80}title=\{t\("team:squad\.ownAuctionTooltip"/,
    "OwnAuctionBadge skal stoppe klik-propagation, ellers navigerer rækkens onClick til rytterprofilen i stedet",
  );
});

test("team.json har i18n-nøgler til egen-auktion-indikatoren i både en og da (#2183)", () => {
  const localesDir = join(__dirname, "..", "..", "public", "locales");
  for (const lng of ["en", "da"]) {
    const teamJson = JSON.parse(readFileSync(join(localesDir, lng, "team.json"), "utf8"));
    assert.equal(
      typeof teamJson?.page?.ownAuctionsBanner,
      "string",
      `${lng}/team.json mangler page.ownAuctionsBanner — sammendrags-banneret viser så en rå i18n-nøgle`,
    );
    assert.equal(
      typeof teamJson?.squad?.ownAuctionTooltip,
      "string",
      `${lng}/team.json mangler squad.ownAuctionTooltip — badgets tooltip viser så en rå i18n-nøgle`,
    );
  }
});
