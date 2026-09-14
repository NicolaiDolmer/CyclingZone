// #4821 (ejer-løfte 4/9: "det får jeg gjort", thelamba bad om det i #dansk-snak
// 4/9 — "Kan du flytte den transfer tråd jeg nåede at lave") · Admin kan
// flytte en forumtråd til en anden kategori fra selve trådsiden. Denne spec
// dækker præcis det gaten tilføjer:
//
//   1. Ikke-admin ser slet ingen Move-knap (backend håndhæver requireAdmin —
//      knappen er kun der for isAdmin, samme mønster som Pin/Slet).
//   2. Admin kan åbne modalen, vælge en anden kategori og bekræfte — traadens
//      EGEN kategori ("general") er IKKE et valg (at "flytte" til samme sted
//      er ikke en handling, se moveTargetCategories i forumCategories.js).
//   3. Modalen lukker og en toast bekræfter flytningen.
//
// Tager desuden bevis-screenshots (desktop + mobil-390) af den åbne modal til
// PR-body — se evidenceShotPath i fixtures.js.
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, corsHeaders, evidenceShotPath } from "./fixtures.js";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// ForumPostPage læser rollen med supabase.from("users").select("role") —
// mocken registreres OVEN PÅ installNetworkMocks (senest registrerede route vinder).
async function setRole(page, role) {
  await page.route("**/rest/v1/users**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (request.method() !== "GET") return route.fallback();
    const wantsObject = (request.headers().accept || "").includes("vnd.pgrst.object");
    const row = { id: "e2e-user", role };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: corsHeaders(request),
      body: JSON.stringify(wantsObject ? row : [row]),
    });
  });
}

const MOVE_BUTTON = /^(Move|Flyt)$/;
// "forum-post-2" (seedData/mockHandlers): kategori "general", titel om
// transfer-vinduet — samme slags tråd som thelambas oprindelige ønske.
const THREAD_PATH = "/forum/forum-post-2";
const THREAD_HEADING = /Deadline Day/;

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
});

test("ikke-admin ser ingen Move-knap", async ({ page }) => {
  await setRole(page, "user");
  await login(page);
  await page.goto(THREAD_PATH);

  await expect(page.getByRole("heading", { name: THREAD_HEADING })).toBeVisible();
  await expect(page.getByRole("button", { name: MOVE_BUTTON })).toHaveCount(0);
});

test("admin kan flytte traaden til en anden kategori", async ({ page }, testInfo) => {
  await setRole(page, "admin");
  await login(page);
  await page.goto(THREAD_PATH);
  await expect(page.getByRole("heading", { name: THREAD_HEADING })).toBeVisible();

  await page.getByRole("button", { name: MOVE_BUTTON }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const select = dialog.getByRole("combobox");
  // Traaden staar allerede i "general" — den maa IKKE vaere et valg (moveTargetCategories).
  await expect(select.locator("option", { hasText: /^(General|Generelt)$/ })).toHaveCount(0);
  await expect(select.locator("option", { hasText: /^Transfers$/ })).toHaveCount(1);
  await select.selectOption("transfers");

  // Bevis-screenshot af den aabne modal (#3554-moenster) — desktop-chromium
  // og mobile-chromium (393px, tilnaermet ejerens 390px Android) daekker
  // PR-kravet "desktop + 390 px"; webkit-koerslen skriver ikke et billede.
  if (testInfo.project.name !== "mobile-webkit") {
    const out = evidenceShotPath(`pr-screens/4821-forum-move-${testInfo.project.name}.png`);
    mkdirSync(dirname(out), { recursive: true });
    await page.screenshot({ path: out });
  }

  await dialog.getByRole("button", { name: MOVE_BUTTON }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(/moved to Transfers|flyttet til Transfers/i)).toBeVisible();
});
