# #6514: visuelt bevis, 15/10/2026

Alle billeder er faktiske browser-renderinger med syntetiske, anonyme fixtures. Ingen produktionsdata eller genererede mockups.

- before-desktop/mobile: uændret plan-base 32e405320. Samme races/seasons med den gamle querys season-join; verdenskatalog fra testharnessens katalogfixture.
- desktop-light (1280x900), desktop-1440 (1440x900), mobile-dark og mobile-light (390x844): afsluttende bibliotek, Kommende løb som startfane.
- history-desktop: Historik. edition-desktop/mobile: konkret udgave med gemte sektorer og ærlig forklaring, når højdekurven mangler.
- empty-mobile, error-mobile og loading-mobile: særskilte tom-, fejl- og loadingtilstande. Fejloverskriften er verificeret på dansk og engelsk. Loading bruger kontrolleret ventende svar; samme side blev derefter observeret færdigindlæst.
- before-after.png: browser-renderet sammenligning af de faktiske kildebilleder med billedtekster og beskæring af topområder.

Ni afsluttende populated/history/empty/error-visninger: målt ydre overflow 0 og pageerrors 0. Loading er særskilt kontrolleret. Testdata omfatter 12 sæsoner, live/scheduled/completed, fælles løb og valideret pulje. Ingen S5-generering, udtagelse eller produktionsskrivning.

[Verifikationsrapport](../../docs/audits/2026-10-15-loebsbibliotek-verifikation.md). Ingen evidens for autentificeret produktionslatens, RLS i ejerens browsersession eller forbedret spilleradfærd. Ejerens previewgennemgang er stadig åben.
