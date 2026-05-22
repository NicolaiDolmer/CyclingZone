# Postmortem template

> Genbrugbar skabelon til incident- og bug-postmortems i `.claude/learnings/`. Designet 2026-05-22 per [#561](https://github.com/NicolaiDolmer/CyclingZone/issues/561) (B7), baseret på 20+ eksisterende postmortems i mappen. Fyldes ud ved Fase 5 i [`bugfix.md`](bugfix.md) eller Fase 4 i [`investigation.md`](investigation.md).

## Hvorfor templaten eksisterer

`.claude/learnings/` er projektets vigtigste hukommelse for "dette må ikke ske igen". Effektive postmortems har 3 ting:

1. **Reproducerbar root-cause-sætning** — så fremtidige sessions kan grep efter symptom + se hvad det viste sig at være.
2. **Forward-guard der faktisk virker** — ikke "vær mere forsigtig", men en test, et tjek, en linje i et script, en MEMORY-entry.
3. **Backwards-check** — for hver fundet bug: hvor mange andre steder eksisterer samme problem? Per HOT-memory [feedback_backwards_check_forward_guard.md](../../memory/feedback_backwards_check_forward_guard.md).

De fleste postmortem-skabeloner på nettet glemmer (3), og dem der har den, glemmer at gøre den eksplicit. Denne template tvinger begge.

## Filnavn

```
.claude/learnings/<YYYY-MM-DD>-<kort-slug-med-bindestreger>.md
```

- Datoen er hvornår postmortem skrives, ikke incident-dato (skriv incident-dato i body hvis forskellig).
- Slug skal være søgbar: indeholder enten symptom-keyword eller komponentnavn. Ikke "fix" eller "bug" alene.

## Skabelonen

```markdown
# <YYYY-MM-DD> — <1-linje incident-titel>

## Symptom

<Hvad blev observeret. Konkret. Kopiér evt. error-message eller skærmbillede-beskrivelse. Hvis CI-fejl: hvilken check, hvilken commit.>

## Impact

<Hvem blev påvirket og hvordan. Skip hvis trivielt. Eksempler: "0 brugere ramt, fanget i staging" eller "5 manager-konti fik forkert balance i 3 timer".>

## Root cause

<Hvorfor det skete. Én sætning: "Det skete fordi <X>, ikke fordi <Y som det lignede>." Derefter detaljen: kode-snippet, config-værdi, race-window — det konkrete.>

## Hvorfor det ikke blev fanget

<Optional men anbefalet ved P0/P1. Hvilken test, review-step eller invariant skulle have fanget det? Hvorfor gjorde den ikke? Tit her ligger det interessante.>

## Fix

<Commit-hash + 1-2 sætninger om hvad ændringen gør. Inkludér test-tilføjelser hvis relevant.>

## Forward-guard

<Hvad forhindrer gentagelse. KONKRET — ikke "vær mere opmærksom".
- Ny test: <path:line>
- Hook/script: <path>
- Memory-entry: <link>
- ADR: <path>
- CLAUDE.md/MEMORY.md update: <hvor>
>

## Backwards-check

<Hvor ellers eksisterer samme problem-mønster? Søgte du efter andre forekomster? Liste fundne + handlinger (fix nu, separat issue, accepteret som OK).>

## Læring

<Optional. Den generelle indsigt — bredere end denne ene bug. Hvad bør Claude/brugeren gøre anderledes i fremtidige lignende situationer?>

## Related

<Optional. Links til andre learnings, issues, ADRs, eller eksterne ressourcer der hjælper kontekst.>

## Time cost

<Optional. Estimat af spildt tid på incident + investigation. Hjælper prioritere forward-guard-investeringer.>
```

## Felt-regler

- **Symptom** er observerbart, ikke fortolkende. "Build fejlede med `Module not found: foo`" ikke "build var brækket".
- **Root cause** har præcis én "Det skete fordi <X>"-sætning. Hvis du har 3, har du fundet 3 root causes (split filen, eller skriv det eksplicit).
- **Forward-guard** med "vær opmærksom" / "husk på" / "i fremtiden bør vi" → ikke en forward-guard. Tving dig selv til at navngive den konkrete artefakt.
- **Backwards-check** må gerne være "søgte efter `<pattern>`, ingen andre forekomster" — det vigtige er at *du søgte*.
- Manglende sektioner: skip eller skriv "n/a". Padding-prosa er værre end ærlig udeladelse.

## Eksempel — minimum-postmortem

```markdown
# 2026-05-22 — Sponsor-modal duplicate i18n-key

## Symptom

DA-bundle viste "sponsor.confirm" to gange i sponsor-godkendelse-modal — én gang som button-tekst, én gang som heading.

## Root cause

`frontend/src/i18n/locales/da/sponsor.json` havde to entries med samme key efter merge i commit `abc123` (manuel konflikt-løsning beholdt begge varianter).

## Fix

Commit `def456`: fjernet duplicate entry. Beholdt den nyere variant (var feature-mæssigt korrekt).

## Forward-guard

i18n-key-uniqueness check eksisterer i `scripts/check-i18n-keys.sh` men checked kun key-paritet mellem da/en, ikke uniqueness inden for samme fil. Tilføjet duplicate-detection: `scripts/check-i18n-keys.sh` linje 42-58.

## Backwards-check

Søgte alle `frontend/src/i18n/locales/{da,en}/*.json` for duplicate keys: 0 andre forekomster.

## Time cost

~15 min (5 min investigation + 10 min fix + test).
```

## Eksempel — incident-postmortem med læring

Se [`.claude/learnings/2026-05-22-now-md-aktiv-styring-archive-regression.md`](../../.claude/learnings/2026-05-22-now-md-aktiv-styring-archive-regression.md) for et fyldigt eksempel med alle sektioner brugt — inkl. "Hvorfor det ikke blev fanget", "Backwards-check" og "Læring".

## Anti-patterns

- **Postmortem som blame-doc** — fokusér på system, ikke person. "Reviewen missede dette" ikke "X gjorde fejl".
- **Forward-guard = process-instruktion** — "vi skal være bedre til at teste i18n" er ikke en guard. En script-linje der fejler builden ER en guard.
- **Skip backwards-check fordi "det er åbenlyst kun ét sted"** — det er den vigtigste sektion. Læringen er ofte at det ikke kun var ét sted.
- **Postmortem skrevet uger efter** — skriv den i Fase 5 af bugfix-sessionen. Erindring decayer hurtigt, og forward-guarden lander aldrig hvis det ikke gøres samme dag.

## Cross-refs

- Bugfix-template (Fase 5 deliverable): [`bugfix.md`](bugfix.md).
- Investigation-template (Fase 4 deliverable): [`investigation.md`](investigation.md).
- Backwards-check + forward-guard memory-rule: [`feedback_backwards_check_forward_guard.md`](../../memory/feedback_backwards_check_forward_guard.md) (HOT-tier).
- CLAUDE.md close-out trin 5: "Postmortem: ved bugfix → `.claude/learnings/<dato>-<slug>.md`".
- Tracker: [#555](https://github.com/NicolaiDolmer/CyclingZone/issues/555) → [#561](https://github.com/NicolaiDolmer/CyclingZone/issues/561).
