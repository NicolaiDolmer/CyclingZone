import test from "node:test";
import assert from "node:assert/strict";

import { runMissedGraduateSweep, findMissedGraduates, findPendingWithoutNotification, markGraduationsNotified } from "./missedGraduateSweep.js";
import { GRADUATION, buildGraduationReadyNotification, notifyGraduationReady } from "./academyGraduation.js";
import { notifyTeamOwner } from "./notificationService.js";
import { translate } from "./i18nServer.js";

// ─── Mock-supabase ─────────────────────────────────────────────────────────────
// Samme fire tabeller som stuckAcademyGraduates.test.js (vagtens prædikat læses
// uændret herfra), plus SKRIVE-vejen: academy_graduation.insert.
//
// Hard rule 16: ingen vægur-tid — `now` injiceres i hver test.

function tableQuery(getRows, extra = {}, onIn = () => {}) {
  const filters = [];
  const b = {
    select() { return b; },
    eq(col, val) { filters.push((r) => (r[col] ?? null) === val); return b; },
    not(col, op, val) { if (op === "is") filters.push((r) => (r[col] ?? null) !== val); return b; },
    in(col, vals) { onIn(col, vals); filters.push((r) => vals.includes(r[col])); return b; },
    order() { return b; },
    range(from, to) {
      return Promise.resolve({ data: apply().slice(from, to + 1), error: null });
    },
    // notifyTeamOwner slår holdets ejer op med .single().
    single() { return Promise.resolve({ data: apply()[0] ?? null, error: null }); },
    maybeSingle() { return Promise.resolve({ data: apply()[0] ?? null, error: null }); },
  };
  function apply() { return getRows().filter((r) => filters.every((f) => f(r))); }
  return Object.assign(b, extra);
}

function makeMock({
  activeSeason = { id: "s3", number: 3 },
  riders = [],
  auctions = [],
  graduations = [],
  teams = [{ id: "t-human", user_id: "u-human" }, { id: "t-other", user_id: "u-other" }],
  notifications = [],
  insertError = null,
  updateError = null,
  missingNotifiedColumn = false,
  maxInIds = Infinity,
} = {}) {
  const rec = { inserts: [], inQueries: [], updates: [], selects: [] };
  const query = (table, rows, extra) => tableQuery(rows, extra, (col, ids) => {
    rec.inQueries.push({ table, col, count: ids.length });
    if (ids.length > maxInIds) throw new Error("Bad Request: oversized URL filter");
  });
  const supabase = {
    from(table) {
      if (table === "seasons") {
        const b = {
          select() { return b; },
          eq() { return b; },
          order() { return b; },
          limit() { return b; },
          maybeSingle() { return Promise.resolve({ data: activeSeason, error: null }); },
        };
        return b;
      }
      if (table === "riders") return query(table, () => riders);
      if (table === "auctions") return query(table, () => auctions);
      if (table === "teams") return query(table, () => teams);
      if (table === "notifications") return query(table, () => notifications);
      if (table === "academy_graduation") {
        // #8196: kolonnen findes ikke før migrationen er kørt (42703 på select).
        const columnMissing = { code: "42703", message: "column academy_graduation.notified_at does not exist" };
        const failing = {
          eq() { return failing; }, order() { return failing; }, in() { return failing; },
          range() { return Promise.resolve({ data: null, error: columnMissing }); },
        };
        const base = tableQuery(() => graduations);
        const realSelect = base.select.bind(base);
        return Object.assign(base, {
          select(columns) {
            rec.selects.push(String(columns));
            if (missingNotifiedColumn && String(columns).includes("notified_at")) return failing;
            return realSelect(columns);
          },
          insert(row) {
            rec.inserts.push(row);
            if (insertError) return Promise.resolve({ error: insertError });
            // Skrivningen er synlig for efterfølgende læsninger i SAMME mock, så
            // "kør igen → ingen dublet" tester den ægte idempotens-kæde og ikke
            // bare en tom tabel.
            graduations.push({
              id: `g-${rec.inserts.length}`, rider_id: row.rider_id, team_id: row.team_id,
              season_id: row.season_id, status: row.status, deadline: row.deadline, created_at: row.deadline,
            });
            return Promise.resolve({ error: null });
          },
          // #8196: "sendt"-mærket skrives med update().in("id").is(col, null).
          update(patch) {
            rec.updates.push(patch);
            const filters = [];
            const u = {
              in(col, vals) { filters.push((r) => vals.includes(r[col])); return u; },
              is(col, val) { filters.push((r) => (r[col] ?? null) === val); return u; },
              then(resolve, reject) {
                if (updateError) return Promise.resolve({ error: updateError }).then(resolve, reject);
                for (const r of graduations) if (filters.every((f) => f(r))) Object.assign(r, patch);
                return Promise.resolve({ error: null }).then(resolve, reject);
              },
            };
            return u;
          },
        });
      }
      throw new Error(`uventet tabel: ${table}`);
    },
  };
  return { supabase, rec, teams, notifications, graduations };
}

/**
 * Notify-spion der opfører sig som notifyTeamOwner: den slår holdets ejer op og
 * SKRIVER notifikationsrækken i mocken. Uden den skrivning ville en test ikke
 * kunne skelne "notifikationen nåede frem" fra "den blev aldrig sendt" — og
 * præcis den skelnen er hele #5133-review-punkt 1.
 */
function spyNotify({ teams = [], notifications = [], failOn = () => false } = {}) {
  const calls = [];
  const fn = async (payload) => {
    calls.push(payload);
    if (failOn(payload)) throw new Error("notifikation kaputt");
    const userId = teams.find((t) => t.id === payload.teamId)?.user_id ?? null;
    // Samme kontrakt som notifyUser: uden modtager skrives ingen række.
    if (!userId) return { delivered: false, deduped: false, reason: "missing_user" };
    notifications.push({ user_id: userId, related_id: payload.relatedId, type: payload.type });
    return { delivered: true, deduped: false };
  };
  fn.calls = calls;
  return fn;
}

const NOW = new Date("2026-09-11T08:00:00.000Z");
// ageForSeason(birthdate, 3) = 2026 + 2 − fødselsår.
const bornForSeason3Age = (age) => `${2028 - age}-10-25`;

// Den konkrete rytter fra #5133, flyttet til den nye graduerings-alder: 23 i S3
// (#4619 rykkede det tvungne valg fra 22 til 23, YOUTH_RULES §2.2), menneskehold,
// ingen grad-række.
const MISSED = {
  id: "r-missed", team_id: "t-human", ai_team_id: null,
  firstname: "Missed", lastname: "Graduate",
  is_academy: true, is_retired: false, birthdate: bornForSeason3Age(23),
};
const YOUNG = {
  id: "r-young", team_id: "t-human", ai_team_id: null,
  firstname: "Still", lastname: "Young",
  is_academy: true, is_retired: false, birthdate: bornForSeason3Age(20),
};

const enabled = async () => true;

test("sweep: finder rytter uden grad-række og opretter ÉN pending-række + notifikation", async () => {
  const mock = makeMock({ riders: [MISSED, YOUNG] });
  const notify = spyNotify(mock);
  const res = await runMissedGraduateSweep({ supabase: mock.supabase, now: NOW, isEnabled: enabled, notify });

  assert.equal(res.created, 1);
  assert.equal(res.failed, 0);
  assert.equal(mock.rec.inserts.length, 1);
  assert.equal(mock.rec.inserts[0].rider_id, "r-missed");
  assert.equal(mock.rec.inserts[0].team_id, "t-human");
  assert.equal(mock.rec.inserts[0].season_id, "s3");
  assert.equal(mock.rec.inserts[0].status, "pending");

  // Managerens fulde override-vindue, ikke et udløbet et: deadline = now + 7 dage.
  const expected = new Date(NOW.getTime() + GRADUATION.DEADLINE_DAYS * 86_400_000).toISOString();
  assert.equal(mock.rec.inserts[0].deadline, expected);

  assert.equal(notify.calls.length, 1);
  assert.equal(notify.calls[0].type, "academy_graduation_ready");
  assert.equal(notify.calls[0].teamId, "t-human");
  assert.equal(notify.calls[0].relatedId, "r-missed");
  // Navnet hører til beskeden, ikke titlen — titlen har ingen placeholder.
  assert.equal(notify.calls[0].metadata.messageParams.name, "Missed Graduate");
  assert.equal(notify.calls[0].metadata.riderId, "r-missed");
  assert.equal(notify.calls[0].metadata.titleCode, "notif.academyGraduationReady.title");
  assert.equal(notify.calls[0].metadata.messageCode, "notif.academyGraduationReady.message");
});

test("findPendingWithoutNotification: season-sized UUID filters stay bounded and retain every missing owner", async () => {
  const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const riders = Array.from({ length: 626 }, (_, i) => ({ id: uuid(i + 1), firstname: "Fixture", lastname: String(i) }));
  const teams = riders.map((_, i) => ({ id: uuid(10000 + i), user_id: i === 300 ? null : uuid(20000 + i) }));
  const graduations = riders.map((r, i) => ({ id: uuid(30000 + i), rider_id: r.id, team_id: teams[i].id, season_id: "s5", status: "pending" }));
  const notifications = riders.flatMap((r, i) => [0, 300, 625].includes(i) ? [] : [{
    related_id: r.id, user_id: teams[i].user_id, type: "academy_graduation_ready",
  }]);
  // Delivered to a previous owner is still missing for the current owner.
  notifications.push({ related_id: riders[0].id, user_id: "previous-owner", type: "academy_graduation_ready" });
  const mock = makeMock({ riders, teams, graduations, notifications, maxInIds: 100 });
  const missing = await findPendingWithoutNotification(mock.supabase, { seasonId: "s5" });
  assert.deepEqual(missing.map((m) => m.riderId), [riders[0].id, riders[625].id]);
  assert.equal(missing[1].name, "Fixture 625");
  for (const table of ["teams", "riders", "notifications"]) {
    assert.ok(mock.rec.inQueries.filter((q) => q.table === table).length > 1, `${table} must not use one oversized request`);
  }
});

test("findPendingWithoutNotification: notifications paginate within each bounded filter", async () => {
  const mock = makeMock({
    riders: [MISSED],
    graduations: [{ id: "g-open", rider_id: MISSED.id, team_id: MISSED.team_id, season_id: "s5", status: "pending" }],
    notifications: [
      ...Array.from({ length: 1000 }, () => ({ user_id: "previous-owner", related_id: MISSED.id, type: "academy_graduation_ready" })),
      { user_id: "u-human", related_id: MISSED.id, type: "academy_graduation_ready" },
    ],
    maxInIds: 100,
  });
  assert.deepEqual(await findPendingWithoutNotification(mock.supabase, { seasonId: "s5" }), []);
});

test("notifikations-copy: title + message kommer fra backendMessages, ikke fra en haandskrevet streng", () => {
  const payload = buildGraduationReadyNotification({ rider: { id: "r-1", team_id: "t-human", firstname: "Missed", lastname: "Graduate" } });
  // EN-fallbacken udledes af samme noegle som frontend rendrer — de to kan
  // derfor ikke sige noget forskelligt (#4734-kontrakten).
  assert.equal(payload.title, translate("notif.academyGraduationReady.title", {}, { language: "en" }));
  assert.equal(payload.message, translate("notif.academyGraduationReady.message", { name: "Missed Graduate" }, { language: "en" }));
  assert.match(payload.message, /Missed Graduate/);

  // DA findes ogsaa, saa en dansk manager faar dansk tekst i UI'et.
  const da = translate("notif.academyGraduationReady.message", { name: "Missed Graduate" }, { language: "da" });
  assert.match(da, /Missed Graduate/);
  assert.notEqual(da, payload.message);
  assert.doesNotMatch(da, /—/, "ingen em-dash i spiller-vendt copy");
});

test("sweep: anden kørsel opretter ingen dublet", async () => {
  const mock = makeMock({ riders: [MISSED] });
  const notify = spyNotify(mock);
  await runMissedGraduateSweep({ supabase: mock.supabase, now: NOW, isEnabled: enabled, notify });
  const second = await runMissedGraduateSweep({ supabase: mock.supabase, now: NOW, isEnabled: enabled, notify });

  assert.equal(second.created, 0, "anden kørsel opretter intet");
  assert.equal(second.notificationsSent, 0, "notifikationen nåede frem første gang");
  assert.equal(mock.rec.inserts.length, 1, "kun én insert i alt");
  assert.equal(notify.calls.length, 1, "manageren får ikke beskeden to gange");
});

// ─── Review-punkt 1: insert lykkedes, notifikationen kastede ───────────────────
test("sweep: insert ok + notify kaster → næste kørsel eftersender notifikationen uden dublet-række", async () => {
  const mock = makeMock({ riders: [MISSED] });
  // Første kørsel: notifikationen fejler EFTER at rækken er skrevet. Præcis den
  // tilstand gjorde rytteren usynlig for prædikatet (rækken findes) samtidig med
  // at manageren intet vidste.
  const failing = spyNotify({ ...mock, failOn: () => true });
  const first = await runMissedGraduateSweep({ supabase: mock.supabase, now: NOW, isEnabled: enabled, notify: failing });
  assert.equal(mock.rec.inserts.length, 1, "rækken blev skrevet");
  assert.equal(first.failed, 1);
  assert.equal(mock.notifications.length, 0, "manageren fik ingen besked");

  // Rytteren har nu en pending-række med åbent vindue → findMissedGraduates ser
  // ham IKKE. Uden efter-leveringen ville han aldrig blive fanget igen.
  const stillMissed = await findMissedGraduates(mock.supabase, { now: NOW, seasonNumber: 3 });
  assert.equal(stillMissed.missed.length, 0);

  const ok = spyNotify(mock);
  const second = await runMissedGraduateSweep({ supabase: mock.supabase, now: NOW, isEnabled: enabled, notify: ok });

  assert.equal(second.notificationsSent, 1, "den manglende notifikation eftersendes");
  assert.equal(second.created, 0, "ingen ny række");
  assert.equal(mock.rec.inserts.length, 1, "stadig kun én insert i alt");
  assert.equal(ok.calls[0].relatedId, "r-missed");
  assert.equal(ok.calls[0].type, "academy_graduation_ready");

  // Tredje kørsel: notifikationen findes nu, så der sendes ikke igen.
  const third = await runMissedGraduateSweep({ supabase: mock.supabase, now: NOW, isEnabled: enabled, notify: ok });
  assert.equal(third.notificationsSent, 0);
  assert.equal(ok.calls.length, 1, "manageren får den ikke to gange");
});

test("findPendingWithoutNotification: en leveret notifikation til en ANDEN manager tæller ikke", async () => {
  const mock = makeMock({
    riders: [MISSED],
    graduations: [{ id: "g-open", rider_id: "r-missed", team_id: "t-human", season_id: "s3", status: "pending", deadline: "2026-09-15T08:00:00.000Z", created_at: "2026-09-10T08:00:00.000Z" }],
    // Rytteren skiftede hold: beskeden ligger hos den forrige ejer, ikke hos den
    // manager der nu skal træffe valget.
    notifications: [{ user_id: "u-other", related_id: "r-missed", type: "academy_graduation_ready" }],
  });
  const missing = await findPendingWithoutNotification(mock.supabase, { seasonId: "s3" });
  assert.deepEqual(missing.map((m) => m.riderId), ["r-missed"]);
  assert.equal(missing[0].name, "Missed Graduate");
  assert.equal(missing[0].graduationId, "g-open");
});

test("findPendingWithoutNotification: en resolveret række er ikke vores (kun status='pending')", async () => {
  const mock = makeMock({
    riders: [MISSED],
    graduations: [{ id: "g-sold", rider_id: "r-missed", team_id: "t-human", season_id: "s3", status: "sold", deadline: "2026-08-30T18:00:00.000Z", created_at: "2026-08-23T18:00:00.000Z" }],
  });
  assert.deepEqual(await findPendingWithoutNotification(mock.supabase, { seasonId: "s3" }), []);
});

// ─── Review-punkt 2: AI-hold (teams.user_id = null) ───────────────────────────
test("sweep: AI-hold uden manager får stadig sin række, og notifikationen svarer missing_user", async () => {
  const aiRider = { ...MISSED, id: "r-ai", team_id: "t-ai", ai_team_id: "t-ai" };
  const mock = makeMock({ riders: [aiRider], teams: [{ id: "t-ai", user_id: null }] });
  const notify = spyNotify(mock);

  const res = await runMissedGraduateSweep({ supabase: mock.supabase, now: NOW, isEnabled: enabled, notify });

  // Rækken SKAL oprettes: uden den kan det natlige sweep ikke auto-resolvere
  // rytteren ved deadline, og han bliver hængende på AI-holdet for altid.
  assert.equal(res.created, 1);
  assert.equal(res.failed, 0, "manglende modtager er ikke en fejl");
  assert.equal(mock.rec.inserts.length, 1);
  assert.equal(notify.calls.length, 1);
  assert.equal(mock.notifications.length, 0, "ingen notifikationsrække uden en modtager");
});

test("notifyGraduationReady: uden holdejer svarer notifyTeamOwner missing_user og skriver intet", async () => {
  const mock = makeMock({ riders: [], teams: [{ id: "t-ai", user_id: null }] });
  const outcome = await notifyGraduationReady(mock.supabase, {
    rider: { id: "r-ai", team_id: "t-ai", firstname: "AI", lastname: "Graduate" },
    notify: notifyTeamOwner,
  });
  assert.deepEqual(outcome, { delivered: false, deduped: false, reason: "missing_user" });
  assert.equal(mock.notifications.length, 0);
});

test("sweep: AI-holdets række prøves ikke eftersendt hver nat", async () => {
  // Uden user_id kan notifikationen pr. definition ikke leveres. Ville
  // efter-leveringen alligevel forsøge, ville hvert tick sende et kald af sted
  // for en modtager der ikke findes.
  const mock = makeMock({
    riders: [{ ...MISSED, id: "r-ai", team_id: "t-ai" }],
    teams: [{ id: "t-ai", user_id: null }],
    graduations: [{ id: "g-ai", rider_id: "r-ai", team_id: "t-ai", season_id: "s3", status: "pending", deadline: "2026-09-15T08:00:00.000Z", created_at: "2026-09-10T08:00:00.000Z" }],
  });
  assert.deepEqual(await findPendingWithoutNotification(mock.supabase, { seasonId: "s3" }), []);
});

test("sweep: rytter med eksisterende grad-række springes over", async () => {
  // 'sold' uden gennemført salg er #4495's klasse (resolveUnsoldGraduate ejer
  // den) — dette sweep må ikke skrive oven i en anden histories reparation.
  const mock = makeMock({
    riders: [MISSED],
    graduations: [{ id: "g-old", rider_id: "r-missed", team_id: "t-human", season_id: "s3", status: "sold", deadline: "2026-08-30T18:00:00.000Z", created_at: "2026-08-23T18:00:00.000Z" }],
  });
  const res = await runMissedGraduateSweep({ supabase: mock.supabase, now: NOW, isEnabled: enabled, notify: spyNotify(mock) });
  assert.equal(res.created, 0);
  assert.equal(mock.rec.inserts.length, 0);
});

test("sweep: rytter med ÅBENT override-vindue røres ikke", async () => {
  const mock = makeMock({
    riders: [MISSED],
    graduations: [{ id: "g-open", rider_id: "r-missed", team_id: "t-human", season_id: "s3", status: "pending", deadline: "2026-09-15T08:00:00.000Z", created_at: "2026-09-10T08:00:00.000Z" }],
    notifications: [{ user_id: "u-human", related_id: "r-missed", type: "academy_graduation_ready" }],
  });
  const res = await runMissedGraduateSweep({ supabase: mock.supabase, now: NOW, isEnabled: enabled, notify: spyNotify(mock) });
  assert.equal(res.created, 0);
  assert.equal(res.notificationsSent, 0);
  assert.equal(mock.rec.inserts.length, 0);
});

test("sweep: rytter på åben graduate-auktion røres ikke", async () => {
  const mock = makeMock({
    riders: [MISSED],
    auctions: [{ rider_id: "r-missed", status: "active" }],
  });
  const res = await runMissedGraduateSweep({ supabase: mock.supabase, now: NOW, isEnabled: enabled, notify: spyNotify(mock) });
  assert.equal(res.created, 0);
  assert.equal(mock.rec.inserts.length, 0);
});

test("sweep: akademi-fri-agent (team_id NULL) er invariant D's klasse, ikke vores", async () => {
  const stranded = { ...MISSED, id: "r-stranded", team_id: null };
  const mock = makeMock({ riders: [stranded] });
  const res = await runMissedGraduateSweep({ supabase: mock.supabase, now: NOW, isEnabled: enabled, notify: spyNotify(mock) });
  assert.equal(res.created, 0);
  assert.equal(mock.rec.inserts.length, 0);
});

test("sweep: flag OFF → no-op", async () => {
  const mock = makeMock({ riders: [MISSED] });
  const res = await runMissedGraduateSweep({ supabase: mock.supabase, now: NOW, isEnabled: async () => false, notify: spyNotify(mock) });
  assert.equal(res.skipped, "flag_off");
  assert.equal(res.created, 0);
  assert.equal(mock.rec.inserts.length, 0);
});

test("sweep: ingen aktiv sæson → no-op i stedet for et gæt", async () => {
  const mock = makeMock({ riders: [MISSED], activeSeason: null });
  const res = await runMissedGraduateSweep({ supabase: mock.supabase, now: NOW, isEnabled: enabled, notify: spyNotify(mock) });
  assert.equal(res.skipped, "no_active_season");
  assert.equal(mock.rec.inserts.length, 0);
});

test("sweep (dryRun): lister kandidaten med hvad der ville blive oprettet, uden writes", async () => {
  const mock = makeMock({ riders: [MISSED, YOUNG] });
  const notify = spyNotify(mock);
  const res = await runMissedGraduateSweep({ supabase: mock.supabase, now: NOW, dryRun: true, isEnabled: enabled, notify });

  assert.equal(res.created, 0);
  assert.equal(mock.rec.inserts.length, 0);
  assert.equal(notify.calls.length, 0);
  assert.equal(res.candidates.length, 1);
  assert.equal(res.candidates[0].riderId, "r-missed");
  assert.equal(res.candidates[0].teamId, "t-human");
  assert.equal(res.candidates[0].age, 23); // #4619: graduerings-alder 22 -> 23
  assert.equal(res.candidates[0].name, "Missed Graduate");
  assert.equal(res.candidates[0].wouldCreate.season_id, "s3");
  assert.equal(res.candidates[0].wouldCreate.status, "pending");
});

test("sweep (dryRun): manglende notifikationer listes uden at blive sendt", async () => {
  const mock = makeMock({
    riders: [MISSED],
    graduations: [{ id: "g-open", rider_id: "r-missed", team_id: "t-human", season_id: "s3", status: "pending", deadline: "2026-09-15T08:00:00.000Z", created_at: "2026-09-10T08:00:00.000Z" }],
  });
  const notify = spyNotify(mock);
  const res = await runMissedGraduateSweep({ supabase: mock.supabase, now: NOW, dryRun: true, isEnabled: enabled, notify });
  assert.equal(res.missingNotifications.length, 1);
  assert.equal(res.missingNotifications[0].riderId, "r-missed");
  assert.equal(notify.calls.length, 0, "dry-run skriver ikke");
});

test("sweep: unique-violation tælles som duplicate, ikke som fejl", async () => {
  const mock = makeMock({
    riders: [MISSED],
    insertError: { code: "23505", message: "duplicate key value violates unique constraint" },
  });
  const notify = spyNotify(mock);
  const res = await runMissedGraduateSweep({ supabase: mock.supabase, now: NOW, isEnabled: enabled, notify });
  assert.equal(res.created, 0);
  assert.equal(res.duplicates, 1);
  assert.equal(res.failed, 0);
  assert.equal(notify.calls.length, 0);
});

test("sweep: per-rytter fejl isoleres — de øvrige får stadig deres vindue", async () => {
  const other = { ...MISSED, id: "r-other", team_id: "t-other", firstname: "Other", lastname: "Graduate" };
  const mock = makeMock({ riders: [MISSED, other] });
  const notify = spyNotify({ ...mock, failOn: (p) => p.relatedId === "r-missed" });
  const res = await runMissedGraduateSweep({ supabase: mock.supabase, now: NOW, isEnabled: enabled, notify });
  assert.equal(res.failed, 1);
  assert.equal(res.created, 1);
  assert.equal(res.errors[0].riderId, "r-missed");
  assert.equal(res.errors[0].phase, "open_window");
  assert.match(res.errors[0].message, /kaputt/);
  assert.equal(mock.rec.inserts.length, 2);
});

// Importen her er halvdelen af pointen: den beviser at scriptets modulkæde
// loader rent. Et brækket import i et ops-script opdages ellers først når
// nogen kører det mod prod.
test("detect-missed-graduates: holdnavne slås op så dry-run'en kan skelne menneskehold fra AI-hold", async () => {
  const { fetchTeamLabels } = await import("../scripts/detect-missed-graduates.js");
  const supabase = {
    from(table) {
      assert.equal(table, "teams");
      return { select() { return { in(col, ids) {
        assert.equal(col, "id");
        return Promise.resolve({ data: ids.map((id) => ({ id, name: `Team ${id}`, is_ai: id === "t-ai" })), error: null });
      } }; } };
    },
  };
  const labels = await fetchTeamLabels(supabase, ["t-human", "t-ai"]);
  assert.equal(labels.get("t-human").isAi, false);
  assert.equal(labels.get("t-ai").isAi, true);
  assert.equal(labels.get("t-human").name, "Team t-human");

  assert.equal((await fetchTeamLabels(supabase, [])).size, 0, "tom liste rammer ikke databasen");
});

// ─── Review-punkt 3: --execute kræver også --owner-go ─────────────────────────
test("detect-missed-graduates: --execute uden --owner-go afvises", async () => {
  const { parseExecuteArgs } = await import("../scripts/detect-missed-graduates.js");

  const blocked = parseExecuteArgs(["--execute"]);
  assert.equal(blocked.exitCode, 2, "misbrug er en kald-fejl, ikke et 'kandidater fundet'-svar");
  assert.match(blocked.error, /--owner-go/);

  const ok = parseExecuteArgs(["--execute", "--owner-go"]);
  assert.equal(ok.error, null);
  assert.equal(ok.execute, true);
  assert.equal(ok.ownerGo, true);

  const dry = parseExecuteArgs(["--dry-run", "--json"]);
  assert.equal(dry.error, null);
  assert.equal(dry.execute, false);
  assert.equal(dry.jsonOut, true);

  // --owner-go alene er harmløst: uden --execute skriver scriptet intet.
  const lonelyGo = parseExecuteArgs(["--owner-go"]);
  assert.equal(lonelyGo.error, null);
  assert.equal(lonelyGo.execute, false);
});

test("findMissedGraduates: kun ryttere uden nogen grad-række", async () => {
  const resolved = { ...MISSED, id: "r-resolved" };
  const mock = makeMock({
    riders: [MISSED, resolved],
    graduations: [{ id: "g1", rider_id: "r-resolved", team_id: "t-human", season_id: "s3", status: "released", deadline: "2026-08-30T18:00:00.000Z", created_at: "2026-08-23T18:00:00.000Z" }],
  });
  const res = await findMissedGraduates(mock.supabase, { now: NOW, seasonNumber: 3 });
  assert.deepEqual(res.missed.map((m) => m.riderId), ["r-missed"]);
  assert.equal(res.checked, 2);
});

// =====================================================================
// #8196 · en slettet graduerings-besked må ikke sendes igen
// =====================================================================
// Før var notifikations-rækken selv beviset for levering. Slettede manageren
// beskeden, så det natlige sweep rækken som "aldrig notificeret" og eftersendte
// den hver nat, så længe vinduet stod åbent. Mærket bor nu på grad-rækken.

const OPEN_ROW = () => ({
  id: "g-open", rider_id: "r-missed", team_id: "t-human", season_id: "s3", status: "pending",
  deadline: "2026-09-15T08:00:00.000Z", created_at: "2026-09-10T08:00:00.000Z",
});

test("#8196: slettes graduerings-beskeden i indbakken, sender næste nat den IKKE igen", async () => {
  const mock = makeMock({ riders: [MISSED], graduations: [OPEN_ROW()] });
  const notify = spyNotify(mock);

  const first = await runMissedGraduateSweep({ supabase: mock.supabase, now: NOW, isEnabled: enabled, notify });
  assert.equal(first.notificationsSent, 1, "den manglende besked eftersendes");
  assert.equal(mock.graduations[0].notified_at, NOW.toISOString(), "mærket sættes på grad-rækken");

  mock.notifications.length = 0; // manageren sletter beskeden

  const second = await runMissedGraduateSweep({ supabase: mock.supabase, now: NOW, isEnabled: enabled, notify });
  assert.equal(second.notificationsSent, 0);
  assert.equal(notify.calls.length, 1, "ingen ny besked efter sletning");
  assert.deepEqual(second.missingNotifications, []);
});

test("#8196: en besked sendt før mærket (fx af sæsonskiftet) får mærket, så en senere sletning ikke giver en ny", async () => {
  const mock = makeMock({
    riders: [MISSED],
    graduations: [OPEN_ROW()],
    notifications: [{ user_id: "u-human", related_id: "r-missed", type: "academy_graduation_ready" }],
  });
  const notify = spyNotify(mock);

  await runMissedGraduateSweep({ supabase: mock.supabase, now: NOW, isEnabled: enabled, notify });
  assert.equal(notify.calls.length, 0);
  assert.equal(mock.graduations[0].notified_at, NOW.toISOString());

  mock.notifications.length = 0;
  const second = await runMissedGraduateSweep({ supabase: mock.supabase, now: NOW, isEnabled: enabled, notify });
  assert.equal(second.notificationsSent, 0);
  assert.equal(notify.calls.length, 0, "ingen ny besked efter sletning");
});

test("#8196: mangler kolonnen endnu (migration ikke kørt), virker sweepet som før og vælter ikke", async () => {
  const mock = makeMock({ riders: [MISSED], graduations: [OPEN_ROW()], missingNotifiedColumn: true });
  const notify = spyNotify(mock);
  const res = await runMissedGraduateSweep({ supabase: mock.supabase, now: NOW, isEnabled: enabled, notify });
  assert.equal(res.notificationsSent, 1, "det gamle værn gælder: beskeden mangler, så den sendes");
  assert.equal(res.failed, 0);
  assert.deepEqual(res.errors, []);
  assert.equal(mock.rec.updates.length, 0, "ingen skrivning til en kolonne, der ikke findes");
  assert.ok(mock.rec.selects.some((s) => !s.includes("notified_at")), "faldvejen læser uden kolonnen");
});

test("#8196: fejler mærke-skrivningen, er beskeden stadig leveret og sweepet vælter ikke", async () => {
  const mock = makeMock({
    riders: [MISSED], graduations: [OPEN_ROW()],
    updateError: { code: "57014", message: "canceling statement due to statement timeout" },
  });
  const res = await runMissedGraduateSweep({ supabase: mock.supabase, now: NOW, isEnabled: enabled, notify: spyNotify(mock) });
  assert.equal(res.notificationsSent, 1);
  assert.equal(res.failed, 0, "en mærke-fejl er ikke en rytter-fejl");
  assert.equal(res.errors.length, 1);
  assert.equal(res.errors[0].phase, "notified_marker");
  assert.equal(mock.graduations[0].notified_at, undefined);
});

test("#8196: bliver beskeden IKKE leveret, sættes mærket ikke", async () => {
  const mock = makeMock({ riders: [MISSED], graduations: [OPEN_ROW()] });
  const res = await runMissedGraduateSweep({
    supabase: mock.supabase, now: NOW, isEnabled: enabled,
    notify: async () => ({ delivered: false, deduped: false, reason: "missing_user" }),
  });
  assert.equal(res.failed, 0);
  assert.equal(mock.graduations[0].notified_at, undefined, "næste nat må prøve igen");
  assert.equal(mock.rec.updates.length, 0);
});

test("#8196: dry-run sætter intet mærke, heller ikke for en besked der findes", async () => {
  const mock = makeMock({
    riders: [MISSED],
    graduations: [OPEN_ROW()],
    notifications: [{ user_id: "u-human", related_id: "r-missed", type: "academy_graduation_ready" }],
  });
  await runMissedGraduateSweep({ supabase: mock.supabase, now: NOW, dryRun: true, isEnabled: enabled, notify: spyNotify(mock) });
  assert.equal(mock.rec.updates.length, 0);
});

// Codex P2 (#8214): mange id'er opdateres i bidder, og en fejlet bid beholder de mærkede.
test("8196 markGraduationsNotified: opdaterer i bidder og beholder mærker før en fejlet bid", async () => {
  const calls = [];
  const supabase = {
    from: () => ({
      update: () => ({
        in: (_col, chunk) => ({
          is: async () => {
            calls.push(chunk.length);
            return calls.length === 3 ? { error: { message: "boom" } } : { error: null };
          },
        }),
      }),
    }),
  };
  const ids = Array.from({ length: 250 }, (_, i) => `g-${i}`);
  const res = await markGraduationsNotified(supabase, { ids, now: new Date("2026-11-16T09:00:00.000Z") });
  assert.deepEqual(calls, [100, 100, 50]);
  assert.equal(res.marked, 200);
  assert.equal(res.error, "boom");
});
