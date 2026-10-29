# Roadmap-afstemning, 27/10/2026

Refs #7153 #6923 #7262. Design-go: ejerens bestilling 27/10, beslutninger 26-27/10 og de godkendte roadmap-grupper på #7153. Rækkefølgen i MASTERPLAN og eksisterende sort_order bevares.

## Målt grundlag

Read-only Supabase 27/10: daglig træning, sæsonens træthedsreset, kurve B og formtoppe er on. Etapeplan og dagens intention er nu on, begge læst tilbage efter PC1-tænding kl. 13:48. Profilbakker har ingen app_config-række (fail closed). #7283 og #7288 er merged; #7281 blev merged under denne session. #7272 er stadig åben. #7291 er merged, men er ikke koblet/tændt. Ingen prod-skrivning fra Codex.

Den leverede kurve har allerede en Done-række på #6110. Samme epic har en separat I gang-række for resten; det er ikke en dublet der skal slettes. #6950 er økonomisk catch-up, ikke issue for Udviklingsscore. Referencen er præciseret i MASTERPLAN.

## Klargjort indholdsændring

Migration: `database/2026-10-27-7153-roadmap-content.sql`. Ejer-go i Codex 27/10: kun leverede punkter må flyttes til Done. Auto-migrate anvender den efter PC1s merge; Codex skriver ikke i prod.

| Punkt | Før, målt | Efter |
|---|---|---|
| Formtoppe #6156 | Planlagt, snart live | Done; kontakten er on |
| Daglig træning mellem sæsoner #7282 | Ingen række | Done-historik |
| Fælles starttræthed, PR #7288 | Ingen række | Done-historik |
| Modsatte ordrer #7003/#7281 | Ingen selvstændig række | Done-historik efter observeret tænding |

Indstillinger, holdtidskørsel, U23-op/nedrykning og den eksisterende Udvikling 2.0-række ændres ikke, efter ejerens seneste afgrænsning. EN og DA står ordret i SQL-diffen og er copy-only-beviset. Ingen layoutændring. SQL låser og statuskontrollerer de eksisterende statusrækker; den kan køres igen uden dubletter. Stemmer, spillerdata og sort_order på eksisterende rækker bevares.

## Kontrolleret og bevaret

De leverede rytterkort, udgiftslettelser, kontraktforlængelse, sprog og sæsonoversigt har allerede Done-status. Motor/taktik står fortsat som igangværende, fordi deres samlede scope ikke er leveret. Løbsbiblioteket står som I gang med beta på vej, ikke som aktiveret beta. #6461 beholder sin separate planlagte tænding. #6369/#6857 beholder afventningen af første relevante løb; ingen forhåndslukning.

De private beslutninger om #7240, #6665, #7277, #7143, #7164 og go-kort til #6636/#6634/#7191/#7101 er afspejlet i MASTERPLAN. Codex ændrer eller lukker ingen motor-/taktik-PR'er.

## PC1 før afslutning

1. Genlæs aktuelle rækker og flag. Ejeren har godkendt Done-delen til auto-migrate efter PC1s merge; ingen andre roadmap-rækker ændres.
2. Apply kun efter merge og efter eget prod-mandat. Sammenlign read-back med tabellen ovenfor og kontrollér /roadmap, EN og DA. Ingen ny patch note for en tekstoprydning alene; dagens mekaniknoter leveres i den separate patch-note-PR.
3. Ordrer er tændt; dagsform og bakker A følger separat. Brug teksterne i den separate aktiveringskladde først efter positiv observation, og opdatér registry i samme tændings-PR. Bakker B, Alt ud og luksushjælper har egne gates.
4. Republicér den eksisterende Masterplan-artifact på samme URL før denne docs-leverance lukkes. Den relevante Artifact list/update-kapabilitet findes ikke blandt denne sessions tools; plugin-søgning gav ingen relevant forbindelse. Der er ikke oprettet en ny artifact. Computer Use blev desuden afvist adgang til Claude-vinduet. PC1 skal observere den faktiske republicering.
5. NOW og samlet close-out tilhører PC1. Dokumenterne her udgør ikke et merge-go fra Codex.

Lokal verifikation: native PostgreSQL 17, syntetisk baseline før ændring, forslaget kørt to gange med identisk resultat. Eksisterende sort_order, stemmer og leveret kurve-række bevaret; ændret baseline afvises. Testklyngen er observeret stoppet. PGlite-kontrollen var supplerende, ikke PG17-beviset.
