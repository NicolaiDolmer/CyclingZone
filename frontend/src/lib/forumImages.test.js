import test from "node:test";
import assert from "node:assert/strict";

import {
  FORUM_IMAGE_ERRORS,
  FORUM_IMAGE_MAX_PER_POST,
  buildForumImagePath,
  computeResizeTarget,
  extensionForType,
  forumImagePublicUrl,
  pickEncodeType,
  resizeImageFile,
  uploadForumImage,
  validateImageFile,
} from "./forumImages.js";

// #4819 — resize/validering er den del der afgoer om et 8 MB telefonbillede
// virker eller ikke. Canvas findes ikke i node --test, saa encoderen
// injiceres: testene her daekker regnestykket og faldene, ikke pixelarbejdet.

function fakeDeps({ sizes, width = 4000, height = 3000, webp = true }) {
  let call = 0;
  return {
    decode: async () => ({ naturalWidth: width, naturalHeight: height }),
    createCanvas: (w, h) => ({ width: w, height: h, getContext: () => ({ drawImage() {} }) }),
    toBlob: async () => ({ size: sizes[Math.min(call++, sizes.length - 1)] }),
    supportsWebp: () => webp,
  };
}

test("computeResizeTarget kapper laengste side og holder forholdet", () => {
  assert.deepEqual(computeResizeTarget(4000, 3000, 1600), { width: 1600, height: 1200 });
  assert.deepEqual(computeResizeTarget(3000, 4000, 1600), { width: 1200, height: 1600 });
});

test("computeResizeTarget skalerer ALDRIG op", () => {
  assert.deepEqual(computeResizeTarget(800, 600, 1600), { width: 800, height: 600 });
});

test("computeResizeTarget haandterer nul og negative maal uden at give 0 px", () => {
  const target = computeResizeTarget(0, 0, 1600);
  assert.equal(target.width >= 1, true);
  assert.equal(target.height >= 1, true);
});

test("validateImageFile afviser andet end jpg/png/webp", () => {
  assert.deepEqual(validateImageFile({ type: "image/gif" }), { ok: false, code: FORUM_IMAGE_ERRORS.TYPE });
  assert.deepEqual(validateImageFile({ type: "application/pdf" }), { ok: false, code: FORUM_IMAGE_ERRORS.TYPE });
  assert.deepEqual(validateImageFile({ type: "image/png" }), { ok: true });
  assert.deepEqual(validateImageFile({ type: "image/webp" }), { ok: true });
  assert.deepEqual(validateImageFile({ type: "image/jpeg" }), { ok: true });
});

test("validateImageFile afviser billede nummer fire", () => {
  assert.deepEqual(
    validateImageFile({ type: "image/png" }, { existingCount: FORUM_IMAGE_MAX_PER_POST }),
    { ok: false, code: FORUM_IMAGE_ERRORS.TOO_MANY }
  );
  assert.deepEqual(validateImageFile({ type: "image/png" }, { existingCount: 2 }), { ok: true });
});

test("extensionForType + pickEncodeType", () => {
  assert.equal(extensionForType("image/png"), "png");
  assert.equal(extensionForType("image/webp"), "webp");
  assert.equal(extensionForType("image/jpeg"), "jpg");
  assert.equal(pickEncodeType(true), "image/webp");
  assert.equal(pickEncodeType(false), "image/jpeg");
});

test("buildForumImagePath laegger filen i brugerens EGEN mappe", () => {
  const path = buildForumImagePath("user-1", "image/webp", "abc");
  assert.equal(path, "user-1/abc.webp");
  assert.equal(path.split("/")[0], "user-1");
});

test("resizeImageFile: et stort telefonbillede lander under graensen paa foerste trin", async () => {
  const result = await resizeImageFile({}, fakeDeps({ sizes: [900_000] }));
  assert.equal(result.ok, true);
  assert.equal(result.width, 1600);
  assert.equal(result.height, 1200);
  assert.equal(result.type, "image/webp");
});

test("resizeImageFile falder til naeste trin naar foerste encode er for stor", async () => {
  const result = await resizeImageFile({}, fakeDeps({ sizes: [5_000_000, 3_000_000, 1_000_000] }));
  assert.equal(result.ok, true);
  // Tredje trin skalerer til 1200 px laengste side.
  assert.equal(result.width, 1200);
  assert.equal(result.height, 900);
});

test("resizeImageFile giver tooLarge naar alle trin er for store", async () => {
  const result = await resizeImageFile({}, fakeDeps({ sizes: [9_000_000] }));
  assert.equal(result.ok, false);
  assert.equal(result.code, FORUM_IMAGE_ERRORS.TOO_LARGE);
});

test("resizeImageFile bruger jpeg naar browseren ikke kan webp", async () => {
  const result = await resizeImageFile({}, fakeDeps({ sizes: [100_000], webp: false }));
  assert.equal(result.type, "image/jpeg");
});

test("resizeImageFile giver decode-fejl paa en ulaeselig fil", async () => {
  const result = await resizeImageFile({}, {
    decode: async () => { throw new Error("nope"); },
  });
  assert.deepEqual(result, { ok: false, code: FORUM_IMAGE_ERRORS.DECODE });
});

test("forumImagePublicUrl bygger URL'en fra klientens faste origin", () => {
  const client = {
    storage: {
      from: (bucket) => ({
        getPublicUrl: (path) => ({ data: { publicUrl: `https://cdn.example/${bucket}/${path}` } }),
      }),
    },
  };
  assert.equal(
    forumImagePublicUrl(client, "user-1/a.webp"),
    "https://cdn.example/forum-images/user-1/a.webp"
  );
  assert.equal(forumImagePublicUrl(client, null), null);
  assert.equal(forumImagePublicUrl(null, "user-1/a.webp"), null);
});

test("uploadForumImage returnerer den raekke der skal med i indlaegget", async () => {
  const uploads = [];
  const client = {
    storage: {
      from: () => ({
        upload: async (path, blob, opts) => {
          uploads.push({ path, opts });
          return { error: null };
        },
      }),
    },
  };
  const result = await uploadForumImage({
    client,
    userId: "user-1",
    file: { type: "image/png" },
    resize: async () => ({ ok: true, blob: { size: 10 }, width: 1600, height: 900, type: "image/webp" }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.image.width, 1600);
  assert.equal(result.image.height, 900);
  assert.equal(result.image.path.startsWith("user-1/"), true);
  assert.equal(uploads[0].opts.contentType, "image/webp");
});

test("uploadForumImage stopper foer upload naar filtypen er forkert", async () => {
  let uploaded = false;
  const client = { storage: { from: () => ({ upload: async () => { uploaded = true; return { error: null }; } }) } };
  const result = await uploadForumImage({ client, userId: "user-1", file: { type: "image/gif" } });
  assert.deepEqual(result, { ok: false, code: FORUM_IMAGE_ERRORS.TYPE });
  assert.equal(uploaded, false);
});

test("uploadForumImage melder upload-fejl frem for at lade som om det gik godt", async () => {
  const client = { storage: { from: () => ({ upload: async () => ({ error: { message: "denied" } }) }) } };
  const result = await uploadForumImage({
    client,
    userId: "user-1",
    file: { type: "image/png" },
    resize: async () => ({ ok: true, blob: { size: 10 }, width: 10, height: 10, type: "image/webp" }),
  });
  assert.deepEqual(result, { ok: false, code: FORUM_IMAGE_ERRORS.UPLOAD });
});
