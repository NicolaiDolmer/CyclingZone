import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, json, RIVAL_TEAM, TEST_USER } from "./fixtures.js";

// #5011 (ejer-direktiv 3/9, #4751) — @-tag af en manager i forummet.
//
// Kæden er tre led, og alle tre kan gå i stykker hver for sig:
//   1. teksten rendrer @navn som et klikbart link til managerprofilen
//   2. editoren foreslår navne mens man skriver "@" + 2 tegn, og indsætter
//      det valgte navn i feltet
//   3. notifikationen i indbakken deep-linker til DET INDLÆG tagget stod i
//      (/forum/<postId>#reply-<replyId>), ikke bare til trådens top
//
// Led 3 er det der historisk er gået galt (#4501: 19 typer uden TYPE_CONFIG →
// døde klik i indbakken), så det testes med en rigtig notifikations-row og et
// rigtigt klik, ikke kun med en enhedstest af link-funktionen.
//
// Seedet (svaret med "@peloton_pete" + GET /api/forum/mentionable-managers)
// bor i src/preview/mockHandlers.js.

const MENTION_ROW = {
  id: "notif-forum-mention-1",
  user_id: TEST_USER.id,
  type: "forum_mention",
  title: "You were mentioned",
  message: 'sofie_r mentioned you in "Anyone else saving their sprinters for Deadline Day?"',
  related_id: "forum-post-2",
  is_read: false,
  created_at: "2026-08-06T07:20:00.000Z",
  metadata: {
    titleCode: "notif.forumMention.title",
    titleParams: {},
    messageCode: "notif.forumMention.messageWithTitle",
    messageParams: { author: "sofie_r", postTitle: "Anyone else saving their sprinters for Deadline Day?" },
    postId: "forum-post-2",
    postTitle: "Anyone else saving their sprinters for Deadline Day?",
    replyId: "forum-post-2-r2",
    sourceKey: "reply:forum-post-2-r2",
    authorName: "sofie_r",
  },
};

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
  await login(page);
});

test("@navn i et svar rendres som link til managerprofilen (#5011)", async ({ page }) => {
  await page.goto("/forum/forum-post-2");
  await page.getByRole("heading", { name: /Deadline Day/ }).waitFor();

  const mention = page.getByRole("link", { name: "@peloton_pete" });
  await expect(mention).toBeVisible();
  await expect(mention).toHaveAttribute("href", `/managers/${RIVAL_TEAM.id}`);

  // Navnet må ikke koste teksten omkring sig: resten af svaret står uændret.
  await expect(page.getByText(/Thanks for asking us directly in the game/)).toBeVisible();
});

test("editoren foreslår managernavne ved '@' + 2 tegn og indsætter det valgte (#5011)", async ({ page }) => {
  await page.goto("/forum/forum-post-2");
  await page.getByRole("heading", { name: /Deadline Day/ }).waitFor();

  const editor = page.locator("#forum-reply-body");
  await editor.click();
  await editor.pressSequentially("Good ride @p");
  // Ét tegn er under grænsen — listen må ikke poppe op ved hvert '@'.
  await expect(page.getByRole("listbox")).toBeHidden();

  await editor.pressSequentially("e");
  const list = page.getByRole("listbox");
  await expect(list).toBeVisible();
  const option = list.getByRole("option", { name: "peloton_pete" });
  await expect(option).toBeVisible();

  await option.click();
  await expect(editor).toHaveValue("Good ride @peloton_pete ");
  // Valget lukker listen — det indsatte navn må ikke matche sig selv og blive
  // stående oven på det man skriver videre.
  await expect(page.getByRole("listbox")).toBeHidden();
});

test("Escape lukker forslagslisten uden at røre teksten (#5011)", async ({ page }) => {
  await page.goto("/forum/forum-post-2");
  await page.getByRole("heading", { name: /Deadline Day/ }).waitFor();

  const editor = page.locator("#forum-reply-body");
  await editor.click();
  await editor.pressSequentially("hej @pel");
  await expect(page.getByRole("listbox")).toBeVisible();

  await editor.press("Escape");
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(editor).toHaveValue("hej @pel");
});

test("forum_mention-notifikationen deep-linker til selve svaret (#5011)", async ({ page }) => {
  await page.route("**/rest/v1/notifications**", route => {
    if (route.request().method() !== "GET") return json(route, []);
    return json(route, [MENTION_ROW]);
  });

  await page.goto("/notifications");
  // Bilingual regex: browser-locale afgør fallbackLng-detection i CI.
  const card = page.getByText(/^You were mentioned$|^Du blev nævnt$/);
  await expect(card).toBeVisible();

  await card.click();
  // #reply-<id> er ankeret ForumPostPage allerede bruger til citat-spring
  // (#3517) — beskeden skal lande på det svar den handler om.
  await expect(page).toHaveURL(/\/forum\/forum-post-2#reply-forum-post-2-r2$/);
  await expect(page.getByRole("heading", { name: /Deadline Day/ })).toBeVisible();
});
