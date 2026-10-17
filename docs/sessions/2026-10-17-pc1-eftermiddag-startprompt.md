# Startprompt: pc1 lang session 17-18/10 (ejeren er primært væk)

Kopiér alt under linjen ind i en ny Claude Code-session på pc1 (mappe `C:\dev\CyclingZone`). Sessionen må køre over 20 timer.

---

Ny lang session på pc1, lørdag 17/10. Kør `git pull --ff-only` og `npm run sync-deps`, og læs `docs/NOW.md` og denne fil. **Svar på dansk i ALLE beskeder, også korte.** Jeg giver eksplicit opt-in til multi-agent-orkestrering via wave.js. Du er den eneste aktive session og ejer merge-køen.

**Rammer (ejer-godkendt 17/10)**
- **Kapacitet:** fuld bølge (`wave.js`, pc1-loftet). opus på motor, DB, penge og sikkerhed; sonnet på UI og ops. `model` skal stå eksplicit på hver agent. Mange tokens er OK; meld anomalier.
- **Merge-mandat, regel 35:**
  - Tekniske PR'er og motor bag en slået-fra revision merges ved grøn CI + review-gate.
  - UI og spillertekst venter på mit visuelle go. Læg ét annoteret før/efter-billede på PR'en.
  - Flag-flip, tænding og prod-dataændringer kræver ALTID mit ordrette "tænd"/"kør" pr. skridt.
- **Merge-køen:** `scripts/merge-queue.ps1`, én proces ad gangen.
  - Tjek selv din venteløkke efter 5 minutter. 17/10 ventede en løkke 50 min på en tekst, den aldrig kunne se.
  - Codex-stopregel: efter 2. runde → opfølgnings-issue, og merge ved grøn CI.
- **Kontakt:** kun ved beslutninger. Saml dem op; send et kort med PNG-billede (SendUserFile), når noget kræver mit go. Ellers højst en kort status hver 4. time (PushNotification). Jeg svarer fra telefonen.
- **Nye idéer:** byg kun det, der står her eller allerede er designet og godkendt. Nye idéer skrives i idébanken (afsnit 7) med anbefaling.
- **Kvalitet:**
  - Motor/DB: design + målt baseline før 1. PR (AGENTS 36).
  - Balance-tal kun i `balance-internals/` (regel 17).
  - Ét issue pr. spor; done-flip straks efter merge.
  - Commit kun bag guarden og aldrig `--no-verify`.

## 0. Start og verifikation (første time)

1. **S5-motorreglerne er tændt (#6699, merget 17/10 08:48).** Kl. 13:00 dansk tid starter dagens første etape; verificér at nye løb binder til `s5_profiles_v1` (`races.engine_rules_revision`), og at de første S5-etaper kører uden Sentry-fejl. Søndag kl. 11:00: Vuelta Ibérica (4963a82d) skal binde til S5. Afvigelse → STOP og meld.
2. Sentry 24 t (`scripts/sentry-issues.mjs`) + Supabase advisors. Kendt: #6504 (CYCLINGZONE-9B).
3. Opret ét samle-issue for sessionen med tjeklisten nedenfor.

## 1. Sæsonskifte 25/10 uden fejl + klar til 10x managere (højeste prioritet)

1. **Fuld generalprøve af sæsonskiftet** som tørkørsel mod en kopi af prod-data: aldring/pension (#5833, plan `docs/superpowers/specs/2026-10-16-5833-foedselsdage-aldring-pension-plan.md`), oprykning/graduering, kontraktudløb, bestyrelse (#6130 #6122), akademi, præmier/økonomi, ny S5-kalender (28/10). Ingen prod-skrivning. Rapport: fejl, rettelser, risici. Brug eksisterende staging; ingen nye løbende udgifter.
2. **Lasttest 10x dagens peak** på staging (#6275, #5904-gaten). Mål aftenspidsen (#6490) og API-svartider om etape-tick (#6273).
3. Byg det der følger af målingerne og allerede er designet: job-kø/backpressure (#6491, #6134), PostgREST-timeouts (#6184), ekstern DB-alarm (#6272). Tekniske PR'er merges efter regel 35.
4. #5864 og øvrige sæsonskifte-issues fra MASTERPLAN 🟠 3.

## 2. Motor og realisme (ny revision `s5_profiles_v2`, SLÅET FRA)

S5 er live, så al ny motoradfærd skal i en ny revision; `s5_profiles_v1` skal forblive byte-identisk.
1. **Motor-testport (byg først, ren tooling):** én kommando der kører alle kommende løb (`tourDryRun` pr. løb, 8 seeds, aktuel mod ny revision, 4+ spor) + `s5MotorBench --scope=all` og laver ét samlet kort med de samme mål hver gang (scorecard-mål, hårde gates, udbrud pr. terræn, favorit-udbrudssejre, GC-vinder fra udbrud, tidlige indhentninger). Skabelon: `balance-internals/6367/s4-full-2026-10-17/` (`run-shard.sh`) og samle-scriptet fra 17/10.
2. **Udbrud på kuperede etaper og mure** (#6748 punkt 3; S4 17/10: S5 6 %, v5 12 %, virkelighed ca. 30-40 %): design + baseline → byg i `s5_profiles_v2`.
3. **Formtoppe virker igen fra nu af** (#6156, ejer 17/10): toppens effekt i motoren i `s5_profiles_v2` (tændes på mit "tænd", ikke først ved S5).
4. **Formtoppe gives tilbage + ingen straf** (#6158, ejer 17/10): toppe brugt uden virkning gives tilbage, og nedgangen efter en top der ikke gav bonus fjernes. Tørkørsel med tal (antal hold/ryttere/toppe) → kort til mig → prod-skrivning kun på "kør", med backup og post-verify.
5. **S5-kanttilfælde** #6748 punkt 1, 2, 4, 5, 6: ret i `s5_profiles_v2` / løbsfilmen.
6. Testporten på `s5_profiles_v2` + uafhængig dommer (Fable, read-only) → tænd-kort med billede og patch note (EN+DA) til mig.
7. **Dagsform og dominans** (#6649): kun design + målt baseline med A/B til mig.

## 3. Spilleroplevelse (UI merges på mit visuelle go)

1. **Fejl og hastighed:** Firefox-crash på løbssiden (#6698, CYCLINGZONE-9H), dashboard der venter 1-2,6 s (#6569).
2. **Dark mode-gennemgang:** jeg har set dagsbåndet på Holdudtagelse → Dag (næsten usynligt) og "Kun beta"-kontakten i Patch notes (usynlig når slukket). Skærmbilleder af alle manager-sider (desktop 1440 + mobil 375), mål WCAG AA (tekst 4,5:1, kontakter/kanter/bånd 3:1), ret via design-tokens i ét spor.
3. **Løbsfilm for endagsløb** (#6512).
4. **Vis regelversion** pr. løb (#6351) og **ét farvet terræn-ikon pr. etapetype** (#6683).
5. **Etapesiden 2.0** (#6570: road book-profil, stigningskort, løbet på profilen).
6. Løbsfilmens tidspunkter (#6350) og gab-kurven for nyt udbrud (#6748 punkt 4).
Følg `PAGE_TEMPLATES.md` + `TASTE.md`; nye filer `.ts/.tsx`; EN+DA. Patch note samles ved close-out.

## 4. Vækst og kommunikation (kun udkast, jeg sender selv)

1. S5-lanceringsopslag pr. målgruppe til torsdag 22/10 (GDD D-005), engelsk, rå kodeblok, med billeder.
2. S5-mail til sovende spillere med samtykke (#6554): udkast + PNG-eksempel.
3. Discord-svar: Friis (dansk: rytterne er frigivet, skade efter udtagelsen koster ikke længere starten) og knud (engelsk: badget på Daily Training er rettet).

## 5. Søndag 18/10 (mind mig, gør det kun på mit ord)

- Flip `promotion_pending_enabled` (55 ryttere i tørkørslen 16/10; ny tørkørsel først) på mit ordrette "tænd", help.json samme dag, post-verify.
- Discord-webhook i Infisical: jeg kører `infisical secrets set "DISCORD_BETA_WEBHOOK_URL=$(Get-Clipboard)" --env=prod`.
- Roadbook + Discord 7.361-7.367 (jeg poster). Go på #6680 med nye billeder. Jeg lukker #6740.

## 6. Venter på mig (spørg ikke før jeg selv tager det op)

- #6739 (små hold mister etapeløb, A/B): "spørg mig senere".
- #6665 forside, #6643 løbshistorie-beta, #6248 træningsregel.

## 7. Idébank (skriv forslag, byg ikke)

Tænk stort: hvad skaber markant mest værdi for spillerne, for mig og for driften ved 10x managere? Kilder: GitHub-issues, Discord, motor-gennemgangen (`docs/audits/2026-10-15-motor-gennemgang.md`, "Verdensklasse-retning"). Hvert forslag: problem, løsning, værdi, omkostning, anbefalet dag. Vis mig de 5 bedste som ét kort.

## Close-out (før du stopper, også ved >20 timer)

- NOW.md: Next action + Working agent nulstillet. GitHub-audit (done-sweep).
- `check-agent-token-hygiene.ps1`, `close-out-cleanup.ps1`, `generate-status-board.mjs`.
- Startprompt til næste session.
