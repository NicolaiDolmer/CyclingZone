// #7729: et mislykket udbrudsforsøg står i løbsfilmen, med det motoren skrev om hvorfor.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import IntlMessageFormat from "intl-messageformat";
import { buildFilmTimeline, collectRiderIds, describeEvent } from "./stageTimelineFilm.js";

const riderNameById = new Map(["a", "b", "c", "d", "e", "f", "g"].map((id) => [id, `Rider ${id.toUpperCase()}`]));
const teamNameById = new Map([["t1", "Team One"], ["t2", "Team Two"], ["t3", "Team Three"], ["t4", "Team Four"]]);
const attempt = (params) => ({ km: 12, type: "breakaway_attempt", params: { exact_km: 12, ...params } });

test("#7729 the riders left behind are named, with the teams that worked against them", () => {
  const event = attempt({ rider_ids: ["a", "b", "c"], escaped_rider_ids: ["a"], reacting_team_ids: ["t1", "t2"] });
  assert.deepEqual(describeEvent(event, { riderNameById, teamNameById }), {
    key: "breakaway_attempt_failed",
    params: { riders: "Rider B, Rider C", count: 2, others: 0, teamCount: 2, teams: "Team One, Team Two", teamsHead: "Team One", teamLast: "Team Two" },
  });
});

test("#7729 riders who got away never appear as failed, and a clean attempt has no line", () => {
  const event = attempt({ rider_ids: ["a", "b"], escaped_rider_ids: ["a", "b"], reacting_team_ids: ["t1"] });
  assert.equal(describeEvent(event, { riderNameById, teamNameById }), null);
});

test("#7729 a morning with no break says nobody got clear", () => {
  const event = attempt({ rider_ids: ["a"], escaped_rider_ids: [], reacting_team_ids: ["t1"] });
  assert.equal(describeEvent(event, { riderNameById, teamNameById }).key, "breakaway_attempt_none_clear");
});

test("#7729 many teams become a count, and so do teams without a known name", () => {
  const many = attempt({ rider_ids: ["a", "b"], escaped_rider_ids: ["a"], reacting_team_ids: ["t1", "t2", "t3", "t4"] });
  assert.deepEqual(describeEvent(many, { riderNameById, teamNameById }), {
    key: "breakaway_attempt_failed_field",
    params: { riders: "Rider B", count: 1, others: 0, teamCount: 4 },
  });
  const unknown = attempt({ rider_ids: ["a", "b"], escaped_rider_ids: ["a"], reacting_team_ids: ["t1", "gone"] });
  assert.equal(describeEvent(unknown, { riderNameById, teamNameById }).key, "breakaway_attempt_failed_field");
  // Race Centre har ingen holdnavne: linjen er stadig sand, med antallet.
  assert.equal(describeEvent(unknown, { riderNameById }).key, "breakaway_attempt_failed_field");
});

test("#7729 a crowded attempt stays a broadcast line, but your own riders are always named", () => {
  const event = attempt({ rider_ids: ["a", "b", "c", "d", "e", "f", "g"], escaped_rider_ids: ["a"], reacting_team_ids: ["t1"] });
  const others = describeEvent(event, { riderNameById, teamNameById });
  assert.equal(others.params.riders, "Rider B, Rider C, Rider D, Rider E");
  assert.equal(others.params.others, 2);
  assert.equal(others.params.count, 6);
  const mine = describeEvent(event, { riderNameById, teamNameById, ownRiderIds: new Set(["g"]) });
  assert.equal(mine.params.riders, "Rider G, Rider B, Rider C, Rider D");
  assert.equal(mine.params.others, 2);
});

test("#7729 missing data shows no attempt", () => {
  const base = { rider_ids: ["a", "b"], escaped_rider_ids: ["a"], reacting_team_ids: ["t1"] };
  for (const missing of Object.keys(base)) {
    const { [missing]: _gone, ...rest } = base;
    assert.equal(describeEvent(attempt(rest), { riderNameById, teamNameById }), null, missing);
  }
  assert.equal(describeEvent(attempt({ ...base, reacting_team_ids: [] }), { riderNameById, teamNameById }), null);
  assert.equal(describeEvent(attempt(base), { riderNameById: new Map(), teamNameById }), null);
});

test("#7729 the film feed carries the attempt, and the name lookup covers its riders", () => {
  const event = attempt({ rider_ids: ["a", "b"], escaped_rider_ids: ["a"], reacting_team_ids: ["t1"] });
  const formed = { km: 12, type: "breakaway_formed", params: { group_id: "g1", rider_ids: ["a"] } };
  const { feedEvents } = buildFilmTimeline({ events: [event, formed], distanceKm: 100, timelineVersion: 2 });
  assert.deepEqual(feedEvents.map((e) => e.type), ["breakaway_attempt", "breakaway_formed"]);
  assert.deepEqual(collectRiderIds([event]).sort(), ["a", "b"]);
});

test("#7729 every language renders each variant without a raw placeholder", () => {
  const params = { riders: "Rider B", count: 3, others: 2, teamCount: 2, teamsHead: "Team One", teamLast: "Team Two" };
  for (const lang of ["en", "da", "fr", "es", "nl"]) {
    const { detail } = JSON.parse(readFileSync(new URL(`../../public/locales/${lang}/races.json`, import.meta.url), "utf8"));
    for (const key of ["breakaway_attempt_failed", "breakaway_attempt_failed_field", "breakaway_attempt_none_clear", "breakaway_attempt_none_clear_field"]) {
      const text = new IntlMessageFormat(detail.film.event[key], lang).format(params);
      assert.match(String(text), /^Rider B .*2/, `${lang}.${key}`);
      assert.doesNotMatch(String(text), /[{}]/, `${lang}.${key}`);
    }
  }
});
