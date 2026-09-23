import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, stabilizePage, login, json, evidenceShotPath } from "./fixtures.js";
import { apiResponse } from "../../src/preview/mockHandlers.js";

// #5386 (ejer 18/9) — traadens AABNINGSINDLAEG kan nu ogsaa citeres, ikke kun
// svar (#3517 introducerede kun citér-svar). Backend-kontrakten (quoteOp/
// quotes_post, mutex med quoted_reply_id, 400 hvis begge sat, ingen ekstra
// notifikation) er dækket under `node --test` i backend/lib/forum.test.js —
// her testes den synlige kæde: knappen på selve opslaget, request-payloaden
// den rent faktisk sender, og at et EKSISTERENDE citat af aabningsindlaegget
// rendres med samme uddrag+forfatter-shape som et svar-citat og hopper til
// traadens top ved klik (i stedet for til en reply-<id> der ikke findes).

const POST_TITLE = "Anyone else saving their sprinters for Deadline Day?";
const POST_BODY_EXCERPT = "My squad is thin on climbers, but the auction prices this week are brutal.";

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
  await login(page);
});

test("Citér-knappen på opslaget citerer aabningsindlaegget — sender quote_op, ikke quoted_reply_id", async ({ page }, testInfo) => {
  await page.goto("/forum/forum-post-2");
  await expect(page.getByRole("heading", { name: POST_TITLE })).toBeVisible();

  let sentBody: any = null;
  await page.route("**/api/forum/posts/forum-post-2/replies", (route) => {
    sentBody = route.request().postDataJSON();
    return json(route, { ok: true, id: "new-reply-5386", seq: 99 });
  });

  // Samme ghost-knap som på hvert svar — bor nu OGSÅ på selve opslaget.
  // Scopet til opslagets sektion (#forum-post-top), så den ikke forveksles
  // med et svars egen "Citér"-knap.
  const postSection = page.locator("#forum-post-top");
  await expect(postSection.getByRole("button", { name: "Citér" })).toBeVisible();
  await postSection.getByRole("button", { name: "Citér" }).click();

  // Citat-indikatoren over svarfeltet viser aabningsindlaeggets forfatter +
  // uddrag — samme komponent som når man citerer et svar (#3517), bare med
  // opslagets egen forfatter/tekst.
  await expect(page.getByText("Svarer peloton_pete")).toBeVisible();
  await expect(page.getByText(new RegExp(POST_BODY_EXCERPT))).toBeVisible();

  if (testInfo.project.name === "desktop-chromium") {
    await page.screenshot({ path: evidenceShotPath("pr-screens/5386-quote-op-compose-desktop.png"), fullPage: true });
  }

  await page.locator("#forum-reply-body").fill("Enig — lad os style dagen ind i kalenderen.");
  await page.getByRole("button", { name: "Svar", exact: true }).click();

  await expect.poll(() => sentBody).not.toBeNull();
  expect(sentBody.quote_op).toBe(true);
  expect(sentBody.quoted_reply_id).toBeNull();
  expect(sentBody.body).toBe("Enig — lad os style dagen ind i kalenderen.");

  // Citat-indikatoren ryddes straks efter et gennemført svar (samme reset
  // som ved et svar-citat) — den hænger ikke ved til det næste besøg.
  await expect(page.getByText("Svarer peloton_pete")).toBeHidden();
});

test("et EKSISTERENDE citat af aabningsindlaegget vises med samme shape som et svar-citat, og hopper til toppen ved klik", async ({ page }, testInfo) => {
  await page.route("**/api/forum/posts/forum-post-2", (route) => {
    const data = structuredClone(apiResponse("/api/forum/posts/forum-post-2"));
    // #5386: r2 citerer nu aabningsindlaegget i stedet for et andet svar —
    // SAMME shape som getForumPost returnerer for et post-citat (backend/
    // lib/forum.js's shapeQuoted): { id: post.id, removed: false,
    // target: "post", excerpt, author }.
    data.replies[1].quoted = {
      id: data.post.id,
      removed: false,
      target: "post",
      excerpt: data.post.body,
      author: data.post.author,
    };
    return json(route, data);
  });
  // Lav viewport-hoejde: traaden (opslag + poll-plads + 3 svar) er garanteret
  // hoejere end 400px, saa "spring til toppen" faktisk KRAEVER et scroll —
  // ellers kunne testen bestaa selv uden noget spring, hvis hele traaden
  // tilfaeldigvis passede i én skaermfuld.
  await page.setViewportSize({ width: 1000, height: 400 });
  await page.goto("/forum/forum-post-2");
  await expect(page.getByRole("heading", { name: POST_TITLE })).toBeVisible();

  const quotingReply = page.locator("#reply-forum-post-2-r2");
  const quoteBlock = quotingReply.getByRole("button", { name: /Af peloton_pete/ });
  await expect(quoteBlock).toBeVisible();
  await expect(quoteBlock.getByText(new RegExp(POST_BODY_EXCERPT))).toBeVisible();

  if (testInfo.project.name === "desktop-chromium") {
    await page.screenshot({ path: evidenceShotPath("pr-screens/5386-quoted-post-block-desktop.png"), fullPage: true });
  }

  // Scroll traaden ned FØR klikket, så et evt. udeblevet spring ikke bare
  // "tilfældigvis" lader toppen stå synlig.
  await quotingReply.scrollIntoViewIfNeeded();
  await expect(page.locator("#forum-post-top")).not.toBeInViewport();

  await quoteBlock.click();
  await expect(page.locator("#forum-post-top")).toBeInViewport();
});

test("citat-knappen og en eksisterende post-citation virker uden vandret scroll ved 390 px", async ({ page }) => {
  await page.route("**/api/forum/posts/forum-post-2", (route) => {
    const data = structuredClone(apiResponse("/api/forum/posts/forum-post-2"));
    data.replies[1].quoted = {
      id: data.post.id,
      removed: false,
      target: "post",
      excerpt: data.post.body,
      author: data.post.author,
    };
    return json(route, data);
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/forum/forum-post-2");
  await expect(page.getByRole("heading", { name: POST_TITLE })).toBeVisible();

  await expect(page.locator("#forum-post-top").getByRole("button", { name: "Citér" })).toBeVisible();
  await expect(page.locator("#reply-forum-post-2-r2").getByRole("button", { name: /Af peloton_pete/ })).toBeVisible();

  await page.screenshot({ path: evidenceShotPath("pr-screens/5386-quote-op-390.png"), fullPage: true });

  const overflow = await page.evaluate(() => Math.max(
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ...[...document.querySelectorAll("main, main p, main button")].map(el => el.scrollWidth - el.clientWidth),
  ));
  expect(overflow).toBe(0);
});
