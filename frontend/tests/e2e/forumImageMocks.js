// #4819 — Storage-mocks for forum-billeder i e2e/preview.
//
// Forum-billeder ligger i Supabase Storage-bucketen `forum-images`. Preview og
// e2e maa hverken skrive til eller laese fra prod-bucketen, saa de to kald der
// rammer Storage routes lokalt:
//   · POST .../storage/v1/object/forum-images/<sti>        (upload)
//   · GET  .../storage/v1/object/public/forum-images/<sti> (visning)
//
// Uploadet svarer 200 uden at gemme noget; visningen serverer altid det samme
// PNG-fixture. Det er nok til at daekke UI-tilstandene (forhaandsvisning,
// taeller, fejltekst, indlaeg med 1 og 3 billeder) uden en levende backend.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const FORUM_IMAGE_FIXTURE = resolve(__dirname, "fixtures/forum-image-1200x800.png");

export async function installForumImageMocks(page) {
  const png = readFileSync(FORUM_IMAGE_FIXTURE);

  await page.route("**/storage/v1/object/public/forum-images/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: png })
  );

  await page.route("**/storage/v1/object/forum-images/**", (route) => {
    if (route.request().method() === "DELETE") {
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ Key: "forum-images/preview-user/uploaded.webp" }),
    });
  });

  // supabase-js sender sletninger som POST .../object/forum-images med en
  // prefixes-payload; den rammer routen ovenfor. Bucket-metadata-kaldet gaar
  // til et andet path og maa ikke naa nettet.
  await page.route("**/storage/v1/bucket/forum-images**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "forum-images", public: true }) })
  );
}
