# Natbølge 2026-09-07 (Bane 1: v4 før flip, ejer-mandat 6/9 "lav noget du kan lave uden jeg skal holde dig i hånden")

| Metrik | Værdi |
|---|---|
| Start/slut (lokal tid) | 6/9 23:05 → 7/9 ca. 01:15 |
| Agenter launched / fuldført / døde | 11 Agent-tool-workers (5 første runde, 3 anden runde, 3 rebase/recovery), 11 fuldført, 0 døde, 0 frys |
| PR'er åbnet / merged | 8 åbnet / 8 merget (#4931 #4932 #4933 #4935 #4938 #4939 #4937 #4940) + 2 docs-commits direkte på main (NOW-claim, ankertabel-refresh) |
| Issues → claude:done | #4886 #4910 #4905 #4885 #4929 #4928 #4934 #4911 #4918 #4920 #4919 |
| Nye issues | #4934 (nedkørsels-styrt uden konsekvens, lukket samme nat), #4936 (populations-snapshot skævt, trin 1 målt) |
| gh-401-retries | 0 observeret |
| Recoveries (type) | 0 frys. 3 planlagte rebase-workers i SAMME worktree (B2, C2, D2) fordi SendMessage er slået fra i sessionen |
| Prod-mutationer | Ingen. v4 er flag-OFF; help-sektionen er hardkodet skjult. Kun read-only SQL (#4936 trin 1) |
| Preflight | GO kl. 23:07 (keep-awake startet som baggrundsproces) |

Baseline: `backend/scripts/out/baseline/main-<sha>-s{1,2,3}.txt` + `-tailspread.txt` genkørt efter HVER engine-merge (ffe85890e → dddc7f216 → d7db448ac → d0d7821e5 → f81aac018), 2-4 sek pr. kørsel. Den gamle baseline fra 6/9 17:45 var tom fejl-output (manglende etapefil); fundet og erstattet før launch.

## Spor

| Lane | Issue | Model | PR | Resultat |
|---|---|---|---|---|
| A | #4886 rng-nøgle pr. segment | opus | #4931 | Segment-nøgling i kernen (`segmentRngFor`), `rngForStage` som undtagelse. Issuets breakaway-hypotese holdt ikke (ruller kun på segment 0); reelt ramt: climbSelection + descent. Alle 4 fixtures regenereret |
| B | #4905 nedkørsels-styrt gulv | sonnet | #4933 | Subtraktiv dæmpning ramte 0 ved descending ≥ 67; nu multiplikativ med gulv. Ankre byte-identiske. Fund: styrtet kostede intet → #4934 |
| C | #4885 halen | opus | #4935 | Rod-årsag: absolut styrke-led i fart-modellen + W' aldrig i tærsklen. Hale p90 bjerg 2,7 → 9,1 %, OTL fyrer. Bjerg-top-10 middel 203 → 212 s, spænd 165-242 (→ #4914) |
| D | #4911 regeldokument | sonnet | #4937 | 8 modsigelser lukket med kodebevis, §7 renummereret, ankertabel §7b genereret + pinnet (population + etaper + seeds), `--check`-guard |
| E | #4910 hjælpetekster | sonnet | #4932 | 5 blokke en+da, flag-gated (hardkodet skjult: intet frontend-flag for v4 findes). Ejer-go på tekst udestår til flip |
| F | #4934 styrt ind i M10 | opus | #4939 | Én uheldsmodel (`resolveCrashIncident`), angriber mister gevinst, fælles loft. Uheldsrate 1,7 %/etape, alle ankre grønne |
| G | #4929 + #4928 feature-register | sonnet | #4938 | Løbsside-faner live, `dormant`-state (4 poster), advisory registervagt-workflow |
| H | #4918 + #4920 + #4919 ops | sonnet | #4940 | Bølge-vagt på branch, recovery-brief, brief-generator, close-out-oprydning, merge-kø |

## Afvigelser/læringer

- **Genmål før dispatch, igen:** issuets tal for #4885 (maks 6 %) var forældet samme aften (uheldstrappen gav 25 %-outliers). Baseline før launch fangede det, og briefen bad workeren skille uheld fra fysiologi først. Uden det havde lanen jagtet et forkert tal.
- **Baseline-filer skal verificeres, ikke bare findes:** de tre 6/9-filer var 876 bytes Node-fejl. Tjek indhold (scorecard nederst), ikke filnavn.
- **SendMessage slået fra i sessionen:** rebase efter hver merge krævede en frisk worker i samme worktree (B2, C2, D2). Kostede ~10-15 min pr. rebase men 0 tabt arbejde. Brief-mønstret "WIP-status først, reset aldrig, main's fixtures + regenerér" virkede tre gange ud af tre.
- **Merge-kø én ad gangen med baseline-refresh imellem** gav sammenlignelige før/efter-tal pr. PR og fangede at #4931 selv havde flyttet bjerg-ankeret (s2 rød) før #4935 blev lagt ovenpå.
- **Tre workers fandt ting issuet ikke vidste:** breakaway-hypotesen falsk (A), styrt uden konsekvens (B), populations-snapshot skævt (C). Alle tre blev til kommentar/issue samme nat i stedet for at blive tabt i slutrapporter.
- **Livstegn-reglen holdt:** 10 af 11 workers pushede inden 10 min; ingen tavshed over 30 min på de første 10. Lane H var den eneste der lod arbejde ligge ucommittet i over 20 min.
- **Fejlfamilie nr. 3:** absolutte konstanter mod en evne-relativ skala (#4604, #4615 rk. 13, #4885). Postmortem: `.claude/learnings/2026-09-07-v4-absolute-constants-vs-relative-scale.md`.

## Ejer-valg der venter (ét ad gangen, i NOW.md)

1. Hale-bånd (bjerg 8-15 %, fladt 0,5-3 %, startgæt) og bjerg-anker-spændet 165-242 s: kalibreres sammen med holdspil-gabet i #4914, men FØRST efter #4936 (snapshot re-eksport).
2. Hjælpeteksten "Race day and tactics" (usynlig til flip): læs og godkend/ret i `frontend/public/locales/en/help.json` → `sections.raceDay`.
3. #4915 TTT/passage-punkter (uheld/tidsgrænse på TTT, TTT-point, TTT i S4-kalender).

## Formiddag 7/9 (07:15 → 09:00, ejer til stede)

- **Ejerbeslutning:** hale-bånd låst til bjerg/højbjerg 6-12 %, fladt 0-2 % (RULES §9 beslutning 13). Gate i harnesset (PR #4945, lane I, sonnet, 23 min).
- **#4936 snapshot re-eksport (lane J → J2 → J3):** første worker frøs kl. 07:30 uden push i 49 min (fanget af lane-vagten ved 45-min-grænsen plus ejerens "det tager lang tid"). Recovery-worker i SAMME worktree overtog målt WIP (snapshot + fordelings-udskrift lå på disk), rebasede rent og leverede PR #4946 på 18 min. Én CI-fejl: CLI-testen fandt tabel-headeren ved linje-index, og fordelings-blokken øverst forskød den; fix-worker (J3) rettede testen til at finde headeren ved indhold.
- **Fund der ændrer billedet:** med den rigtige population (5.955 hold-ryttere; prod har 7.880 aktive, forskellen er 1.350 uden hold, 494 akademi og 80 på ekskluderede hold) bliver sprinter-ankeret grønt (96,2 %), men bjerg-top-10 rødt (132 s mod 180-240) og højbjerg-halen rød (5,2 % mod 6-12 %). Alt kalibreret mod juli-filen skal genses. Ejeren: kalibreringen tages i en ny session; brief på #4914, prompt i `docs/drafts/next-session-prompt-2026-09-08-v4-kalibrering.md`.
- **Nye issues:** #4947 (aggregering mangler 3 ankre + stale grus-kommentar), #4948 (raceDay-hjælp hardkodet skjult, flag-endpoint), #4949 (test-rigge spejler ikke segment-nøgling), #4950 (descent-småfælder), #4951 (flag-rækker i app_config for dormant).
- **Læring:** en frossen worker kan have gjort det meste; recovery-briefen skal starte med "commit det der ligger" (J2 fik det som første handling og tabte intet). Test der indexerer output-linjer brækker ved enhver ny top-linje; find headere ved indhold.

Refs #3855 #4914 #605
