# Bølge 2 (dagsbølge) 2026-08-17 — cutover-kernen + spillermærkbare ting

| Metrik | Værdi |
|---|---|
| Start/slut (lokal tid) | ~13:20 → ~15:45 |
| Agenter launched / fuldført / døde | 10 / 10 / 0 |
| PR'er åbnet / merged | 9 / 9 (3829-3836, 3840, 3841; 3841 auto-merge på grøn) |
| Issues → claude:done | #3819 #3541 #3551 #2889 #3715 #3496 #3493 #3491 #3549 (+ #3826 #3067 #2400 ved #3841-merge) |
| Prod-mutationer (ejer-godkendte) | 1: #3715-reparation, 11/11 ryttere, backup + post-verify + uafhængigt SQL-tjek |
| Migrationer applied post-merge | #3834 (mandat-tabeller, auto), #3549-typen (manuelt under #2642, post-verify grøn) |
| Bundle (forenet træ inkl. v7.136) | 952,7 KB gzipped mod loft 958,7 — grøn, kun 6 KB luft |
| Preflight | GO kl. 13:26 (.codex.local/night-wave-preflight.json) |
| Patch note | v7.136 (samlet entry, nummer tjekket mod main + åbne PR'er; #3798 bærer stale 7.132 til A1-renummerering) |

## Cutover-beslutninger truffet af ejeren i sessionen

Alle fire drejebogs-spørgsmål + økonomi-beslutning 4+5 (dokumenteret på #3757 og i drejebogen): alle fire komponenter FORSØGES 23/8 (#3514 genoplivet) · spillerbesked før flip · caps-gendannelse via spor 1 + staging-generalprøve · ankerværdi som løngrundlag · ét globalt A mod 35 % af genmålt indtægt. #3393 løn afventer fælles design (ejer-valg under bølgen).

## Gates efter bølgen (23/8-status)

- **Race-day (#3459): KLAR.** Snapshot/gendannelses-værktøj bevist mod staging (netto-nul-test, uafhængig SQL-verifikation). Besked-udkast klar (`docs/discord/2026-08-17-cutover-beskeder.md`).
- **Markedsvægt: RØD — udgår 23/8.** Refit måler dårligere end kørende model på alle tre mål (MAE 29.831 mod 20.572). Nøglefund: **v4 × 0,422 slår alt** — markedet er enigt om rangorden, uenigt om niveau (faktor ~2,4). Anbefalet vej: niveau-korrektion, ikke modelskifte; kræver egen beslutning + måling. Blend-sweepets omfordeling bekræftet som doktrin-problem (straffer styrke).
- **Løn (#3393): afventer fælles design.** Kan desuden ikke flippe uden værdier under bindende rækkefølge — medmindre ankerværdi-grundlaget (beslutning 4) afkobler den; hører til design-sessionen.
- **Mandat (#3514): fase 1a/1b MERGED + inert.** Dry-run grøn; rest: script-apply mod staging med ejer-nøgle før 23/8 + backfill-timing ift. sæsonskiftet (i drejebogen).

## Afvigelser/læringer

- **Baseline-uenighed spor 1 vs spor 10** om mandat-flippets konsekvens-effekt ("0 nye tærskler" vs "30 skifter lag"). Afgjort af orkestrator mod prod-grundsandheden (`board_consequences`): spor 10's baseline (aktive konsekvenser) var den rigtige; spor 1 antog 1-års-planen alene som driver. Præcist facit: 0 nye negative konsekvenser, 34 lettelser, **3 hold** (Indeso, Purple Rain, Xtreme Noob) mister bonus-berettigelse — deres igangværende tilbud løber færdig (ejer-informeret, teknisk valg). Læring: `.claude/learnings/2026-08-17-to-agenter-to-baselines-samme-tal.md`.
- Drejebogens stop-grænse (Δ −29) står i før-#3666-enheden — genmåles før 23/8 (spor 1-fund).
- Browser-panen kompositerede ikke frames for hverken spor 4 eller orkestrator → screenshots via Playwright-MCP i stedet (fungerede).
- Spor 9 efterlod untracked V2-udkast i hoved-checkoutet (instruks-brud); backup i scratchpad, merged versioner er kanoniske.
- Spor 5-agenten brød ingen-underagenter-reglen (2 research-agenter), fangede det selv og efter-verificerede alt.
- Rolling ejer-godkendelse pr. PR (i stedet for samlet side til sidst) holdt køen ≤ 2 åbne og fungerede godt — genbrug.

Refs #3645 #3757 #3750 #3514 #3715 #605
