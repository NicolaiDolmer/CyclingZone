// #7778 · Hvorfor?-knappen skal med på v6-løbssiden som på den nuværende side (#7717).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildV6RowWhy } from "./v6RowWhy.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const base = { enabled: true, storyError: false, storyLoading: false, events: [], story: null, climbs: [], cast: null, routeFits: null };
const row = (status?: "dnf" | "dns") => ({ key: "k", rank: 12, riderId: "a", name: "A", nation: null, gap: null, mine: true, status });

test("v6 Din dag bruger den eksisterende Hvorfor?-komponent og kontakten, ikke en kopi", () => {
  const src = read("./V6YourDay.tsx");
  assert.match(src, /import \{ RiderWhyButton, RiderWhyLine \} from "\.\.\/RiderWhy\.tsx"/);
  assert.match(src, /useRiderWhyEnabled\(/);
  assert.match(src, /<RiderWhyButton /);
  assert.match(src, /<RiderWhyLine /);
});

test("RacePageV6 giver Din dag det den skal bruge til historien", () => {
  const src = read("./RacePageV6.tsx");
  assert.match(src, /<V6YourDay [^>]*raceId=\{raceId\}[^>]*profile=\{profile\}[^>]*stageRoles=\{stageRoles\}/);
});

test("kontakten slukket eller historien i fejl: ingen knap", () => {
  assert.equal(buildV6RowWhy({ ...base, enabled: false }), null);
  assert.equal(buildV6RowWhy({ ...base, storyError: true }), null);
});

test("kontakten tændt: knap pr. række, men ikke ved en ikke-starter", () => {
  const why = buildV6RowWhy({ ...base, storyLoading: true });
  assert.ok(why);
  assert.equal(why.loading, true);
  assert.ok(why.forRow(row()));
  assert.equal(why.forRow(row("dns")), null);
});
