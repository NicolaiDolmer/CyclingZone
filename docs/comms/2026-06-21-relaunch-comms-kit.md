# Relaunch comms-kit: varsling til spillere ved relaunch

> **Status:** EJER-PREP-dokument. Struktur + fakta-skelet leveret af AI. **Al founder-prosa skriver ejeren selv** (jf. `feedback_founder_voice_owner_writes`, founder-voice-læring 10/6). Markeret `[FOUNDER-PROSA: ejer skriver]`.
> **Issue:** [#1278](https://github.com/NicolaiDolmer/CyclingZone/issues/1278): relaunch-kommunikation til spillere.
> **Oprettet:** 2026-06-21.
> **ToV-reference:** følg `docs/TONE_OF_VOICE.md` (founder-led, EN-first/DA-second, jeg-stemme, ingen em-dash). Founder-voice-skabelon: samme dok, sektionen "Founder voice: template".

---

## 0. Kontekst + hvilken relaunch dette dækker (læs først)

**Vigtig afklaring ift. issue-teksten.** #1278 blev skrevet med antagelsen om ét hard-reset 20/6. Virkeligheden pr. 2026-06-21 (verificeret i `docs/NOW.md` + `project_forever_relaunch_readiness`):

- En **frisk uafhængig sæson 1 gik allerede LIVE 18/6** (22 hold, fiktive ryttere, eget værdisystem, 22 founder-badges tildelt). Den relaunch er udført.
- Den relaunch dette kit skal dække er **"forever-relaunch"**: **ét sidste reset → permanent, ingen flere nulstillinger** (ejer-beslutning 19/6, spec `docs/superpowers/specs/2026-06-19-forever-relaunch-readiness-design.md`).
- Forever-relaunch er **ikke dato-fikseret** (blødt pejlemærke før TdF 4/7). Den udløses når readiness-gaten er grøn (blockers lukket + automatisering bevist + granit-frys ejer-godkendt), med frisk backup umiddelbart før.

**[EJER-BESLUTNING: hvilken relaunch kommunikeres?]**
- **A: Kun forever-relaunch (det permanente, kommende reset).** Benefit: ét klart budskab, "dette er sidste gang." Cost: kræver at datoen/vinduet er kendt før udsendelse. Alternativ: send teaser nu + endelig varsling når vinduet låses.
- **B: To-trins: (1) "fundamentet er skiftet" om 18/6-sæsonen der allerede kører nu, (2) forever-varsling senere.** Benefit: rydder den forældede faseplan-forvirring på Discord (observeret 9-10/6) med det samme. Cost: to udsendelser.
- *Faktagrundlag for begge er i dette kit; selve valget er ejerens.*

**Datofelt der skal bekræftes før udsendelse:** `[EJER: relaunch-dato/-vindue]`: bruges alle steder nedenfor hvor `{RELAUNCH_DATO}` står. Indtil låst: `[antagelse]` at det er "før TdF 4/7".

---

## (a) FAQ-struktur: hvad et relaunch/reset betyder for eksisterende testere

> **Format:** EN-first, DA-second (ToV language-priority). Hver post = spørgsmåls-stamme + faktiske svar-bullets. **Den varme founder-framing/indledning skrives af ejeren**: markeret pr. sektion.
> **Mål-fil ved publicering:** `frontend/.../help.json` (en + da), per close-out-rutine #1171. Dette er kildeteksten, ikke selve JSON'en.
> **Faktakilder:** #1105 (epic), #1103 (relaunch-orchestrator + founder-badge, CLOSED = shipped), `project_forever_relaunch_readiness`.

`[FOUNDER-PROSA: ejer skriver en kort, varm indledning til FAQ-blokken: fx hvorfor dette reset sker og hvad det betyder for tilliden. 1-3 sætninger i jeg-stemme.]`

---

**Q1. EN:** "What happens to my team and riders when the season resets?"
**DA:** "Hvad sker der med mit hold og mine ryttere når sæsonen nulstilles?"

Fakta-bullets:
- All teams and riders are reset to a fresh start. / Alle hold og ryttere nulstilles til en frisk start.
- Everyone restarts from roughly the same place (owner decision 6/6: "alle kommer ind på cirka samme sted"). / Alle genstarter fra cirka samme udgangspunkt.
- The riders you currently hold do not carry over. / De ryttere du har nu, følger ikke med over.
- `[antagelse]` Existing real-name riders are retired (kept for history/rollback), not active; only fictional riders are active. Grounded in #1103 population-swap (`pcm_id IS NOT NULL → is_retired`). Confirm wording with owner. / Bekræft formulering med ejer.

**Q2. EN:** "Do I keep my account, or do I have to sign up again?"
**DA:** "Beholder jeg min konto, eller skal jeg oprette mig igen?"

Fakta-bullets:
- Your account is preserved. Only the game-state (teams, riders, money) is reset. / Din konto bevares. Kun spil-tilstanden nulstilles.
- You do not need to sign up again. / Du behøver ikke oprette dig igen. (Grounded: #1103 acceptance "Brugerkonti bevaret (kun game-state nulstillet)".)

**Q3. EN:** "What happens to my money / budget?"
**DA:** "Hvad sker der med mine penge / mit budget?"

Fakta-bullets:
- Budgets reset along with the rest of the game-state. / Budgetter nulstilles sammen med resten af spil-tilstanden.
- `[antagelse]` Start budgets/squad rules may differ from the current season (e.g. weaker starting squads → more free budget, ref #1487). Owner to confirm whether to mention start-economy specifics. / Ejer afgør om start-økonomi-detaljer skal nævnes.

**Q4. EN:** "I'm making transfer decisions right now. Are they pointless before the reset?"
**DA:** "Jeg træffer transferbeslutninger lige nu. Er de ligegyldige inden resettet?"

Fakta-bullets:
- This is the exact confusion observed on Discord 9-10/6 (#spørgsmål-og-svar): players answered each other with the old phase-plan. This FAQ exists to replace that. / Dette svarer på præcis den forvirring der blev observeret på Discord 9-10/6.
- Factual answer depends on timing: purchases made before the reset do not carry into the fresh season. / Køb foretaget før resettet følger ikke med ind i den friske sæson.
- `[EJER-BESLUTNING: hvor direkte siger vi "vent med store køb"?]` A: eksplicit råd om at vente (benefit: ærligt, sparer spillere for spildt indsats; cost: kan dæmpe aktivitet før reset). B: neutralt faktasvar uden råd (benefit: ingen aktivitets-dæmpning; cost: nogle spiller spilder indsats). Ejer vælger tone.

**Q5. EN:** "Why is the season being reset at all?"
**DA:** "Hvorfor nulstilles sæsonen overhovedet?"

Fakta-bullets (neutrale; founder-framing ovenpå skrives af ejer):
- The game moved to a fresh, independent season 1: fictional riders, the game's own value system, the game's own race engine. / Spillet er gået til en frisk, uafhængig sæson 1: fiktive ryttere, eget værdisystem, egen race-motor.
- PCM/UCI data and real rider names are being removed from the game. / PCM/UCI-data og rigtige rytternavne fjernes fra spillet. (Grounded: #1105 "UCI/PCM væk fra UI + pipeline"; forever-spec "PCM slettes HELT".)
- `[antagelse]` This (forever-) reset is the **last** reset; after it the game is permanent with no further resets. Confirm before stating publicly. / Bekræft før det siges offentligt at det er sidste reset.

`[FOUNDER-PROSA: ejer skriver "hvorfor"-narrativet: den ærlige begrundelse for skiftet væk fra rigtige data og hen mod et permanent spil. Dette er kerne-founder-stemme.]`

**Q6. EN:** "Is this the last reset, or will my progress be wiped again later?"
**DA:** "Er det her det sidste reset, eller bliver min fremgang nulstillet igen senere?"

Fakta-bullets:
- `[antagelse → ejer-bekræft]` This is intended as the final reset. From this point the game is permanent (no reset safety-net). Grounded in forever-relaunch owner decision 19/6, but the public promise is the owner's to make and time. / Dette er tænkt som det sidste reset; men det offentlige løfte er ejerens at give og time.
- `[EJER-BESLUTNING]` Skal "no more resets, ever" siges nu, eller først når vinduet faktisk udløses? A: sig det nu (benefit: stærkt tillidssignal; cost: bindende løfte før alt er bevist). B: vent til reset er udført (benefit: ingen risiko for at bryde løftet; cost: misser tillidsmomentet). 

**Q7. EN:** "Do I get anything for having played during the beta?"
**DA:** "Får jeg noget for at have spillet i beta'en?"

Fakta-bullets:
- Yes. Beta testers receive a permanent **Founder** badge as recognition. / Ja. Beta-testere får et permanent **Founder**-badge som anerkendelse.
- The badge survives future resets (excluded from reset-clearing). / Badgen overlever fremtidige resets.
- (Grounded: #1103 founder-badge def + `manager_achievements` insert + undtaget fra `resetBetaAchievements`. 22 founder-badges blev tildelt ved 18/6-relaunch per `docs/NOW.md`.)
- Use the term **Founder** alone, not "Founder Supporter" (ToV forbudt-term). / Brug **Founder** alene.

**Q8. EN:** "What is changing about how races are run?"
**DA:** "Hvad ændrer sig i måden løb afvikles på?"

Fakta-bullets:
- Races now run on the game's own engine instead of imported PCM results. / Løb afvikles nu på spillets egen motor i stedet for importerede PCM-resultater.
- `[antagelse]` Race names and routes are becoming the game's own (away from real-world names), ref WS3 / #1571 / #1586. Owner to confirm what is live vs. pending at send-time. / Ejer bekræfter hvad der er live vs. udestående ved udsendelse.
- Keep this answer light unless owner wants engine-depth detail. / Hold svaret let medmindre ejer vil have motor-dybde med.

**Q9. EN:** "When does this happen?"
**DA:** "Hvornår sker det?"

Fakta-bullets:
- `[EJER: indsæt {RELAUNCH_DATO}/-vindue]`. Until locked: do not state a hard date. / Indtil låst: angiv ikke en hård dato.
- `[antagelse]` Soft target before TdF (4/7), not date-fixed. / Blødt pejlemærke før TdF, ikke dato-fikseret.

---

## (b) Patch-note SKELETON (in-app PatchNotes)

> **Mål-fil ved publicering:** `frontend/src/.../PatchNotesPage.jsx` (per close-out-rutine #4 + `feedback_patch_notes`). Versionsnummer tildeles ved publicering (seneste pr. NOW.md var v5.69+; konsolidér mod aktuel HEAD ved merge: undgå version-kollision, jf. `feedback_patch_notes_version_merge_conflict`).
> EN + DA overskrifter; faktiske ændrings-bullets; **founder-intro = placeholder**.

**Heading: EN:** `Fresh season 1: the relaunch`
**Heading: DA:** `Frisk sæson 1: relaunchet`

`[FOUNDER-PROSA: ejer skriver intro-afsnit, 2-4 sætninger, jeg-stemme. Hvad/hvorfor + hvad det betyder for spilleren. Følg founder-voice-skabelon i TONE_OF_VOICE.md.]`

**Change bullets (fakta; EN-first / DA under):**
- EN: Everyone restarts on a fresh season 1, from roughly the same place.
  DA: Alle genstarter på en frisk sæson 1, fra cirka samme udgangspunkt.
- EN: Riders are now fictional. Real rider names and PCM/UCI data are gone from the game.
  DA: Ryttere er nu fiktive. Rigtige rytternavne og PCM/UCI-data er væk fra spillet.
- EN: The game now uses its own value system for riders (no UCI points).
  DA: Spillet bruger nu sit eget værdisystem for ryttere (ingen UCI-point).
- EN: Races run on the game's own engine.
  DA: Løb afvikles på spillets egen motor.
- EN: Your account is kept. Only your team, riders and budget were reset.
  DA: Din konto er bevaret. Kun dit hold, dine ryttere og dit budget blev nulstillet.
- EN: Beta testers received a permanent Founder badge.
  DA: Beta-testere har fået et permanent Founder-badge.
- `[antagelse: ejer bekræfter inkluder/ekskluder]` EN: This is the last reset; the game is now permanent. / DA: Dette er det sidste reset; spillet er nu permanent.

**Bullets der KRÆVER ejer-faktatjek før de skrives ind:**
- Eksakt start-budget/squad-regler (ref #1487): kun hvis ejer vil nævne tal.
- Egne løbsnavne/ruter live-status (WS3 #1571/#1586): afhænger af send-tidspunkt.

---

## (c) Discord-announcement SKELETON

> Struktur + faktiske bullets. **Voice/prosa = ejerens** (Discord-announcements er eksplicit founder-stemme i ToV). Følg founder-voice-skabelon i `docs/TONE_OF_VOICE.md`.
> Posting-konvention fra ToV: EN-post først, DA-version i tråd nedenunder. Jeg-stemme. 1-til-1 ("you"/"du"). Ingen em-dash.

**Slot 1: Opening hook**
`[FOUNDER-PROSA: ejer skriver åbnings-linjen. Fx "I want to be straight with you about what's about to change." Ikke AI-formuleret.]`

**Slot 2: What's changing (fakta: ejer omskriver til egen stemme):**
- Fresh season 1; everyone restarts from roughly the same place. / Frisk sæson 1; alle genstarter fra cirka samme sted.
- Fictional riders; PCM/UCI and real names removed. / Fiktive ryttere; PCM/UCI og rigtige navne fjernet.
- Own value system + own race engine. / Eget værdisystem + egen race-motor.
- Account kept; only game-state reset. / Konto bevaret; kun spil-tilstand nulstillet.

**Slot 3: Why it matters (fakta-anker; founder-narrativ ovenpå):**
- Replaces the outdated phase-plan some of you were still answering each other with (the old "2-seasons-PCM" plan no longer applies). / Erstatter den forældede faseplan nogle af jer stadig svarede hinanden med.
- `[antagelse]` This is the last reset; the game becomes permanent after it. / Dette er det sidste reset; spillet bliver permanent derefter.
- `[FOUNDER-PROSA: ejer skriver hvorfor dette gør spillet bedre/mere fair/mere holdbart.]`

**Slot 4: Recognition (fakta):**
- Beta testers get a permanent Founder badge. / Beta-testere får et permanent Founder-badge.
- `[FOUNDER-PROSA: ejer skriver tak til de tidlige testere i egen stemme.]`

**Slot 5: Timing + ask/CTA**
- Timing: `[EJER: {RELAUNCH_DATO}/-vindue]`. `[antagelse]` før TdF 4/7, ikke dato-fikseret.
- `[FOUNDER-PROSA: ejer skriver CTA: fx hvor man stiller spørgsmål, og at kritisk feedback er velkommen (matcher build-in-public-tonen i ToV launch-post-eksemplet).]`

---

## Publicerings-tjekliste (når ejer har skrevet prosaen)

- [ ] `{RELAUNCH_DATO}`/-vindue låst og indsat alle steder.
- [ ] Alle `[antagelse]`-flag verificeret af ejer (særligt: "sidste reset"-løftet, start-økonomi-tal, løbsnavne live-status).
- [ ] EN-first / DA-second gennemgået i alle tre kanaler.
- [ ] Ingen em-dash (CI `tone-check-em-dash.mjs` dækker locales/PatchNotes; Discord-post tjekkes manuelt).
- [ ] Ingen ToV-forbudte termer ("Founder Supporter", "sprint", "støt", "full-time" osv.).
- [ ] `help.json` (en+da) opdateret med FAQ.
- [ ] `PatchNotesPage.jsx` opdateret + versionsnummer uden kollision.
- [ ] Discord-post: EN først, DA i tråd nedenunder.
