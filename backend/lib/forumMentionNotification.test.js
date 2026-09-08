import assert from "node:assert/strict";
import test from "node:test";

import { translate } from "./i18nServer.js";
import {
  FORUM_MENTION_TYPE,
  buildForumMentionNotification,
  notifyForumMention,
  notifyForumMentions,
} from "./notificationService.js";
import { isKnownNotificationType } from "./notificationTypes.js";

// #5011 — indbakke-siden af @-tagget: hvad der står i notifikationen, og de
// tre regler ejeren låste (ingen selv-tag, højst én pr. indlæg pr. bruger,
// ingen ny ved redigering).

const MANAGERS = [
  { userId: "u-nic", teamId: "t-nic", name: "Nicolai" },
  { userId: "u-sky", teamId: "t-sky", name: "Team Sky Racing" },
];

/** Minimal notifications-tabel: kun de kald notifyForumMention laver. */
function fakeNotifications(existing = []) {
  const rows = [...existing];
  const inserted = [];
  const supabase = {
    from(table) {
      assert.equal(table, "notifications");
      const filters = {};
      const builder = {
        select: () => builder,
        eq: (col, val) => { filters[col] = val; return builder; },
        order: () => builder,
        limit: () => Promise.resolve({
          data: rows.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v)),
          error: null,
        }),
        insert: (row) => {
          inserted.push(row);
          rows.push({ ...row, id: `n-${inserted.length}` });
          return {
            select: () => ({ single: () => Promise.resolve({ data: { id: `n-${inserted.length}` }, error: null }) }),
          };
        },
      };
      return builder;
    },
  };
  return { supabase, inserted, rows };
}

test("typen er kendt (paritet med notifications_type_check)", () => {
  assert.equal(FORUM_MENTION_TYPE, "forum_mention");
  assert.ok(isKnownNotificationType(FORUM_MENTION_TYPE));
});

test("payloaden bærer nøgler, dybdelink-data og en EN-fallback udledt af nøglen", () => {
  const payload = buildForumMentionNotification({
    postId: "p1", postTitle: "Tactics for the Alps", replyId: "r7", authorName: "Nicolai",
  });
  assert.equal(payload.type, "forum_mention");
  assert.equal(payload.relatedId, "p1");
  assert.equal(payload.metadata.replyId, "r7");
  assert.equal(payload.metadata.sourceKey, "reply:r7");
  assert.equal(payload.metadata.titleCode, "notif.forumMention.title");
  assert.equal(payload.metadata.messageCode, "notif.forumMention.messageWithTitle");
  // #4734: fallbacken er UDLEDT af nøglen, ikke en parallel streng.
  assert.equal(payload.title, translate("notif.forumMention.title", {}, { language: "en" }));
  assert.match(payload.message, /Nicolai/);
  assert.match(payload.message, /Tactics for the Alps/);
});

test("uden trådtitel bruges den korte besked-nøgle", () => {
  const payload = buildForumMentionNotification({ postId: "p1", postTitle: null, authorName: null });
  assert.equal(payload.metadata.messageCode, "notif.forumMention.message");
  assert.equal(payload.metadata.sourceKey, "post:p1");
  assert.match(payload.message, /Someone/);
});

test("de to nøgler findes på begge sprog og siger noget forskelligt", () => {
  const params = { author: "Nicolai", postTitle: "Alperne" };
  const en = translate("notif.forumMention.messageWithTitle", params, { language: "en" });
  const da = translate("notif.forumMention.messageWithTitle", params, { language: "da" });
  assert.notEqual(en, "notif.forumMention.messageWithTitle");
  assert.notEqual(da, "notif.forumMention.messageWithTitle");
  assert.notEqual(en, da);
  assert.notEqual(translate("notif.forumMention.title", {}, { language: "da" }), "notif.forumMention.title");
});

test("selv-tag sender aldrig — håndhævet i notify, ikke kun ved kaldestedet", async () => {
  const { supabase, inserted } = fakeNotifications();
  const res = await notifyForumMention({
    supabase, mentionedUserId: "u1", authorUserId: "u1", postId: "p1",
  });
  assert.equal(res.delivered, false);
  assert.equal(res.reason, "own_mention");
  assert.equal(inserted.length, 0);
});

test("et tag lander i den taggedes indbakke", async () => {
  const { supabase, inserted } = fakeNotifications();
  const res = await notifyForumMention({
    supabase, mentionedUserId: "u-nic", authorUserId: "u-sky",
    postId: "p1", postTitle: "Alps", replyId: "r1", authorName: "Sky",
  });
  assert.equal(res.delivered, true);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].user_id, "u-nic");
  assert.equal(inserted[0].type, "forum_mention");
  assert.equal(inserted[0].related_id, "p1");
  assert.equal(inserted[0].is_read, false);
  assert.equal(inserted[0].metadata.sourceKey, "reply:r1");
});

test("samme indlæg to gange giver ÉN notifikation — også når den første er læst", async () => {
  const { supabase, inserted } = fakeNotifications([
    {
      id: "old", user_id: "u-nic", type: "forum_mention", related_id: "p1", is_read: true,
      metadata: { sourceKey: "reply:r1" },
    },
  ]);
  const res = await notifyForumMention({
    supabase, mentionedUserId: "u-nic", authorUserId: "u-sky", postId: "p1", replyId: "r1",
  });
  assert.equal(res.delivered, false);
  assert.equal(res.deduped, true);
  assert.equal(inserted.length, 0);
});

test("et ANDET indlæg i samme tråd er ikke en dublet", async () => {
  const { supabase, inserted } = fakeNotifications([
    {
      id: "old", user_id: "u-nic", type: "forum_mention", related_id: "p1", is_read: false,
      metadata: { sourceKey: "reply:r1" },
    },
  ]);
  const res = await notifyForumMention({
    supabase, mentionedUserId: "u-nic", authorUserId: "u-sky", postId: "p1", replyId: "r2",
  });
  assert.equal(res.delivered, true);
  assert.equal(inserted.length, 1);
});

test("notifyForumMentions: to tags → to modtagere, skribenten selv springes over", async () => {
  const { supabase, inserted } = fakeNotifications();
  const res = await notifyForumMentions({
    supabase,
    text: "@Nicolai og @Team Sky Racing — se lige her",
    authorUserId: "u-sky",
    postId: "p1",
    postTitle: "Alps",
    replyId: "r1",
    authorName: "Sky",
    managers: MANAGERS,
  });
  assert.equal(res.delivered, 1);
  assert.deepEqual(inserted.map((r) => r.user_id), ["u-nic"]);
});

test("notifyForumMentions: samme navn to gange giver én notifikation", async () => {
  const { supabase, inserted } = fakeNotifications();
  const res = await notifyForumMentions({
    supabase, text: "@Nicolai ... @nicolai igen", authorUserId: "u-sky",
    postId: "p1", replyId: "r1", managers: MANAGERS,
  });
  assert.equal(res.delivered, 1);
  assert.equal(inserted.length, 1);
});

test("tekst uden '@' rører aldrig databasen", async () => {
  let touched = false;
  const res = await notifyForumMentions({
    supabase: { from() { touched = true; throw new Error("må ikke kaldes"); } },
    text: "helt uden tags", authorUserId: "u-sky", postId: "p1",
  });
  assert.equal(res.delivered, 0);
  assert.equal(touched, false);
});

test("en DB-fejl vælter aldrig indlægget — den bliver til delivered: 0", async () => {
  const res = await notifyForumMentions({
    supabase: { from() { throw new Error("boom"); } },
    text: "@Nicolai", authorUserId: "u-sky", postId: "p1", replyId: "r1",
  });
  assert.equal(res.delivered, 0);
  assert.equal(res.reason, "error");
});
