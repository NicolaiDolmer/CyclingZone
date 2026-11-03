# Postmortem · 2026-11-03 · Dagsession PC1: merges, designs og tre egne fejl (#7495)

## Hvad skete der?
Dagsessionen mergede 20 PR'er, tændte løbsbiblioteket for alle og skrev fire kernedesigns. Undervejs lavede sessionen tre fejl:
1. **Balance-tal på GitHub (hard rule 17):** designs for #7560 og #7565 blev postet med vægte, lofter og målte fordelinger, og #7565's issue-tekst indeholdt demand-vektorer. Opdaget via design-sporet for #7536. Kommentarerne blev slettet og issue-teksten gjort kvalitativ, men GitHubs redigeringshistorik beholder den første version (ejeren sletter revisionen).
2. **Rød main efter #7523:** byggestop-poster fra Codex' PR'er blev lagt på main (`af0fc411`), mens #7523 også havde sine egne. Efter merge stod #6679/#6337 to gange, og wave-admission afviste dubletter (`ops-script-tests`). Rettet i `ebae98a2`.
3. **Falske fund fra billedstationen:** "Henter…"/"—" (læse-POST blev blokeret) og "afskårne" tabeller (egen lodret scroll) blev først kaldt fejl. Rettet i #7563 (allowlist + udfoldede tabeller).

Desuden: en målefejl i #5950-sporet (summering pr. kalenderdato i stedet for pr. spildag) gav et falsk "løbsdage giver halvt så meget". Rettet efter fejlsøgning; issuet blev rettet med det samme.

## Root cause
- Design-agenter fik ikke rule 17 med i prompten, og output blev postet direkte.
- Flytning af data mellem PR og main uden at tjekke, at PR'en selv bringer de samme poster.
- Værktøjets begrænsninger blev tolket som spillets fejl uden at tjekke koden først.

## Forhindret-fremover
- Design-agenter skal levere en "Offentlig opsummering" uden tal; fuldt design gemmes i `balance-internals/`.
- Feature-PR'er ændrer aldrig `scripts/build-stop.json`; listen ændres kun i små commits på main. Kør `node scripts/wave-policy.mjs assert-idle` efter enhver ændring af listen.
- Et fund fra billedstationen tjekkes mod koden (GET/POST, scroll-containere), før det kaldes en fejl.
- Træning mod løbsdag sammenlignes pr. spildag (training_rider_ticks er én række pr. spildag).
- Kør hele `npm test` før push (#7562 fejlede på en strukturtest, der kun fandtes i den fulde suite).

## Læring
Det, der gav mest fart: billedstationen med ejerens rigtige data, READ-ONLY opus-spor parallelt med merge-køen, og at stille ejeren ét spørgsmål ad gangen med billede.
