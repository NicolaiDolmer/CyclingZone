import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, stabilizePage, login, json, RIVAL_TEAM } from "./fixtures.js";
import { apiResponse } from "../../src/preview/mockHandlers.js";

const longUrl = `https://example.com/${"lang".repeat(500)}`;
const postBody = "Her er ruten: https://cyclingzone.org/forum/abc.\nSe også (https://example.com/a_(b)) og www.example.com.\nHvad tænker du om finalen?";
const replyBody = 'Tak @peloton_pete! https://example.com/?q=1&x=2, javascript:alert(1) <img src=x onerror=1> https://a.dk" onmouseover="x';

async function openThread(page, body = postBody) {
  await installNetworkMocks(page);
  await page.route("**/api/forum/posts/forum-post-2", route => {
    const data = structuredClone(apiResponse("/api/forum/posts/forum-post-2"));
    data.post.title = "Links til ruten og finalen";
    data.post.body = body;
    data.replies = [{ ...data.replies[0], body: replyBody }];
    return json(route, data);
  });
  await stabilizePage(page);
  await login(page);
  await page.goto("/forum/forum-post-2");
  await expect(page.getByRole("heading", { name: "Links til ruten og finalen" })).toBeVisible();
}

test("links i indlaeg og svar er sikre, og mentions bevares", async ({ page }, testInfo) => {
  await openThread(page);
  if (testInfo.project.name === "desktop-chromium") {
    const out = resolve("pr-screens/3517", process.env.FORUM_SHOT_PHASE || "after");
    mkdirSync(out, { recursive: true });
    for (const [name, width, height] of [["mobile", 412, 915], ["desktop", 1280, 900]]) {
      await page.setViewportSize({ width, height });
      await page.screenshot({ path: resolve(out, `${name}.png`), fullPage: true });
    }
  }
  for (const [name, href] of [
    ["https://cyclingzone.org/forum/abc", "https://cyclingzone.org/forum/abc"],
    ["https://example.com/a_(b)", "https://example.com/a_(b)"],
    ["www.example.com", "https://www.example.com/"],
    ["https://example.com/?q=1&x=2", "https://example.com/?q=1&x=2"],
    ["https://a.dk", "https://a.dk/"],
  ]) {
    const link = page.getByRole("link", { name, exact: true });
    await expect(link).toHaveAttribute("href", href);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow ugc");
    await expect(link).not.toHaveAttribute("onmouseover");
  }
  await expect(page.getByRole("link", { name: "@peloton_pete", exact: true })).toHaveAttribute("href", `/managers/${RIVAL_TEAM.id}`);
  await expect(page.locator('a[href^="javascript:"], img[onerror], a a')).toHaveCount(0);
  await expect(page.getByText(/javascript:alert\(1\)/)).toBeVisible();
});

test("meget lang URL giver nul vandret scroll ved 390 px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openThread(page, `En lang rute: ${longUrl}`);
  await expect(page.getByRole("link", { name: longUrl, exact: true })).toHaveAttribute("href", longUrl);
  const overflow = await page.evaluate(() => Math.max(
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ...[...document.querySelectorAll("main, main p")].map(el => el.scrollWidth - el.clientWidth),
  ));
  expect(overflow).toBe(0);
});

test("forumliste og dashboardkort beholder URL-titler som ren tekst", async ({ page }) => {
  await installNetworkMocks(page);
  const excerpt = "Ruten er https://example.com/preview-link.";
  await page.route(/\/api\/forum\/posts(?:\?.*)?$/, route => {
    const data = structuredClone(apiResponse("/api/forum/posts"));
    for (const post of [...data.items, ...data.pinned]) post.title = excerpt;
    return json(route, data);
  });
  await stabilizePage(page);
  await login(page);
  for (const path of ["/forum", "/dashboard"]) {
    await page.goto(path);
    await expect(page.getByText(excerpt, { exact: true }).first()).toBeVisible();
    await expect(page.locator('a[href="https://example.com/preview-link"], a a')).toHaveCount(0);
  }
});
