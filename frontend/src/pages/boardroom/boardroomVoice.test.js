import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import i18next from "i18next";
import ICU from "i18next-icu";

import { visionSpan } from "./boardroomFormat.js";

// #5633 fund 3 (ejer: "udsagnene virker robotagtige") + beta-feedback 19/9 og
// beta-sweep 26/9 (N1 gaeldsmaalet, N4 visionens saesonnumre).
//
// De replikker Boardroom, aarsmoedet og saesondommen faktisk viser, kommer fra
// syv buckets pr. arketype (boardRoom.js, boardMandateMeeting.js,
// routes/boardVerdict.js). De blev omskrevet 26/9, saa de lyder som mennesker i
// klubben. Testene her er forward-guards mod de tre ting, der gjorde dem
// robotagtige:
//   1. engelsk uden sammentraekninger ("I am", "do not", "That is"),
//   2. opfundne fakta, der kan vaere forkerte, naar linjen vises (en bestemt dag,
//      maaned eller tidsperiode, som "today", "this April", "third month running"),
//   3. samme aabning paa tvaers af hele bestyrelsen ("The milestone is reached").

const __dirname = dirname(fileURLToPath(import.meta.url));
const localesRoot = join(__dirname, "..", "..", "..", "public", "locales");
const en = JSON.parse(readFileSync(join(localesRoot, "en", "board.json"), "utf8"));
const da = JSON.parse(readFileSync(join(localesRoot, "da", "board.json"), "utf8"));

const LIVE_BUCKETS = [
  "receipt_positive",
  "receipt_negative",
  "meeting_easier",
  "meeting_keep",
  "meeting_stretch",
  "milestone_achieved",
  "milestone_missed",
];
const ARCHETYPES = Object.keys(en.archetypes);

function liveLines(locale) {
  const out = [];
  for (const archetype of ARCHETYPES) {
    for (const bucket of LIVE_BUCKETS) {
      for (const line of locale.archetypes[archetype].reactions[bucket]) {
        out.push({ archetype, bucket, line });
      }
    }
  }
  return out;
}

test("#5633 EN-replikkerne bruger talesprog: ingen ukontraherede former", () => {
  const STIFF = /\b(I am|I do not|I would|It is|That is|We are|do not|does not|did not|cannot|is not|are not|was not|will not|Let us)\b/;
  const offenders = liveLines(en).filter(({ line }) => STIFF.test(line));
  assert.deepEqual(offenders, [], "robot-engelsk i en live-replik");
});

test("#5633 replikkerne opfinder ikke en dag, maaned eller periode der kan vaere forkert", () => {
  const EN_INVENTED = /\b(today|tonight|yesterday|this week|this month|this April|in April|spring|quarters? in|month running|in a row)\b/i;
  const DA_INVENTED = /(\bi dag\b|\bi nat\b|\bi aften\b|\bi går\b|\bdenne uge\b|\bdenne måned\b|\bi april\b|\bforåret\b|\bforårs|\bkvartaler\b|\bmåned i træk\b)/i;
  const offenders = [
    ...liveLines(en).filter(({ line }) => EN_INVENTED.test(line)),
    ...liveLines(da).filter(({ line }) => DA_INVENTED.test(line)),
  ];
  assert.deepEqual(offenders, []);
});

test("#5633 milestone_achieved paastaar ikke en sejr (bucket'en gaelder alle maaltyper, ogsaa oekonomi og ungdom)", () => {
  const WIN_CLAIM = /\b(we won|won when|wins on the board)\b/i;
  const DA_WIN_CLAIM = /(\bvi vandt\b|\bsejre på tavlen\b)/i;
  const offenders = [
    ...ARCHETYPES.flatMap((a) => en.archetypes[a].reactions.milestone_achieved.filter((l) => WIN_CLAIM.test(l))),
    ...ARCHETYPES.flatMap((a) => da.archetypes[a].reactions.milestone_achieved.filter((l) => DA_WIN_CLAIM.test(l))),
  ];
  assert.deepEqual(offenders, []);
});

test("#5633 ingen aabning deles af mere end tre arketyper i samme bucket", () => {
  for (const bucket of LIVE_BUCKETS) {
    const openers = new Map();
    for (const archetype of ARCHETYPES) {
      const seen = new Set();
      for (const line of en.archetypes[archetype].reactions[bucket]) {
        const opener = line.split(/[\s,.]+/).slice(0, 2).join(" ").toLowerCase();
        if (seen.has(opener)) continue;
        seen.add(opener);
        openers.set(opener, (openers.get(opener) || 0) + 1);
      }
    }
    for (const [opener, count] of openers) {
      assert.ok(count <= 3, `${bucket}: "${opener}" aabner linjer hos ${count} arketyper`);
    }
  }
});

test("#5633 samme antal varianter i en og da (backend vaelger index ud fra antallet)", () => {
  for (const archetype of ARCHETYPES) {
    for (const bucket of LIVE_BUCKETS) {
      assert.equal(
        en.archetypes[archetype].reactions[bucket].length,
        da.archetypes[archetype].reactions[bucket].length,
        `${archetype}.${bucket}`,
      );
    }
  }
});

test("#5633 N1: gaeldsmaalets kvittering matcher reglen (saldo minus laan, ikke loenbudgettet)", () => {
  const enLine = en.goalReceipt.counted.no_outstanding_debt;
  const daLine = da.goalReceipt.counted.no_outstanding_debt;
  assert.doesNotMatch(enLine, /wage/i);
  assert.doesNotMatch(daLine, /løn/i);
  assert.match(enLine, /zero or more/);
  assert.match(daLine, /nul eller mere/);
});

test("#5633 medlemspanelet har ingen pladsholder-etiket og ingen udvikler-sprog", () => {
  for (const locale of [en, da]) {
    assert.equal(locale.boardroom.member.portraitLabel, undefined);
    assert.doesNotMatch(locale.boardroom.member.footerNote, /identit|round|runde/i);
  }
});

test("#5633 aarsmoedets reaktion bruger ikke valg-etiketten som navneord ('backs the easier')", () => {
  assert.doesNotMatch(en.boardroom.meeting.mandate.reactionAttribution, /\{choice\}/);
  assert.doesNotMatch(da.boardroom.meeting.mandate.reactionAttribution, /\{choice\}/);
});

test("#5633 N4 visionSpan: plan-laengde og spaend fra milepaelene", () => {
  assert.deepEqual(
    visionSpan({ startSeason: 3, endSeason: 6, milestones: [{ seasonNumber: 3 }, { seasonNumber: 6 }] }),
    { start: 3, end: 6, seasons: 4 },
  );
  // startSeason = mandatets saeson (4), men en milepael ligger i S3.
  assert.deepEqual(
    visionSpan({ startSeason: 4, endSeason: 5, milestones: [{ seasonNumber: 3 }, { seasonNumber: 4 }, { seasonNumber: 5 }] }),
    { start: 3, end: 5, seasons: 3 },
  );
  assert.deepEqual(visionSpan({ startSeason: null, endSeason: null, milestones: [] }), { start: null, end: null, seasons: null });
  // Uden slut-saeson og uden milepaele med saeson: ingen meta-linje frem for et gaet.
  assert.deepEqual(visionSpan({ startSeason: 2, endSeason: null, milestones: [{ seasonNumber: null }] }), { start: null, end: null, seasons: null });
});

let i18n;
before(async () => {
  i18n = i18next.createInstance();
  await i18n.use(ICU).init({
    lng: "en",
    fallbackLng: false,
    ns: ["board"],
    defaultNS: "board",
    resources: { en: { board: en }, da: { board: da } },
    interpolation: { escapeValue: false },
  });
});

test("#5633 N4 vision-meta renderer plan-laengde + saesoner paa begge sprog", () => {
  const enT = i18n.getFixedT("en", "board");
  const daT = i18n.getFixedT("da", "board");
  assert.equal(enT("boardroom.vision.meta", { seasons: 4 }), "4-season plan");
  assert.equal(enT("boardroom.vision.meta", { seasons: 1 }), "1-season plan");
  assert.equal(daT("boardroom.vision.meta", { seasons: 4 }), "Plan over 4 sæsoner");
  assert.equal(daT("boardroom.vision.meta", { seasons: 1 }), "Plan over 1 sæson");
  assert.equal(enT("boardroom.vision.currentSeasonLabel", { season: 3 }), "Season 3 · You are here");
  assert.equal(daT("boardroom.vision.seasonLabel", { season: 4 }), "Sæson 4");
  assert.equal(enT("boardroom.meeting.mandate.reactionAttribution", { name: "Jørgen Brandt", choice: "stretch" }), "Jørgen Brandt, who owns this goal");
});
