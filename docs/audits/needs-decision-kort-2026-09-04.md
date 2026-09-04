# needs-decision: beslutningskort-grundlag (4/9 2026)

> 37 issues med label `needs-decision`, læst af 6 research-workers 4/9. Ét kort pr. issue, klart sprog, A/B + anbefaling. Sortering: brænder nu → før 27/9 → efter 27/9. Afgjort i dag: #4376 (sponsor), #4514 (mapping var allerede rettet), #4753 (flag tændt). Verificér issue-state før hvert kort; resuméer kan være forældede (bidt 4/9 på #4514).

## Brænder nu

- **#4582 Demote til akademiet genberegner løn forkert.** Senior flyttet ned i akademiet får ny (højere) løn i stedet for at arve kontrakten; promote arver korrekt. 3 rapporter 1/9. Ejer valgte 4/9: A, arv kontrakten. WIP ligger ucommittet i et worktree. Næste: genoptag med stramt scope + read-only liste over ramte + reparations-SQL som forslag.
- **#3460 "Spar kræfter" gratis, "Arbejd" ren nedside.** Kaptajner kørt på Spar kræfter hele sæsonen uden tab; dominerende strategi beskrevet af spiller. A: fiks så effort afvejer støtte mod træthed · B: kun dokumentation (gjort). Anbefaling A (balance-fix med simulering).
- **#4149 Race-motor og web-API i to Railway-services.** Deploys afbryder løb (gentaget 3/9). A: split · B: deploy-vagt (#4150) · C: vent på #4147/#4148-data. Anbefaling C, men prioriter højt; #4147-flag tændes efter et døgn med vagten.
- **#3200 Spiller-til-spiller-beskeder (deadline S3).** Design-samtale (1:1 vs. gruppe, kobling til handler, blokering, notifikation) er aftalt men ikke afholdt. Anbefaling: kør designsessionen nu; ~3 uger til 27/9.
- **#2824 Login-væg + SEO.** Beslutning taget 21/8 (hybrid: offentligt Next.js-site på roden, spil-app forbliver Vite). Mangler kun implementerings-issue under #1301. Ingen ny beslutning.

## Før sæsonskiftet 27/9

- **#4765 Udviklingsrate for svagheder (0,05).** Hævede lofter virker ikke uden højere rate. A: hæv til 0,10-0,15 · B: rate efter afstand til loft · C: behold. Kræver simulering; ejer-frist 11/9.
- **#2887 Sportsdirektør: senior-træning + kandidatpulje.** A: verificér motor-effekt + gør puljen ærlig (refresh) · B: dokumentér. Anbefaling A.
- **#3152 Bestyrelses-omdømme som humør-dræber.** B: foldes ind i Mandat-rework #3514 (spec godkendt 7/8). Anbefaling B, luk herfra.
- **#4074 /pro valuta** → AFGJORT 4/9 (PR #4608 merget). **#4511 EU-moms** → revisor-spørgsmål; under 10.000 EUR = dansk 25 % (bekræftet af Dinero-AI 4/9). OSS slået fra.
- **#4103 Kalender-audit S3.** A: genkør komposition for S3 · B: acceptér afvigelse, bekræft S4's opt-in-mekanisme. Anbefaling B.
- **#4203 Monumenter ud af GT-vinduer.** Regel besluttet + bygget for S4; luk når #4270 (S4-apply) er verificeret. Valgfrit: fyld de 4 tynde S3-endagsløb op.
- **#3982 Etapestriben fase 2.** A: resultat-piller + optakt · B: kun resultat-piller nu. Anbefaling B.
- **#3984 Samlet indstillinger + nationalitet.** A: byg IA-struktur (T1) først, nationalitet som første feature · B: punktvis. Anbefaling A (ejer bad selv om samlet område).
- **#3425 Planlægning i mobilbundbaren.** A: udskift "Mit Hold" (svagest, 1.486 sessions) med Planlægning (3.615) · B: 6. punkt (bryder touch-target). Anbefaling A.
- **#4235 Forummets rolle vs. Discord.** Måling 15/9 mod tærskler; ingen handling før.

## Efter 27/9

- **#4632 Løbsdagens intention pr. rytter.** Tre valg: model C (hybrid) / samme effort-felt / ship nu. Anbefaling: følg specen, stil enkeltvist.
- **#3049 Rolle/taktik i klassikere.** A: åbn hele panelet · B: kun fri-rolle. Anbefaling A (motoren kender rollerne). Audit-D.
- **#2991 GT-achievement uopnåeligt for mennesker.** A: lad stå som flersæsonsmål · B: slæk kriterie · C: åbn GT for D2. Anbefaling A nu, B ved copy-runde. Audit-D.
- **#3050 Venskabsløb.** Ægte feature-scope (økonomi-isolering, inviter-flow). Kræver ejer-go før start. Audit-D.
- **#3413 Udbrud gratis.** A: giv udbrud en pris · B: behold. Anbefaling B kortsigtet, simulering før ændring.
- **#3471 Kalender-spor med identitet.** Rækkefølge: #3469 (kronologi) først.
- **#2885 Sælg uønsket rytter til AI-opkøb.** A: byg efter N mislykkede auktioner, mellem sæsoner · B: intet. Kræver pris-formel + sim. Audit-D.
- **#3967 Fog of war: potentiale som ord.** A: ordbånd nu · B: vent til træningscore. Anbefaling B, men beslut eksplicit.
- **#3350 Spillerne gætter reglerne.** A+B shippet; C (systemside) mangler, foldes ind i transparens-session efter trin 7.
- **#2675 Efterspil academy-intake.** A: acceptér status quo (7 af 16 ryttere handlet naturligt) · B: manuel oprydning. Anbefaling A; ejer ville have en gennemgang først. Audit-D.
- **#3147 Sponsor-udbetaling.** Synlighed løst; A: behold base som engangsudbetaling · B: løbende. Anbefaling A. Audit-D.
- **#4714 12-timers minimum fri agent-auktion.** Afventer spillerafstemning (udkast i docs/drafts/community-fredag-2026-09-04.md).
- **#1595 Slet PCM-import.** Besluttet 23/7; kun sletning mangler. A.
- **#2259 DB-hygiejne (59 backup-tabeller, 13 hot-path-FK-index).** A: godkend nu. **#3633 slet #3570-backup-tabeller.** A: go (vindue udløbet).
- **#2511 Bundle-drift.** A: luk (løst 30/8); i18n-split som eget lavprioritets-issue.
- **#2688 Fable-optimering.** A: effort-routing + pilot judge-panel. **#2689 AI-setup-audit 19/7.** B: luk som forældet, nyt hurtigt tjek.
- **#4189 @claude på ejerens kvote.** B: kun ejeren kan trigge (actor-guard, kodesnippet klar; ejeren redigerer workflow-filen selv).
- **#4753** → flag tændt 4/9 kl. 16:11; luk når alle 15 puljer = 24.
