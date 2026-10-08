# Prompt til næste Claude Code-session (skrevet 8/10 aften)

Kopiér alt under linjen ind i en ny Claude Code-session i `C:\Dev\CyclingZone`.

---

Fortsæt Cycling Zone efter sessionen 8/10. Læs FØRST `docs/NOW.md` (🎯 Next action), `docs/MASTERPLAN.md` og denne fil. Dette er eneste aktive session; sæt 🤖 Working agent i NOW.

## Sessionens ene mål (ejer 8/10)
**Tour de l'Hexagone (D1, 18 etaper) starter søndag 11/10 kl. 11 og skal køre fejlfrit, og træningens løfter skal lande.** Spillerne er frustrerede over motoren (stjerner/GC i udbrud, eget hold jagter, tidsgab, film/mærker passer ikke) og træningen (udvikling, kan ikke se hvad træningen gav, Train now-lås). "Ikke flere fejl nu." Høj kvalitet, men hurtigst muligt: Touren må gerne være klar før lørdag, hvis kvaliteten er i orden.

## Arbejdsform (bindende, ejer 8/10)
- **Model:** Opus leder og bygger; Fable til formdesignet, etapeprofil-designet og som én dommer før motoren tændes. Sonnet til UI/ops/docs, Haiku kun til mekaniske tjek med skema + efterkontrol (`docs/AI_CHANNEL_ROUTING.md` §Model og effort). Codex kun hvis Claude mener den er bedre, og ejeren starter den.
- **Design før byg** (AGENTS hard rule 25, skærpet 8/10): også rettelser der ændrer hvad spilleren ser. Billede/mockup til ejeren FØR byg.
- **Merge-regel 35(d):** tekniske PR'er uden spillervendt indhold og spillervendte PR'er med design-go før byg merger Claude selv ved grøn CI + opus-review uden blokerende fund og melder bagefter. Prod-dataændringer og motor-tænding kræver ejerens "kør"/go pr. skridt.
- **Bølger** via `wave.js` (4 laner). Laner kører hele pakkens test + lint + CI-vagter før ready (#6357). Færdiggør før nyt.
- **Spillerstatus hver dag** (EN, Discord, ejeren poster) + roadmap synket dagligt (memory `feedback_daily_player_status`).
- **Motor/træning:** 14 dages Discord-sweep → verificerede issues → design ét ad gangen → test mod virkelig cykelsport (memory `feedback_engine_training_trust_first`). Sweep blev lavet 8/10; genbrug den (issues #6349-#6352 oprettet).
- Ét spørgsmål ad gangen med anbefaling; nøgletal i selve kortet; billeder som fil.

## Rækkefølge
1. **Bølge med to Tour-kritiske opfølgninger** (stoppet 8/10 før start, branches rene og pushet):
   - #6330 (`codex/6199-shared-group-clock`, revision `official_times_v2` = v3 + samlet tidsmodel): motoren skriver `exact_km` (og evt. `exact_time`) på gruppe-hændelser under official_times_v2 — ejer: nye etaper UDEN km-spænd, "virkelighedstro, som at læse et løb live"; ingen `breakaway_caught` når en udbryder kommer tilbage til sit eget udbrud; DB-CHECK-proposalen som rigtig migration så `races.engine_rules_revision` tillader `official_times_v2`; SSOT-inkonsistenser (RACE_ENGINE_RULES "Samlet tidsmodelprototype", header i `mechanics/timeModel.ts`). CURRENT_RACE_RULES_REVISION røres ikke.
   - #6355 (`fix/6294-6350-marks-and-film`, design-go 8/10): rød perf-gate + frontend-build; tabs-liste/placeringstabel skal bruge samme ærlige km som filmen; sorterede events i findMorningCatch.
2. **Morgen med ejeren, i denne rækkefølge:** (a) Train now-lås synlig (#6139) — design-go på mockup; (b) #5268 evner: hvad betyder "evnerne flyttes" (valg A 1/10 = opfyldning af tomme Holdarbejde/Lederskab med fødselsformlen) — følg til dørs samme dag; (c) form #6156: 7 beslutningskort fra Fable-forberedelsen (privat: OneDrive `CyclingZone-context/private-handoffs/2026-10-08-claude/form-6156-designmoede-9-10.md`), inkl. ejerens idé: lad form vente til S5; (d) **grupetto/tidsudelukkelse** (#6330: OTL sker oftere end i v3 på hårde bjergetaper — ny spillervendt regel, beslutningskort før Touren tændes); (e) betaling + moms (#4511 A anbefalet, #4514/#4512, slå Alunta "Betaling fejlet" + "Betalingsopfølgning" til); (f) secret `POSTHOG_PERSONAL_API_KEY` (#6310).
3. **Merge** efter regel 35(d) når CI grøn (actionlint-hikke = genkør): #6325, #6348, #6357, #6353, #6354, #6330 (efter opfølgning), #6355 (efter opfølgning). **#6053 må IKKE merges** før ejerens go.
4. **Tour-gennemtest:** `infisical run --env=prod -- node backend/scripts/dev/tourDryRun.mjs "--race-name=Tour de l'Hexagone" --revision=official_times_v2 --compare=orders_gc_v2 --seeds=5` (Infisical skal være logget ind — ejer). Benchmark-båndene markeret "forslag" godkendes af ejeren. Fable som dommer. Ét annoteret før/efter-billede → ejer-go → sæt revisionen for Touren → frys. Ikke grøn lør kl. 18 → Touren kører på `orders_gc_v2`, og spillerne får det at vide.
5. **Træning:** #6139 Train now-lås, #6027 4 af 5 dage, #6123 nulstil til holdprogram, svar om 1.759 tabte træningsdage (#5912, lovet 30/9).
6. **Etapeprofiler S5** (epic #6369, designgrundlag `docs/superpowers/specs/2026-10-08-s5-etapeprofiler-design-brief.md` inkl. §Runde 2): designmøde med ejeren mellem fredag og mandag EFTER motor, træning og database; 7 kort; S5-kalender live senest lør 18/10 (efter pause-afstemningen #5833).
7. **Hvis tid:** Codex' overdragne spor uden spillereffekt: #5904 staging-data, #6324, #6290, #6314 Sentry-opfølgning, #6184/#3511 tjeklister, #6358 deploy-verify NEED_RAILWAY.

## Laves IKKE i denne session (ejer 8/10)
Nye features (fx #5105), Udvikling 2.0-byg (#6110; kun designkort), byg af S5-etapeprofiler (kun design), vækst og markedsføring.

## Status ved overlevering (8/10 aften)
- Merget i dag: #6310 (chunk-fejl; første prod-build uploadede 780 filer — tjek at andet frontend-deploy bærer gamle filer videre), #6340 (Next.js-sikkerhed, 0 åbne alerts), #6347, #6345, #6346 (RLS: rytterlister 25 ms i prod), #6297, #6356 (patch 7.346 live).
- Prod-data: Tour etape 11 → kuperet, etape 8 → bjerg m. nedkørsel (#6332, backup `backup_6332_race_stage_profiles_20261008`).
- Klar til spillerne (ejeren poster): dagens Discord-status + pause-polls (#5833) — se #5833-kommentaren og sessionens chat; patch 7.346 Discord-udkast i `docs/drafts/discord-patch-notes-2026-10-08.md`.
- Roadmap: 8 etapeprofil-idéer oprettet (sort_order 150-157).
- Masterplan-artifact: https://claude.ai/artifact/UoZexVskbfA5xmvTnML4Bn
