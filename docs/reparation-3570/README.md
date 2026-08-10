# Reparationen af rytter-identiteten — #3570, indstilling D

Materialet der skal til for at gennemføre (eller undlade) reparationen. Det lå
oprindeligt kun i en midlertidig session-scratchpad. En reparation af 4.027 ryttere
må ikke afhænge af en temp-mappe, så det er lagt her.

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
committet. Bestanden driver (AI-hold oprettes og trimmes løbende), så kørebogens trin 1
vil med stor sandsynlighed melde «rytter i skrive-scopet mangler i planen» hvis
skrivedagen ikke er 10/8. Det er fail-closed med vilje, men det skal kunne komme
videre. Valget mellem at committe generatoren og at bygge D ind i `buildPlan` står
sidst i kørebogen og er **ikke truffet**.
