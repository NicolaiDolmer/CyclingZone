# Prompt til natsessionen 9/10 → 10/10

Fortsæt Cycling Zone efter sessionen 9/10 aften. Læs FØRST `docs/NOW.md` (🎯 Next action), `docs/MASTERPLAN.md` og denne fil. Sæt 🤖 Working agent i NOW.

## Arbejdsform (bindende, uændret)
Opus leder/bygger; Fable kun designer + én dommer før motor-tænding. Parallelbyg kun via `wave.js` (4 laner, verify-semafor 2). ÉN merge-kø ad gangen (`scripts/merge-queue.ps1`), og vent kun på køen ved at læse "[OK] Hele merge-koeen": **STOP betyder stop, ikke "færdig"** (læring 9/10: #6393 blev merget på rød main). Regel 35(d): tekniske PRer og spillervendte med design-go merger du selv når testet+reviewet. **Prod-data og motor-tænding = ejerens ordrette "kør".** Spillervendt tekst (roadmap, Discord, patch notes til Discord) vises ejeren FØR den går live; ejeren poster selv på Discord. Copy: `docs/TONE_OF_VOICE.md` (jeg/I, aldrig vi, ingen tankestreger, ingen opfundne følelser). Ejeren sover: saml beslutninger op til morgenblokken, ét kort ad gangen med nøgletal + billede som fil.

## Status 9/10 nat (verificeret)
- **Motor:** `official_times_v2` er standard for alle nye løb (#6389) inkl. kalibrering #6376 + robust udbrud #6391 (kuperet ~0,38 / bjerg ~0,25 / højfjeld ~0,15 udbrudssejre, 0 egen-jagt, 0 30:00-klump). Tour de l'Hexagone søn 11/10 kl. 11 binder ved første etape. Første nye løb lør 10/10 kl. 12: **verificér `races.engine_rules_revision = official_times_v2`** på det første løb der claimes.
- **Grupetto/OTL:** ingen ny regel (ejer 9/10, #6199). Følg antal OTL i Touren efter hver bjergetape.
- **Træning:** `training_train_now`/`training_programs`/`training_groups` = on for alle (9/10 23:23). Patch note 7.349 = PR #6395 (em-dash rettet; merge når grøn). Åbent: #6123, #5825, #6027-#6006 ejer-luk.
- **#5268 evner:** apply kørt 9/10 23:15-23:50 (formel + trænet, ejer-regel). Backup `backup_5268_rider_derived_abilities_20261009`. **Kør kontrollen:** felter skrevet vs plan 8.443, 0 NULL tilbage, 0 fald, 0 ratingændringer, ingen skrevet værdi > 70 (tw_max 71 set midt i kørslen: tjek om den er fra backup/prior-født, ikke fra os). Patch note EN+DA for #5268 (kort: tomme Holdarbejde/Lederskab er fyldt; trænede point lagt oveni).
- **Udskudt af ejeren:** form #6156 tændingsdato (17/10 vs S5, kort klar på issuet) → morgenblok 10/10; moms #4511 (A anbefalet) → mandag 12/10.
- **Låst og klar til byg:** #4514/#4512 betaling fejler → Pro stopper + én besked (ejer 4/10). Beskedtekst vises ejeren før merge.

## Nattens opgaver (i denne rækkefølge, alle følges til dørs)

### 1. Patch notes: web og Discord til og med de sidste 7 dage (3/10-10/10)
- Sammenlign `frontend/src/data/patchNotes.js` (hjemmesiden, cyclingzone.org/patch-notes) med alle merged spillervendte PRer 3/10-10/10 (`gh pr list --state merged --search "merged:>=2026-10-03"`). Find huller: spillervendte ændringer uden patch note.
- Læs Discord #patch-notes (discord MCP, read-only) for samme periode og find versioner der står på web men ikke er postet. Saml de manglende til ÉT samlet EN-udkast (`docs/drafts/discord-patch-notes-catchup-2026-10-10.md`), rå tekst i kodeblok. Ejeren poster selv.
- Manglende web-patch notes: skriv dem (EN+DA) i én docs-PR og merge.

### 2. GitHub-audit (skill `github-housekeeping`)
- Dubletter blandt åbne issues (samme fejl/feature flere gange): forslag til hvilke der lukkes som dublet af hvilken.
- Issues hvor arbejdet er merget, men `claude:done` mangler → flip label (det må du selv, rule: markér done straks efter merge).
- `claude:done`-issues der stadig er åbne → liste til ejeren (ejeren lukker selv efter verifikation; giv én linje pr. issue om hvad der er verificeret).
- Rapport i `docs/audits/github-audit-2026-10-10.md`, kort.

### 3. MASTERPLAN + NOW ajour
- `docs/MASTERPLAN.md`: fjern alt der er færdigt (bl.a. motor-skiftet, udbrudskalibrering, træningspakken, #5268, #6111/#6383/#6053). Prioriteret kø efter det der brænder (Tour-drift, form #6156, betaling #4514/#4512 + moms, S5-skiftet 25/10). Budget ≤1.500 tok. **Rækkefølgen er ejer-godkendt: foreslå ændringer, omprioritér ikke selv.**
- Forslag til ændringer = ét kort til morgenblokken (før/efter-liste).
- Masterplan-artifact (https://claude.ai/artifact/UoZexVskbfA5xmvTnML4Bn): læs den, fjern det der er færdigt, opdatér med den nye kø og publicér til samme URL (Artifact-tool, `url`). Den må IKKE indeholde færdige ting.
- `docs/NOW.md`: ajour, budget ~1.200 tok.

### 4. Roadmap på hjemmesiden: komplet gennemgang + forslag (IKKE live uden ejer-go)
- Gennemgå roadmappet på hjemmesiden fra top til tå (find kilden i repoet: `frontend/src` roadmap-data/komponent, se `/roadmap`). Marker: hvad er færdigt og står stadig som "kommende", hvad er forældet, hvad mangler (træningspakken live, ny løbsmotor, form/formtoppe, S5-etapeprofiler, Udvikling 2.0, betaling).
- Lav forslagene som én PR (draft) + ÉT annoteret før/efter-billede (sendes som fil). **Merge først efter ejerens go.** Ejerens memory: "Today" skal være sand; roadbook uden datoer og tal, glad tone.
- Stil ejeren de nødvendige spørgsmål i morgenblokken, ét ad gangen.

### 5. Roadbook-opslag (Discord, EN) i ejerens tone
- Skriv ét roadbook-opslag: hvad jeg planlægger som de næste ting (fra den opdaterede MASTERPLAN/roadmap). Ingen datoer, ingen tal, glad tone, jeg-form, ingen opfundne følelser eller selvros. Fil: `docs/drafts/discord-roadbook-2026-10-10.md`, rå tekst i kodeblok. Ejeren godkender og poster selv.

### 6. Natbølge: mest værdi uden ejeren (efter 1-5, følg `docs/NIGHT_WAVE_RUNBOOK.md`)
Kun ting med låst design eller ren teknik (ingen nye spillervendte valg):
- #4514/#4512 betaling fejler → Pro stopper + én besked (låst 4/10; beskedtekst til ejeren før merge, PR som draft til morgen).
- #6123 nulstil individuel plan til holdprogram; #5825 fold programkatalog på mobil (træningspakken er nu live for alle).
- #6370 frontend-freshness falske røde + prod-domæne; #6318-opfølgning (30-min-jobs tæt på cron-bevisets deadline: deploy-verify ventede ~40 min pr. merge i aften).
- Mål-6-måleartefaktet (#6373, klassementsgruppen = svage top-10 sat af) → opret issue + fix i scorecardet.
- Bundle-budget: main ligger ~1 KB under loftet (1240/1241 KB). Find 5-10 KB at trimme (lazy-load), så hver UI-PR ikke skal hæve loftet.
Bølge-PRer uden patch note; samlet patch note ved close-out.

## Morgenblok 10/10 (kortene, ét ad gangen)
1. Form #6156 tændingsdato (17/10 samlet vs S5; kort på issuet). 2. MASTERPLAN-ændringer. 3. Roadmap-PR (billede). 4. Roadbook-opslag + catch-up patch notes til Discord. 5. GitHub-audit: done-issues til lukning + dubletter. 6. Betaling-beskedtekst (#4514). 7. PostHog-nøgle #6310 (ejeren opretter). Moms #4511 mandag.

## Laves IKKE
Nye features, Udvikling 2.0-byg (#6110), S5-etapeprofiler-byg, vækst/markedsføring, gen-tænding eller ændring af live motor uden ejer-go, CronCreate.
