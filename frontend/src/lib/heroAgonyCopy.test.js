// Hero & Agony (#3397) — unit-tests for moment → i18n-key/params bridging.
import test from "node:test";
import assert from "node:assert/strict";
import { heroAgonyCopyFor, heroAgonyHeadlineFor, heroAgonyEyebrowKeyFor } from "./heroAgonyCopy.js";

function moment(overrides = {}) {
  return { kind: "sprint_win", tone: "triumph", dramaScore: 85, riderId: "r1", riderName: "Rider One", teamId: null, teamName: null, params: {}, ...overrides };
}

test("heroAgonyCopyFor: null moment giver null", () => {
  assert.equal(heroAgonyCopyFor(null), null);
});

test("close_win: finite gapSeconds bruger den detaljerede nøgle, ellers generic", () => {
  const withSeconds = heroAgonyCopyFor(moment({ kind: "close_win", params: { gapSeconds: 3 } }));
  assert.equal(withSeconds.key, "close_win");
  assert.equal(withSeconds.params.seconds, 3);

  const withoutSeconds = heroAgonyCopyFor(moment({ kind: "close_win", params: { gapSeconds: null } }));
  assert.equal(withoutSeconds.key, "close_win_generic");
  assert.equal(withoutSeconds.params.seconds, undefined);
});

test("incident_time_loss: samme finite/generic-branching som close_win", () => {
  const withSeconds = heroAgonyCopyFor(moment({ kind: "incident_time_loss", params: { kind: "crash", seconds: 47 } }));
  assert.equal(withSeconds.key, "incident_time_loss");
  assert.equal(withSeconds.params.seconds, 47);
  assert.equal(withSeconds.params.kind, "crash");

  const withoutSeconds = heroAgonyCopyFor(moment({ kind: "incident_time_loss", params: { kind: "mechanical", seconds: null } }));
  assert.equal(withoutSeconds.key, "incident_time_loss_generic");
});

test("gc_takeover_won/lost: navne falder tilbage til em-dash-glyf hvis mangler", () => {
  const won = heroAgonyCopyFor(moment({ kind: "gc_takeover_won", params: {} }));
  assert.equal(won.params.previousLeader, "—");
  const lost = heroAgonyCopyFor(moment({ kind: "gc_takeover_lost", params: {} }));
  assert.equal(lost.params.newLeader, "—");
});

test("team_day bruger teamName, ikke riderName", () => {
  const c = heroAgonyCopyFor(moment({ kind: "team_day", teamName: "Team Alpha", params: { count: 3 } }));
  assert.equal(c.params.team, "Team Alpha");
  assert.equal(c.params.count, 3);
});

test("ukendt kind giver null (degraderer ærligt)", () => {
  assert.equal(heroAgonyCopyFor(moment({ kind: "some_future_kind" })), null);
});

test("heroAgonyHeadlineFor: team_day viser holdnavn, alt andet rytternavn", () => {
  assert.equal(heroAgonyHeadlineFor(moment({ kind: "team_day", teamName: "Team Alpha", riderName: null })), "Team Alpha");
  assert.equal(heroAgonyHeadlineFor(moment({ kind: "sprint_win", riderName: "Rider One" })), "Rider One");
  assert.equal(heroAgonyHeadlineFor(null), "");
});

test("heroAgonyEyebrowKeyFor: tone → hero/agony/moment", () => {
  assert.equal(heroAgonyEyebrowKeyFor(moment({ tone: "triumph" })), "hero");
  assert.equal(heroAgonyEyebrowKeyFor(moment({ tone: "agony" })), "agony");
  assert.equal(heroAgonyEyebrowKeyFor(moment({ tone: "neutral" })), "moment");
  assert.equal(heroAgonyEyebrowKeyFor(null), "moment");
});
