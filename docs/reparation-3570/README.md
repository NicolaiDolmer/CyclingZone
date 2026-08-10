# Reparationen af rytter-identiteten — #3570, indstilling D

Materialet der skal til for at gennemføre (eller undlade) reparationen. Det lå
oprindeligt kun i en midlertidig session-scratchpad. En skrivning til 8.193 ryttere
må ikke afhænge af en temp-mappe, så det er lagt her.

De tre tal der bliver blandet sammen: **8.193** ryttere får skrevet en identitet ·
**5.977** af dem skifter synlig type · **4.027** flyttes væk fra deres fødsels-anlæg
for at ramme kvoterne (det kombinatoriske minimum, `Σ_k max(0, født_k − kvote_k)`).

| fil | hvad det er |
|---|---|
| [`KOEREBOG.md`](KOEREBOG.md) | **Læs denne på skrivedagen.** Trin 0-4, hvad der afbryder hvert trin, hvad der IKKE er en fejl, og hvad man gør hvis en kørsel knækker midtvejs. Skrevet til en person der ikke har læst natbølgen. |
| [`RAPPORT-PLAN-D.md`](RAPPORT-PLAN-D.md) | Hvorfor D — indstillingen ejeren valgte, dens mål og dens omkostninger. |
| [`RAPPORT-DRYRUN-D.md`](RAPPORT-DRYRUN-D.md) | Integrations-dry-runnet af apply-værktøjet mod D, kørt mod en ægte PostgreSQL med prod-skemaet. Inkl. de fem blokkere der blev fundet og lukket, og listen over hvad der **ikke** er verificeret. |
| `skriveplan-D-2026-08-10.json.gz` | **Den godkendte skriveplan.** 8.193 identiteter, heraf 5.977 typeskift. Bygget på `docs/snapshots/3570/`-snapshottet, genereret 2026-08-10T13:35:56Z. |

Populationen: se [`docs/snapshots/3570/`](../snapshots/3570/README.md) — det daterede
10/8-snapshot planen er bygget på, og rollback-grundlaget.

## Skriveplanen

Filen er gzippet, ligesom snapshottene ved siden af — 22,9 MB rå, 1,9 MB pakket.
Indholdet er bit-identisk med generatorens output (SHA-256 af de udpakkede bytes:
`fcb6da6ee7e643d4019c335e1163e9c18f8e2485fee998a9cbe0daf0355234b2`,
22.920.200 bytes). `laesPlanFil()` i `repair3570Apply.mjs` pakker `.gz` ud selv.

```bash
node scripts/dev/repair3570Apply.mjs --selvtest \
  --plan-fil=../docs/reparation-3570/skriveplan-D-2026-08-10.json.gz
```

## Den åbne afhængighed

Værktøjet kan **anvende** D. Det kan ikke **regenerere** D — generatoren blev aldrig
committet. Valget mellem at committe generatoren og at bygge D ind i `buildPlan` står
sidst i kørebogen og er **ikke truffet**.

## Målt 10/8 ~20:00 CEST: planen dækker ikke længere populationen

Kørebogen kaldte det «den mest sandsynlige afbrydelse på dagen». Det er ikke længere
en sandsynlighed. Målt read-only mod prod (fire `SELECT`, ingen mutation):

| | snapshot 9/8 22:30 | prod 10/8 ~20:00 |
|---|---:|---:|
| levende ryttere | 8.199 | **8.738** |
| levende med `archetype_draw` | 6 | **740** |

De 722 nye er oprettet **inden for 34 sekunder** 10/8 kl. 19:47 CEST: 695 frie
markeds-ryttere, 25 akademi-ryttere til 16 menneskehold, 2 menneske-ejede.

**To spærrer fyrer, ikke én:**

1. **Dæknings-gaten** (kørebogens trin 1): 722 ryttere i skrive-scopet har ingen
   godkendt identitet i planen. Fail-closed, som designet.
2. **A0 i `repair3570Rollback.sql`** (trin 2): den afbryder ved >50 ryttere med
   `archetype_draw`. Der er 740. **Sikkerhedskopien kan altså ikke tages.**

Spærre 2 er en fejl, ikke en korrekt afvisning. A0's kendetegn — «før reparationen har
kun en håndfuld levende ryttere et draw» — var sandt da 6 havde ét. Nu giver
`fictionalRiderGenerator` hver ny rytter et draw ved fødslen, så tallet vokser af sig
selv. Kendetegnet kan ikke længere skelne «reparationen er allerede kørt» fra «der er
født nye ryttere», og det er hele dens opgave.

**Forslag (ikke bygget):** tæl kun ryttere oprettet FØR planens snapshot-tidspunkt.
Det tal står på 18 indtil reparationen kører og springer så til 8.193 — et kendetegn
der ikke forfalder når generatoren opfører sig normalt. Cutoff'et kan læses ud af
plan-filens `kilde_snapshot`. Rettelsen hører hjemme i `rollbackSQL()` og i
værktøjets `DRAW_BASELINE_SPAERRE`, så begge steder bruger samme grænse.

**Sidegevinst ved den samme måling:** 616 af de 740 draws har `secondary: null` — det
er [#3593](https://github.com/NicolaiDolmer/CyclingZone/issues/3593) live på 616
ryttere lige nu. Reparationen skriver en ikke-null sekundær for alle 8.193 den rører,
så den lukker hullet for dem; den lukker det ikke for ryttere født bagefter.
