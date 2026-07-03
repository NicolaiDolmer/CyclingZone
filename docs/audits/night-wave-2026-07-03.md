# Natbølge 2026-07-03

| Metrik | Værdi |
|---|---|
| Start/slut (lokal tid) | 00:24 launch → 08:47 close-out (agent-arbejde 00:24–01:15, recovery 08:30–08:45) |
| Agenter launched / fuldført / hang | 21 / 18 i første pass / 3 hang (F2, F9, I4) → alle 3 reddet i recovery |
| PR'er åbnet / merged | 20 / 0 (ejer merger selv) |
| Issues → claude:done | 0 flippet af orkestrator (ejer-only). #2059 lukket af recovery-agent (allerede løst på main, se nedenfor) |
| gh-401-retries (preflight-probe + bølge) | Ikke talt eksakt; preflight-GraphQL-probe grøn på 1. forsøg |
| Recoveries (type) | 3 (F2: fortsæt-uncommitted · F9: frisk-tom · I4: falsk-positiv/allerede-løst) |
| Preflight | GO kl. 00:12 (9 ok / 2 advarsler / 0 NO-GO; `.codex.local/night-wave-preflight.json`) |

## Spor → PR-mapping (21 spor)

### Backend (Opus)
| Spor | Issue(s) | PR | Kort |
|---|---|---|---|
| B1 | #1941 | [#2119](https://github.com/NicolaiDolmer/CyclingZone/pull/2119) | Auktions-grace: merge prod-config oven på DEFAULT_AUCTION_CONFIG |
| B2 | #2029 | [#2121](https://github.com/NicolaiDolmer/CyclingZone/pull/2121) | Loft antal ITT/TTT pr. etapeløb (Grand Tour fik 5) |
| B3 | #1856 | [#2120](https://github.com/NicolaiDolmer/CyclingZone/pull/2120) | Overlap-detektion fanger nu in-flight etapeløb |
| B4 | #2074 | [#2124](https://github.com/NicolaiDolmer/CyclingZone/pull/2124) | Forward-guard mod tabt startfelt (diagnose + guard, ingen prod-reparation) |
| B5 | #1665 | [#2122](https://github.com/NicolaiDolmer/CyclingZone/pull/2122) | errorCode-migrér Gruppe A player-facing api.js-fejl (IKKE Gruppe B admin) |

### Frontend (Opus)
| Spor | Issue(s) | PR | Kort |
|---|---|---|---|
| F1 | #2032 +#109 +#2073 | [#2123](https://github.com/NicolaiDolmer/CyclingZone/pull/2123) | Sæson-drevet U25/U23-alders-gate |
| F2 | #2002 +#58 +#1929 | [#2137](https://github.com/NicolaiDolmer/CyclingZone/pull/2137) | Evne-SSOT + 3 tab-modes + akademi-sektion (recovery) |
| F3 | #2108 +#2060 | [#2130](https://github.com/NicolaiDolmer/CyclingZone/pull/2130) | Patch-notes-prosa ud af JS-bundle → statisk JSON (rørte PatchNotesPage-loader per spec) |
| F4 | #2033 | [#2125](https://github.com/NicolaiDolmer/CyclingZone/pull/2125) | Farveblind: chart-4 amber væk fra chart-8 yellow + ΔE-lås |
| F5 | #2047 | [#2126](https://github.com/NicolaiDolmer/CyclingZone/pull/2126) | Landing-perf: flag-icons ud af boot |
| F6 | #1953 | [#2129](https://github.com/NicolaiDolmer/CyclingZone/pull/2129) | Distinkte ITT/TTT-glyffer |
| F7 | #260 | [#2127](https://github.com/NicolaiDolmer/CyclingZone/pull/2127) | Klikbare holdnavne via TeamLink |
| F8 | #1930 | [#2128](https://github.com/NicolaiDolmer/CyclingZone/pull/2128) | Sortér afsluttede løb nyeste-først |
| F9 | #261 | [#2138](https://github.com/NicolaiDolmer/CyclingZone/pull/2138) | Tal-input ved rytterfiltre (recovery) |
| F10 | #256 | [#2133](https://github.com/NicolaiDolmer/CyclingZone/pull/2133) | Bud-antal + antal hold pr. auktion i historik |
| F11 | #2018 | [#2132](https://github.com/NicolaiDolmer/CyclingZone/pull/2132) | Sentry: filtrér Vercel-toolbar-støj (Lag 1 SDK; Lag 2 dashboard = ejer) |

### Infra (Sonnet)
| Spor | Issue(s) | PR | Kort |
|---|---|---|---|
| I1 | #2017 | [#2131](https://github.com/NicolaiDolmer/CyclingZone/pull/2131) | CodeQL ignorér docs/** (alerts #165/166/167 = ejer dismisser) |
| I2 | #1668 | [#2136](https://github.com/NicolaiDolmer/CyclingZone/pull/2136) | Wire prune-stale-project-dirs i ugentlig worktree-cleanup |
| I3 | #1942 | [#2134](https://github.com/NicolaiDolmer/CyclingZone/pull/2134) | Tilføj orphan FAQ-nøgle relaunchTeamMoney til FAQ_KEYS |
| I4 | #2059 | — (lukket, allerede løst på main) | Snapshot-drift allerede fikset af `79f82c40`; verificeret tom diff → issue lukket |
| I5 | #2070 | [#2135](https://github.com/NicolaiDolmer/CyclingZone/pull/2135) | DA-copy "Du leder" → "Du fører" |

## Afvigelser/læringer

- **S0 Modern Standby frøs fleet'et ~01:15 (rod-årsag til de hængende spor).** Preflight advarede om at maskinen er en S0 Low Power Idle-maskine der kan sove trods `standby-timeout-ac=0`. Fleet'et arbejdede 00:24–01:15, hvorefter ALLE agent-transcripts frøs samtidig — konsistent med at maskinen gik i standby midt i kørslen. `parallel()`-barrieren ventede på 2 uafsluttede agenter (F2, F9) → workflow'et sendte aldrig completion-notifikation → de fremstod "gået i stå". **Forbedring til runbook:** enten (a) en stall-watchdog der genstarter en agent hvis dens transcript-mtime står stille i >N min, (b) chunk fleet'et i flere mindre Workflow-kald så én hængende agent ikke blokerer hele barrieren, eller (c) hard-verificér at maskinen faktisk holdes vågen (S0 kræver mere end powercfg-timeout=0).
- **Recovery-mønster virkede (runbook-tabellen holdt):** F2 havde uncommitted arbejde → fortsat i SAMME worktree (bevarede ~10 min arbejde) → PR #2137. F9 var tom → frisk implementering i worktreet → PR #2138. Begge via separate baggrundsagenter mod deres eksisterende worktree-sti (rørte aldrig main-checkoutet).
- **I4 var et falsk-positivt spor.** #2059 (patch-notes-snapshot-drift) var allerede fikset på main af `79f82c40`. En TIDLIGERE session i samme natbølge nåede samme konklusion i en issue-kommentar men **glemte at lukke issuet** → det så ud som "aldrig åbnet PR". Recovery-agenten verificerede tom diff (core-smoke 27/27, `--update-snapshots` = 0 bytes) og lukkede issuet med bevis. Læring: en session der konkluderer "ingen ændring nødvendig" SKAL lukke/markere issuet, ellers gen-triageres det.
- **Done-flip ikke udført (ejer-only).** Ingen af de 20 PR-issues er flippet til `claude:done` — det gør ejeren pr. merge. Undtagelse: #2059 lukket som verificeret-allerede-løst (matcher audit-close-reglen: fix live på main, ikke en fleet-PR der venter merge).
- **PatchNotesPage urørt af alle agenter** (undtagen F3's loader per spec). Konsolideret patch-note-udkast nedenfor — ejeren indsætter i `PatchNotesPage.jsx` ved merge (PR'erne er ikke merged endnu).
- **Konflikt-serialisering holdt:** clusters kørte som én agent (F1/F2/F3). api.js rørt af B1 (#2119, config-helper) + B5 (#2122, error-strenge) i forskellige regioner — noteret i begge PR-bodies. index.css ejet af F4 (#2125); F5 (#2126) holdt sig til main.jsx/LanguageSwitcher. help.json rørt af I3 (#2134) + F2's #58 (#2137) med forskellige nøgler.

## Ekskluderet (til ejer-review, ikke rørt i bølgen)

Fra bølgeplanen bevidst udeladt: **#519, #1979, #1667, #1812** (allerede shippet → verificér + luk), **#520, #1976, #21, #1799** (rod-årsag ufundet), **#1774** (live-konstant), **#1994, #1996, #1847, #2014, #1928**. Grund: kræver ejer-beslutning, rod-årsags-graving uden klar afgrænsning, eller berører en live-konstant/central flade.

## Konsolideret patch-note-udkast (EN først / DA under)

> Indsæt i `frontend/src/pages/PatchNotesPage.jsx` ved merge. Trim per hvad der faktisk merges. Version sættes af ejer (næste efter v6.49). Kun brugerrettede ændringer er med.

**Transfers & squad**
- EN: The transfers page is reorganized into three clear sections — To act on, Negotiations, and Market. Your academy prospects now have their own section on the team page.
- DA: Transfer-siden er delt op i tre tydelige sektioner: Skal handles, Forhandlinger og Marked. Dine akademi-talenter har nu deres egen sektion på holdsiden.

**Rider filters**
- EN: You can now type exact minimum and maximum values on every rider filter, next to the sliders.
- DA: Du kan nu skrive præcise min- og maks-værdier på hvert rytterfilter ved siden af sliderne.

**Calendar & races**
- EN: Individual and team time trials now have their own calendar glyph, so they no longer look like flat sprint stages. Finished races are sorted newest first.
- DA: Enkeltstart og holdtidskørsel har nu deres egen kalender-glyf, så de ikke længere ligner flade spurter. Afsluttede løb sorteres nyeste først.

**Around the app**
- EN: Team names are clickable links across the app. Auction history shows the number of bids and how many different teams took part in each auction.
- DA: Holdnavne er klikbare links overalt i appen. Auktionshistorikken viser antal bud og hvor mange forskellige hold der deltog i hver auktion.

**Fairness & correctness**
- EN: U25 and U23 eligibility now follows the season instead of today's date. Grand Tours no longer generate an unrealistic number of time trials. Fixed stage races being scheduled on top of races already in progress. Server error messages are now shown in your language.
- DA: U25- og U23-berettigelse følger nu sæsonen i stedet for dagens dato. Grand Tours genererer ikke længere et urealistisk antal tidskørsler. Rettet at etapeløb kunne planlægges oven på løb der allerede var i gang. Fejlbeskeder fra serveren vises nu på dit sprog.

**Accessibility & performance**
- EN: Adjusted two similar chart colors so they are distinguishable for color-blind players. The landing page loads faster.
- DA: Justeret to ens farver i graferne så de kan skelnes af farveblinde. Landingssiden loader hurtigere.

**Danish copy & help**
- EN: (Danish only) The auction leader badge now reads "Du fører". Added a missing help entry about relaunch team money.
- DA: Auktions-badgen viser nu "Du fører" i stedet for "Du leder". Tilføjet en manglende hjælpe-tekst om relaunch-holdpenge.

---

_Refs #605. Orkestrator: Claude Opus 4.8 (natbølge-session 3/7). Ikke-brugerrettede spor (B4 guard, F11 Sentry, I1 CodeQL, I2 worktree-sweep) kræver ingen patch-note._
