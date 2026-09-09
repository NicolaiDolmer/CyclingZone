# Codex-prompter — CyclingZone

> **Sådan bruger du filen.** Tre prompter til copy-paste. **Del A** køres én gang per PC (og igen efter ændringer i hook-opsætningen). **Del B** pastes ved hver session-start. **Del C** pastes oveni når opgaven rører frontend.
>
> Start altid Codex inde fra repoet: `cd C:\Dev\CyclingZone; codex` — ellers auto-genererer den sin egen mappe (se `docs/CROSS_PC_SETUP.md`).
>
> Baggrund: Codex genindført 2026-09-09 ([#5065](https://github.com/NicolaiDolmer/CyclingZone/issues/5065)). Codex auto-loader `AGENTS.md`, men **ikke** `CLAUDE.md` — derfor beder prompterne eksplicit om den.

---

## Del A — Engangs-verifikation (per PC)

```
Du er Codex i CyclingZone-repoet. Dette er en VERIFIKATIONS-session: du skal
ikke bygge noget. Du skal bevise at opsætningen virker, og rapportere hvad der
ikke gør. Ret ingenting uden at spørge først.

TRIN 1 — Placering
Kør: git rev-parse --show-toplevel && git status -sb
Forventet: C:/Dev/CyclingZone på main. Andet end det → STOP og vis mig output.

TRIN 2 — Regel-lagene
Du auto-loader AGENTS.md, men IKKE CLAUDE.md. Læs begge nu.
Bekræft ved at svare på tre spørgsmål med citat:
  a) Hvad siger trin 0 i AGENTS.md' start-sekvens at du skal gøre?
  b) Hvilke tre sideskabeloner findes, og hvad hedder dokumentet?
  c) Hvad er hard rule 18, og hvorfor er `git branch --show-current` IKKE en guard?
Kan du ikke svare fra filerne, har du ikke læst dem — læs igen.

TRIN 3 — Hook-selvtest (den vigtigste)
Aktivér først Git-laget med `pwsh -File scripts/setup-local.ps1` (dependencies,
kanonisk installer og fake-secret-smoketest). Kontrollér core.hooksPath=.githooks.
Det sker automatisk på nye PC'er via setup-new-pc.ps1. Bevisdatoer og begrænsninger
står i docs/GUARD_INVENTORY.md; "installeret" er ikke "bevist".

Dine hooks er konfigureret i .codex/hooks.json. Test at din runner FAKTISK
fyrer dem. T1-T3 skal blokeres af agent-hooks; T4 af Git pre-commit.
Kommandoerne er valgt så de er harmløse hvis en guard mangler.

Før selvtesten: åbn /hooks i interaktiv Codex CLI, review og trust de aktuelle
hook-definitioner. Nye eller ændrede hooks springes over indtil trust; ændringer
i .codex/hooks.json kræver nyt review af trust. Færdiggør derfor konfigurationen først,
trust som sidste opsætningstrin, og kør selvtesten i en FRISK session.
Kræver fejlsøgning en midlertidig dump-hook: trust den særskilt, brug kun harmløse
prøver, slet dumpen straks og fjern hooken før afsluttende trust. Går trust eller
CLI-opstart i stå: STOP; brug aldrig --dangerously-bypass-hook-trust.

Navigér sikkert i /hooks: én tast ad gangen og aflæs resultatet. Kontrollér den
valgte hooks kommando før t/Enter; brug aldrig samlet Escape+paste. Send Escape
enkeltvis, indtil det almindelige promptfelt er SET. Indsæt derefter tekst,
kontrollér at den står i promptfeltet, og send Enter i et separat kald.
"Trusted/aktiv" er ikke bevis for, at scriptet starter eller blokerer korrekt.

  T1  cat .env.findes-ikke
      → skal blokeres af block-dangerous-secret-commands.sh
  T2  git diff
      → skal blokeres af block-blocking-shell-commands.sh (pager-guard).
        Hænger den i stedet, så afbryd: guarden mangler.
  T3  git checkout -b codex-hook-selvtest
      → skal blokeres af block-branch-switch-in-main-checkout.sh.
        Slap den igennem: kør straks `git checkout main` og
        `git branch -D codex-hook-selvtest`, og noter det som FEJL.
  T4  Forsøg et Git-commit med en staged, harmløs arkivændring i en isoleret fixture.
      → skal blokeres af pre-commit: STAGED-DOCS BLOCKED: archive.
      Verificér HEAD uændret og ryd fixture/index op. Brug aldrig --no-verify.

Codex bruger scripts/hooks/run-codex-hook.ps1 til portabel Git Bash-opstart.
Den finder Git-installationen lokalt, tilføjer dens bin/usr/bin til barnets PATH
og videresender payload/exit/output uden policy. Manglende runtime fejler højt.
Edit-hookene er bevaret, men inaktive for observeret apply_patch-input uden
file_path. Arkiv/NOW beskyttes derfor på staged Git-indhold; en edit er mulig,
men må ikke kunne committes i strid med de regler. Ingen patchtekst-adapter.

Kontroltest — denne skal IKKE blokeres:
  K1  git --no-pager status -sb

Rapportér som tabel: test | blokeret ja/nej | hvilken hook der svarede.
Blev ÉN af T1-T4 ikke blokeret: STOP alt andet arbejde og fortæl mig det.
Den forventede beskyttelse er ikke bevist. Undersøg trust, hook-processens PATH
og faktisk payload-format; en script-test alene beviser ikke runner-integrationen.

TRIN 4 — Context-kæden
Vis at du kan finde din kontekst uden at gætte:
  1. Læs docs/NOW.md. Citér "🎯 Next action" og "🤖 Working agent".
  2. Kør: gh issue list --label "claude:todo" --state open --limit 10
  3. Læs .codex.local/SESSION_CONTEXT.md hvis den findes — og fortæl mig
     hvorfor den IKKE er source of truth.
  4. Slå op i docs/META_DOCS_INDEX.md: hvor står reglerne for økonomi?
Rapportér: hvad er den aktive opgave lige nu, og hvor læste du det?

TRIN 5 — Worktree
Hoved-checkoutet er ejerens og Claudes. Du arbejder ALTID i en worktree.
Vis mig kommandoen du ville køre for at lave en til branchen fix/test-1234
(kør den ikke). Forventet form:
  pwsh -File scripts/new-worktree.ps1 -Branch fix/test-1234

TRIN 6 — Rapport
Afslut med en tabel: hvad virker, hvad er brudt, hvad du er usikker på.
Foreslå rettelser — men lav dem ikke uden mit go.
```

---

## Del B — Daglig session-start

```
Du er Codex i CyclingZone. Følg AGENTS.md. Før du rører noget:

1. Læs CLAUDE.md — du auto-loader den ikke, og fire bindende regel-lag står
   kun der (page templates, PR-preflight-tiers, close-out, merge-mekanik).
2. git fetch --prune origin && git status -sb   (behind → git pull --ff-only)
3. Læs docs/NOW.md. Står der en anden aktiv session under "🤖 Working agent"
   → STOP og spørg mig før du tager noget op.
4. Sæt dig selv på: skriv "Codex — <opgave>" i "🤖 Working agent" i NOW.md og
   push den ændring med det samme. Dette er vigtigt: Claude kan IKKE se at du
   kører (#4016), så feltet er den eneste lås mellem jer.
5. Opret din worktree: pwsh -File scripts/new-worktree.ps1 -Branch <branch>
   Arbejd derinde. Commit med:
   bash scripts/guard-commit-branch.sh <branch> <worktree-sti> && git -C <sti> commit ...
6. Én issue per session. Rører opgaven et område med et SSOT-dokument
   (hard rule 30), så læs det FØR du rører kode.

Før push: pwsh -File scripts/preflight-pr.ps1
Rørte du frontend/: også `npm run lint`, `node --test` og build i frontend/.

Ved close-out: nulstil "🤖 Working agent" til "Ingen aktiv session", opdatér
issuet, og kør: pwsh -File scripts/check-agent-token-hygiene.ps1
(den skal ende på 0 fail).

Spørg når du er 70-95% sikker. Gæt ikke.
```

---

## Del C — Før du rører UI

```
Denne opgave rører frontend. Design er IKKE frit — der findes en aftalt
kontrakt, og dele af den håndhæves af CI uanset hvem der skriver koden.

LÆS FØRST (før en linje kode):
  docs/design/PAGE_TEMPLATES.md — de tre kanoniske skabeloner:
    T1 standard content (max-w-4xl) · T2 wide data (cap 1600px)
    T3 profile/detail (hero + tabs, max-w-5xl)
  docs/design/TASTE.md — smagen: forbudsliste + dommer-tjekliste.
Skabelonen er gulvet, TASTE er målet. Opfind ALDRIG dit eget sidehoved,
container-bredde, padding, radius, typografi-trin eller loading/empty/
error-markup. Vælg en af de tre skabeloner og sig hvilken.

BINDENDE: én gold primary-knap pr. view · hairline-borders, ingen skygger ·
5px card-radius · tabular figures på al numerik · stroke-ikoner, aldrig emoji ·
cz-tokens (text-cz-1/2/3, bg-cz-card, border-cz-border) — aldrig slate-*/gray-*.

KØR DISSE FØR PUSH — de kører også i CI og blokerer din PR:
  node scripts/lint-ui-slop.mjs        (rå hex, rounded-xl/2xl/3xl, glow,
                                        backdrop-blur, blob-blur, emoji-som-ikon)
  node scripts/check-anti-slop.mjs     (unicode-pile-som-ikon, text-[Npx] under
                                        12px, shadow-* uden for shadow-overlay,
                                        gradienter)
  node scripts/lint-t2-container-guard.mjs  (DataTable må ikke stå i T1-container)
  npm run lint                          (i frontend/ — cz-tokens + ms-*/me-*)
Alle er ratchets: de må kun skrumpe. Tilføj ALDRIG noget til
scripts/ui-slop-baseline.json for at få en PR igennem — spørg mig i stedet.

DET GUARDSNE IKKE FANGER — og som derfor er mit kald, ikke dit:
  - Valget mellem T1 og T3
  - Om resultatet faktisk ser godt ud
Derfor: en NY spillervendt funktion bygges ALDRIG uden at jeg først har
godkendt en skitse (hard rule 25), og alt brugerrettet vises visuelt for mig
med rigtige screenshots — mobil OG desktop — FØR merge (hard rule 26).
Refactors og bugfixes uden ny adfærd er undtaget.

Er du i tvivl om en skabelon passer: spørg. Byg ikke videre på et gæt.
```

---

## Hvad der beskytter dig — og hvad der ikke gør

| Lag | Håndhævelse | Dækker |
|---|---|---|
| `lint-ui-slop` + `check-anti-slop` | 🔒 CI, agent-agnostisk | rå hex, rounded-xl/2xl/3xl, glow, backdrop-blur, emoji-som-ikon, unicode-pile, mikro-tekst, skygger, gradienter |
| `lint-t2-container-guard` | 🔒 CI | DataTable i forkert container |
| eslint | 🔒 CI (frontend-build) | cz-tokens frem for slate-*/gray-*, logical properties |
| `.codex/hooks.json` | 🔒 lokalt, hvis runneren fyrer | secret-leak, pager-hæng, branch-skift i hoved-checkout, arkiv-edits |
| `codex-hooks-tracked` | 🔒 close-out | at en hook ikke peger på en lokal-only fil |
| Skabelon-VALG, TASTE-tjeklisten | ✍️ prosa | — |
| Design-gate + visuelt bevis (hard rule 25/26) | ✍️ prosa | — |
| Hvem der ejer checkoutet lige nu | ✍️ NOW.md-feltet | — |

**Kort sagt:** en agent kan ikke merge en PR der bryder anti-slop-, container- eller token-reglerne — det gælder Codex lige så meget som Claude. Det der stadig kræver dig, er skabelon-valget, smagsdommen og at to agenter ikke skriver i samme checkout samtidig.
