# Kombineret session-prompt: trin 7 som hovedspor + planens nyeste vigtigste ting

**Skrevet 15/8 i plan-sessionen (30-punkts-planen, MASTERPLAN F-sektionen).** Kombinerer trin 7-prompten med de plan-punkter der naturligt hører til samme design eller kan køre i parallelle baner. Alt andet fra planen er BEVIDST udeladt — det har sin plads i køen og skal ikke udvande grundigheden her.

**Model og indsats:** Fable (arkitekt) i hovedtråden med høj indsats — systemet er rettet tre gange på en uge, og design-samtalen med ejeren ER opgaven. Sonnet-subagenter til de parallelle måle-baner og mekaniske edits. INGEN natbølge til designdelen; den kræver ejeren ved bordet.

---

## Trin 0 — kontrakten

Læs [`2026-08-16-trin7-potentiale-som-fart-prompt.md`](2026-08-16-trin7-potentiale-som-fart-prompt.md) **helt, før du gør noget**. Den er kontrakten: de 8 låste beslutninger, de 5 spillervendte gates (S1-S5), spørgsmål A-E med visuals, gap-proportional-mekanikken og ugens 7 faldgruber. Intet i denne fil overstyrer den — denne fil TILFØJER kun.

Kort: S4 (20→90 skal tage 286-386 dage; er 228) og S5 (fart-spænd 2,5-3,5x; er 1,13x) er sessionens opgave. Kør `backend/scripts/spillervendteGates3709.mjs` FØR du ændrer noget (snapshot: `docs/snapshots/3591/riders_full.json`). Design med ejeren: spørgsmål ét eller få ad gangen, hver med anbefaling og et visual (`show_widget`).

## Hovedsporet — trin 7, udvidet med det der hører til samme design

Fra 30-punkts-planen (15/8) hører disse til NETOP dette design og skal med i samtalen, ikke i en senere session:

1. **Spørgsmål E afgøres tidligt, og planens anbefaling er JA:** trin 2 løbslære (#3762) står som **nr. 1** i 30-punkts-planen og flytter `positioning`/`tactics`/`aggression` til eget fokus. Med kun 1-2 evner over 90 pr. rytter bliver fokus-størrelser et balance-håndtag — de to ting kalibreres bedst sammen. Anbefal det, men det er ejerens valg.
2. **#3788** — loftet kan ligge midt i et niveau, så træningsbaren viser fremgang mod et niveau rytteren aldrig når. Det flade tag afgør hvordan baren skal tegnes. Samme flade, samme PR-serie.
3. **#3714** — er scout-båndet en garanti? To spillere spurgte samme morgen, og svaret står ingen steder i spillet. Prognose-designet (spørgsmål B+D) afgør svaret. Leverance: hjælpetekst en+da i samme opdatering.
4. **#3679** — loft-båndet kan regnes ud fra to scout-niveauer. Allerede kendt fejlende og står i trin 7-promptens afledningstjekliste; det flade tag ændrer præmissen, så den SKAL afgøres her, ikke genopdages senere.
5. **Trin 7-promptens afledningstjekliste er bindende:** scout-båndet (#1162), `predictBaseValueV4`, #3503's G3-præcision. Før merge: før/efter-tabel for fem navngivne prod-ryttere.

## Parallelle baner (sonnet-workers, kører mens du venter på ejer-svar)

Begge er **read-only-målinger** — ingen prod-ændringer, ingen merges, kun rapporter med tal. De er de to mest tidsfølsomme punkter fra planen der IKKE kræver design:

- **Bane 1 — S3-kalender-målingen (plan nr. 11, skal ske FØR 23/8):** Kalenderen ER genbygget (v7.105: 430 løb, kronologi, 7 GT-hviledage, realisme-bånd). Mål den mod megathread-punkterne: GT-andel af løbsdage, Giro-længde, terræn-mix (#3349), klasse/etape-kobling (#3328), løbsidentitet (#3471/#3547). Rapportér hvad der allerede er løst og hvad der reelt mangler, med tal pr. punkt. Ejeren beslutter kun resterne.
- **Bane 2 — bitype-hullet (plan nr. 5, lækker ~24/døgn):** #3634 voksen-generatoren giver ingen sekundær + #3631 skævheden. Fødsels-fixet (#3632) er merged — mål hvor mange ryttere der er født uden bitype siden, og hvor lækagen præcis sidder. Fix-forslag som udkast; selve fixet bygges kun hvis ejeren siger go i en designpause (det er uafhængigt af trin 7-koden).

Workers må ikke spawne chips til ejeren — fund går til dig, du samler op i hovedtråden.

## Eksplicit UDE af denne session

- **#3682 landing 2** (positioneringsloftet) — egen prod-mutation med egen spillerbesked; køres separat.
- **Økonomi-beslutning 4+5 (#3757), #3750, #3733** — eget spor, egen session.
- **Backlog-bølgerne W1-W9** — natbølge-arbejde; W3 observability foreslås som FØRSTE natbølge ved close-out, ikke i denne session.
- **#3746's tal må ikke "løses" ved at slække gates.** Gates udvides, aldrig slækkes, uden ejer-go.

## Close-out-krav (ud over CLAUDE.md-ritualet)

1. S1-S5 grønne, eller ejer-godkendt afvigelse dokumenteret på #3746.
2. Patch note + hjælp (en+da) — én besked om ét system, inkl. #3714-svaret.
3. Luk/kommentér: #3746, evt. #3762 trin 2, #3788, #3714, #3679 + rapporter på #3634/#3631 og S3-kalender-issues (#3546/#3547/#3471/#3349/#3328).
4. NOW.md + MASTERPLAN.md: kryds af i 30-punkts-planen (F-sektionen), foreslå "Næste session starter med #3682 + W3 som natbølge".
5. Ejerens ord ved close-out 15/8 gælder: *"Hvis vi designer en fed løsning, så skal den laves."* Designet skibes i denne session eller har en committet, dateret plan for hvornår.
