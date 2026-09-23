// #5417: "Vis detaljer" på en samlet løbslinje skal åbne løbet, ikke den
// generiske resultat-hub. Rene enhedstests af destinationen + en kildetekst-
// guard på at NotificationsPage faktisk bruger den (frontend-tests kører på
// node --test uden JSX-transform, samme mønster som
// NotificationsPage.stageResultLink.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAggregateLink, type AggregateLinkEntry } from "./aggregateLink.ts";
import { groupNotifications } from "../../lib/groupNotifications.js";
import { aggregateCtaKey } from "../../lib/notificationLink.js";

const here = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(join(here, "..", "..", "pages", "NotificationsPage.jsx"), "utf8");

const RACE_ID = "race-1";

type NotificationRow = ReturnType<typeof row>;
type GroupedEntry = AggregateLinkEntry & { kind: string; type?: string };

function row(id: string, type: string, createdAt: string, metadata: Record<string, unknown> = {}) {
  return { id, type, related_id: RACE_ID, is_read: false, created_at: createdAt, title: type, message: type, metadata };
}

// Første (og eneste) linje i indbakken for rækkerne — samme funktion som siden bruger.
function firstEntry(rows: NotificationRow[]): GroupedEntry {
  const [entry] = groupNotifications(rows) as unknown as GroupedEntry[];
  return entry;
}

test("race_completed-bøtten med resultat som ansigt linker til løbssiden", () => {
  const entry = firstEntry([
    row("n1", "race_result", "2026-09-19T10:00:00Z", { raceId: RACE_ID, messageParams: { race: "Classic" } }),
    row("n2", "career_milestone", "2026-09-19T10:00:05Z", { raceId: RACE_ID, riderId: "rider-1" }),
  ]);
  assert.equal(entry.kind, "aggregate");
  assert.equal(entry.group, "race_completed");
  assert.equal(resolveAggregateLink(entry, "/resultater"), `/races/${RACE_ID}`);
});

test("stage_result + milepæl samme dag linker også til løbssiden", () => {
  const entry = firstEntry([
    row("n1", "stage_result", "2026-09-19T10:00:00Z", { raceId: RACE_ID, stageNumber: 3 }),
    row("n2", "career_milestone", "2026-09-19T10:00:05Z", { raceId: RACE_ID, riderId: "rider-1" }),
  ]);
  assert.equal(resolveAggregateLink(entry, "/resultater"), `/races/${RACE_ID}`);
});

test("bøtte med kun milepæle (intet resultat) går til løbet, ikke én vilkårlig rytterprofil", () => {
  const entry = firstEntry([
    row("n1", "career_milestone", "2026-09-19T10:00:00Z", { raceId: RACE_ID, riderId: "rider-1" }),
    row("n2", "career_milestone", "2026-09-19T10:00:05Z", { raceId: RACE_ID, riderId: "rider-2" }),
  ]);
  assert.equal(entry.type, "career_milestone");
  assert.equal(resolveAggregateLink(entry, "/resultater"), `/races/${RACE_ID}`);
});

test("falder tilbage til metadata.raceId hvis related_id mangler", () => {
  assert.equal(
    resolveAggregateLink({ group: "race_completed", related_id: null, sample_metadata: { raceId: "race-9" } }, "/resultater"),
    "/races/race-9",
  );
});

test("race_completed uden noget løbs-id bruger fallbacken i stedet for et dødt /races/-link", () => {
  assert.equal(resolveAggregateLink({ group: "race_completed", related_id: null, sample_metadata: null }, "/resultater"), "/resultater");
});

test("auktions-bøtterne er uændrede: generisk link og stadig 'Vis auktion'", () => {
  const outbid = { group: "auction_bidding", related_id: "auction-1", sample_metadata: null };
  const bids = { group: "bid_received", related_id: "auction-2", sample_metadata: null };
  assert.equal(resolveAggregateLink(outbid, "/auctions"), "/auctions");
  assert.equal(resolveAggregateLink(bids, "/auctions"), "/auctions");
  assert.equal(aggregateCtaKey(resolveAggregateLink(outbid, "/auctions")), "actions.viewAuction");
});

test("løbs-knappen hedder stadig 'Vis detaljer'", () => {
  assert.equal(aggregateCtaKey(`/races/${RACE_ID}`), "actions.viewDetails");
});

test("NotificationsPage navigerer til resolveAggregateLink, ikke til config.link direkte", () => {
  assert.match(pageSource, /resolveAggregateLink\(entry, config\.link\)/);
  assert.doesNotMatch(pageSource, /navigate\(config\.link\)/);
});
