import { useId, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { Button } from "../ui";
import { ImageIcon, XIcon } from "../ui/icons/index.jsx";
import {
  FORUM_IMAGE_ALLOWED_TYPES,
  FORUM_IMAGE_MAX_PER_POST,
  forumImagePublicUrl,
  removeForumImage,
  uploadForumImage,
} from "../../lib/forumImages.js";

// #4819 — billed-vaelgeren i forum-editoren (ny traad OG svar).
//
// Uploadet sker HER, foer indlaegget sendes. Det er et bevidst valg: et fejlet
// upload maa aldrig koste brugeren sin tekst, og forhaandsvisningen viser den
// fil der faktisk ligger i bucketen — ikke en lokal blob der senere kan vise
// sig ikke at kunne uploades.
//
// Prisen er foraeldreloese filer hvis nogen lukker editoren uden at sende.
// Fjern-krydset sletter filen med det samme, og resten ryddes af det
// idempotente scripts/sweep-forum-image-orphans.mjs (se docs/SOCIAL_RULES.md
// §8.5). Bevidst valg frem for at holde filen lokalt til submit.

export default function ForumImagePicker({ images, onChange, disabled = false, userId, t }) {
  const inputRef = useRef(null);
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const count = images.length;
  const full = count >= FORUM_IMAGE_MAX_PER_POST;

  async function handleFiles(event) {
    const files = Array.from(event.target.files || []);
    // Inputtet nulstilles med det samme, saa den samme fil kan vaelges igen
    // efter en fejl (change-eventet fyrer ellers ikke anden gang).
    event.target.value = "";
    if (!files.length || !userId) return;

    setBusy(true);
    setError(null);
    let next = images;
    try {
      for (const file of files) {
        if (next.length >= FORUM_IMAGE_MAX_PER_POST) {
          setError(t("images.errors.tooMany", { count: FORUM_IMAGE_MAX_PER_POST }));
          break;
        }
        const result = await uploadForumImage({
          client: supabase,
          userId,
          file,
          existingCount: next.length,
        });
        if (!result.ok) {
          setError(t(`images.errors.${result.code}`, { count: FORUM_IMAGE_MAX_PER_POST }));
          break;
        }
        next = [...next, result.image];
        onChange(next);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(path) {
    onChange(images.filter((img) => img.path !== path));
    setError(null);
    // Best-effort: slaar sletningen fejl, bliver filen foraeldreloes og
    // fanges af sweep-scriptet. Indlaegget peger under alle omstaendigheder
    // ikke laengere paa den.
    await removeForumImage({ client: supabase, path });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          className="sr-only"
          accept={FORUM_IMAGE_ALLOWED_TYPES.join(",")}
          multiple
          disabled={disabled || busy || full}
          onChange={handleFiles}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={busy}
          disabled={disabled || busy || full}
          onClick={() => inputRef.current?.click()}
        >
          <ImageIcon size={14} aria-hidden="true" className="me-1 inline -mt-0.5" />
          {t("images.add")}
        </Button>
        <span className="font-data text-2xs uppercase tracking-[.06em] tabular-nums text-cz-3">
          {t("images.counter", { count, max: FORUM_IMAGE_MAX_PER_POST })}
        </span>
      </div>

      {count > 0 && (
        <ul className="flex flex-wrap gap-2">
          {images.map((image) => (
            <li key={image.path} className="relative">
              <img
                src={forumImagePublicUrl(supabase, image.path)}
                alt=""
                width={image.width || undefined}
                height={image.height || undefined}
                className="h-20 w-20 rounded-cz border border-cz-border object-cover"
              />
              <button
                type="button"
                disabled={disabled || busy}
                onClick={() => handleRemove(image.path)}
                aria-label={t("images.remove")}
                title={t("images.remove")}
                className="absolute end-1 top-1 rounded-full border border-cz-border bg-cz-surface/90 p-1 text-cz-2 transition-colors hover:text-cz-1 disabled:opacity-50"
              >
                <XIcon size={12} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-2xs text-cz-3">
        {t("images.hint", { max: FORUM_IMAGE_MAX_PER_POST })}
      </p>
      {error && <p className="text-xs text-cz-danger">{error}</p>}
    </div>
  );
}
