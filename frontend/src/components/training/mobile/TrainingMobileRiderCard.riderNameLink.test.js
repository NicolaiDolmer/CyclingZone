// #5735 (spillerforslag, knud_r_flink): rytternavnet i rytter-popup'en (den
// udfoldede raekke fra Today-tabellen, aabnet ved klik paa navn + chevron)
// skal vaere et rigtigt link til profilen, saa ctrl/midterklik aabner en ny
// fane. Kildekode-struktur-guard (samme moenster som
// RaceSelectionPanel.riderProfile.test.js — repoet koerer node --test uden
// DOM-renderer, ingen @testing-library her).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cardSource = readFileSync(join(__dirname, "TrainingMobileRiderCard.tsx"), "utf8");
const todaySource = readFileSync(join(__dirname, "TrainingMobileToday.tsx"), "utf8");

test("#5735 kortet importerer RiderLink (samme profil-link-komponent som resten af appen)", () => {
  assert.match(
    cardSource,
    /import RiderLink from "\.\.\/\.\.\/RiderLink\.jsx";/,
    "navnet skal genbruge den delte RiderLink, ikke en ny <a>-opfindelse",
  );
});

test("#5735 kortet tager imod en riderId-prop (valgfri, default null — bagudkompatibel)", () => {
  assert.match(
    cardSource,
    /riderId\s*=\s*null,/,
    "riderId skal have default null, saa kaldere der endnu ikke sender den ikke braekker",
  );
});

test("#5735 sidehovedets <h3> render'er navnet som et anchor via RiderLink, med id=riderId", () => {
  assert.match(
    cardSource,
    /<h3 className="truncate text-\[15px\] font-semibold text-cz-1">\s*\n\s*<RiderLink id=\{riderId\}[^>]*>\{name\}<\/RiderLink>\s*\n\s*<\/h3>/,
    "navnet skal staa inde i <h3>, wrappet af <RiderLink id={riderId}> — RiderLink renderer selv <Link to=\"/riders/<id>\"> naar id er sat, og falder tilbage til <span> uden id",
  );
});

test("#5735 mobil-traeningssiden sender rytterens id med ind i kortet", () => {
  assert.match(
    todaySource,
    /<TrainingMobileRiderCard\s*\n\s*id=\{detailId\}\s*\n\s*riderId=\{selected\.id\}/,
    "TrainingMobileToday skal sende selected.id som riderId, saa mobil-popup'ens navn faar et rigtigt profil-link",
  );
});
