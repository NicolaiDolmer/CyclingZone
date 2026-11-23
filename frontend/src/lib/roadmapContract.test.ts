import test from "node:test";
import assert from "node:assert/strict";
import { categoryCounts, resolveRoadmapCategory, roadmapCategoryLabel } from "./roadmapVoting.js";
import { parseHorizon, horizonRank } from "./roadmapModel.ts";
import { ROADMAP_CATEGORIES, validRoadmapPlan } from "./roadmapAdminModel.ts";
import { formatRoadmapHorizon } from "../components/roadmap/roadmapFormat.ts";

test("admin and player category filters share the taxonomy, including legacy items", () => {
  assert.equal(ROADMAP_CATEGORIES.length, 16);
  assert.equal(resolveRoadmapCategory({ engine: "youth" }), "academy");
  assert.equal(resolveRoadmapCategory({ engine: "races", category: "race_film" }), "races");
  assert.deepEqual(categoryCounts([
    { engine: "races", category: "race_film" },
    { engine: "training", category: "form" },
    { engine: "club", category: "growth" },
  ]), [{ key: "races", count: 1 }, { key: "form", count: 1 }]);
});

test("ISO dates and weeks are stable and real calendar dates", () => {
  assert.deepEqual(parseHorizon("2026-W49"), {
    kind: "week", week: 49, start: "2026-11-30", end: "2026-12-06",
  });
  assert.equal(parseHorizon("2025-W53").kind, "unscheduled");
  assert.equal(parseHorizon("2026-02-29").kind, "unscheduled");
  assert.equal(parseHorizon("2028-02-29").kind, "date");
  assert.equal(parseHorizon("next_week").kind, "unscheduled");
  assert.ok(horizonRank("2026-W49") < horizonRank("2026-12-01"));
  assert.ok(horizonRank("season_6_start") < horizonRank("season_6"));
  assert.equal(formatRoadmapHorizon("2026-W49", "da"), "Uge 49 (30/11-6/12)");
});

test("headings and categories stay translated in all five languages", () => {
  assert.equal(formatRoadmapHorizon("season_6", "fr"), "Saison 6");
  assert.equal(formatRoadmapHorizon("season_6_start", "es"), "Inicio de la temporada 6");
  assert.equal(formatRoadmapHorizon("2026-W49", "nl-NL"), "Week 49 (30/11-6/12)");
  assert.equal(formatRoadmapHorizon("season_6", "de"), "Season 6");
  assert.equal(roadmapCategoryLabel("academy", "fr"), "Académie et jeunes");
  assert.equal(roadmapCategoryLabel("academy", "da-DK"), "Akademi & ungdom");
  assert.equal(roadmapCategoryLabel("academy", "de"), "Academy & youth");
  for (const category of ROADMAP_CATEGORIES) {
    for (const lang of ["da", "en", "es", "fr", "nl"]) {
      assert.ok(roadmapCategoryLabel(category.key, lang), `${category.key} mangler ${lang}`);
    }
  }
});

test("planned needs an issue and a fixed horizon", () => {
  assert.equal(validRoadmapPlan("planned", 8584, "2026-W49"), true);
  assert.equal(validRoadmapPlan("planned", 8584, "season_6_start"), true);
  assert.equal(validRoadmapPlan("planned", null, "season_6"), false);
  assert.equal(validRoadmapPlan("planned", 8584, "unscheduled"), false);
  assert.equal(validRoadmapPlan("planned", 8584, "next_week"), false);
  assert.equal(validRoadmapPlan("active", null, "unscheduled"), true);
});
