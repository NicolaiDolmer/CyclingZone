# Session-prompt (14/8, samme dag): triage, patch notes-hul og træningen i mål

**Model:** Opus 5 i hovedtråden · **Indsats:** high · **Form:** workflow-session med parallelle spor
**Subagenter:** Sonnet til mekaniske spor, Opus til trænings-sporet (design-tro implementering)

---

## Prompt (kopiér ind som første besked)

> Vi kører en workflow-session. Læs `docs/NOW.md` og `docs/MASTERPLAN.md` først, og `docs/NIGHT_WAVE_RUNBOOK.md` før du spawner noget.
>
> **Del 1 kører først og skal være færdig før del 2 launches.** Det er triage, og det afgør hvad del 2 skal indeholde.
>
> **Del 2 er det egentlige arbejde:** før vores planer ud i livet, med fokus på hvad der betyder mest for spillerne. Design gerne sammen med mig undervejs.
>
> Vis mig ting visuelt frem for at beskrive dem. Stil ét spørgsmål ad gangen, altid med din anbefaling først. Vær kritisk over for dit eget arbejde og verificér før du påstår noget. Spørg hvis du er i tvivl.

---

## Del 1 · Triage (sekventielt, før launch)

1. **Åbne PR'er.** Gennemgå alle. Hvad kan merges nu, hvad mangler en beslutning fra mig, hvad er superseded? Husk done-flip pr. merged issue (runbook trin 5b) — den blev glemt to gange 14/8.
2. **Nye issues sidste 24 timer.** Hvert issue skal placeres: `docs/NOW.md`, `docs/MASTERPLAN.md`, masterplan-artifact, eller bevidst ingen af delene. Sig hvorfor. Ompriorriter ikke MASTERPLAN uden at spørge.
3. **Supabase-logs.** Tjek for fejl. Skil ægte fejl fra støj, og sig hvilke der rammer spillere.
4. **Sikkerhedsadvarsel i GitHub.** `brace-expansion` high i frontendens dev-træ (noteret 14/8). Verificér om den er reachable i produktion eller kun i dev-afhængigheder, og anbefal.
5. **Patch notes-hul, sidste 7 dage.** Grundigt, i to spor:
   - **Hjemmesiden:** er alt spillervendt der er merget de sidste 7 dage dækket i `frontend/src/data/patchNotes.js`? Kryds merged PR'er mod entries.
   - **Discord:** læs patch notes-tråden og find hvad der er postet kontra hvad der findes in-app.
   - Alt nyt skrives i **det låste format** (`docs/TONE_OF_VOICE.md` §Patch notes, låst 14/8): `What changed` / `Why` (valgfri) / `What it means for you`, højst ét tal, EN først og DA under, ingen em-dash.
   - **Levér Discord-teksterne som copy-paste-klare blokke.** Discord = titel plus `What changed`, ordret fra samme kilde. Nemt for mig at poste, nemt for spillerne at læse.

## Del 2 · Arbejdet (workflow, parallelle spor)

**Vigtigst: [#3709](https://github.com/NicolaiDolmer/CyclingZone/issues/3709) trin 1 — træningen skal i mål.**
Kvitteringen på træningsfladen: `nu → tag` som par, hvad rytteren fik i sæsonen med fremdriftsbar, og slet `focusOptionCapped` / `focusCappedTitle` / `focusPartiallyCappedTitle`. Dækker `/training` OG rytterprofilens Træning-fane. Lukker #3649, #3651, #3639. Ingen motor-ændring, shipbar før 23/8.
Spec er SSOT: `docs/superpowers/specs/2026-08-14-3659-rytterudvikling-og-traening-design.md`. Helperen `focusTrainabilityNotice` fra PR #3701 (draft) genbruges.
**Vis mig UI'et før du bygger det færdigt.**

Derudover: vælg spor ud fra del 1's triage. Prioritér det der er i stykker for spillerne over det der er nyt.

## Rammer

- 23/8-cutoveren er dato-bundet og viger ikke. Trin 2 til 5 af #3709 ligger efter cutover.
- Agent-regler: `git checkout -b <branch> origin/main` som første skridt · arbejd sekventielt, ingen under-agenter · gh-kald gennem `scripts/lib/gh-retry.sh` · PR-body med `## Brugerverifikation` og mindst ét `[x]` · kun ÉN fuld e2e-suite ad gangen.
- `patchNotes.js` koordineres centralt — parallelle spor må ikke røre den hver især.
- Intet merges uden mit go. Migrationer applies først efter merge.
- Tvivl om HVORDAN en opgave løses: stop sporet og spørg. Hellere færre rigtige end flere gættede.

## Åbent fra 14/8

- **[#3713](https://github.com/NicolaiDolmer/CyclingZone/pull/3713)** patch notes-format + v7.123. Klar til merge; akademi-notens formulering er rettet, så den ikke lover en reparation der ikke er sizet.
- **[#3715](https://github.com/NicolaiDolmer/CyclingZone/issues/3715)** akademi-reparationen. Målingen, de to brugbare backup-tabeller og ejer-gaten står i issuet. Ikke akut: de ramte kontrakter udløber tidligst ved udgangen af sæson 3, som starter 24/8.
- Uposteet backlog i gammelt format: `docs/discord/2026-08-12-patch-notes-catchup.md` og `2026-08-13-patch-notes-7118-7120.md`.
