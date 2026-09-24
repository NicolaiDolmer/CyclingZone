import { test } from "node:test";
import assert from "node:assert/strict";
import { YOUTH_RACES_PATH, youthRacesHref, youthRacesPoolFromSearch, youthRacesSquadFromSearch } from "./youthRoutes.ts";

test("Youth races: ?squad= vælger truppen, ukendt eller manglende giver U23", () => {
  assert.equal(youthRacesSquadFromSearch("?squad=junior"), "junior");
  assert.equal(youthRacesSquadFromSearch("?squad=senior"), "u23");
  assert.equal(youthRacesSquadFromSearch(""), "u23");
});

test("Youth races: ?pool= er et positivt heltal eller null", () => {
  assert.equal(youthRacesPoolFromSearch("?squad=u23&pool=902"), 902);
  assert.equal(youthRacesPoolFromSearch("?pool=abc"), null);
  assert.equal(youthRacesPoolFromSearch("?pool=-1"), null);
  assert.equal(youthRacesPoolFromSearch(""), null);
});

test("youthRacesHref bygger ruten med trup og valgfri gruppe", () => {
  assert.equal(youthRacesHref("u23"), `${YOUTH_RACES_PATH}?squad=u23`);
  assert.equal(youthRacesHref("junior", 911), `${YOUTH_RACES_PATH}?squad=junior&pool=911`);
});
