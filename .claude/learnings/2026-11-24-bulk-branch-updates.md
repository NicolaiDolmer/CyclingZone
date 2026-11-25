# Branch-opdateringer fyldte Actions-køen 24/11

Refs #8665. GitHub registrerede syv servergenererede main-indfletninger
på #8652–#8658 fra 08:53:06 til 08:53:16 UTC. Den almindelige merge-kø
venter 60 sekunder efter hver opdatering. Genbestilling af review
skriver en kommentar. Den konkrete afsenderkommando kunne ikke ses
i de tilgængelige toglogs.

Hold branch-opdateringer i merge-køen. Et rødt required check og en
bagudstående branch kan være samtidige uden at have samme årsag.
Reservér før det asynkrone API-kald og send den head, der blev
undersøgt. Kladder og docs-only PR'er skal stadig rapportere de
påkrævede check-navne uden at bygge eller starte browserne.

Senere review viste, at en afbrudt branch-opdatering kunne efterlade
en reservation uden udløb. En tidsgrænse og en loglinje gør tilstanden
synlig og genoprettelig. Autotoget genlæser ukendt mergeability via REST.
Ved overlappende Actions-kørsler bruges GitHubs kørselsoprettelse og
seneste jobforsøg. Starttiden for et job kan tilhøre en genkørsel af en
ældre workflow-kørsel.
