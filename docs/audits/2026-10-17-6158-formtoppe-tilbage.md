# #6158 formtoppe tilbage og nedgangen uden bonus (tørkørsel 17/10)

Refs #6158 · #6156 · ejer-beslutning 10/10 (formtoppe tændes ved S5, alle S4-toppe gives tilbage) · ejer 17/10 (startprompt §3.4).

Kun læsning. Intet er skrevet til prod. Selve tilbagegivelsen sker kun på ejerens ordrette "kør". Tal med navne, id'er og pr.-hold-fordeling ligger privat i `balance-internals/6158/` (dry-run-rapport, json, snapshot-SQL, restore-SQL og kortet `card-2026-10-17.png`).

## Hvad skal rettes

1. **Del A:** formtoppe brugt i S4, mens de ikke kunne virke (fra motoren v4 blev tændt 28/9 til formtoppe virker igen ved S5), gives tilbage.
2. **Del B:** rytterne må ikke bære nedgangen efter en top der aldrig gav bonus.

## Metode

Script: `backend/scripts/dev/giveBack6158FormPeaks.mjs` (udvidet fra PR #6306). Standard er read-only. Kørt 17/10 mod prod med service-rollen, kun SELECT.

**Tændingstidspunkt.** Default er nu næste sæsons start, midnat dansk tid (`seasons.start_date` for S5 = 28/10), fordi ejeren 10/10 besluttede at formtoppe først virker fra S5. Alle S4-etaper er planlagt før det tidspunkt, så ingen S4-top kan nå at virke.

**Del A, reglen (uændret fra spec §4).** En top gives tilbage, hvis vinduet startede fra sæsonstart til tændingen (A), eller målløbet starter før tændingen (B), medmindre toppen allerede har talt i et løb efter tændingen. Kun menneskehold (samme ejendomsfilter som #5864). "Giv tilbage" = rækken i `rider_peak_plans` slettes efter backup: pladsen i kvoten er fri igen, låsen forsvinder med rækken, og manageren kan planlægge på ny.

**Del B, målt i stedet for antaget.** Læst i koden:

- Nedgangen gemmes ikke i `rider_condition.form`. Den regnes ved løbstid ud fra selve planrækken (dagene efter vinduet) og lægges kun ind i den gamle v3-score. Planlæggeren viser det samme "formhul" ud fra rækken.
- Under v4 sender broen ikke vinduerne videre, og den form v4 ser, er rytterens form uden top og uden nedgang (#6156, ejer 10/10).

Scriptet finder derfor for hver top de kørte etaper hvor rytteren stod i nedgangen, slår den seneste motorkørsel af etapen op, og læser om motoren faktisk lagde en negativ top-komponent på rytteren. Et andet aktivt vindue samme dag vinder over nedgangen, som i motoren. Formjusteringen pr. rytter er det målte, anvendte dyk med modsat fortegn.

## Resultat 17/10

| | Antal |
|---|---|
| S4-toppe i alt | 934 |
| Uden for scope (rytter uden hold) | 37 |
| **Toppe der gives tilbage** | **897** |
| ... kun regel B (vinduet startede før sæsonstart, målløb før tænding) | 192 |
| ... begge regler | 705 |
| Toppe der beholdes (har talt eller vil virke) | 0 |
| Berørte ryttere | 643 |
| Berørte hold | 33 |
| Toppe hvis målløb er et etapeløb i gang ved tændingen | 103 |
| Toppe på ryttere der ikke er seniorer nu (kan først planlægges igen som senior) | 181 |

**Del B:**

| | Antal |
|---|---|
| Kørte rytter-etaper i nedgangen efter en S4-top | 3.117 |
| Motorversion på de etaper | kun v4 |
| Rytter-etaper hvor motoren faktisk lagde et dyk på | **0** |
| Ryttere der skal have formjustering | **0** |
| Ændring i `rider_condition.form` | 0 for alle |
| Ryttere med en nedgang uden bonus der stadig ligger foran eller er i gang | 431 |

Krydstjek i prod: alle 884 S4-etapekørsler er v4, og v4 skriver ingen score-komponenter (0 rækker), så der er ingen anvendt top og intet anvendt dyk i noget S4-resultat.

**Konklusion for del B:** rytterne har ikke fået en formstraf i løbene. Det der står tilbage, er nedgangen i planlæggeren og den nedgang en S4-top ville give, hvis toppene blev tændt med S4-rækkerne liggende. Begge forsvinder sammen med rækken i del A. Der skal ikke skrives noget i `rider_condition`, og historiske resultater røres ikke.

## Apply (ejer-gated, ikke kørt)

Rækkefølge, når ejeren har set tallene og siger "kør":

1. Kør tørkørslen igen med samme `--ignition` og den `--backup-date`, snapshot tages på. Tallet vokser, så længe managere kan planlægge S4-toppe.
2. Kør `balance-internals/6158/snapshot.sql` (opretter `backup_6158_<dato>` med RLS og en kvitteringskolonne `given_back_at`, idempotent).
3. `node backend/scripts/dev/giveBack6158FormPeaks.mjs --apply --owner-go=6158-production --approved-list=<hash> --ignition=next-season --backup-date=<dato>`

Apply afbryder før første skrivning, hvis listen afviger fra den godkendte (hash), backuppen ikke dækker alle toppe, eller hvis der er målt et anvendt dyk uden bonus i et kørt resultat (det kræver en særskilt ejer-beslutning). Hver tilbagegivet række får en kvittering i backuppen. En genkørsel efter et afbrudt apply matcher samme hash, sletter kun resten og gør kvitteringen færdig. Post-verify: ingen godkendt top findes mere, alle er kvitteret, og en ny indlæsning har intet at give tilbage og ingen nedgang uden bonus foran. Rul tilbage med `balance-internals/6158/restore.sql`.

## Hvad tørkørslen ikke dækker

- Tallene er et øjebliksbillede 17/10. Nye S4-toppe frem til apply kommer med i næste tørkørsel.
- Spillerbeskeden (patch note ved S5) er ikke en del af dette script.
- Effekten af en top i v4 (S5) er ikke målt her.
