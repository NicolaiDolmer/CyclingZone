# Design-kvalitets-audit — 2026-06-20

> Kørt som del af natbølgen 19→20/6 (5 parallelle flade-scannere + synthesis, kode-baseret). Trigger: ejer-direktiv "tjek hele hjemmesiden for AI-slop".

## Omfangsdom

**AI-slop er et LILLE problem — koncentreret, ikke udbredt.** ~35 player-facing flader auditeret; ~28 er rene. Design-systemet (`--radius-sm`=5px/`rounded-cz`, `shadow-overlay`, 50-ikon SVG-set i `ui/icons/`, `cz-*`-farvekanaler, Bebas via `font-display`) er sundt og bredt adopteret. Problemerne er **afvigelser fra et godt system**, ikke fravær af et. Plan-4-migrationen (#671) har gjort sit arbejde.

Det gennemgående mønster er ikke "slop" men **token-drift**: hardcoded Tailwind-farve (`text-red-400`, `bg-blue-300`, hex-gradienter) hvor en `cz-*`-token fandtes — bryder dark-mode. Plus enkelte glow-shadows og glyph-som-ikon.

## Fixet i nat (autonomt — sikre, ikke smags-følsomme)

PR #1548 (design-token-drift) + PR #1549 (#1421 dead-click + separatorer):
- FounderSupporterPage: 4 glow-shadows fjernet, 3 non-modal `rounded-2xl`→`rounded-cz`, `✓`/`✗`-glyfer + `text-emerald-500` → `CheckIcon`/`XIcon` + `cz-success`/`cz-danger`.
- BoardPage / HeadToHeadPage / RiderComparePage: `shadow-2xl`→`shadow-overlay` (theme-aware).
- TrainingPage: injury-badge `bg-red-500/10 text-red-400` → `cz-danger`-tokens.
- HeadToHeadPage: `bg-blue-300`→`bg-cz-info`. HelpPage: ét `❓`→`InfoIcon`. SetupWizardModal: `<div>CZ</div>`→`<Monogram/>`.
- StandingsPage + SeasonEndPage: inline hex-gradient-separatorer → `border-t border-cz-danger/30` tokens.
- Dead-click (#1421): løn-tal + sæson-label fik forklarende tooltips; dashboard-sæson-banner blev et ærligt link til løbskalenderen.
- `ui-slop-baseline.json` strammet (57→56 filer, hex 8→6).

## Smags-følsomme — DINE beslutninger (ikke rørt)

Disse er æstetiske valg, ikke fejl. Jeg ventede bevidst på dig.

| # | Tema | Spørgsmål | Min anbefaling |
|---|------|-----------|----------------|
| A | **Emoji som nav-ikon** | HelpPage (13 sektion-emoji 🚀⚡👤🏆🎽) + RoadmapPage (5 ENGINES-emoji) + SeasonEndPage WinnerCard (💰💸🔄🚴) bruger emoji som funktionelle ikoner. SVG-pendanter findes til alle (RocketIcon, LightningIcon, UserIcon, TrophyIcon, JerseyIcon, MountainIcon…). | **Skift til SVG** — mere editorial, mindre AI-slop-signal. NB: HelpPage's emoji mangler `aria-hidden` → læses op af skærmlæsere (a11y-argument uafhængigt af smag). RoadmapPage/SeasonEnd har korrekt `aria-hidden`, så dér er det rent æstetisk. |
| B | **Modal-afrunding** | BoardPage-dialoger + SetupWizardModal bruger `rounded-2xl` (12px+). Resten af systemet er `rounded-cz` (5px). | Afgør om modaler er en bevidst undtagelse (større radius OK) eller skal følge 5px. Lav beslutningen ÉN gang, så gælder den alle modaler. |
| C | **Loan-status-farve** | TransfersPage bruger `text-violet-700` for `window_pending`-lån (uden for token-systemet, men konsekvent inden for siden). | Enten: gør violet til en officiel sekundær "fremtid/venter"-accent (tilføj `cz-pending`-token), eller genbrug `cz-warning`/`cz-info`. |

## Allerede rent (det der virker — bevar det)

- **Hele kerne-spil-loopet** (Dashboard, Riders, Auctions, Transfers, Team): konsekvente `cz-*`-tokens, ægte cykel-data, ingen emoji-funktioner. Sticky-column-skygger er en korrekt, gennemført teknik (ikke glow).
- **Race/resultat-familien** + **rytter-fokus-siderne**: høj kvalitet; sparklines/styrke-barer er funktionelle, ikke dekorative.
- **Meta/økonomi** (Finance, Notifications, Profile) + **marketing/auth** (Landing, Login, Onboarding): følger systemet. LandingPage bruger allerede `CheckIcon` i stedet for emoji — referencen at kopiere.

## Forward-guard

`scripts/lint-ui-slop.mjs` (CI-gate `ui-anti-drift`) fanger NYE slop-tells (emoji-som-ikon, rounded-2xl/3xl, glow `shadow-[0_0...]`, backdrop-blur, rå hex) over `ui-slop-baseline.json`-ratchet'en. Baselinen må kun skrumpe. Det gør oprydningen permanent — drift kan ikke snige sig ind igen.
