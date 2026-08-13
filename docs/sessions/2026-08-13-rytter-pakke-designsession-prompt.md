# Næste session — rytter-pakken: design færdig, derefter byg (#3664)

**Model:** Opus 5, høj reasoning. Fast mode fra. Subagenter: sonnet.
**Form:** designsamtale med mange spørgsmål FØRST, derefter kode i samme session.
**Forudsætning:** merge #3641 og #3663 før noget andet.

---

## Prompt (kopiér ind som første besked)

> Vi bygger rytter-pakken færdig — #3664. Rammen er din egen fra i går: **loft, potentiale, ryttertyper og følelsen af at træning ikke virker.** Uden at det hænger sammen, har vi nærmest ingen sæson 3.
>
> **Kvalitet over tempo. Det skal lande ordentligt første gang.** Design hele pakken færdig FØR du skriver en linje kode — ellers bygger vi fundamentet uden at kende huset. Stil mig masser af spørgsmål, ét ad gangen, med din anbefaling først. Når designet er låst, bygger du så meget som muligt i samme session.
>
> **Start med at rydde bordet:** merge PR #3641 (CI-checket der maler hver PR rød — vi skal lave 7+ PR'er nu) og PR #3663 (patch note v7.118 + close-out for #3591/#3593, som blev lukket i går).
>
> **Læs først:** `docs/superpowers/specs/2026-08-13-rating-fundament-v3-design.md` (hele spec'en, inkl. §6 og §7) · `docs/MASTERPLAN.md` spor B · `docs/sessions/2026-08-13-sessionsplan-3662.md` · issues #3664 #3665 #3666 #3667 #2454 #3592 #3643 #3649 #3564 · PR #3512's body (dens rod-årsagsanalyse er relevant, se nedenfor).
>
> **Ingen kode før designet er låst med mig.**

---

## Låst i går (#3662) — må ikke genåbnes uden at sige det højt

| Beslutning | Konsekvens |
|---|---|
| **#3668 rod-fix af evne-skalaen er UDSKUDT** | Vej A står ved magt. R1-gaten forbliver ≤6 points spredning. **De 8 opskrifter i spec §3 gælder som skrevet** — de skal ikke re-designes. |
| **#2454 potentiale 1-6 → 1-99** | Stjernerne erstattes i UI af **potentiel rating**. `potentiale`-feltet bliver rent internt og styrer fortsat vækst, værdi og akademi. Motoren rører sig ikke. |
| **Rækkefølgen i pakken** | #3665 → #3666 → #2454 → #3592 → capsShaping → #3643/#3649 → #3667 |
| **Succeskriteriet** | Ikke konsistente tal, men at **træning føles som om den virker**. Skærmbilleder før/efter i PR-body. |
| **Penge-sporet** | Betinget. Gaten er at denne pakke er leveret. |

Ejer-citat der styrer alt: *"Det er loft, potentiale, ryttertyperne, og følelsen af at træning ikke virker vi skal arbejde med."*

---

## Spørgsmål sessionen SKAL stille ejeren

Ét ad gangen, anbefaling først. Rækkefølgen er valgt så et svar aldrig gør et tidligere svar forkert.

1. **Godkender du de 8 visnings-opskrifter i spec §3 som de står?** De gælder uændret nu hvor #3668 er ude. #3666 er blokeret indtil dette ja. Vis effekten pr. rolle (tabellen i §3 findes allerede) og spørg om sprinterens skift fra acceleration til sprint som tungeste evne er som han vil have det.

2. **Potentiel rating vises hvor præcist?** Erstatter den stjernerne 1:1 alle steder (`PotentialeStars.jsx` bruges på hero, udviklingsfane, scoutingfane, filtre, planner, træningsmoment), eller skal nogle flader beholde et grovere signal? Vis en liste over de faktiske forbrugssteder før han svarer.

3. **Hvad sker der med maskeringen når potentialet bliver et tal?** Spec D5 siger loft-båndets bredde og spejder-præcision er uændret. Men et bånd på stjerner og et bånd på et 0-99-tal opleves forskelligt — skal båndet vises som interval ("kan nå 42-51") eller som ét tal med usikkerhedsmarkør? Ikke-inverterbarheden (#1543/#1162) skal holde uanset.

4. **capsShaping-mismatchen (spec §6 punkt 2):** når opskriften belønner positionering hos sprintere, men positionering vokser neutralt for alle — retter vi det nu, eller accepterer vi mismatchen i denne omgang? At rette det flytter lofter på eksisterende ryttere. Det er grænsen mod "tredje rystelse". **Anbefal eksplicit** og vær ærlig om at dette er tæt på det han lige udskød.

5. **#3592 — de fire uadskillelige typepar:** rettes de i `classifierWeights` (som efter #3665 er sin egen tabel), og hvad sker der med eksisterende ryttere hvis klassifikationen ændrer sig? Siden #3570 kommer typen fra `archetype_draw` og er en fast identitet man fødes med — så ændrer vi kun fremtidige ryttere, eller reklassificerer vi? **Det er det farligste spørgsmål i pakken** — spillerne har lige haft en uge med typer der flakkede.

6. **PR #3512 og #3668 er blokeret af samme fil.** #3512's egen analyse siger den kun kan komme videre ved at refitte `riderTypesBaseline.json` eller røre `abilityDerivation.js` — sidstnævnte er præcis rod-årsagen i spec §7. Skal #3512 forblive parkeret indtil #3668 tages, eller skal de to planlægges som ét senere spor? Anbefaling: ét spor, og #3668 får en dato når denne pakke er landet.

7. **#3643 træningsfladen — hvad betyder "føles som om den virker" konkret?** Få ham til at beskrive hvad en spiller skal kunne SE efter en uges træning. Det er acceptkriteriet, og uden hans ord bliver det en gætteleg. Byg et `show_widget`-mockup FØR I bygger fladen.

8. **Landing:** lander pakken samlet med én besked (#3667), eller i etaper? Han sagde i går at hele pakken helst skal lande omkring 23/8, men at rod-fixet kan vente. Få rækkefølgen mod cutover-dagen bekræftet.

---

## Teknisk kontekst sessionen skal kende

**Rod-årsagen #3665 fjerner (spec §1.5):** `RIDER_TYPES[].weights` læses i dag af fire forbrugere — klassifikatoren, værdimodellen, progressionen og visningen, sidstnævnte via en **håndholdt kopi** i `frontend/src/lib/riderRating.js`. En vægt-ændring for at rette et vist tal flytter samtidig lofter, markedsværdier og typer. Frontend-kopien kan drifte uden at noget fejler. Det er derfor "en lille rettelse" gentagne gange er blevet en release med fejl.

**Derfor er #3665's tredje CI-vagt den vigtigste:** frontend-vægttabellen skal være **genereret** fra backend-kilden med en drift-test, ikke håndholdt.

**Gates der skal bevises i PR-body:** R1 (≤6 point spredning på median-rytteren) · R2 (caps/primary_type/secondary_type/potentiale 100 % uændret) · R3 (markedsværdi 100 % uændret) · R4 (alle 15 evner tæller ≥1 sted, CI-vagt) · R5 (frontend genereret, drift-test) · R6 (median ≥20 points luft nu→loft) · R7 (ingen flade på gammel skala, grep-gate + e2e alle 3 projekter) · R8 (`scoutingInversionHarness` uændret).

**To evner er usynlige i dag (§1.6):** positionering og taktik indgår i nul af de 8 nuværende opskrifter, men påvirker løbene. R4-vagten er den der ville have fanget det.

**Præflight:** `pwsh -File scripts/preflight-pr.ps1` før hver push. Frontend/i18n rører → `npm run lint` + `node --test` i `frontend/` + hele e2e-suiten (alle 3 playwright-projekter). Visuelle ændringer → alle 3 projekter, ellers fejler CI på mobile.

**Migrationer:** ingen prod-mutation af eksisterende ryttere i nogen fase af denne pakke (spec §5). Hvis en fase kræver det, er det et stopsignal — spørg ejeren.

---

## PR-status ved sessionens start

| PR | Status | Gør hvad |
|---|---|---|
| #3641 | READY | **Merge først.** CI-checket der maler hver PR rød (8/8 fejl, ikke required). |
| #3663 | READY | **Merge først.** Patch note v7.118 + close-out for #3591/#3593. |
| #3512 | DRAFT | Lad ligge. Blokeret af samme fil som #3668 — se spørgsmål 6. |
| #3449 | DRAFT | Rør ikke. Kører 14.-15/8 som egen opgave (ejer-løfte). |
| #3393 | DRAFT | Rør ikke. Venter på post-sweep-fordelingen fra #3449. |

---

## Faldgruber fra de sidste to uger

- **Typer der flakker er den dyreste fejl vi kan lave igen.** Spillerne havde en hel uge med ryttere der skiftede type frem og tilbage. Ethvert forslag der reklassificerer eksisterende ryttere skal have ejerens eksplicitte ja og en negativ-kontrol før kørsel.
- **Verificér mod runtime, ikke mod en anden tekst.** #3591's præmis ("2.139 ryttere skifter type") viste sig at være 0 af 3.293 da den blev målt.
- **Mocket Playwright beviser kun rendering.** Nye endpoints eller nye SELECT-kolonner: verificér kolonnerne findes og kør queryen mod ægte DB.
- **Loop-guard:** 2 CI-fejl på samme symptom → stop og spørg.
