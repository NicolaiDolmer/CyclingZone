# Startprompt: pc1 lørdag 17/10 eftermiddag (ejeren er væk)

Kopiér alt under linjen ind i en ny Claude Code-session på pc1 (mappe `C:\dev\CyclingZone`).

---

Ny session på pc1, lørdag 17/10 eftermiddag. Kør `git pull --ff-only` og `npm run sync-deps`, og læs `docs/NOW.md`. Ejeren er væk resten af dagen. Svar på dansk i ALLE beskeder. Start intet ud over opgaverne herunder, som ejeren har godkendt 17/10. Merge ingen UI-PR uden ejerens visuelle go. Saml spørgsmål op til ejeren kommer tilbage, og stil dem så ét ad gangen med en anbefaling og et PNG-billede.

## 1. Dark mode-gennemgang (ejer-godkendt 17/10)

Ejeren har set to fejl, hvor mørke felter ikke kan skelnes fra baggrunden:
- **Holdudtagelse → Dag:** dagsbåndet (dag 1-28) er næsten usynligt. Kun den gule markør ses.
- **Patch notes:** "Kun beta"-kontakten er usynlig, når den er slået fra.

Gør:
1. Tag skærmbilleder i dark mode (desktop 1440 + mobil 375) af alle manager-sider. Find alle steder, hvor felter, kontakter, bånd, kanter eller tekst har for lav kontrast mod baggrunden. Mål: WCAG AA (tekst 4,5:1; ikke-tekst-elementer som kontakter, kanter og bånd 3:1).
2. Saml fundene i ét issue med billeder (også fund i lyst tema, hvis du ser dem).
3. Ret via design-tokens i ét samlet spor (`docs/design/TASTE.md`, `PAGE_TEMPLATES.md`; hairlines, ingen skygger). Ét annoteret før/efter-billede pr. fund i `pr-screens/<issue>/`.
4. PR'en gøres klar til review, men merges IKKE før ejerens visuelle go.

## 2. Design + målt baseline, intet byg (ejer-godkendt 17/10)

- **#6748 punkt 3: udbrud vinder for sjældent på kuperede etaper og mure.** Målt 17/10 på 157 S4-løb: S5 6 % mod v5 12 % mod virkelighed ca. 30-40 %. Skriv spec i `docs/superpowers/specs/` med baseline (`tourDryRun.mjs` + `s5MotorBench.mjs --scope=all`), rodårsag og forslag med A/B til ejeren. Tal kun i `balance-internals/` (hard rule 17).
- **Fast motor-testport før hver tænding:** én kommando, der kører alle kommende løb (`tourDryRun` pr. løb, 8 seeds, nuværende mod ny revision) plus `s5MotorBench --scope=all` og laver ét samlet kort med de samme mål hver gang. Skabelon fra 17/10: `balance-internals/6367/s4-full-2026-10-17/` (`run-shard.sh`, 4 spor) og samle-scriptet. Kun design og forslag i dag.

## Ikke i dag (spørg ejeren senere)

- **#6739: små hold mister etapeløb (A/B).** Ejeren svarede 17/10: "spørg mig senere".
- **#6748 punkt 1, 2, 4 og 5:** S5-kanttilfælde, løbsfilmens kurve og mærkning.

## Close-out

Følg CLAUDE.md: NOW.md, hygiejne-scripts og status-board.
