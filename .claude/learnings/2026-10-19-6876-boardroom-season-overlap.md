# #6876: Boardroom mistede sæsonkonteksten under sæsonskiftet

- Årsag: et ubegrænset active-season-opslag med maybeSingle fejlede i vinduet, hvor transitionToNextSeason har aktiveret næste sæson, men endnu ikke afsluttet den gamle.
- Følge: mandatet kunne falde tilbage til seneste mandat uden sæsonfilter, mål-loaderen blev sprunget over, milepæle mistede den aktuelle sæson, og bonustilbud fra andre sæsoner kunne vises.
- Rettelse: genbrug loadSingleActiveSeason og del resultatets promise mellem mandatopslaget og payloaden. Nyeste aktive sæson vælges; upcoming ignoreres. Ingen skrivninger eller ændret spillertekst.
- Regression: tre faste fixtures for S4 active/S5 upcoming, S4+S5 active under transition og S4 completed/S5 active. Alle indeholder også en upcoming S6 og konkurrerende mandater, milepæle og bonustilbud. Mål-loaderens sæson-id og den afledte målstatus kontrolleres.
- Testfælden: Boardrooms mock lod maybeSingle returnere første række ved flere matches. Den gengiver nu PostgRESTs PGRST116, så overlap-fejlen faktisk reproduceres.
- Rød/grøn: overlap-testen fejlede med manglende loadGoalContext-kald før rettelsen; alle 110 Boardroom/helper-tests bestod efter. Fuld suite afslørede desuden en auto-accept-mock, hvor seasons.order sluttede kæden før limit; genbrug af selectChain(seasons) rettede mocken. Alle 163 relaterede tests bestod derefter.
- Patch notes undtaget efter ejerens mandat om ingen spillertekst; kun eksisterende sæsonvalg rettes. FEATURE_REGISTRY uændret: ingen feature-lukning, ny kernefunktion eller flagændring.
