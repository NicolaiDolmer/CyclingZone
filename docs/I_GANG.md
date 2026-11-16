# I gang (uge 47: 16/11-22/11)

> Én side for ugens løfter. Kilde: roadmappets "This week" (`roadmap_items`), ugeplanen og roadmap-flytningen på #7911 (16/11) og MASTERPLAN "Rækkefølge". Opdateres ved hver tænding og hver morgen. Loft: 3 initiativer i gang; fejl hos spillerne går foran.

## Ugens løfter

| # | Løfte | Issue | Kontakt | Tilstand 16/11 middag | Næste skridt |
|---|---|---|---|---|---|
| 1 | Træn nu virker med det samme | #7737 | `training_train_now_instant` | **leveret**, on for alle 09:16 | Mål aftenspidsen 18-20; over 8 s eller fejl = tilbage til beta. Luk issuet efter målingen |
| 2 | Salgssummen kommer ved skifte | #6181 | `sale_escrow_enabled` | **leveret** (roadmap 10:44) | Første række i `sale_escrows` ses, så lukkes issuet |
| 3 | Bonus 15 % ved eget tryk | #7741 | `training_train_now_bonus` | tekster + kvittering i PR #8219 (ejer "merge") | Merge, så tænde-kort i aften. Ejer: ingen kl. 20-grænse; kun eget tryk |
| 4 | Træthed gennem løbsdagen + afregning | #7801 / #7982 (roadmap #6984) | `fatigue_now_7801` + `training_settle_race_session` | Fable: #8212 og #8213 bevist med forbehold; tænding IKKE klar | Prøve uden stempel i #8212, billede af "Kørt"-tilstanden i #8213, migration for kontakt-rækken (bølge) |
| 5 | Udvikling 2.0 (XP) | #6110 | `development_xp_model` | prøvekørsel kørt (0 ratingfald, 0 brud på +1 pr. dato) | De to faste krav i den private fil, prislisten i prod (kør), Fable-gentjek. Status senest ons |
| 6 | Træningsrapporten viser løbenes bidrag | #7627 | - | procent-udgaven **merget** (#8205, `e0f4ae730`) | Roadmap til leveret (ejerens ord); XP-udgaven #8210 følger XP |
| 7 | Løbssiden v6 | #7778 | `race_page_v6` | merget (#8211) | Ret striben efter gem (bølge), så tænde-kort for beta |
| 8 | Trøjejagt | #7855 (roadmap #5573) | `jersey_hunt_7855` | #8218: Fable bevist med forbehold; ejervalg navn/plads, S2, S3 afgjort | Hul 1 lukkes i næste race engine-session (ejer 16/11); tændes derefter alene |
| 9 | Træthed ved tidsgrænsen | #7715 | - | design "træthed koster tid" fundet (OneDrive `balance-internals/7715/2026-11-12/`) | Designkort til ejeren (fire valg) |
| 10 | Én planlægningsside | #7535 | `planning_workbench` | runde 3 i #8216; ejer: løftes markant | Visuelle valg for 8 punkter tegnes (bølge), ejeren vælger ét ad gangen |
| 11 | Enklere træningsvalg | #7947 | - | A/B/C for tunge (ejer) | 4 nye forslag "som i gamle dage" tegnes (bølge) |
| 12 | Hurtigere aftentræning | #6490 | - | planlagt | Design + målt baseline først |
| 13 | Udvikling af det, han gjorde i løbet | #5950 | - | planlagt | Hører til XP-sporet |
| 14 | Evner pr. naturlig rolle | #3813 | - | planlagt | Lander med XP |
| 15 | Indsatskort efter etapen | #5101 | - | planlagt | Mockup først |
| 16 | Spoiler-skjold | #7859 | - | planlagt | Design |
| 17 | Stabilt og hurtigere spil | #6917 (#6494, #7659) | - | i gang | Web 5x: værdi pr. trin med ejeren |
| - | Til dørs | #7638, #7003 | - | bygget og merget | Hjælp, patch note, bevis i prod |

Næste uge: #7708, #5850, #7096, #8034, #1833, #6944, #7924, #7455, #7805 (+ #7139, #7325 i masterplanen). Sæson 5: motor #6912, #7644, #8045, #7884.

## Drift

- Code scanning: PR #8217 merget, alarmer #388-#390 lukket.
- Patch notes: 7.451 (Træn nu) og 7.452 (rapport) merget; 7.453 (tre manglende) i PR #8227.
- Merge-køen satte issues til done med åbne PR'er: #8222 (bølge).
- "Vercel Security Review" rød på #8214: kræver ejerens login i Vercel for at se fundet.

## Log

- 16/11: siden oprettet; Træn nu og salgssum leveret; roadmap flyttet efter ejerens svar.
