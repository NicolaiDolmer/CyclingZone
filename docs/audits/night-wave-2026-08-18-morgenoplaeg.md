# Morgenoplæg — natbølge XL 18/8

## ØVERST: race_stage_timelines er stadig TOM
34 løb / 22.499 resultater importeret 17/8, flag `race_stage_timeline` ON, men tabellen har **0 rows**. Timeline-skrivningen fyrer altså ikke. Detector A-suppressionen må IKKE fjernes endnu, og Race Centre-draften (#3893) degraderer sin LIVE-film-linje til en neutral tekst indtil det er fikset. Hører til race-/kalendersporet i dag.

## Merged i nat (9 PR'er, 10 issues — alle done-flippet, backend-only bugfixes)
| PR | Issue | Hvad den gør |
|---|---|---|
| #3866 | #3653 | 99 catch-blokke i api.js sender nu Sentry-events; prod-500'ere er ikke længere usynlige |
| #3880 | #3578 | Bonus-tilbud-accept er atomar; tilbud kan ikke længere forsvinde uden udbetaling |
| #3887 | #2982 | Tvangssalg genoptager disposition efter crash i stedet for penge-uden-tab |
| #3895 | #2793 | Solgte akademi-ryttere tæller i akademi-regnskabet fremadrettet |
| #3870 | #2086 | AI-holds-wipe/slette-stier springer ryttere i igangværende løb over |
| #3875 | #3580 | Ejerskabs-guard i auktions-finalisering (Seojun Choi-sagen var en LOVLIG parkering der selv-helede; ingen reparation nødvendig) |
| #3869 | #3695+#3696 | Drift-vagterne: rigtige kolonnenavne + trend vender rigtigt |
| #3868 | #3587 | Board-cron logger heartbeat ved 0 handlinger |
| #3865 | #3753 | Token-gaten måler tokens; NB den FAIL'er nu reelt på NOW/MASTERPLAN (trimning = ejer-session) |

## Drafts til dit visuelle/faglige go (22)
**UI (screenshots i pr-screens/):** #3893 Race Centre (3858-*.png; 30-min LIVE-vindue er agentens eget valg — justérbar knap) · #3876 popularitet på profil+marked (3622-*.png) · #3874 badge-loft 9+→99+ (3439-*.png) · #3879 transferhistorik-oprydning (3708-*.png) · #3891 tidszone-dato-fix (delt formatDate, spillersynlig datokorrektion) · #3892 i18n-chunk-split (#3697, ændrer render-timing på 20 flader — ejer-go krævet)
**Migrationer (SQL reviewes før merge; apply post-merge per #2642):** #3873 season-end-idempotens (**skal applies FØR næste season-end — ellers 500'er endpointet**) · #3881 ejerskabs-audit (#3582) · #3877 dobbeltbooking-DB-invariant (#3420) · #3871 race_entries FK-CASCADE (#3817) · #3894 e-mail-retry (#3585+#3600, loopet stadig slukket)
**Backend/ops uden migration:** #3878 sælger-gulv (#2836) · #3882 starter-kontrakter 2-3 sæsoner (#3037) · #3883 dobbeltbooking-vagt-kadence (#3415; agenten bad selv om dit blik) · #3885 byttehandel akademi-cap (#2797; **rører patchNotes.js med egen v7.139-entry — afstem med udkastet**) · #3886 sikker rytter-sletning m. budgiver-notifikation (#3594) · #3872 bonus-kompensations-script (#3655) · #3884 grace-fallback 60→0 (#3740) · #3889 patch note-guard (#3638, ny CI-workflow) · #3890 working-agent-hooks (#3712; ændrer .claude/settings.json — derfor dit blik) · #3867 Vercel ignore-fix (#3838) · #3888 DOMAIN_REFERENCE-afsnit (#3752, docs-only, kan merges direkte)

## Dry-run-tal (ingen prod-mutationer udført)
- **#3655:** Præcis 4 hold / 800.000 mangler: Team WolkerWessels, Aquila-L3gatus, Team Hansen Pro Cycling, Pro Cycling Team (200.000 hver). Script klar i PR #3872; kørsel kræver dit go + dine 3 beslutninger på issuet.
- **#3614:** 141 team-løse ungdomsryttere over båndet; 21 ryttere (evne 42-54) bærer 94 % af værdien. Anbefaling B (fuld nedjustering, 139 uden aktiv auktion) postet på issuet — dit metodevalg.
- **#3817:** 36 forældreløse race_entries bekræftet; FK-fix i PR #3871, skæbnen for de 36 rows er din beslutning.

## Housekeeping (rapport: night-wave-2026-08-18-housekeeping.md)
28 lukket med evidens · 11 sprunget over (reelt ikke færdige) · **6 i ejer-bundt** — vigtigst: #2840 (dagsbaseret løn er bygget men står stadig på season_upfront i prod) og #3134 (fair-play-spærrer bygget men slukket).

## Ikke leveret (3 spor)
- **Trænings-klyngen #3815+#3651+#3761:** 2 forsøg (110+180 min), intet output — tag i dagsession.
- **#3722 .single():** kun lille start i worktree fix-3722-holdopslag-tilstande.
- **#3684 pixel-maskering:** fixet ligger klar i worktree fix-3684-pixel-maskering; snapshot-refresh (alle 3 projekter) kørte muligvis stadig som løsreven proces ved close-out — tjek `git status` i worktree'et; e2e-låsen er fjernet.

## Afvigelser du bør kende
#3875 auto-mergede før agentens "hold til #3582 er live"-anbefaling (ufarligt, dokumenteret på #3580) · #3594-agenten rørte kortvarigt hoved-checkoutet (gendannelse verificeret) · #3626 var allerede løst (typen vises siden 25/7) — agent gensendte dit åbne spørgsmål på issuet · patch note-udkast: night-wave-2026-08-18-patchnote-udkast.md (post ikke selv; jeg opdaterer PatchNotesPage når du siger go).
