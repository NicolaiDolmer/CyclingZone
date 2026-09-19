# Fair-play uge 38: klassificering af de 45 åbne flag + transfer-ring-analyse

> **Anonymiseret udgave.** Den fulde version med holdnavne, hold-ID'er og præcise beløb ligger
> privat i `OneDrive-context/balance-internals/fairplay-uge38-2026-09-18-FULD.md` og er kun til
> ejeren. Denne offentlige udgave bruger konsekvente aliaser (A-E/F/G for #5282-ringen, "Hold N1",
> "Hold N2" osv. for øvrige hold) og størrelsesordener i stedet for præcise beløb.
>
> **Kørt:** 2026-09-18, read-only worker (docs/5203-readonly-reports-uge38). Kun `SELECT` mod prod via
> Supabase MCP (`execute_sql`). Ingen mutation, ingen sanktion, ingen spillere kontaktet.
> **Dækker:** #5203 (triage af de 45 `new`-flag + whitelist-forslag) og #5282 (transfer-ring i Division 2).
> Ingen e-mail eller andet personhenførbart er slået op eller citeret her. `teams.user_id` er slået op
> for de 6 hold i Del B udelukkende for at sammenligne dem parvis (samme/forskellig konto) — hverken
> rå UUID-værdier eller holdnavne er gengivet i denne udgave.

## Metode

`fairplay_flags` gemmer en `evidence`-JSON pr. flag med de faktiske transaktioner, nettostrøm og
**antal DISTINKTE modparter** hvert hold i parret har handlet med nogensinde (`counterparties_lo/hi`).
Det sidste tal er klassifikationens vigtigste signal: et hold med 20-37 modparter er en aktiv,
bredt handlende spiller, og ét enkelt flagget par blandt så mange er svagt bevis i sig selv. Et hold
med **1-2 modparter i HELE sin historie** har derimod al sin aktivitet koncentreret på præcis dette
par, hvilket er et markant stærkere signal, uanset kronebeløbet.

Klassifikation brugt nedenfor:
- **Ægte** — koncentreret modpart (lavt `counterparties`-tal på mindst én side) + stort udsving eller
  gentaget mønster. Bør ind i sessionens triage som en sag, ikke en rutine-afvisning.
- **Falsk positiv (whitelist-kandidat)** — kendt husstandspar, eller et mønster der modsiger
  værdi-udtræk (fx begge retninger, ingen nettodrænet part).
- **Uafklaret** — koncentreret modpart, men uden yderligere signal (identitet, gentagelse) til at
  afgøre det herfra. Kræver ejer-blik eller identitetsdata dette read-only pas ikke har adgang til.

## Del A — #5203: de 45 `new`-flag, grupperet i netværk

33 `pair_value_flow` + 12 `lifecycle_funnel`. Lifecycle-flagene er for de samme par som allerede har
et value-flow-flag, undtagen tre stand-alone-flag nedenfor — de to signaler bekræfter hinanden på
samme begivenhed, ikke to separate fund.

### Netværk 1 — Hold N1 (34 modparter): mest støj

Hold N1 optræder i **13 af de 45 flag**. Med 34 distinkte modparter i alt (og modparterne selv
ofte lige så brede: Hold N2 37, Hold N16 21) er langt de fleste af disse par
**falsk positiv-kandidater**: statistisk normalt for et hold der handler bredt og ofte.

| Par | Netto → | Beløb (størrelsesorden) | Antal handler | Klasse |
|---|---|---|---:|---|
| Hold N1 ↔ Hold N2 | Hold N2 | ca. 2 mio. | 3 | Uafklaret (begge brede, men beløbet er højt — se note) |
| **Hold N1 → Hold N3** | Hold N3 | ca. 1-2 mio. | 4 (alle på 3 min., samme dag) | **Ægte** — se boks nedenfor |
| Hold N1 ↔ Hold N4 | Hold N4 | sekscifret (~0,5 mio.) | 6 | Falsk positiv (Hold N4 har 7 modparter, spredt over tid) |
| Hold N1 ↔ Hold N5 | Hold N5 | sekscifret | 3 | Falsk positiv (begge brede) |
| Hold N1 ↔ Hold N6 (x2 flag) | Hold N6 | sekscifret x2 | 4+2 | Falsk positiv — se whitelist-note |
| Hold N1 ↔ Hold N7 | Hold N7 | sekscifret | 2 | Uafklaret (Hold N7 kun 4 modparter) |
| Hold N1 ↔ Hold N8 (x2 flag) | Hold N1 | under 100.000 (x2) | 2 | **Ægte, men allerede kendt** — matcher ugescan-fund #2 i #5203 (ny konto, betalte 2,5x og 11,5x for ryttere fra et etableret hold kort efter oprettelse) |
| Hold N1 ↔ Hold N9 | Hold N9 | sekscifret | 3 | Falsk positiv (Hold N9 har 25 modparter) |
| Hold N1 ↔ Hold N10 | Hold N10 | sekscifret | 3 | Del af Netværk 2, se dér |
| Hold N1 ↔ Hold N11 | Hold N11 | sekscifret | 3 | Falsk positiv (Hold N11 kun 5 modparter, men handlen går IMOD Hold N1 — Hold N11 vandt værdi, ikke tabte den) |
| Hold N1 ↔ Hold N12 | Hold N12 | sekscifret (~0,5 mio.) | 1 | Uafklaret |
| Hold N1 ↔ Hold N13 (lifecycle only) | — | — | — | Uafklaret, ingen value-flow-par fundet |

**Ægte fund — Hold N1 → Hold N3 (burst-dump):** fire auktioner, alle afsluttet inden for
3 minutter samme dag, alle vundet af Hold N3 til stærk underpris (ratio 0,088-0,409
af markedsværdi). Hold N3 har **kun 2 modparter i hele sin historie** og står i dag med en
kassebeholdning på under 25.000, altså tæt på nul, selvom holdet har modtaget rytterværdi for
over 1 mio. Enten er Hold N3 en alt-konto der modtager værdi og siden er tømt igen (ryttere
videresolgt/brugt), eller Hold N1 har bevidst tabt fire auktioner i træk til samme modtager. Dette
matcher #5282's åbne spørgsmål "er den anden budgiver uafhængig" — se Del B for hvordan det
spørgsmål besvares for ring A's netværk; det samme spørgsmål er IKKE undersøgt for denne
Hold N1-klynge i dette pas.

**Whitelist-note (designspørgsmålet fra #5203 punkt 1):** ingen flag findes i dag for **Hold N6 ↔
Hold N14** eller **Hold N15 ↔ Hold N28** — de to par er aldrig blevet flagget af detektoren
(bekræftet ved direkte opslag på parret, 0 rækker). **Hold N31 ↔ Hold N1** HAR et flag, men det
står allerede `actioned` (ikke i denne liste). Whitelisting af de 4 kendte husstandspar ændrer altså
ikke noget i den aktuelle 45-kø — den er ren forebyggelse mod fremtidige flag på de samme par, ikke en
oprydning af eksisterende støj.

### Netværk 2 — Hold N10: gennemstrømning (mellemstation)

Hold N10 har 18 modparter (moderat bredt), men nettopositionen over 90 dage er en klar
ind-og-ud-strøm med kassebeholdning nu på under 50.000:

| Par | Netto | Beløb (størrelsesorden) | Dato | Klasse |
|---|---|---|---|---|
| Hold N16 → Hold N10 | **ind** | ca. 3 mio. | seneste (6 handler) | Ægte — kilden |
| Hold N10 → Hold N32 | ud | sekscifret (~0,8 mio.) | seneste (4 handler) | Ægte — udløb 1 |
| Hold N10 → Hold N33 | ud | sekscifret (~0,5 mio.) | 1 handel | Ægte — matcher ugescan-fund #1 i #5203 ordret |
| **Hold N10 → Hold N2** | **ud** | **ca. 1,5 mio.** | **1 handel, NYT siden #5203 blev skrevet** | **Ægte, nyt fund** |
| Hold N1 → Hold N10 | ind | sekscifret | 3 handler | Ægte — endnu en kilde ind |

Dette er den samme "mellemstation"-observation ejeren allerede har noteret i #5203, men med et
**nyt udløb**: kort efter #5203 selv blev skrevet sendte Hold N10 ca. 1,5 mio. videre til Hold N2 i
én handel. Hold N2 optræder også som modtager fra Hold N1 (netværk 1) og er dermed selv et
knudepunkt med bred aktivitet (37 modparter) — sandsynligvis for bredt til at være den "sidste"
modtager i kæden, men Hold N10's rolle som gennemstrømningskonto er nu bekræftet med endnu en
transaktion. **Prioritet: høj**, i tråd med ejerens egen vurdering i #5203.

### Netværk 3 — Ring A (#5282's hub-sælger)

Se Del B — Hold A ER hub-sælgeren i #5282's transfer-ring. De fair-play-flag der involverer Hold A
herunder er derfor ikke uafhængige fund, men samme mønster set fra detektorens vinkel:

| Par | Netto → | Beløb (størrelsesorden) | Modpartens totale modparter | Klasse |
|---|---|---|---:|---|
| Hold A → Hold C | Hold A | sekscifret, negativt (let imod A) | Hold C: **1** (kun A, nogensinde) | Se note — blandet, ikke rent udtræk |
| Hold A → Hold B | Hold A | sekscifret (~0,5 mio.) | Hold B: 4 | Ægte (del af ring, se Del B) |
| Hold A → Hold D | Hold A | sekscifret (10 handler) | Hold D: 7 | Ægte (del af ring) |
| Hold A → Hold N28 | Hold N28 | sekscifret (~0,8 mio., 1 handel) | Hold N28: 9 | Uafklaret — Hold N28 ikke del af den identificerede ring |
| Hold F ← Hold A | Hold F | sekscifret (~0,2 mio., 2 handler, begge UNDER værdi til F) | **Hold F: 1** (kun A, nogensinde) | **Ægte/uafklaret** — eneste modpart nogensinde, se note |

**Hold C-note:** Hold C har handlet **udelukkende** med Hold A (modpartstal 1) over 5 transaktioner
med blandede ratioer (nogle over, nogle under markedsværdi, nettoresultat kun let negativt imod A).
Det er IKKE et rent værdi-udtræk (pengene går ikke konsekvent én vej), men en eksklusivitet på 100%
af Hold C's handelshistorik er i sig selv usædvanligt og typisk for et husstands- eller vennepar,
ikke for en ring. **Anbefaling: whitelist-kandidat**, ikke sanktionssag, men ejeren bør bekræfte
relationen først (samme princip som de 4 kendte par).

**Hold F-note:** Hold F har ligeledes **kun handlet med Hold A nogensinde** (modpartstal 1), men her
går begge transaktioner samme vej (Hold F køber under værdi begge gange, ca. 93% og 68,5% af
markedsværdi) — altså et rent, om end beskedent, værdi-udtræk fra Hold A til Hold F. Kombineret med
at Hold F ER en af budgiverne i #5282's ringmønster (se Del B) er dette **den stærkeste kandidat til
et 6. ringmedlem** ud over A-E.

### Øvrige par (ikke i et af de tre netværk)

| Par | Netto → | Beløb (størrelsesorden) | Klasse |
|---|---|---|---|
| Hold N14 → Hold N16 | Hold N16 | over 5 mio. (1 handel!) | **Ægte, høj prioritet** — suverænt største enkeltbeløb i hele listen. Hold N14 er IKKE identisk med det kendte husstandspar Hold N6 ↔ Hold N14 (det er en anden modpart-relation). Bør undersøges før triage-sessionen, ikke rutinemæssigt afvises. |
| Hold N16 ↔ Hold N17 | Hold N17 | sekscifret x2 (to flag, modsatrettede) | Uafklaret — se `counterparties` mangler (evidensfelt uden tal for disse to) |
| Hold N16 ↔ Hold N18 | Hold N18 | sekscifret (~0,7 mio., 1 handel) | **Ægte kandidat** — Hold N18 har kun 2 modparter total, sad allerede på den højeste kassebeholdning i hele listen (over 1 mio.) inden handlen |
| Hold N16 ↔ Hold N6 | Hold N6 | sekscifret | Uafklaret |
| Hold N16 ↔ Hold N24 | Hold N24 | sekscifret | Falsk positiv (Hold N24 har 20 modparter) |
| Hold N16 ↔ Hold N19 | Hold N19 | sekscifret | Uafklaret (data mangler modpartstal) |
| Hold N20 → Hold N21 | Hold N21 | sekscifret (~0,3 mio., 1 handel, ratio 2,03x) | **Ægte kandidat** — Hold N20 har kun 2 modparter total |
| Hold N9 ↔ Hold N19 | Hold N19 | sekscifret | Falsk positiv (Hold N9 25 modparter) |
| Hold N9 → Hold N22 | Hold N22 | sekscifret (1 handel) | **Ægte, allerede kendt** — matcher ugescan-fund #3 i #5203 ordret (ny konto, købte straks 2,8x over værdi) |
| Hold N11 ↔ Hold N17 | Hold N11 | sekscifret | Uafklaret |
| Hold N12 ↔ Hold N19 (lifecycle only) | — | — | Uafklaret |
| Hold N23 ↔ Hold N24 | Hold N23 | sekscifret | Falsk positiv (Hold N24 20 modparter) |
| Hold N25 ↔ Hold N2 (lifecycle only) | — | — | Falsk positiv (Hold N2 37 modparter) |
| Hold N26 ↔ Hold N27 | Hold N26 | sekscifret | Uafklaret — samme par som #3818 allerede undersøgte (en navngivet rytter, ejer-note "ligner undervurdering af eget talent") |
| **Hold N26 → Hold N4** | Hold N4 | sekscifret (~0,7 mio., 1 handel, ratio 0,066x) | **Ægte — genkendt mønster.** Samme rytter som Hold N26 modtog billigt fra Hold N27, solgt videre endnu billigere til et tredje hold. Hold N26 optræder nu i BEGGE ender af to forskellige gennemstrømnings-handler. |
| Hold A (gammelt systemnavn) → Hold C (lifecycle) | — | — | Datahygiejne-note: Hold A har haft et andet navn i systemet tidligere (holdet findes ikke længere under det gamle navn) — evidensen er et navne-snapshot fra flag-tidspunktet, ikke en ny modpart. Se Del B. |

### Samlet whitelist-forslag (til ejer-godkendelse i sessionen)

| Par | Grundlag | Ændrer noget i de 45 flag? |
|---|---|---|
| Hold N6 ↔ Hold N14 | #3135-audit, kendt husstand | Nej — intet aktivt flag på parret |
| Hold N15 ↔ Hold N28 | #3135-audit, kendt husstand | Nej — 0 flag nogensinde (#3818 bekræftede samme) |
| Hold N29 ↔ Hold N30 | #3135-audit, kendt husstand | Nej — 0 flag nogensinde |
| Hold N31 ↔ Hold N1 | #3135-audit, kendt husstand | Nej — flaget står allerede `actioned` |
| **Hold A ↔ Hold C** (ny kandidat, ikke i #3135) | Hold C har handlet 100% udelukkende med Hold A, blandede ratioer | **Ja** — ville lukke et aktivt flag på parret |

SQL-skabelonen ligger klar i `database/2026-08-03-fairplay-pair-whitelist.sql`
(`least()/greatest()`-mønsteret); intet er indsat af dette pas, jf. read-only-scopet.

## Del B — #5282: transfer-ring i Division 2, identificeret

`A` fra #5282 er identificeret ved oprettelsesperiode + division (2) + sælgerrolle. De fire købere
er identificeret ved oprettelsesperiode + første-køb-tidspunkt fra A, som stemmer med #5282's egne
observationer:

| #5282-label | Hold | Første køb fra A | Matcher #5282's observation |
|---|---|---|---|
| A (sælger) | Hold A | — | Division 2, oprettet primo juli 2026 ✓ |
| B | Hold B | 16 min. efter oprettelse | ✓ eksakt |
| C | Hold C | 70 min. efter oprettelse | ✓ eksakt |
| D | Hold D | 5 dage efter oprettelse | ✓ |
| E | Hold E | matcher "2,57x værdi" | ✓ |

Ingen delt `user_id` mellem de fem konti (forventet — det ville være for åbenlyst). Oprettelsestidspunkterne
er spredt over ca. 7 uger, ikke skabt i én batch-session, hvilket hverken be- eller afkræfter
koordination mellem separate personer.

### Den anden budgiver (#5282's åbne spørgsmål #2) — BESVARET

**20 auktioner** fra Hold A blev vundet af B/C/D/E i alt (rettelse: #5282 selv angav 18, den
faktiske optælling i dag er 20). Af dem havde **7 kun én byder** (ingen konkurrence at vurdere), **12
havde præcis 2 bydere**, og **1 havde 3 bydere**. Hver af de 12 to-byder-auktioner, én række pr.
auktion:

| Dato (UTC) | Vinder | Anden budgiver |
|---|---|---|
| Uge 1 | Hold B | Hold E |
| Uge 1 | Hold B | Hold D |
| Uge 1 | Hold C | Hold D |
| Uge 1 | Hold E | Hold C |
| Uge 1 | Hold C | Hold E |
| Uge 1 | Hold D | Hold E |
| Uge 2 | Hold E | Hold B |
| Uge 2 | Hold D | Hold B |
| Uge 2 | Hold B | Hold D |
| Uge 2 | Hold D | Hold B |
| Uge 4 | Hold E | **Hold F** |
| Uge 4 | Hold C | **Hold F** |

Herudover ét separat tilfælde med 3 bydere: Hold D vandt over Hold F OG **Hold G** (nyt navn i
systemet, ikke set før i dette mønster).

**Svar: i samtlige 12 to-byder-sager er "den anden budgiver" et af de andre kendte ringmedlemmer
(B/C/D/E), aldrig en uafhængig tredjepart** — undtagen to nye navne i den seneste periode: Hold F (2
gange, og som vist i Del A også selv modtager af underprissalg direkte fra Hold A) og Hold G (1
gang, aldrig set før i dette mønster). Det betyder at "konkurrencen" i disse auktioner ikke er
ekstern efterspørgsel, der driver prisen op naturligt: det er ringens egne medlemmer der byder mod
hinanden på hinandens vegne. Det svarer #5282's eget spørgsmål "blev prisen drevet op kunstigt?"
med: sandsynligvis ja for de 10 sager mellem B/C/D/E indbyrdes, mens Hold F og Hold G endnu ikke er
verificeret som del af samme koordinering (kunne være reelle uafhængige bydere, eller et
6.-7. ringmedlem — se Hold F-noten i Del A, som taler for det første).

### Kobling til #5203

Hold A, Hold B, Hold C, Hold D og Hold F optræder ALLE som en del af det samme klyngemønster i
#5203's fair-play-flag (Netværk 3 ovenfor) — de to issues beskriver samme underliggende hold set fra
to forskellige detektions-veje (spillerrapport vs. automatisk flag). Hold E og Hold G har derimod
**intet** fair-play-flag i den aktuelle 45-kø, selvom Hold E er den næststørste modtager fra Hold A
(sekscifret, høj ende). Det er enten en dækning-hul i detektoren (Hold E's handler ligger måske under
tærsklen 0,35 enkeltvis), eller Hold E har flere modparter der fortynder signalet — begge kræver et
opslag dette pas ikke nåede.

### Ikke undersøgt i dette pas

- Identitetssignaler (IP, enhed, login-tid) — kræver adgang uden for `execute_sql`/logs, samme
  begrænsning #5282 selv noterer.
- Afstemning mod spiller 2's skærmbilleder (ejeren har dem, ikke tilgængelige for denne worker).
- Om detektoren ville fange dette mønster i dag (forward-guard-spørgsmålet i #5282 punkt 5) — kræver
  læsning af `backend/lib/fairplayFlagsCron.js`'s faktiske logik, ikke kun dens output.
- Sanktion eller tilbageførsel af nogen art — helt uden for scope, og ejer-gated per #3131.

## Hvad denne audit ikke dækker

- 12 lifecycle_funnel-flag uden selvstændig evidens ud over det tilhørende value-flow-par er ikke
  dobbelt-klassificeret.
- `#3818` og `#5282`'s egne åbne accept-kriterier er ikke lukket her, kun beriget med nye fund.
- Tærskel-justering (#5203 punkt 5) og rytme-omlægning (punkt 6) er sessionens beslutning, ikke denne
  audits.
