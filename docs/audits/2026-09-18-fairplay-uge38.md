# Fair-play uge 38: klassificering af de 45 åbne flag + transfer-ring-analyse

> **Kørt:** 2026-09-18, read-only worker (docs/5203-readonly-reports-uge38). Kun `SELECT` mod prod via
> Supabase MCP (`execute_sql`). Ingen mutation, ingen sanktion, ingen spillere kontaktet.
> **Dækker:** #5203 (triage af de 45 `new`-flag + whitelist-forslag) og #5282 (transfer-ring i Division 2).
> **Holdnavne bruges som identifikator** (ikke anonymiseret) fordi #5203 og #5282 selv navngiver holdene
> i klartekst i den offentligt læsbare repo — det er projektets etablerede praksis for holdidentitet.
> Ingen e-mail eller andet personhenførbart er slået op eller citeret her. `teams.user_id` er slået op
> for de 6 hold i Del B udelukkende for at sammenligne dem parvis (samme/forskellig konto) — de rå
> UUID-værdier er ikke gengivet nogen steder i dette dokument.

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

### Netværk 1 — LEGO-Vestas Cycling Team (34 modparter): mest støj

LEGO-Vestas optræder i **13 af de 45 flag**. Med 34 distinkte modparter i alt (og modparterne selv
ofte lige så brede: Lidl–Leffe 37, Équipe Lorraine Acier 21) er langt de fleste af disse par
**falsk positiv-kandidater**: statistisk normalt for et hold der handler bredt og ofte.

| Par | Netto → | Beløb | Antal handler | Klasse |
|---|---|---:|---:|---|
| LEGO-Vestas ↔ Lidl–Leffe Pro Drinking | Lidl–Leffe | 2.125.953 | 3 | Uafklaret (begge brede, men beløbet er højt — se note) |
| **LEGO-Vestas → Reynolds Team** | Reynolds | 1.432.494 | 4 (alle på 3 min., 27/7) | **Ægte** — se boks nedenfor |
| LEGO-Vestas ↔ Wander Riders | Wander Riders | 528.890 | 6 | Falsk positiv (Wander Riders har 7 modparter, spredt over tid) |
| LEGO-Vestas ↔ Guaracha Guerreros | Guaracha Guerreros | 284.105 | 3 | Falsk positiv (begge brede) |
| LEGO-Vestas ↔ 24/7 Aspire-Light (x2 flag) | 24/7 | 225.559 + 275.100 | 4+2 | Falsk positiv — se whitelist-note |
| LEGO-Vestas ↔ Team Easy-On | Team Easy-On | 216.969 | 2 | Uafklaret (Easy-On kun 4 modparter) |
| LEGO-Vestas ↔ Valbycycling Inc (x2 flag) | LEGO-Vestas | 98.538 | 2 | **Ægte, men allerede kendt** — matcher ugescan-fund #2 i #5203 (ny konto 27/8, betalte 2,5x og 11,5x for ryttere fra et etableret hold 66 min. og 17 dage efter oprettelse) |
| LEGO-Vestas ↔ Team Hansen Pro Cycling | Team Hansen | 251.762 | 3 | Falsk positiv (Team Hansen har 25 modparter) |
| LEGO-Vestas ↔ NewE Pro Cycling | NewE | 257.575 | 3 | Del af Netværk 2, se dér |
| LEGO-Vestas ↔ GFDJ | GFDJ | 387.645 | 3 | Falsk positiv (GFDJ kun 5 modparter, men handlen går IMOD LEGO-Vestas — GFDJ vandt værdi, ikke tabte den) |
| LEGO-Vestas ↔ RMF Pro Athletic | RMF | 503.710 | 1 | Uafklaret |
| LEGO-Vestas ↔ Prema (lifecycle only) | — | — | — | Uafklaret, ingen value-flow-par fundet |

**Ægte fund — LEGO-Vestas → Reynolds Team (burst-dump):** fire auktioner, alle afsluttet inden for
3 minutter (27/7 kl. 08:20-08:23), alle vundet af Reynolds Team til stærk underpris (ratio 0,088-0,409
af markedsværdi). Reynolds Team har **kun 2 modparter i hele sin historie** og står i dag med en
kassebeholdning på 20.004, altså tæt på nul, selvom holdet har modtaget rytterværdi for over 1,4 mio.
Enten er Reynolds en alt-konto der modtager værdi og siden er tømt igen (ryttere videresolgt/brugt),
eller LEGO-Vestas har bevidst tabt fire auktioner i træk til samme modtager. Dette matcher #5282's
åbne spørgsmål "er den anden budgiver uafhængig" — se Del B for hvordan det spørgsmål besvares for
Sleepy Riders-ringen; det samme spørgsmål er IKKE undersøgt for denne LEGO-Vestas-klynge i dette pas.

**Whitelist-note (design­spørgsmålet fra #5203 punkt 1):** ingen flag findes i dag for **24/7 ↔
Metro-L3** eller **Wheelbarrels ↔ Nickstar** — de to par er aldrig blevet flagget af detektoren
(bekræftet ved direkte opslag på parret, 0 rækker). **TR Cycling ↔ LEGO-Vestas** HAR et flag, men det
står allerede `actioned` (ikke i denne liste). Whitelisting af de 4 kendte husstandspar ændrer altså
ikke noget i den aktuelle 45-kø — den er ren forebyggelse mod fremtidige flag på de samme par, ikke en
oprydning af eksisterende støj.

### Netværk 2 — NewE Pro Cycling: gennemstrømning (mellemstation)

NewE Pro Cycling har 18 modparter (moderat bredt), men nettopositionen over 90 dage er en klar
ind-og-ud-strøm med kassebeholdning nu på kun **35.040**:

| Par | Netto | Beløb | Dato | Klasse |
|---|---|---:|---|---|
| Équipe Lorraine Acier → NewE | **ind** | 3.284.622 | seneste 17/8 (6 handler) | Ægte — kilden |
| NewE → The 3rd Leg of Lukaku | ud | 777.354 | seneste 31/8 (4 handler) | Ægte — udløb 1 |
| NewE → Team Fakta | ud | 490.789 | 7/9 (1 handel) | Ægte — matcher ugescan-fund #1 i #5203 ordret |
| **NewE → Lidl–Leffe Pro Drinking** | **ud** | **1.460.596** | **14/9, 1 handel** | **Ægte, NYT siden #5203 blev skrevet 14/9** |
| LEGO-Vestas → NewE | ind | 257.575 | 3 handler | Ægte — endnu en kilde ind |

Dette er den samme "mellemstation"-observation ejeren allerede har noteret i #5203, men med et
**nyt udløb**: 14/9 sendte NewE 1.460.596 videre til Lidl–Leffe Pro Drinking i én handel, dagen
efter #5203 selv blev skrevet. Lidl–Leffe optræder også som modtager fra LEGO-Vestas (netværk 1) og
er dermed selv et knudepunkt med bred aktivitet (37 modparter) — sandsynligvis for bredt til at være
den "sidste" modtager i kæden, men NewE's rolle som gennemstrømningskonto er nu bekræftet med endnu
en transaktion. **Prioritet: høj**, i tråd med ejerens egen vurdering i #5203.

### Netværk 3 — Sleepy Riders (tidligere "Cadenza Comoda Pro Cycling")

Se Del B — Sleepy Riders ER hub-sælgeren ("A") i #5282's transfer-ring. De fair-play-flag der
involverer Sleepy Riders herunder er derfor ikke uafhængige fund, men samme mønster set fra
detektorens vinkel:

| Par | Netto → | Beløb | Modpartens totale modparter | Klasse |
|---|---|---:|---:|---|
| Sleepy Riders → Rumler Roulers | Sleepy Riders | -142.036 (netto let imod Sleepy) | Rumler: **1** (kun Sleepy, nogensinde) | Se note — blandet, ikke rent udtræk |
| Sleepy Riders → Helmers | Sleepy Riders | -574.521 | Helmers: 4 | Ægte (del af ring, se Del B) |
| Sleepy Riders → Koben Racing | Sleepy Riders | -271.272 (10 handler) | Koben: 7 | Ægte (del af ring) |
| Sleepy Riders → Nickstar Rockets | Nickstar | -801.932 (1 handel) | Nickstar: 9 | Uafklaret — Nickstar ikke del af den identificerede ring |
| Finnish Racing ← Sleepy Riders | Finnish Racing | -208.567 (2 handler, begge UNDER værdi til Finnish) | **Finnish Racing: 1** (kun Sleepy, nogensinde) | **Ægte/uafklaret** — eneste modpart nogensinde, se note |

**Rumler Roulers-note:** Rumler Roulers har handlet **udelukkende** med Sleepy Riders (modpartstal
1) over 5 transaktioner med blandede ratioer (nogle over, nogle under markedsværdi, nettoresultat
kun -142.036 imod Sleepy). Det er IKKE et rent værdi-udtræk (pengene går ikke konsekvent én vej),
men en eksklusivitet på 100% af Rumlers handelshistorik er i sig selv usædvanligt og typisk for et
husstands- eller vennepar, ikke for en ring. **Anbefaling: whitelist-kandidat**, ikke sanktionssag,
men ejeren bør bekræfte relationen først (samme princip som de 4 kendte par).

**Finnish Racing-note:** Finnish Racing har ligeledes **kun handlet med Sleepy Riders nogensinde**
(modpartstal 1), men her går begge transaktioner samme vej (Finnish Racing køber under værdi begge
gange, 93% og 68,5% af markedsværdi) — altså et rent, om end beskedent, værdi-udtræk fra Sleepy
Riders til Finnish Racing. Kombineret med at Finnish Racing ER en af budgiverne i #5282's ringmønster
(se Del B) er dette **den stærkeste kandidat til et 6. ringmedlem** ud over A-E.

### Øvrige par (ikke i et af de tre netværk)

| Par | Netto → | Beløb | Klasse |
|---|---|---:|---|
| Metro-L3 → Équipe Lorraine Acier | Équipe Lorraine Acier | 6.106.247 (1 handel!) | **Ægte, høj prioritet** — suverænt største enkeltbeløb i hele listen. Metro-L3 er IKKE identisk med det kendte "24/7 ↔ Metro-L3"-husstandspar (det er en anden modpart). Bør undersøges før triage-sessionen, ikke rutinemæssigt afvises. |
| Équipe Lorraine Acier ↔ den usaltet smør | den usaltet smør | 488.720 / -478.722 (to flag, modsatrettede) | Uafklaret — se `counterparties` mangler (evidensfelt uden tal for disse to) |
| Équipe Lorraine Acier ↔ Team CSC | Team CSC | 738.514 (1 handel) | **Ægte kandidat** — Team CSC har kun 2 modparter total, sad allerede på den højeste kassebeholdning i hele listen (1.312.109) inden handlen |
| Équipe Lorraine Acier ↔ 24/7 Aspire-Light | 24/7 | 432.415 | Uafklaret |
| Équipe Lorraine Acier ↔ Bacon Fræsers | Bacon Fræsers | 139.515 | Falsk positiv (Bacon Fræsers har 20 modparter) |
| Équipe Lorraine Acier ↔ SJ racing | SJ racing | 108.769 | Uafklaret (data mangler modpartstal) |
| Liverpool Racing → Borregaard Racing | Borregaard | 329.210 (1 handel, ratio 2,03x) | **Ægte kandidat** — Liverpool Racing har kun 2 modparter total |
| Team Hansen Pro Cycling ↔ SJ racing | SJ racing | 120.507 | Falsk positiv (Team Hansen 25 modparter) |
| Team Hansen Pro Cycling → MIE1981 | MIE1981 | 105.666 (1 handel) | **Ægte, allerede kendt** — matcher ugescan-fund #3 i #5203 ordret (ny konto 9/9, købte straks 2,8x over værdi) |
| GFDJ ↔ den usaltet smør | GFDJ | -478.722 | Uafklaret |
| RMF Pro Athletic ↔ SJ racing (lifecycle only) | — | — | Uafklaret |
| Atom Bikers ↔ Bacon Fræsers | Atom Bikers | -148.350 | Falsk positiv (Bacon Fræsers 20 modparter) |
| Montillana Scott ↔ Lidl–Leffe (lifecycle only) | — | — | Falsk positiv (Lidl–Leffe 37 modparter) |
| De Saltede Guder ↔ L'Échappée du Soleil | De Saltede Guder | -487.239 | Uafklaret — samme par som #3818 allerede undersøgte (Shun Kimura, ejer-note "ligner undervurdering af eget talent") |
| **De Saltede Guder → Wander Riders** | Wander Riders | 712.235 (1 handel, ratio 0,066x) | **Ægte — genkendt mønster.** Samme rytter (Shun Kimura) som De Saltede Guder modtog billigt fra L'Échappée, solgt videre endnu billigere til et tredje hold. De Saltede Guder optræder nu i BEGGE ender af to forskellige gennemstrømnings-handler. |
| Cadenza Comoda Pro Cycling → Rumler Roulers (lifecycle) | — | — | Datahygiejne-note: "Cadenza Comoda Pro Cycling" er Sleepy Riders' GAMLE navn (holdet findes ikke længere under det navn) — evidensen er et navne-snapshot fra flag-tidspunktet, ikke en ny modpart. Se Del B. |

### Samlet whitelist-forslag (til ejer-godkendelse i sessionen)

| Par | Grundlag | Ændrer noget i de 45 flag? |
|---|---|---|
| 24/7 Aspire-Light Velo Team ↔ Metro-L3 | #3135-audit, kendt husstand | Nej — intet aktivt flag på parret |
| The Wheelbarrels ↔ Nickstar Rockets | #3135-audit, kendt husstand | Nej — 0 flag nogensinde (#3818 bekræftede samme) |
| The Morse Codes ↔ Team Velocity One | #3135-audit, kendt husstand | Nej — 0 flag nogensinde |
| TR Cycling ↔ LEGO-Vestas Cycling Team | #3135-audit, kendt husstand | Nej — flaget står allerede `actioned` |
| **Sleepy Riders ↔ Rumler Roulers** (ny kandidat, ikke i #3135) | Rumler Roulers har handlet 100% udelukkende med Sleepy Riders, blandede ratioer | **Ja** — ville lukke flag `5978f7db` |

SQL-skabelonen ligger klar i `database/2026-08-03-fairplay-pair-whitelist.sql`
(`least()/greatest()`-mønsteret); intet er indsat af dette pas, jf. read-only-scopet.

## Del B — #5282: transfer-ring i Division 2, identificeret

`A` fra #5282 er identificeret ved oprettelsesdato (9/7) + division (2) + sælgerrolle:
**A = Sleepy Riders**. De fire købere er identificeret ved oprettelsesdato + første-køb-tidspunkt
fra A, som stemmer eksakt med #5282's egne observationer:

| #5282-label | Hold | Oprettet | Første køb fra A | Matcher #5282's observation |
|---|---|---|---|---|
| A (sælger) | **Sleepy Riders** | 2026-07-09 | — | Division 2, oprettet 9/7 ✓ |
| B | **Helmers** | 2026-08-15 20:17 UTC | 15/8 22:33 CEST (16 min. efter oprettelse) | ✓ eksakt |
| C | **Rumler Roulers** | 2026-08-22 06:40 UTC | 22/8 09:50 CEST (70 min. efter oprettelse) | ✓ eksakt |
| D | **Koben Racing** | 2026-08-09 06:50 UTC | 14/8 (5 dage efter oprettelse) | ✓ |
| E | **Island Cycling Team** | 2026-08-02 11:00 UTC | 6/8 (matcher "2,57x værdi") | ✓ |

Ingen delt `user_id` mellem de fem konti (forventet — det ville være for åbenlyst). Oprettelsestidspunkterne
er spredt over 7 uger (2/8 til 22/8), ikke skabt i én batch-session, hvilket hverken be- eller afkræfter
koordination mellem separate personer.

### Den anden budgiver (#5282's åbne spørgsmål #2) — BESVARET

**20 auktioner** fra Sleepy Riders blev vundet af B/C/D/E i alt (rettelse: #5282 selv angav 18, den
faktiske optælling i dag er 20). Af dem havde **7 kun én byder** (ingen konkurrence at vurdere), **12
havde præcis 2 bydere**, og **1 havde 3 bydere**. Hver af de 12 to-byder-auktioner, én række pr.
auktion:

| Dato (UTC) | Vinder | Anden budgiver |
|---|---|---|
| 17/8 15:33 | Helmers | Island Cycling Team |
| 20/8 21:30 | Helmers | Koben Racing |
| 22/8 07:50 | Rumler Roulers | Koben Racing |
| 23/8 07:28 | Island Cycling Team | Rumler Roulers |
| 23/8 07:28 | Rumler Roulers | Island Cycling Team |
| 23/8 20:20 | Koben Racing | Island Cycling Team |
| 26/8 21:00 | Island Cycling Team | Helmers |
| 26/8 21:00 | Koben Racing | Helmers |
| 26/8 21:08 | Helmers | Koben Racing |
| 27/8 06:00 | Koben Racing | Helmers |
| 3/9 08:57 | Island Cycling Team | **Finnish Racing** |
| 5/9 10:40 | Rumler Roulers | **Finnish Racing** |

Herudover ét separat tilfælde med 3 bydere: **16/9 18:26**, Koben Racing vandt over Finnish Racing OG
**RaceGen Cycling Team** (nyt navn, ikke set før i dette mønster).

**Svar: i samtlige 12 to-byder-sager er "den anden budgiver" et af de andre kendte ringmedlemmer
(B/C/D/E), aldrig en uafhængig tredjepart** — undtagen to nye navne i september: Finnish Racing (2 gange, og som
vist i Del A også selv modtager af underprissalg direkte fra Sleepy Riders/A) og RaceGen Cycling Team
(1 gang, 16/9, aldrig set før i dette mønster). Det betyder at "konkurrencen" i disse auktioner ikke
er ekstern efterspørgsel, der driver prisen op naturligt: det er ringens egne medlemmer der byder mod
hinanden på hinandens vegne. Det svarer #5282's eget spørgsmål "blev prisen drevet op kunstigt?"
med: sandsynligvis ja for de 10 sager mellem B/C/D/E indbyrdes, mens Finnish Racing og RaceGen Cycling
Team endnu ikke er verificeret som del af samme koordinering (kunne være reelle uafhængige bydere,
eller et 6.-7. ringmedlem — se Finnish Racing-noten i Del A, som taler for det første).

### Kobling til #5203

Sleepy Riders (A), Helmers (B), Rumler Roulers (C), Koben Racing (D) og Finnish Racing optræder ALLE
som en del af det samme klyngemønster i #5203's fair-play-flag (Netværk 3 ovenfor) — de to issues
beskriver samme underliggende hold set fra to forskellige detektions-veje (spillerrapport vs.
automatisk flag). Island Cycling Team og RaceGen Cycling Team har derimod **intet** fair-play-flag i
den aktuelle 45-kø, selvom Island Cycling Team (E) er den næststørste modtager fra Sleepy Riders
(657.006). Det er enten en dækning-hul i detektoren (Island Cyclings handler ligger måske under
tærsklen 0,35 enkeltvis), eller Island Cycling har flere modparter der fortynder signalet — begge
kræver et opslag dette pas ikke nåede.

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
