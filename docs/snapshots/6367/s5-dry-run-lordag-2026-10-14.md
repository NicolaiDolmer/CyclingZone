# #6367 / #5833 S5-tørkørsel med de låste datoer: onsdag 28/10 → lørdag 28/11 (2026-10-14)

Genkørsel af S5-tørkørslen efter ejerbeslutningen 14/10 kl. 20:35 ([#5833](https://github.com/NicolaiDolmer/CyclingZone/issues/5833)): sidste løbsdag er **lørdag** fra S5. Den første tørkørsel (`s5-dry-run-2026-10-14.md`) brugte søndag 29/11 (33 løbsdatoer), fordi §2 dengang krævede søndag. Denne kørsel bruger det låste vindue: **28/10 → 28/11 = 32 løbsdatoer**.

Intet er skrevet til prod: `buildSeasonCalendar` kørte uden `--apply` (kun SELECT), generator-scriptet er offline.

> **Offentligt repo (hard rule 17).** Kvalitative resultater her; de præcise tal (fordelinger, gulve, afvigelser) står i den gitignorerede `balance-internals/6367/` (filnavne nederst).

## Kørsler

| Kørsel | Kommando | Resultat |
|---|---|---|
| A. Kalender-dry-run mod prod (read-only) | `infisical run --env=prod -- node scripts/buildSeasonCalendar.js --season 5 --first-day 2026-10-28 --last-day 2026-11-28 --uniform-tilt` | §2-vinduet **accepteret** ("sidste dag er en lørdag (sæson 5): OK"). Benchmark-gaten **grøn**. Stoppet af to fund (se 1 og 2) |
| A2. Forbi pr.-division-K-B | `... --allow-tier-composition-drift` (kun for at måle resten) | Stoppet af sæson-K-B (se 3) |
| A3. Forbi begge K-B-gates | `... --allow-tier-composition-drift --allow-composition-drift` (kun måling) | Dry-runnet kører til ende. Exit 1 pga. placerings-gaten (1) og skrive-gaten (sæson 5-rækken findes ikke endnu, forventet før `--apply`) |
| B. Generator offline, 5 sæson-træk | `node scripts/dev/s5ProfileDryRun.mjs --first-day=2026-10-28 --last-day=2026-11-28 --seeds=5` | 0 etaper med type ≠ B+ og 0 afslutninger uden for matrixen i alle 5 træk. Alle tre Grand Tours rammer kvoten præcist i alle 5 træk. Uændret fra 33-dages-kørslen |
| Regel-tjek | `resolveSeasonWindow` / `resolveBuildSeasonWindow` (enhedstests) | S5 med søndag 29/11 **afvises** nu; S4 (man 28/9 → søn 25/10) er uændret |

## Hvad 32 dage ændrer i forhold til 33

| Gate | 33 dage (søn 29/11) | 32 dage (lør 28/11) |
|---|---|---|
| §2-vindue | krævede søndag | ✅ lørdag accepteret |
| Benchmark-gaten (S5, del 1-3) | ✅ grøn | ✅ grøn |
| Løb hver kalenderdag (§2) | ✅ | ✅ |
| Kvote (§1b), mindste-overlap, monument/GT-spænd, GT-rækkefølge, ingen GT-start dag 1 | ✅ | ✅ |
| #5592 sæsonskifte-tider | sidste dag søndag kl. 15 | ✅ lørdag 28/11 slutter kl. 15 i alle fire divisioner; første dag (onsdag 28/10) har normale tider, da den ligger langt over 24 t efter S4's skifte; kun 28/11 afviger |
| **§5 terræn-gulve (placerings-gate, ingen override)** | ✅ | ❌ **D1's bølget-familie (rolling) ligger lige under gulvet** |
| K-B pr. division (§6) | ❌ D1 bjerg over tolerance | ❌ samme |
| **K-B sæson-aggregat (§6)** | ✅ | ⚠ kuperet lidt under og bjerg lidt over den strenge sæson-tolerance (kan overrides) |
| §6b uniforme mål | 5 afvigelser | 4 afvigelser (D3's brosten er nu inden for) |
| §7b finale-bånd | røde, dømmes ikke for S5 (§7c) | samme |

## Afvigelser og åbne punkter

1. **Ny hård blokering: §5 bølget-gulvet i D1.** Med én kalenderdag mindre får D1 færre etaper, og bølget-familien falder fra lige over til lige under §5-gulvet. Det er en placerings-gate uden override, så `--apply` stopper. Det skal løses før generering, enten ved katalog/pakker (flere bølgede etaper i D1) eller en ejer-beslutning om gulvet for S5-modellen. Ikke rørt i denne PR.
2. **K-B pr. division (§6) i D1**: uændret fra 33-dages-kørslen (bjerg-andelen over tolerancen). Ejer-valg som før: `--allow-tier-composition-drift` for S5, eller nye §6-mål for S5-modellen.
3. **Ny: K-B sæson-aggregat (§6)** er lige uden for den strenge sæson-tolerance (kuperet under, bjerg over). Kan overrides med `--allow-composition-drift`; samme rod som punkt 2 (B+ læser typen af stigningerne).
4. **§1d fælles løbsdage er stadig slået FRA for S5** (`SEASON_RACE_DAY_TARGET` har kun S4). D1 har klart flest løbsdage. S5's mål skal sættes før `--apply`.
5. **`SEASON_RACE_DAYS_DEFAULT` har stadig ingen S5-længde.** `--last-day 2026-11-28` skal med ved `--apply`. Det udledte forslag fra onsdag 28/10 er i øvrigt netop 32 dage (lørdag 28/11).
6. **Skrive-gaten (§2c)** er NÆGTET i dry-runnet, fordi sæson 5-rækken ikke findes endnu. Forventet.
7. **Del (4) motor** i benchmark-gaten er stadig en stub (#6363).

## Private filer (gitignoreret, `balance-internals/6367/`)

- `kalender-A-lordag.txt` (kørsel A)
- `kalender-A2-lordag.txt` (kørsel A2)
- `kalender-A3-lordag.txt` (kørsel A3, til ende)
- `generator-B-lordag-2026-11-28.md` (kørsel B)

Refs #6367 #5833
