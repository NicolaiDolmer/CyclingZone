// #5011 — screenshots af @-tag-kæden til PR-review:
//   (a) autocomplete-listen åben i editoren
//   (b) et svar hvor @navnet er rendret klikbart
//   (c) notifikationen i indbakken
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js). Kører mod en kørende preview-server med e2e-netværksmocks;
// forum-seedet bor i src/preview/mockHandlers.js.
//
//   node tests/e2e/5011-forum-mentions.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, json, TEST_USER } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

// Samme row-shape som backend indsætter (notificationService.js's
// buildForumMentionNotification), så billedet viser den ÆGTE tekst.
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

// Player-facing copy reviewes EN-first, saa sproget laases til engelsk.
async function stabilizeEnglish(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cz_lang", "en");
    window.localStorage.setItem("cz_consent_v1", JSON.stringify({
      version: 1, necessary: true, analytics: false, marketing: false,
      email_marketing: false, updated_at: "2026-05-13T00:00:00.000Z",
    }));
    const css = "*, *::before, *::after { animation-duration: 0.001s !important; animation-iteration-count: 1 !important; caret-color: transparent !important; transition-duration: 0s !important; }";
    const inject = () => {
      const style = document.createElement("style");
      style.textContent = css;
      document.head.appendChild(style);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject, { once: true });
    else inject();
  });
}

async function loginEnglish(page) {
  await page.goto("/login");
  await page.getByPlaceholder("you@email.com").waitFor();
  await page.getByPlaceholder("you@email.com").fill(TEST_USER.email);
  await page.getByPlaceholder("••••••••").fill("playwright-password");
  await page.getByRole("button", { name: /^Log in$/ }).click();
  await page.waitForURL(/\/dashboard$/);
}

const BASE = process.argv[2] || "http://127.0.0.1:4995";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../..", "pr-screens/5011"));

// 1280 = dommer-tjeklistens desktop-bredde (TASTE §4). 390 = mobil-bredden
// PR'en skal kunne ses paa (ejeren har Android; webkit er CI-only).
const VIEWPORTS = [
  { name: "desktop-1280", width: 1280, height: 900 },
  { name: "mobile-390", width: 390, height: 844 },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    locale: "en-GB",
  });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await page.route("**/rest/v1/notifications**", route => {
    if (route.request().method() !== "GET") return json(route, []);
    return json(route, [MENTION_ROW]);
  });
  await stabilizeEnglish(page);
  await loginEnglish(page);

  // (b) Traaden: svaret fra sofie_r baerer "@peloton_pete" som klikbart navn.
  await page.goto("/forum/forum-post-2");
  await page.getByRole("heading", { name: /Deadline Day/ }).waitFor();
  await page.getByRole("link", { name: "@peloton_pete" }).waitFor();
  await page.screenshot({ path: resolve(OUT, `thread-mention-${vp.name}.png`), fullPage: true });

  // (a) Autocomplete: "@pel" i svarfeltet aabner navnelisten.
  const editor = page.locator("#forum-reply-body");
  await editor.click();
  await editor.pressSequentially("Good ride @pel");
  await page.getByRole("listbox").waitFor();
  // IKKE fullPage: panelet er `fixed` og foelger viewporten, saa et fullPage-
  // skud ville vise det svaevende et vilkaarligt sted paa den lange side.
  await page.screenshot({ path: resolve(OUT, `autocomplete-${vp.name}.png`) });

  // (c) Indbakken: notifikationen med link til selve svaret.
  await page.goto("/notifications");
  await page.getByText(/^You were mentioned$/).waitFor();
  await page.screenshot({ path: resolve(OUT, `inbox-mention-${vp.name}.png`), fullPage: true });

  await context.close();
}

await browser.close();
console.log(`Screenshots -> ${OUT}`);
