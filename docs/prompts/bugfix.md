# Bugfix session-prompt

> Genbrugbar template til en Claude Code-session der skal fixe én konkret bug. Designet 2026-05-22 per [#561](https://github.com/NicolaiDolmer/CyclingZone/issues/561) (B7). Komplementerer [`mobile-to-code.md`](mobile-to-code.md) — den dækker hand-off-formatet (5 linjer); denne dækker selve session-flowet når Claude Code modtager opgaven.

## Hvorfor templaten eksisterer

Bugfix-sessioner glider af sporet på 3 forudsigelige måder:

1. **Fix uden at reproducere** — symptomet patches, men rod-årsagen forbliver. Bidt 2026-05-17 (5 CI-fails, postmortem i `2026-05-17-symptom-patching-loop-vs-root-cause.md`).
2. **Fix breder sig til refactor** — én bug bliver til 200 linjer ændringer i 8 filer. Review-byrde stiger, regression-risiko stiger, PR sidder fast.
3. **Fix lukker uden forward-guard** — samme bug rammer igen 3 uger senere fordi der ikke blev skrevet en learning + ingen test fanger det.

Templaten tvinger session-flowet ind i 5 faser hvor hver fase har en eksplicit gate før næste.

## Session-skabelonen

Brug denne som første-message i session (eller udfyld fra `mobile-to-code.md`-briefen):

```
Mål: <bug-symptom i 1 sætning — ikke fix-hypotesen>
Issue: #<nr> (eller "ingen issue endnu — opret som del af session")
Rapporteret af: <bruger/CI/monitoring/postmortem>
Severity: <P0 brækker prod · P1 brækker feature · P2 cosmetic/edge>
```

Efter Claude Code har læst briefen, gennemløb 5 faser:

### Fase 1 — Reproducér FØR du gætter

- Find mindste reproducer (failing test, manuel browser-step, curl-kommando).
- Verificér: bug eksisterer på `main` lige nu (ikke kun "før commit X").
- **Gate:** hvis du ikke kan reproducere → STOP. Bed brugeren om steps. Fix ikke i blinde.

### Fase 2 — Rod-årsag, ikke symptom

- Find linjen hvor forventning og adfærd divergerer. Det er ikke nødvendigvis hvor symptomet vises.
- Skriv én sætning: "Bug'en sker fordi <X>, ikke fordi <Y som det ligner>."
- **Gate:** hvis du har patched 2 forskellige steder og symptomet flytter sig → STOP. Du jagter symptomer. Læs `.claude/learnings/2026-05-17-symptom-patching-loop-vs-root-cause.md`.

### Fase 3 — Minimal fix

- Skriv FØRST fix'et. Ingen refactor, ingen oprydning, ingen "while I'm at it".
- Fix-størrelse: aim for <30 linjer ændret. Større = sandsynligvis scope-creep.
- **Gate:** hvis fix > 50 linjer eller rører > 3 filer → STOP og forklar hvorfor før du fortsætter.

### Fase 4 — Verifikation + backwards-check

- Reproducer fra Fase 1 → nu grøn.
- Naboer: kør relevante tests (`npm run test --workspace=backend`, `npx playwright test core-smoke.spec.js` for frontend/i18n).
- Build clean: `npm run build` hvis frontend/dep-touching.
- **Gate:** hvis nye tests fejler → ikke push før de er grønne. Loop-guard: 2 CI-fails på samme symptom → STOP og spørg brugeren.

### Fase 5 — Forward-guard + close-out

Obligatorisk for non-trivielle bugs (P0/P1, eller bug der overraskede dig):

- **Postmortem:** `.claude/learnings/<dato>-<slug>.md` med Symptom · Root cause · Forward-guard · Related.
- **Test:** ny test der fanger bug'en hvis den vender tilbage (ikke altid muligt for visuelle/UX-bugs, men forsøg).
- **PatchNotesPage.jsx:** opdatér hvis brugerrettet ændring; bump version (max+1 over main's top).
- **NOW.md:** opdatér 🎯 Next action + nulstil 🤖 Working agent.
- **Issue:** kommentér med 🟢 + summary + `Refs #N` (brugeren lukker selv).

## Anti-patterns

- **"Fix" der bare flytter symptomet** — hvis du ikke har en root-cause-sætning fra Fase 2, har du ikke et fix.
- **Bundled fix + refactor** — del op. Refactor får sit eget issue/PR.
- **Skip postmortem fordi "lille bug"** — hvis bug'en overraskede dig, var den ikke lille for fremtidige-dig.
- **Push uden lokal verify** — frontend/i18n-changes kræver `npx playwright test core-smoke.spec.js` (alle 3 projekter ved visuelle ændringer) lokalt FØR push. CI fanger ofte mobile selv om desktop passer.

## Eksempel — udfyldt brief

```
Mål: Sponsor-modal viser duplicate "sponsor.confirm" i DA-bundle.
Issue: #XXX
Rapporteret af: Bruger via mobil-screenshot 2026-05-22 morgen.
Severity: P2 (cosmetic, men forvirrende for nye brugere).
```

Session-flow:
- Fase 1: reproducér ved at åbne sponsor-modal i DA → ja, key shower 2x.
- Fase 2: grep `sponsor.confirm` i `frontend/src/i18n/locales/da/*.json` → 2 entries i `sponsor.json`.
- Fase 3: fjern duplicate i `sponsor.json` (ikke refactor af hele i18n-strukturen).
- Fase 4: `npm run build` clean, Playwright i18n-key-check grøn.
- Fase 5: ingen postmortem (trivielt), PatchNotes opdateret, NOW.md opdateret, kommentar på #XXX med 🟢 + Refs.

## Cross-refs

- Hand-off-format (mobil → PC): [`mobile-to-code.md`](mobile-to-code.md) (B8, [#562](https://github.com/NicolaiDolmer/CyclingZone/issues/562)).
- Investigation-template (når du ikke ved hvor bug'en bor endnu): [`investigation.md`](investigation.md).
- Postmortem-template (Fase 5): [`postmortem.md`](postmortem.md).
- Symptom-patching loop-guard: [`.claude/learnings/2026-05-17-symptom-patching-loop-vs-root-cause.md`](../../.claude/learnings/2026-05-17-symptom-patching-loop-vs-root-cause.md).
- Tracker: [#555](https://github.com/NicolaiDolmer/CyclingZone/issues/555) → [#561](https://github.com/NicolaiDolmer/CyclingZone/issues/561).
