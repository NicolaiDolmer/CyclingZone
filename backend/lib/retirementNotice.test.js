// backend/lib/retirementNotice.test.js
//
// #5073 — beviser at pensionsvarslet er en GEMT kendsgerning, ikke et rul der
// køres forfra. De tre ting der skal holde:
//   1) findes frysningen for sæsonen, læses den — også når den er UENIG med det
//      rullet ville sige i dag (det er hele reparationen),
//   2) mangler den, beregnes svaret én gang og skrives ned (lazy freeze),
//   3) cutover-stien (developRiderSeason) læser SAMME svar, så banneret og den
//      faktiske pensionering ikke kan sige to forskellige ting.

import test from "node:test";
import assert from "node:assert/strict";

import {
  RETIREMENT_NOTICE_COLUMNS,
  frozenNoticeFor,
  isInSeededWindow,
  noticeFreezePatch,
  resolveNoticeFromRow,
  resolveRetirementNotice,
} from "./retirementNotice.js";
import { announcedRetirementAfterSeason, developRiderSeason, retirementDecision } from "./riderProgression.js";

// Sæson 3 = referenceår 2028 (LAUNCH_REFERENCE_YEAR 2026 i riderSeasonAge.js).
const S3 = 3;
const bornForAge = (age, season = S3) => `${2026 + season - 1 - age}-06-01`;

// Minimal Supabase-stub: registrerer update-kald uden at røre netværk.
function stubSupabase() {
  const calls = [];
  return {
    calls,
    from(table) {
      const call = { table, patch: null, filters: [] };
      const chain = {
        update(patch) { call.patch = patch; calls.push(call); return chain; },
        eq(col, val) { call.filters.push(["eq", col, val]); return chain; },
        or(expr) { call.filters.push(["or", expr]); return Promise.resolve({ error: null }); },
      };
      return chain;
    },
  };
}

test("#5073: kolonne-listen indeholder alle tre felter (et kaldested må ikke kunne glemme markøren)", () => {
  for (const col of ["retirement_notice_season", "retirement_notice_after_season", "retirement_notice_given_at"]) {
    assert.ok(RETIREMENT_NOTICE_COLUMNS.includes(col), `${col} mangler i RETIREMENT_NOTICE_COLUMNS`);
  }
});

test("#5073: frozenNoticeFor skelner 'nej' fra 'endnu ikke afgjort'", () => {
  // Afgjort, svar ja.
  assert.equal(frozenNoticeFor({ retirement_notice_season: 3, retirement_notice_after_season: 3 }, 3), true);
  // Afgjort, svar nej — markøren står, men ingen sæson at stoppe efter.
  assert.equal(frozenNoticeFor({ retirement_notice_season: 3, retirement_notice_after_season: null }, 3), false);
  // Aldrig afgjort.
  assert.equal(frozenNoticeFor({ retirement_notice_season: null, retirement_notice_after_season: null }, 3), null);
  // Afgjort for en ANDEN sæson — et nej for sæson 2 er ikke et nej for sæson 3.
  assert.equal(frozenNoticeFor({ retirement_notice_season: 2, retirement_notice_after_season: null }, 3), null);
  assert.equal(frozenNoticeFor({ retirement_notice_season: 2, retirement_notice_after_season: 2 }, 3), null);
});

test("#5073: et frosset svar vinder over rullet, også når de er uenige", () => {
  // Find en rytter i vinduet hvor dagens rul siger JA, og frys det modsatte.
  let rider = null;
  for (let i = 0; i < 500 && !rider; i++) {
    const cand = { id: `r-${i}`, birthdate: bornForAge(38) };
    if (announcedRetirementAfterSeason(cand, S3)) rider = cand;
  }
  assert.ok(rider, "kunne ikke finde en rytter hvor dagens rul siger ja");

  const frozenNo = resolveNoticeFromRow(
    { ...rider, retirement_notice_season: S3, retirement_notice_after_season: null, retirement_notice_given_at: null },
    S3,
  );
  assert.equal(frozenNo.announced, false, "frysningen skal slå rullet");
  assert.equal(frozenNo.frozen, true);
  assert.equal(frozenNo.shouldFreeze, false);
  assert.equal(frozenNo.givenAt, null, "et nej har ingen varsel-dato");

  const frozenYes = resolveNoticeFromRow(
    { ...rider, retirement_notice_season: S3, retirement_notice_after_season: S3, retirement_notice_given_at: "2026-08-28T10:00:00.000Z" },
    S3,
  );
  assert.equal(frozenYes.announced, true);
  assert.equal(frozenYes.givenAt, "2026-08-28T10:00:00.000Z");
});

test("#5073: uden frysning beregnes svaret med den gældende regel, og kun vinduet skal fryses", () => {
  const inWindow = { id: "w1", birthdate: bornForAge(37) };
  const below = { id: "y1", birthdate: bornForAge(24) };
  const guaranteed = { id: "g1", birthdate: bornForAge(41) };

  const w = resolveNoticeFromRow(inWindow, S3);
  assert.equal(w.announced, announcedRetirementAfterSeason(inWindow, S3));
  assert.equal(w.frozen, false);
  assert.equal(w.shouldFreeze, true, "i vinduet findes et rul der kan flytte sig — det SKAL fryses");

  // Uden for vinduet er svaret en ren alders-regel: intet at fryse.
  assert.equal(resolveNoticeFromRow(below, S3).announced, false);
  assert.equal(resolveNoticeFromRow(below, S3).shouldFreeze, false);
  assert.equal(resolveNoticeFromRow(guaranteed, S3).announced, true);
  assert.equal(resolveNoticeFromRow(guaranteed, S3).shouldFreeze, false);

  assert.equal(isInSeededWindow(inWindow, S3), true);
  assert.equal(isInSeededWindow(below, S3), false);
  assert.equal(isInSeededWindow(guaranteed, S3), false);
});

test("#5073: lazy freeze skriver præcis én gang, og kun for ryttere i vinduet", async () => {
  const supabase = stubSupabase();
  const inWindow = { id: "w1", birthdate: bornForAge(37), retirement_notice_season: null, retirement_notice_after_season: null, retirement_notice_given_at: null };

  const res = await resolveRetirementNotice(supabase, inWindow, S3);
  assert.equal(supabase.calls.length, 1, "der skal skrives netop én gang");
  const call = supabase.calls[0];
  assert.equal(call.table, "riders");
  assert.equal(call.patch.retirement_notice_season, S3);
  assert.equal(call.patch.retirement_notice_after_season, res.announced ? S3 : null);
  assert.equal(res.frozen, true, "svaret rapporteres som frosset efter skrivningen");
  // Skrivningen er "først til mølle": aldrig oven i en markør for samme eller
  // en senere sæson, men et forældet svar må gerne erstattes.
  assert.deepEqual(call.filters[0], ["eq", "id", "w1"]);
  assert.match(call.filters[1][1], /retirement_notice_season\.is\.null/);
  assert.match(call.filters[1][1], new RegExp(`retirement_notice_season\\.lt\\.${S3}`));

  // Allerede frosset → ingen skrivning.
  const frozen = { id: "w2", birthdate: bornForAge(37), retirement_notice_season: S3, retirement_notice_after_season: S3, retirement_notice_given_at: "2026-08-28T10:00:00.000Z" };
  await resolveRetirementNotice(supabase, frozen, S3);
  assert.equal(supabase.calls.length, 1, "et allerede givet varsel må ikke overskrives");

  // Uden for vinduet → ingen skrivning.
  await resolveRetirementNotice(supabase, { id: "y1", birthdate: bornForAge(24) }, S3);
  await resolveRetirementNotice(supabase, { id: "g1", birthdate: bornForAge(41) }, S3);
  assert.equal(supabase.calls.length, 1, "uden for vinduet er der intet rul at fryse");
});

test("#5073: en fejlet skrivning ændrer ikke svaret (lazy freeze er non-critical)", async () => {
  const failing = {
    from: () => ({
      update: () => ({ eq: () => ({ or: () => Promise.resolve({ error: { message: "boom" } }) }) }),
    }),
  };
  const rider = { id: "w1", birthdate: bornForAge(37) };
  const res = await resolveRetirementNotice(failing, rider, S3);
  assert.equal(res.announced, announcedRetirementAfterSeason(rider, S3));
  assert.equal(res.frozen, false, "en fejlet skrivning må ikke påstå at svaret er frosset");
});

test("#5073: cutover LÆSER kolonnen i stedet for at rulle igen", () => {
  // Cutover til sæson S3+1 afgør pensionen for den AFSLUTTEDE sæson S3:
  // developRiderSeason kaldes med age = ageForSeason(birthdate, S3+1) og
  // season = S3+1, og ruller på (age − 1) = alderen i S3.
  const cutoverSeason = S3 + 1;
  const age = 38; // alder i cutover-sæsonen ⇒ 37 i den afsluttede sæson
  const base = { id: "cut-1", primary_type: "climber", potentiale: 3, age };
  const abilities = { climbing: 70, sprint: 50 };
  const caps = { climbing: 80, sprint: 60 };

  const rolled = developRiderSeason(base, abilities, caps, cutoverSeason);
  assert.equal(rolled.retirement.source, "rolled");
  assert.equal(rolled.retirement.retire, retirementDecision(age - 1, base.id, cutoverSeason).retire);

  // Med et frosset svar bruges DET — begge retninger, så testen ikke bare
  // rammer det samme udfald rullet allerede gav.
  for (const frozen of [true, false]) {
    const out = developRiderSeason({ ...base, frozenRetirementNotice: frozen }, abilities, caps, cutoverSeason);
    assert.equal(out.retirement.retire, frozen);
    assert.equal(out.retirement.notice, frozen);
    assert.equal(out.retirement.source, "frozen");
  }

  // null/undefined = intet frosset svar ⇒ nøjagtig samme adfærd som før #5073.
  const nullish = developRiderSeason({ ...base, frozenRetirementNotice: null }, abilities, caps, cutoverSeason);
  assert.equal(nullish.retirement.retire, rolled.retirement.retire);
  assert.equal(nullish.retirement.source, "rolled");
});

test("#5073: banneret og cutover giver samme svar for den samme sæson", () => {
  // Uden frysning gav #2748 allerede den garanti (samme seed-nøgle). Med
  // frysning skal den holde ad en ANDEN vej: begge sider læser samme kolonne.
  const rider = { id: "same-1", birthdate: bornForAge(37) };
  const row = { ...rider, retirement_notice_season: S3, retirement_notice_after_season: S3, retirement_notice_given_at: "2026-08-28T10:00:00.000Z" };

  const banner = resolveNoticeFromRow(row, S3);
  const cutover = developRiderSeason(
    { id: rider.id, primary_type: "climber", potentiale: 3, age: 38, frozenRetirementNotice: frozenNoticeFor(row, S3) },
    { climbing: 70 }, { climbing: 80 }, S3 + 1,
  );
  assert.equal(banner.announced, true);
  assert.equal(cutover.retirement.retire, banner.announced);
});

test("#5073: noticeFreezePatch giver kun en dato når der faktisk er et varsel", () => {
  const now = "2026-09-10T14:00:00.000Z";
  assert.deepEqual(noticeFreezePatch(S3, true, now), {
    retirement_notice_season: S3,
    retirement_notice_after_season: S3,
    retirement_notice_given_at: now,
  });
  assert.deepEqual(noticeFreezePatch(S3, false, now), {
    retirement_notice_season: S3,
    retirement_notice_after_season: null,
    retirement_notice_given_at: null,
  });
});
