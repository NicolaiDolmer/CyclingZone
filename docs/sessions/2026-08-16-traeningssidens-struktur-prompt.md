# Session-prompt: træningssidens struktur (#3721) + trin 2

**Model:** Opus 5 · **Indsats:** high · **Form:** design-først, derefter bygge-session
**Skrevet:** 15/8 aften, af loft- og udviklingsfart-sessionen · **Ejer-ramme:** #3721 — *"strukturen er aldrig blevet designet, kun indholdet"*

---

## Prompt (kopiér ind som første besked)

> Du designer og bygger træningssidens struktur, [#3721](https://github.com/NicolaiDolmer/CyclingZone/issues/3721), og derefter trin 2 af [#3709](https://github.com/NicolaiDolmer/CyclingZone/issues/3709) ovenpå. Læs i denne rækkefølge:
>
> 1. `docs/design/PAGE_TEMPLATES.md` — de tre kanoniske skabeloner er **bindende**. Opfind aldrig nyt sidehoved, container-bredde, card-padding eller loading/empty/error-markup.
> 2. `#3721` — problemet, ejer-formuleret.
> 3. `docs/superpowers/specs/2026-08-14-3659-rytterudvikling-og-traening-design.md` §5 og §6 — hvad fladen skal kunne bære, og hvad trin 2 og 4 lægger på den. **Læs §8.1 inklusive rettelsen.**
> 4. `#3747` — trænbarheds-labelen kan ikke længere sige det den siger. Den skal løses **sammen med** trin 2, ikke efter.
> 5. `#3743` — assistentens kvalitet skal afhænge af trænerens evner.
>
> **Arbejd i en worktree.** `pwsh -File scripts/new-worktree.ps1 -Branch feat/3721-traeningssidens-struktur`. Tjek `git branch -a` og nyligt oprettede issues før du går i gang — NOW.md er ikke et pålideligt realtids-claim på tværs af worktrees ([#3712](https://github.com/NicolaiDolmer/CyclingZone/issues/3712)).
>
> **Design før kode.** Ejeren har sagt at strukturen aldrig er blevet designet. Byg ikke videre på den nuværende opbygning fordi den er der — det er præcis fejlen issuet beskriver. Vis mockups før du bygger.
>
> Vær kritisk over for dit eget arbejde. Sig det når du gætter.

---

## Hvorfor denne side, og hvorfor nu

Motoren under træningssiden er bygget om i denne uge. Fladen er ikke fulgt med, og der ligger nu tre ting i kø som alle skal stå på den samme side. Bygger man dem én ad gangen oven på en struktur ingen har designet, får man tre lag lapper.

| hvad | hvor det kommer fra | hvad det kræver af fladen |
|---|---|---|
| Kvitteringen pr. evne | trin 1, **live** | 15 linjer pr. rytter, hver med nu · sæsonens point · fremdrift |
| Et **syvende** fokus (`løbslære`) | trin 2 | fokusvælgeren skal kunne rumme det |
| Fremadrettede tal pr. fokus | trin 4, spec §5.2 | point pr. sæson pr. fokus, pr. rytter |
| Trænbarheds-signalet | #3747 | skal vise **to** knapper i stedet for én |
| Assistentens kvalitet | #3743 | skal kunne forklares for spilleren |

Det er ikke fem små tilføjelser. Det er en side der skal svare på ét spørgsmål — *hvad skal jeg gøre ved denne rytter, og hvad får jeg ud af det* — og som lige nu ikke er bygget til at svare på noget.

## Den ene ting der er vigtigst

**Assistenten er lige så god som det bedste spil.** Målt på 1.200 simulerede karrierer: `smartDefaultFocus` giver rating 28 ved 30 år, og den bedste manuelle strategi giver også 28.

Der findes altså i dag **ingen målbar grund til at åbne træningssiden overhovedet.** Det er den hårdeste kritik man kan rette mod en flade, og den er målt, ikke gættet.

#3743 løser halvdelen (gør assistenten afhængig af trænerens evner, så den kan være dårlig). Men den anden halvdel er fladens: den skal gøre det **synligt og attraktivt** at gøre det selv. En side der er lige så god at ignorere som at bruge, er ikke et designproblem i detaljen — det er et designproblem i formålet.

## Trænbarheds-labelen: løs den med trin 2, ikke efter

Fuld beskrivelse i #3747. Kort: labelen læser kun **taget**, og modellen har nu to knapper.

| klasse | tag | rate | label i dag |
|---|---:|---:|---|
| signatur | 1,30 | 0,45 | `strength` |
| sekundær | 1,10 | 0,36 | `strength` |
| **håndværk** | **0,95** | **0,22** | **`limited`** |
| **anden rolle** | **0,70** | **0,15** | **`limited`** |
| svaghed | 0,20 | 0,05 | `blocked` |

Grunden til at det haster sammen med trin 2: `løbslære` (positioning, tactics, aggression) kommer til at bestå næsten udelukkende af håndværk og anden rolle. **Det nye fokus, hvis hele formål er at gøre spillets mest låste evner trænbare, vil præsentere sig som det mindst attraktive valg på siden.** Shipper man trin 2 uden at røre labelen, bygger man en fælde.

## Grænser

- **Motoren er ikke din.** `backend/lib/riderProgression.js`, `dailyTraining.js`, `training.js` er netop ombygget i [#3739](https://github.com/NicolaiDolmer/CyclingZone/pull/3739) + [#3741](https://github.com/NicolaiDolmer/CyclingZone/pull/3741). Trin 2 ændrer `TRAINING_FOCUSES` og kræver kalibrering af fokus-størrelser (specen: *"fokus-størrelser kalibreres, ikke arves"*) — det er en balance-ændring med egen måling, ikke en konstant du retter.
- **`smartDefaultFocus` må ikke ændres som sideeffekt.** Den afgør hvilket fokus tusindvis af ryttere uden plan trænes med hver dag. Den er verificeret bit-identisk gennem trin 3 og 4 og er pinnet i en test. #3743 er stedet hvor den ændres, med egen dry-run.
- **Ejer-go før merge på alt visuelt.** UI-PR'er merges aldrig uden at ejeren har set dem.

## Værktøj der findes nu

- `backend/scripts/rytterudviklingScorecard.js` — flow-scorecard med fem gates. Kræver en `--baseline`-worktree (`git worktree add --detach ../ref-<navn> <commit>`). Brug den hvis trin 2's fokus-kalibrering flytter noget.
- `docs/audits/2026-08-15-3709-flow-scorecard.md` — hvad modellen gør i dag.
- `docs/audits/2026-08-15-3709-hul7-staff-stien-verificeret.md` — hvad træneren og faciliteten er værd (median +12,9 %, max +38,9 % for 1.932 ryttere). Relevant hvis fladen skal forklare hvorfor en klub-investering betaler sig.

## Målet, i klar tekst

Når sessionen er slut skal en spiller kunne åbne siden og på under et minut svare på: **hvilken af mine ryttere har mest at hente, hvad skal jeg vælge for ham, og hvad får jeg ud af det.** Ikke: hvilke felter findes der.

## Kilder

`#3721` · `#3709` · `#3747` · `#3743` · `#3705` · `docs/design/PAGE_TEMPLATES.md` · specens §5-6 + §8.1
