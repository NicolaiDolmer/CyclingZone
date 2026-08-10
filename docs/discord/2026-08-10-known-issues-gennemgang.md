# Gennemgang af `docs/discord/2026-08-10-known-issues.md` efter nattens arbejde

**Ejeren poster selv. Denne fil er en gennemgang, ikke en besked.**

Alle tal nedenfor er mine egne kørsler mod det daterede 10/8-snapshot (n=8.199),
paritets-bevist mod repoets egne funktioner (16.398 sammenligninger, 0 afvigelser).

## Kort svar

**Tre linjer holder ikke længere.** Alle tre handler om det samme: udkastet beskriver
"one-time correction" som noget der venter forude, men **label-halvdelen kørte allerede af
sig selv 9/8 kl. 22**, og loft-halvdelen kører automatisk ved næste sweep. Én linje er
desuden for pessimistisk: bjergtræningen bliver bedre, ikke værre.

Resten af teksten holder.

---

## Linje for linje

### ❌ 1. "Too many fighters (root cause fixed Aug 10, **visible from Aug 16**)"

**Holder ikke.** Overskriftens dato er forkert for de ryttere spillerne allerede ejer.

`riderTypesBaselineYouth.json` gik live **9/8 kl. 18:53** (`a61635a4`, PR #3571), og
nattens sweep 9/8 kl. 22 skrev nye typer med den. Målt på de 952 menneske-ejede ryttere
under 22: baroudeur-andelen er **allerede faldet fra 74,1 % til 16,2 %**. Beviset for at
det var 74,1 % før: 846 af de 952 rytteres `ability_caps` matcher stadig eksakt det loft
man får af deres FØR-type.

16/8 er datoen for noget andet og snævrere: **det første akademi-kuld der fødes med et
anlæg der står fast**. Det er værd at nævne, men det er ikke datoen hvor fighter-problemet
bliver synligt løst for de ryttere man har i dag.

**Forslag:** ændr til "root cause fixed Aug 9-10, already visible on your current riders;
new academy classes from Aug 16".

### ❌ 2. "One-time correction for existing young riders (**being prepared**) … I'll post before it runs."

**Holder ikke, og løftet kan ikke længere holdes for den del der allerede er kørt.**

Korrektionen har to halvdele:
- **Typerne** blev omskrevet 9/8 kl. 22. Det er sket.
- **Lofterne** følger automatisk ved næste trænings-tick, fordi motoren genopbygger
  `ability_caps` ud fra den persisterede type hver gang. 5 hold fik det allerede natten
  til 10/8; resten rammes af aftenens sweep.

Målt for de 952 menneske-ejede unge når lofterne følger med: 586 (61,6 %) får mindst ét
sænket loft (median 15 point på den værste evne), men **rytterens rating for sin EGEN type
flytter sig median 0** (p10 −3). Det der beskæres, er den gamle fighter-signatur
(descending, aggression, recovery, punch) som rytteren aldrig havde et anlæg for.
Seniorer rammes stort set ikke (2,6 %).

**Forslag:** omskriv fra kommende til "delvist udført", og vær ærlig om at type-delen skete
automatisk. Det der stadig venter på ejerens beslutning, er **hvad identiteten skal fryses
PÅ** — og dét kan stadig annonceres før det kører.

### ⚠️ 3. "Climbing not improving in training … **The one-time correction below is what restores it.**"

**Mekanismen er rigtig, men attributionen er forkert — og virkeligheden er bedre end
teksten lover.** Genopretningen sker automatisk, ikke via en kommende korrektion.

Målt for de 952 menneske-ejede unge når lofterne følger de nye typer:
**climbing-loftet hæves for 222 ryttere (op til +48 point) og sænkes for NUL.** Antallet af
evne-slots uden vokseplads falder (2.562 → 2.238). De eneste evner der reelt låses, er
`aggression` (136) og `punch` (84) — fighter-signaturen.

**Forslag:** "This is the same root cause, and it is already being undone — no climbing
ceiling is lowered, and 222 of your young riders get theirs raised."

### ⚠️ 4. "Two types (puncheur and rouleur) are still recognised less reliably than the rest"

**Holder for NYE akademi-ryttere** (`scorecard3570Phase2.mjs`: puncheur 26 % / rouleur 16 %
genfinding) — og det er den kontekst sætningen står i, så den er forsvarlig.

Men for de ryttere spillerne ejer i dag er billedet omvendt for rouleur: **rouleur er nu
39,4 %** blandt menneske-ejede unge (mål 17), mens **puncheur er 0,9 %** (mål 13). En
spiller der lige har set halvdelen af sin ungdomstrup blive rouleur, vil undre sig over at
læse at rouleur "genkendes mindre pålideligt".

**Forslag:** enten præcisér "for new academy riders", eller nævn at rouleur i øjeblikket
er over-repræsenteret blandt de eksisterende, og at det er en af de ting den kommende
beslutning skal rette.

### ✅ Holder uændret

| Linje | Status |
|---|---|
| Academy "super riders" (374, auktion aflyst, 4 refunderet) | ✅ uændret |
| #3577 følgeomkostninger ikke dækket | ✅ uændret |
| Tomt akademi vs. mail | ✅ uændret |
| Youth prospects starting slightly too weak | ✅ uændret (spec §11.1) |
| "No rider loses any current ability" | ✅ verificeret: `buildCapsForRider` returnerer `max(tapered, current)` — loftet kan ikke komme under nuværende evne |
| "no market values change" | ✅ verificeret: `valuation_type` er frosset (#3345); T4 frossen = 0,00 % flyt, 0 ryttere |
| Academy signing fees 760k-1M | ✅ uændret (#3550, ikke rørt i nat) |
| Mid-season prize money, 191 hold | ✅ uændret (#3572) |
| Indrømmelsen af at fixet blev meldt for tidligt 9/8 | ✅ står stærkere nu, ikke svagere — vi ved nu præcis hvorfor typerne gled tilbage |

---

## To ting der IKKE står i udkastet

### a) Seniorerne er ramt af det samme

**70,4 % af de menneske-ejede ryttere over 22 er også fightere** (mod 1,4 % blandt AI-holdenes,
som aldrig er blevet tickede — samme generator, samme formler). Samme løkke, bare akkumuleret
længere.

**Min anbefaling: nævn det ikke i denne omgang.** Teksten er allerede lang, seniorerne kræver en
selvstændig beslutning som først tages efter 23/8, og et problem uden en plan skaber mere uro end
det fjerner. Bemærk dog at en opmærksom spiller kan se det selv, så hvis nogen spørger i Discord,
er det bedre at have svaret klar end at improvisere.

### b) Nye spillere har fået ubrugelige start-trupper

Generator-buggen ([PR #3589](https://github.com/NicolaiDolmer/CyclingZone/pull/3589)) har været
live i 51 dage: en ny managers trup genereres i batches af 8 og 4, og ved de størrelser kan kun
sprinter og GC-rytter fødes. De fem hold der blev oprettet 9/8 fik tilsammen **47 sprintere,
16 GC-ryttere og 1 rouleur af 64 ryttere** — ingen klatrere, ingen puncheurs, ingen
brostensryttere, ingen tidskørere.

Det er en anden historie end fighter-problemet, og den rammer en lille, identificerbar gruppe:
alle der har oprettet hold siden 20. juni.

**Min anbefaling: nævn det, men først når rettelsen er merged**, og hold det kort og konkret —
"nye hold blev oprettet med for ensartede trupper; det er rettet, og jeg kigger på hvad de
berørte hold skal have". Ellers lover teksten en analyse du ikke har lavet endnu. Om de
berørte hold skal kompenseres er en selvstændig beslutning; nattens arbejde har ikke målt hvad
en fair kompensation ville være.
