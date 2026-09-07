import { supabase } from "../../lib/supabase";
import { forumImagePublicUrl } from "../../lib/forumImages.js";

// #4819 — billederne under et indlaeg eller svar.
//
// LAYOUT: ét billede staar frit i indlaeggets bredde (op til 420 px hoejt);
// to eller tre laegges i et gitter af lige store felter. Tre billeder i fuld
// bredde ville skubbe resten af traaden langt ned — traaden skal stadig kunne
// laeses, ikke scrolles igennem (TASTE: "overblik foerst"). Fuld stoerrelse
// er altid ét klik vaek.
//
// Klik aabner filen i en ny fane frem for en lightbox: browserens egen
// billedvisning kan zoome og gemme, og forummet faar ikke endnu et modal-lag.
// Max-bredde 100 % holder gitteret inde paa mobil (#4415).
//
// SIKKERHED: der rendres ALDRIG markup fra brugerens tekst. `src` bygges af
// Supabase-klientens faste Storage-origin plus en sti backend'en har
// valideret ligger i afsenderens egen mappe — et indlaeg kan derfor ikke pege
// et <img> mod et fremmed domaene.

export default function ForumImageAttachments({ images, t, onAdminRemove = null }) {
  if (!Array.isArray(images) || images.length === 0) return null;
  const single = images.length === 1;

  return (
    <ul className={`mt-3 ${single ? "flex" : "grid grid-cols-2 gap-2 sm:grid-cols-3"}`}>
      {images.map((image) => {
        const url = forumImagePublicUrl(supabase, image.path);
        if (!url) return null;
        return (
          <li key={image.path} className="relative min-w-0">
            <a href={url} target="_blank" rel="noopener noreferrer" title={t("images.openFull")}>
              <img
                src={url}
                // Spilleren skriver ingen alt-tekst, saa den generiske
                // beskrivelse er det aerlige valg: et indholdsbillede maa
                // ikke skjules for skaermlaesere med alt="".
                alt={t("images.attachmentAlt")}
                width={image.width || undefined}
                height={image.height || undefined}
                loading="lazy"
                className={
                  single
                    ? "max-h-[420px] w-auto max-w-full rounded-cz border border-cz-border object-contain"
                    : "aspect-[4/3] w-full rounded-cz border border-cz-border object-cover"
                }
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
