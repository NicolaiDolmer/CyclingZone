// #4819 (ejer-direktiv 4/9 + ejer-valg 8/9) — billeder i forum-indlaeg.
//
// Specen daekker de fire ting ingen anden forum-spec rammer:
//   1. Et indlaeg med tre billeder og et svar med ét renderes fra
//      `images`-feltet, med URL'er bygget mod Storage-bucketen forum-images.
//   2. Editoren uploader FOER submit: efter et valg staar taelleren paa
//      "1 of 3" og forhaandsvisningen peger paa den uploadede sti.
//   3. Fjern-krydset taeller ned igen.
//   4. En forkert filtype afvises i browseren med en laesbar fejl — uden at
//      der bliver sendt et upload.
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage } from "./fixtures.js";
import { installForumImageMocks, FORUM_IMAGE_FIXTURE } from "./forumImageMocks.js";

test.describe("#4819 billeder i forum-indlaeg", () => {
  test("traaden viser billederne paa opslag og svar", async ({ page }) => {
    await installNetworkMocks(page);
    await installForumImageMocks(page);
    await stabilizePage(page);
    await login(page);

    await page.goto("/forum/forum-post-2");
    await expect(page.getByRole("heading", { name: /Deadline Day/ })).toBeVisible();

    const images = page.locator("main img[src*='forum-images']");
    // 3 paa opslaget + 1 paa foerste svar.
    await expect(images).toHaveCount(4);
    await expect(images.first()).toBeVisible();

    // Klik aabner filen i fuld stoerrelse — som et almindeligt link, ikke en
    // lightbox (se ForumImageAttachments.jsx).
    const link = page.locator("main a[href*='forum-images']").first();
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
  });

  test("editoren uploader foer submit, taeller op og ned igen", async ({ page }) => {
    await installNetworkMocks(page);
    await installForumImageMocks(page);
    await stabilizePage(page);
    await login(page);

    await page.goto("/forum");
    await page.getByRole("button", { name: "Nyt opslag" }).click();
    await expect(page.getByText("0 af 3")).toBeVisible();

    await page.locator("input[type=file]").setInputFiles(FORUM_IMAGE_FIXTURE);
    await expect(page.getByText("1 af 3")).toBeVisible();
    await expect(page.locator("img[src*='forum-images']")).toHaveCount(1);

    await page.getByRole("button", { name: "Fjern billede" }).click();
    await expect(page.getByText("0 af 3")).toBeVisible();
    await expect(page.locator("img[src*='forum-images']")).toHaveCount(0);
  });

  test("en forkert filtype afvises i browseren, uden upload", async ({ page }) => {
    await installNetworkMocks(page);
    await installForumImageMocks(page);
    await stabilizePage(page);
    await login(page);

    let uploads = 0;
    await page.route("**/storage/v1/object/forum-images/**", (route) => {
      uploads += 1;
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await page.goto("/forum");
    await page.getByRole("button", { name: "Nyt opslag" }).click();
    await page.locator("input[type=file]").setInputFiles({
      name: "not-an-image.gif",
      mimeType: "image/gif",
      buffer: Buffer.from("GIF89a"),
    });

    await expect(page.getByText(/Den filtype virker ikke her/)).toBeVisible();
    await expect(page.getByText("0 af 3")).toBeVisible();
    expect(uploads).toBe(0);
  });
});
