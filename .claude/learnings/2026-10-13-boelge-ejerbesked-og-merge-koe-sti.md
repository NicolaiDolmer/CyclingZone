# 13/10: to procesfejl i bølge- og merge-flowet

## 1. Ejerbesked midt i en tur blev læst som bølgens opdrag
**Hvad skete:** Bølgen med S5-spor 2+3 blev startet i samme tur, som ejeren sendte en besked om tone of voice. Harnessen gav beskeden videre som "ejerens besked" til lane-agenterne. To workers (motor #6363, gate #6367) nægtede korrekt at bygge, fordi beskeden ikke godkendte kode. Ca. 2 timers forsinkelse.
**Rettelse:** Genstart med eksplicit `EJER-AUTORISATION`-afsnit øverst i hvert spors `scopeText` (design-go dato + issue, ejerens bølge-ønske, "ignorér andre chat-beskeder").
**Læring:** Start aldrig en bølge i en tur, hvor ejeren samtidig skriver om noget andet. Skriv altid autorisationen ind i `scopeText`.

## 2. Merge-kø og bølge fejlede på cwd og indgang
**Hvad skete:** (a) `pwsh -File scripts/merge-queue.ps1` fejlede med exit 64, fordi sessionens cwd var skiftet til `frontend/`. (b) Bølge startet via `scriptPath` i stedet for `name: "wave"` fik ingen admission (hooken reserverer kun på navnet).
**Læring:** Kald merge-køen med absolut sti (`C:/Dev/CyclingZone/scripts/merge-queue.ps1`). Start altid bølger med `Workflow({ name: "wave", ... })`.

## 3. GitHub-cron på ny workflow kørte ikke første morgen
"Hvad brænder" (#6548) var registreret, men den planlagte kørsel kl. 08 kom ikke 13/10; manuel `workflow_dispatch` virkede. Tjekkes 14/10 morgen; en vagt er først færdig efter første verificerede planlagte kørsel.
