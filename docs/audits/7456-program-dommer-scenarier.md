# Dommer-scenarier for Program-siden (#8548, #8549, #8550)

Uafhængig Fable-dom (AGENTS 40), 22/11. Scenarierne er udledt af `docs/TRAINING_RULES.md` (TR) og `docs/CALENDAR_RULES.md` (CR) plus ejerens svar 21-22/11 på de tre issues, ikke af designene. Det er facit, koden skal bestå. Samme dommer gennemgår hver motor- og data-PR mod dette dokument før merge.

**Erklæret afvigelse (AGENTS 40):** PR 1 for #8548 (#8577) og #8549 (#8578) blev startet 22/11 nat, før scenarierne var skrevet. De merges ikke, før dommeren har gennemgået dem mod dette dokument. Alle senere trin skrives først efter scenarierne.

**Notation.** En dato har 5 felter, LD1-LD5 (CR §1d, TR §13.3 nr. 8). `L` = løb, `H` = hvile, `(x)` = erstattet af træthedsgrænsen. Rotation `[A,B,C]`, "næste" = passet der står for tur. Hvor intet andet står: `condition_model_v2`, `fatigue_now_7801` og de nye kontakter er tændt, og planen er sat i Program-fanen.

**Gælder alle scenarier (I5, TR §5.3b og #7801-afsnittet):** prognosen viser for hvert felt præcis det pas, den kilde og det rotationsnummer, motoren stempler. Samme rene funktion, samme input (datoens kvitteringer + planlagte etaper).

## Ejerens svar 22/11 nat på dommerens spørgsmål

- **K-2 (rotation efter Træn nu + frigivet felt):** "Ja". Et sent frigivet felt må få dagens sidste rotationsnummer, når datoens samlede træning og næste dags start er ens. "Seneste kvittering" findes efter stemplet rækkefølge, ikke efter løbsdag.
- **K-9 (hvornår en plan får de nye regler):** "Alt han gør i den nye fane". Både tildeling af et program og "Save plan" i den nye Program-fane sætter `plan_kind`.
- Besluttet tidligere og gældende her: K-1 (frie felter på etapedatoer træner, TR §13.3b nr. 3), K-3 (én markør `plan_kind`, `rotation.active` udgår), K-4 (ny længde = alle fra pas 1), K-7 (ingen træthed frem i #8550 PR 3), K-8 (låsen flytter til nærmeste ledige felt, ikke sidste).
- Åbne forslag (dommerens, ikke ejer-besluttet): K-5 "Løb tog" viser intet på en hel bundet hviledato og for en skadet rytter. K-6 #8550 §4.2: "hvile" kun på hele datoer uden etape.

## 1. Rotation (#8548)

| Id | Opsætning | Forventet motor pr. felt | Regel |
|---|---|---|---|
| ROT-1 | GT-rytter, næste = A. Dato 1: etaper LD2+LD4. Dato 2: hel dato uden etape inde i spændet. Dato 3: etape LD1 | D1: A, L, B, L, C. D2: H×5 (intet tick, ingen score, kun restitution), rotationen venter. D3: L, A, B, C, A | TR §13.3b nr. 3 + præcisering 28/9; CR §2b, §3 |
| ROT-2 | Etapeløb, 3 etaper: D1 LD3+LD5, D2 LD2. `[A,B,C,D]`, næste = C | D1: C, D, L, A, L. D2: B, L, C, D, A. Frie felter på etapedatoer træner og rykker | TR §13.3b nr. 3; CR §2b, §1e |
| ROT-3 | Grænse med erstatning Hvile. Etape på LD2 løfter "træthed nu" over. Næste = A | A, L, (H), (H), (H). Felt for felt. Rotationen venter: næste dato (under grænsen) starter med B | TR #7801; ejer 21/11 nr. 1 |
| ROT-4 | Som ROT-3, erstatning "samme pas på let" | A, L, B let, C let, A let. Rotationen rykker; næste dato starter med B | ejer 21/11 nr. 2 |
| ROT-5 | Endagsløb LD3, ikke kørt. Næste = A. (a) Træn nu kl. 10, (b) kun aftenkørsel | Begge: A, B, L, C, A. Samme indeks pr. felt, samme næste (B) | TR §13.3b (I1), #7970 |
| ROT-6 | Som ROT-5, men rytteren kommer ikke i startfeltet (feltet frigives) | Uden tryk: A, B, C, A, B. Med tryk: de samme fem numre præcis én gang; samlet pas, evnegevinst, tilstand og næste (C) ens (K-2 = ja) | TR l. 264-265, §13.3b (#7692), I1 |
| ROT-7 | Skadet rytter; rytter med `unknown_pending` felt | Skadet: H, rotationen venter. Ukendt felt: intet nummer før feltet afgøres | TR §2 (G5) |
| ROT-8 | Genkørsel/recovery af samme (rytter, sæson, løbsdag) | Samme stempel; ingen plads brugt to gange eller sprunget over | TR "Tilstand én gang pr. dato" |
| ROT-9 | Holdets række har rotation; rytter har egen eksplicit plan | Rytterens egen plan vinder | TR §4 |
| ROT-10 | "Copy to riders": (a) samme længde, (b) ny længde | (a) hver rytter beholder sin plads. (b) alle fra pas 1. "Start fra pas 1" kan vælges | ejer 21/11 nr. 3 |

## 2. Prioritet og låst pas (#8549)

Plan for dagen: A, B, C, D, E i LD1-5 (rækkefølgen er prioriteten; LD5 er lavest).

| Id | Opsætning | Forventet motor pr. felt | "Løb tog" | Regel |
|---|---|---|---|---|
| WB-1 | Ingen løb; eller alle 5 felter samme pas | Identisk med i dag | – | TR §13.3 nr. 8 |
| WB-2 | Lås E (hjem LD5), løb LD5 | A, B, C, E, L | D | ejer 21/11 (nærmeste) |
| WB-3 | Lås C (hjem LD3), løb LD3 | A, B, L, C, D (lige afstand → det senere) | E | ejer 21/11 |
| WB-4 | Lås E, løb LD1+LD5 | L, A, B, E, L | C, D | samme |
| WB-5 | Træn nu: LD1-4 afgjort som A-D; derefter forsøges rytteren udtaget til løb i LD5 | Udtagelsen afvises (låst rytter). E kører i LD5 | – | TR §13.3b Train now-lås |
| WB-6 | LD1-4 afgjort som A-D, og LD5 viser sig at være løb (afgjort sent) | Afgjorte felter ændres aldrig: A, B, C, D, L. E flytter IKKE til LD4 (prognosen heller ikke) | E | TR "Aldrig dobbelt", "Tilstand én gang pr. dato" |
| WB-7 | Lås B (hjem LD2), etape på LD2 løfter rytteren over grænsen (Hvile) | A, L, (H), (H), (H). Låsen flyttede til LD3 og blev erstattet dér; indhentes ikke | E | ejer 19/11: grænsen slår låsen |
| WB-8 | WB-4 afregnet i rækkefølge, ude af rækkefølge (stemplet rytter) og efter etapen (#7982) | Samme kilde pr. felt i alle tre; ingen kilde to gange | C, D | TR #7737, §13.5 |
| WB-9 | Hel bundet dato uden etape; skadet rytter | H×5; låsen køres ikke og gemmes ikke | (K-5) | TR §13.3b nr. 3, §2 |
| WB-10 | Lås + `slotEfforts` | Indsatsen følger passet; grænsen vurderes på feltets egen tid | – | TR §3 |

## 3. Gamle planer og slukkede kontakter

| Id | Opsætning | Forventet | Regel |
|---|---|---|---|
| OLD-1 | `plan_kind` NULL, alle kontakter tændt, løb LD5, række med `lockSlot` | A, B, C, D, L (E tabt, som i dag). Ingen `source_slot`/`rotation` i rapporten, intet ekstra opslag. Bit-identisk med frossen golden | ejer 21/11 |
| OFF-1 | Kontakter slukket; rækker med `plan_kind`, `lockSlot`, rotationspas | Motor, prognose, rapport og API bit-identiske med i dag | TR §13.6-mønsteret |
| OFF-2 | `plan_kind='rotation'`, kun prioritet-kontakten tændt (og omvendt) | Den slukkede regel gælder ikke; rækken læses som almindelig ugeplan | ejer 21/11 |

## 4. Egne programmer (#8550)

| Id | Opsætning | Forventet | Regel |
|---|---|---|---|
| CP-1 | Program P tildelt rytter R og gruppe G. P rettes, omdøbes, arkiveres | R's og G's `days`, `plan_kind` og rotationsplads er byte-ens; næste tick uændret | ejer 26/9 (kopi), TR §4 (#2438) |
| CP-2 | P tildeles; derefter rettes R's plan | P er uændret; ingen delt reference | samme |
| CP-3 | Kontakt slukket | `GET /programs` bit-identisk; skriveruter lukket | – |

## 5. Rullende uge (#8550 PR 3, også grundlag for dagsvælgeren #8580)

| Id | Opsætning | Forventet | Regel |
|---|---|---|---|
| UGE-1 | I dag onsdag | Kolonnerne er ons til tirs (i dag + 6). Dag 0 bit-identisk med dagens `/forecast` | ejer 21/11 Q1 |
| UGE-2 | GT som ROT-1 | D1: løbsfelt LD2+LD4, øvrige = planens pas. D2: H×5 | TR §13.3b; CR §2b, §3 |
| UGE-3 | Rytter mangler i seneste etapes startfelt | Fra dagen efter sidste etape med resultat: ingen løbsfelter. Mangler eller ulæseligt bevis: bindingen bevares | TR §13.3b (#7692), #5949 |
| UGE-4 | Løb i divisionen som rytteren ikke er udtaget til | Ikke hans løbsfelt | CR §2b |
| UGE-4b | Holdet har ingen manuel udtagelse; assistenten fylder holdet ved løbsstart (raceRunner, hvert hold uden tilmeldinger) | Datoen er en løbsdag: chip "Løb · auto" og en note om, at assistenten udtager ved start. Kørt løb tæller holdets tilmeldinger (race_entries, også auto), så i dag aldrig står som træning. Et startet eller slut løb uden holdets ryttere er ikke holdets dag (assistenten fylder kun ved 1. etape). Et løb med bindinger tæller kun dem; tilmeldinger tæller med udgang af løb, så en rytter, der er stået af, aldrig kommer tilbage | #8580-rettelsen 22/11 |
| UGE-5 | Dato hvor aksen ikke giver 5 løbsdage | `available:false`; løbsdagen gættes aldrig fra datoen | CR §0 |
| UGE-6 | Svarets indhold | Ingen træthed frem. Pr. dato også holdets løb (etape/endagsløb, løbsnavn) | ejer 21/11 Q3, 22/11 (#8580) |
| UGE-7 | Rotationsrytter over ugen | Samme numre som motoren for kendte bindinger | I5 |

## 6. Huller i reglerne (SSOT, AGENTS 30)

Træthedsgrænsen (#4854) har ingen egen sektion i TR §5. Kopi-princippet (ejer 26/9) og udgang af løb (#5949) står ikke i TR/CR. De skrives ind i TR i samme PR som motor-ændringerne.
