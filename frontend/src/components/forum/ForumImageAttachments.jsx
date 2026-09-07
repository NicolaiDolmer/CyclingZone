import { supabase } from "../../lib/supabase";
import { forumImagePublicUrl } from "../../lib/forumImages.js";

// #4819 — billederne under et indlaeg eller svar.
//
// Vises med max-bredde 100 % (#4415, mobil) og et loft paa hoejden, saa et
// portraetbillede ikke skubber hele traaden ned. Klik aabner filen i fuld
// stoerrelse i en ny fane — bevidst frem for en lightbox: browserens egen
// billedvisning kan zoome og gemme, og forummet faar ikke endnu et
// modal-lag at vedligeholde.
//
// SIKKERHED: der rendres ALDRIG markup fra brugerens tekst. `src` bygges af
// Supabase-klientens faste Storage-origin plus en sti backend'en har
// valideret ligger i afsenderens egen mappe — et indlaeg kan derfor ikke
// pege et <img> mod et fremmed domaene.

export default function ForumImageAttachments({ images, t, onAdminRemove = null }) {
  if (!Array.isArray(images) || images.length === 0) return null;

  return (
    <ul className="mt-3 flex flex-col gap-2">
      {images.map((image) => {
        const url = forumImagePublicUrl(supabase, image.path);
        if (!url) return null;
        return (
          <li key={image.path} className="relative">
            <a href={url} target="_blank" rel="noopener noreferrer" title={t("images.openFull")}>
              <img
                src={url}
                alt=""
                width={image.width || undefined}
                height={image.height || undefined}
                loading="lazy"
                className="max-h-[420px] w-auto max-w-full rounded-cz border border-cz-border object-contain"
              />
            </a>
            {onAdminRemove && (
              <button
                type="button"
                onClick={() => onAdminRemove(image.path)}
                aria-label={t("images.adminRemove")}
                title={t("images.adminRemove")}
                className="absolute end-1.5 top-1.5 rounded-cz border border-cz-border bg-cz-surface px-2 py-0.5 font-data text-2xs uppercase tracking-[.06em] text-cz-danger"
              >
                {t("images.adminRemove")}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
