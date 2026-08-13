# Næste session — fredag 14/8: planlægnings- og designsessionen (#3662)

**Model:** Opus 5, høj reasoning. **Fast mode fra.** Subagenter: sonnet.
**Form:** research-workflow først (baggrund), derefter design-samtale med ejeren.
**Ikke:** kode. Der skrives ingen feature-kode i denne session.

---

## Prompt (kopiér ind som første besked)

> Vi kører #3662: masterplan-synk + design af rækkefølgen for de næste 15-25 opgaver. Ingen kode i dag.
>
> **Fase 1 — research, som workflow, mens jeg venter.** Kør en workflow der parallelt henter det grundlag vi skal beslutte ud fra:
> 1. Discord + forum, sidste 7 dage: hvad har spillerne klaget over, hvad har de bedt om, og hvad har JEG lovet dem. Ét afsnit pr. tema med citat og dato.
> 2. Feedback-indbakken på hjemmesiden, samme periode, samme form.
> 3. GitHub-synk: alle åbne issues holdt op mod `docs/MASTERPLAN.md` — hvad står i planen som ikke længere er sandt, hvad er lukket-men-åbent, og hvilke issues overlapper hinanden så meget at de bør slås sammen.
> 4. Løfte-sporing: hvad er lovet spillerne i patch notes og på Discord, som IKKE er leveret endnu.
> 5. Cutover-tjek: hvad SKAL stå færdigt før 23/8, og hvad kan vente. Inkl. rollback-planen der stadig mangler.
>
> Hver del skal ende i en kort, læsbar liste med issue-numre — ikke en rapport jeg skal grave i.
>
> **Fase 2 — vi designer rækkefølgen sammen.** Når research er inde: stil mig mange spørgsmål, ét ad gangen, med din anbefaling først. Vi skal nå frem til en prioriteret liste på 15-25 opgaver hvor jeg har sagt ja til rækkefølgen. Prioritér: (a) det jeg har lovet spillerne, (b) det der allerede er planlagt, (c) langsigtede funktioner der løfter spillet, (d) det der brænder. Sig til når du synes noget bør ryge helt ud af køen.
>
> **Fase 3 — læg sessionerne.** Når rækkefølgen er godkendt: skriv hvad de næste 5-8 sessioner hver skal handle om, med model-anbefaling pr. session. Opdatér `docs/MASTERPLAN.md`, `docs/NOW.md` og masterplan-artefakten.
>
> Spørg om alt du er i tvivl om. Der må ikke være noget i projektet du ikke forstår.

---

## Kontekst sessionen skal kende

### Låst i dag (13/8) — rating-fundamentet v3
Designet sammen med ejeren. Spec: `docs/superpowers/specs/2026-08-13-rating-fundament-v3-design.md`.

- Rating = vægtet snit af rollens evner, på evne-skalaen. 13 i alle relevante evner → rating 13.
- Potentiel rating = samme regnestykke på `ability_caps`. Ét tal, én betydning, hele siden.
- Alle 15 evner skal tælle et sted. Ingen nye evner nu. Alt bygges så en ny evne kan tilføjes senere uden ombygning.
- Issues: #3664 (samling) · **#3665 klar til at starte** · #3666 (blokeret på ejer-godkendelse af de 8 opskrifter) · #3667 · #3668 (rod-fix, egen sag).
- #3649 (spillerrapport: loft-besked modsiger scout-visning) hører ind under #3666.

### Ugeplanens præmis er udløbet
NOW.md's *"2.139 AI-ryttere skifter type 23/8, derfor er rækkefølgen bindende"* gælder ikke længere: målt 13/8 til **0 af 3.293** (#3591-kommentaren). Torsdagens loft-arbejde er færdigt. **Rækkefølge-tvangen mellem lofterne og markedssweepen er væk** — fredagens slot er dermed frit, og det er derfor denne session kan holdes.

### Besluttet 13/8: markedet venter på planlægningen
PR #3449 og markedssweepen er **udskudt** — ny dato besluttes i denne session. Verificeret samme dag: sweep-koden (`marketValueSundaySweep.js`, `marketValueSweepConfig.js`, cron-ændringen) findes kun på PR-branchen, intet i main. **Udsættelsen kræver ingen handling** — der er intet der kan gå af sig selv, og ingen kill-switch at huske.

### Åbent, der kræver ejer-beslutning i sessionen
- **De 8 visnings-opskrifter** i rating-spec §3 (#3666 er blokeret indtil de er godkendt).
- **Ny dato for PR #3449 + markedssweepen**, placeret mod 23/8-cutoveren.
- **Rollback-plan pr. komponent for 23/8** — mangler stadig, og cutover er om 10 dage.
- Gamle ejer-klik der stadig venter: #3641 · #3486 `VERCEL_TOKEN` · #2813 penge-gates · kommunikationspakken + patch notes v7.112-7.117 (skrevet, klar til copy-paste).

### Ejer-direktiver fra i dag der skal ind i planen
#3662 (denne session) · #3661 fast design-/kvalitetsproces · #3660 UX-gennemgang "kan spilleren stole på det de ser" · #3659 udvikling/træning/lofter forståeligt i UI · #3657 scouting-missioner værdiløse (4 spillere) · #3658 staff-kandidater.

**#3661 skal munde ud i konkrete regel-tilføjelser til `AGENTS.md`/`CLAUDE.md`**, ikke en hensigt. Dagens rating-session er formen der virkede: spørgsmål ét ad gangen med anbefaling → spec → issues → først derefter kode.
