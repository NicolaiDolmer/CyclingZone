// #4819 — billeder i forum-indlaeg: gaelder baade nye traade og svar.
//
// Ansvaret her er DELT i to lag med vilje:
//   · rene funktioner (validering, maal-udregning, sti-bygning) — testes med
//     node --test uden en browser
//   · en tynd browser-skal (resizeImageFile / uploadForumImage) der faar
//     canvas + Image injiceret, saa de samme tests kan koere den igennem med
//     en fake encoder
//
// Graenserne er ejer-valg 8/9 og spejles i backend/lib/forum.js,
// database/2026-09-08-4819-forum-images-bucket.sql og docs/GAME_INVARIANTS.md.
// Ret ALLE fire sammen.

export const FORUM_IMAGE_BUCKET = "forum-images";
export const FORUM_IMAGE_MAX_PER_POST = 3;
export const FORUM_IMAGE_MAX_BYTES = 2 * 1024 * 1024; // 2 MB EFTER nedskalering
export const FORUM_IMAGE_ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Naar telefonbilledet er 8 MB og 4032 px bredt, er det nedskaleringen — ikke
// et afvist upload — der skal redde brugeren. 1600 px paa laengste side er
// rigeligt til den bredeste forum-kolonne paa en 2x-skaerm.
export const FORUM_IMAGE_MAX_EDGE = 1600;
export const FORUM_IMAGE_QUALITY = 0.85;

// Faldene proeves i raekkefoelge indtil resultatet er under 2 MB. Foerste
// trin er det normale; de to naeste rammer kun ekstreme kilder (store
// panoramaer, stoejfyldte fotos).
export const FORUM_IMAGE_ENCODE_STEPS = [
  { maxEdge: FORUM_IMAGE_MAX_EDGE, quality: FORUM_IMAGE_QUALITY },
  { maxEdge: FORUM_IMAGE_MAX_EDGE, quality: 0.7 },
  { maxEdge: 1200, quality: 0.7 },
];

/**
 * Fejlkoder fra dette modul. Klienten oversaetter dem via
 * forum:images.errors.<code> — aldrig en raa engelsk streng i UI'et.
 */
export const FORUM_IMAGE_ERRORS = {
  TYPE: "type",
  TOO_MANY: "tooMany",
  TOO_LARGE: "tooLarge",
  DECODE: "decode",
  UPLOAD: "upload",
};

/** Filtypen som den skal skrives i stien. */
export function extensionForType(mimeType) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

/**
 * Er filen en af de tre tilladte typer? Returnerer en fejlkode frem for at
 * kaste — kaldstedet viser den som i18n-tekst under vaelgeren.
 */
export function validateImageFile(file, { existingCount = 0 } = {}) {
  if (existingCount >= FORUM_IMAGE_MAX_PER_POST) {
    return { ok: false, code: FORUM_IMAGE_ERRORS.TOO_MANY };
  }
  if (!file || !FORUM_IMAGE_ALLOWED_TYPES.includes(file.type)) {
    return { ok: false, code: FORUM_IMAGE_ERRORS.TYPE };
  }
  return { ok: true };
}

/**
 * Nedskalerings-maalet: laengste side kappes til `maxEdge`, forholdet holdes.
 * Et billede der allerede er mindre skaleres ALDRIG op (det ville kun goere
 * filen stoerre uden at tilfoeje detalje).
 */
export function computeResizeTarget(width, height, maxEdge = FORUM_IMAGE_MAX_EDGE) {
  const w = Math.max(1, Math.round(width || 0));
  const h = Math.max(1, Math.round(height || 0));
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return { width: w, height: h };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

/**
 * `<user_id>/<uuid>.<ext>`. Foerste mappeniveau ER ejerskabet — RLS-policyen
 * paa storage.objects tvinger den til at matche auth.uid(), saa stien maa
 * aldrig bygges af andet end brugerens eget id.
 */
export function buildForumImagePath(userId, mimeType, uuid) {
  const id = uuid || (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  return `${userId}/${id}.${extensionForType(mimeType)}`;
}

/**
 * Offentlig URL til et gemt billede. Origin'en kommer ALTID fra
 * Supabase-klienten (fast origin), aldrig fra indlaeggets data — derfor kan et
 * indlaeg ikke pege et <img> mod et fremmed domaene.
 */
export function forumImagePublicUrl(client, path) {
  if (!client || !path) return null;
  const { data } = client.storage.from(FORUM_IMAGE_BUCKET).getPublicUrl(path);
  return data?.publicUrl || null;
}

/**
 * Vaelger output-typen: webp naar browseren kan encode det (mindst, og god
 * baade til skaermbilleder og fotos), ellers jpeg. PNG bevares ikke — en
 * gennemsigtig baggrund er ikke en forum-usecase, og PNG af et foto er
 * mange gange stoerre end graensen tillader.
 */
export function pickEncodeType(canSupportWebp) {
  return canSupportWebp ? "image/webp" : "image/jpeg";
}

function defaultCanvasFactory(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function defaultSupportsWebp() {
  try {
    const probe = document.createElement("canvas");
    probe.width = 1;
    probe.height = 1;
    return probe.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    return false;
  }
}

function defaultDecode(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode failed"));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))),
      type,
      quality
    );
  });
}

/**
 * Nedskalér + gen-encode i browseren, FOER upload. Et 8 MB telefonbillede
 * skal virke; det er derfor graensen paa 2 MB gaelder resultatet, ikke kilden.
 *
 * `deps` findes udelukkende for testene (node --test har hverken canvas eller
 * Image) — produktionskoden kalder den uden.
 */
export async function resizeImageFile(file, deps = {}) {
  const {
    decode = defaultDecode,
    createCanvas = defaultCanvasFactory,
    toBlob = canvasToBlob,
    supportsWebp = defaultSupportsWebp,
    steps = FORUM_IMAGE_ENCODE_STEPS,
    maxBytes = FORUM_IMAGE_MAX_BYTES,
  } = deps;

  let source;
  try {
    source = await decode(file);
  } catch {
    return { ok: false, code: FORUM_IMAGE_ERRORS.DECODE };
  }

  const sourceWidth = source.naturalWidth || source.width;
  const sourceHeight = source.naturalHeight || source.height;
  const type = pickEncodeType(supportsWebp());

  let last = null;
  for (const step of steps) {
    const target = computeResizeTarget(sourceWidth, sourceHeight, step.maxEdge);
    const canvas = createCanvas(target.width, target.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(source, 0, 0, target.width, target.height);
    let blob;
    try {
      blob = await toBlob(canvas, type, step.quality);
    } catch {
      return { ok: false, code: FORUM_IMAGE_ERRORS.DECODE };
    }
    last = { blob, width: target.width, height: target.height, type };
    if (blob.size <= maxBytes) return { ok: true, ...last };
  }

  // Alle trin proevet og stadig for stor: sig det aabent i stedet for at
  // sende en fil serveren afviser med en raa 413.
  return { ok: false, code: FORUM_IMAGE_ERRORS.TOO_LARGE, size: last?.blob?.size ?? null };
}

/**
 * Hele vejen: validér, nedskalér, upload til bucketen, returnér den raekke der
 * skal med i indlaeggets `images`. Uploadet sker FOER indlaegget sendes, saa et
 * fejlet upload aldrig koster brugeren sin tekst.
 */
export async function uploadForumImage({ client, userId, file, existingCount = 0, resize = resizeImageFile }) {
  const valid = validateImageFile(file, { existingCount });
  if (!valid.ok) return valid;

  const resized = await resize(file);
  if (!resized.ok) return resized;

  const path = buildForumImagePath(userId, resized.type);
  const { error } = await client.storage
    .from(FORUM_IMAGE_BUCKET)
    .upload(path, resized.blob, { contentType: resized.type, upsert: false });
  if (error) return { ok: false, code: FORUM_IMAGE_ERRORS.UPLOAD };

  return { ok: true, image: { path, width: resized.width, height: resized.height } };
}

/**
 * Fjern en fil brugeren lige har lagt op men fortrudt. Best-effort: en fejl
 * her maa aldrig blokere editoren — filen bliver i vaerste fald foraeldreloes
 * og fanges af scripts/sweep-forum-image-orphans.mjs.
 */
export async function removeForumImage({ client, path }) {
  const { error } = await client.storage.from(FORUM_IMAGE_BUCKET).remove([path]);
  return { ok: !error };
}
