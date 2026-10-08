# Prompt: Claude-session 7/10 morgen

Model: **Claude Opus 5.5** i Claude Code, indsats høj. Kopiér alt under stregen ind i en ny session fra `C:\Dev\CyclingZone`.

---

Ny session 7/10. Svar på dansk i almindeligt sprog uden fagjargon. Status ved hver milepæl er **3 linjer**: hvad er færdigt, hvad venter, hvad skal ejeren gøre. Beslutninger som popup, én ad gangen, med anbefaling og nøgletal i selve spørgsmålet. **Ingen natpakker eller tidsstyrede jobs: arbejd i sessionen, til ejeren siger stop.** Kald `gh`/`git` bart. Én merge-kø ad gangen (`scripts/merge-queue.ps1`). **Klassifikatoren blokerer Claude i at merge PR'er der deployer frontend og i at indsætte nøgler:** giv ejeren kommandoen som Run-blok med det samme (`pwsh -NoProfile -File C:/Dev/CyclingZone/scripts/merge-queue.ps1 -Pr "N"`). Alt uhåndteret oprettes som GitHub-issue med det samme (offentligt repo: aldrig omsætningstal i GitHub). Spids er kl. 11-14 og 19-22.

**Læs først:** `docs/NOW.md` (🎯 Next action 7/10), `.claude/learnings/2026-10-06-aften-posthog-pro-tailwind-audit.md`.

## 1. Tailwind 4: review og merge før kl. 11 (PR #6289, issue #6271)
Bølgen blev færdig i nat. CI 57/57 grøn på `da2baef`. Lokalt: 4.419 unit-tests, fuld e2e i alle 3 projekter, pixel-sammenligning af 43 sider × 3 varianter. Eneste synlige forskel: forumtrådens kant på første ulæste svar bliver guld (som #3451 er designet), før fejlagtigt grå.
- Tjek **de 9 åbne punkter** i Claudes audit-kommentar på PR #6289 af mod den endelige diff (bl.a. SeasonMatrix `outline-solid` ×3, globale regler uden for `@layer`, `BoardCard.structure.test.js`, den tavse `--radius-sm: 5px`-match i `tokens.test.js`, `eslint.config.js`-henvisninger, `mobileNavOffset`, `space-y`/`divide-y`-stikprøver, `AuctionsPage.jsx:1941`-kommentaren, bundle). Afgør hvert punkt med bevis (fil:linje).
- Kig på det nye `frontend/vite-plugins/tailwind-v3-compat.ts` (skriver farver/lag tilbage til v3-form for browsere under Chrome 111/99): korrekt, testet, ingen skjult risiko?
- Åbn Vercel-preview'et for PR'en i den indbyggede browser: dashboard, rytterdatabase, træning, løbsside, planlægning (sæsonmatrix med kladde-celler), forum, på desktop og mobil 390 px (ejeren bruger Android).
- Ét samlet før/efter-billede (`pr-screens/6271/before-after-6271.png` findes; suppler med preview-skærmbilleder) via SendUserFile i samme tur som merge-spørgsmålet. Nævn: ikoner står skævt under Chrome 104 (én spiller på Chrome Mobile 95), ingen rigtig Chrome 109 testet.
- Ved ejer-go: ejeren kører merge-køen. Efter deploy: verificér prod-siderne, Sentry og Deploy verify (husk #6293: source-map-guarden kan blive falsk rød, hvis den kører før Vercel er READY; genkør efter READY). Luk Dependabot #63, markér #6271 done. Derefter **patch note samlet** (Pro-rettelser #6287, PostHog-privatlivstekst #6280, evt. forum-kanten) + Discord-tekst KUN på EN i rå kodeblok til ejeren. Så vagterne #6290.

## 2. Dag 2-lækagen (#6291) + kilde-registreringen (#6292), ejer-go 6/10
Sideløbende med punkt 1 (read-only analyse først):
- #6291: D2 faldt fra ca. 46 % (jul.-aug.) til ca. 15 % (sept.). Find årsagen: hvad blev ændret i første session/onboarding omkring 31/8 (git-log, patch notes), og hvad var sidste handling på dag 1 for dem, der ikke kom tilbage (Postgres; PostHog har data fra 6/10 kl. 21). Tjek også om `last_seen` er et målebrud. Kom med årsag + forslag med succeskriterium (D2 ≥ 35 % i to ugekohorter ≥ 8 signups) og stopregel.
- #6292: 28 % af nye signups har `cyclingzone.org` som kilde. Find hvor kilden tabes (marketing-site → app, #5310?), ret med test.
- PostHog-dashboard "Kerne-rejsen" (#4321): funnel signup → team_created → first_bid → first_race_with_own_squad → first_training + retention D1/D7 på `$pageview`. Byg kun på events der er set (`read-data-schema`/SQL), ikke gættet.

## 3. Resten af dagen (i rækkefølge, spørg ejeren ved tvivl)
- **#5864** rod-årsag: sæsonskiftets kontraktudløb skal også tage U23/junior/akademi med (test), før 25/10. De 77 brugte ryttere frigives ved skiftet. PR #6198 (scriptet, nu med `--only-unused`) reviewes og merges.
- **#6282** (Codex): mine review-fund er ikke rettet; Codex har den som næste opgave. Merge kun når Codex melder KLAR på ny SHA og fundene er rettet.
- **#6248** (træning maks +1): ejeren vælger den langsigtede model i dag. Lav A/B-grundlaget.
- Codex-kø: #6226 → #6230 → #6172.

## Close-out
NOW.md (Next action + Working agent nulstillet), token-hygiejne, `close-out-cleanup.ps1` (først dry-run; kør `-Execute` når ingen bølge kører), status board, learnings ved bugfix.
