# Stale-close eksekvering — spand A og B fra audit 4/9

> Eksekverer `docs/audits/stale-issues-audit-2026-09-04.md` (spand A + spand B). Verifikation gentaget uafhaengigt (merged PR'er, kode-grep, git-tree mod `origin/main`) foer nogen aendring. Ingen migrationer, ingen prod-writes — kun GitHub issue-state.

## Spand A — leveret/foraeldet (6 stk.)

Alle 6 issues fra audittens spand A var allerede lukket `completed` **inden denne session startede** (closedAt `2026-09-04T08:43Z`, med en "Audit 4/9 (ejer-go)"-evidenskommentar der matcher audittens evidenskolonne). Sandsynlig forklaring: ejeren (eller en tidligere session under ejerens `gh`-login) eksekverede lukningerne allerede 4/9 aften, men label-overgangen (`claude:todo` → `claude:done`) blev ikke gennemfoert dengang.

Denne session genverificerede alle 6 uafhaengigt (frisk grep/PR-opslag, ikke bare tillid til den eksisterende kommentar) og fandt evidensen fortsat holdbar for alle 6 — ingen regressioner siden 4/9. Eneste handling denne session: rettede den manglende label-overgang.

| # | Titel (kort) | Status foer denne session | Genverifikation | Handling denne session |
|---|---|---|---|---|
| [#1276](https://github.com/NicolaiDolmer/CyclingZone/issues/1276) | PCM-dump-xlsx laa synligt i public repo | Lukket completed 4/9 | Filen findes fortsat ikke i `origin/main`-treet; PR #1986 merged, indeholder fjernelsen | Label: `claude:todo`→`claude:done` |
| [#2041](https://github.com/NicolaiDolmer/CyclingZone/issues/2041) | Returning users stadig ~0 efter #1797 | Lukket completed 4/9 | PR #3244 og #3829 begge `MERGED`, begge citerer #2041/#3189 direkte | Label: `claude:todo`→`claude:done` |
| [#2164](https://github.com/NicolaiDolmer/CyclingZone/issues/2164) | Aktivér nedrykning Div3→Div4 (ingen nedrykning fra div 4) | Lukket completed 4/9 | `backend/lib/economyEngine.js:2489` har `if (division < MAX_DIVISION)`-gate + kommentar der citerer #2164 direkte | Label: `claude:todo`→`claude:done` |
| [#2416](https://github.com/NicolaiDolmer/CyclingZone/issues/2416) | Udbrud v2: jagt-interesse-model | Lukket completed 4/9 | `backend/lib/engine/v4/mechanics/breakaway.ts` findes i `origin/main`-treet; PR #4085 `MERGED` 21/8 | Label: `claude:todo`→`claude:done` |
| [#2478](https://github.com/NicolaiDolmer/CyclingZone/issues/2478) | Race-motor: adaptiv AI-holdtaktik | Lukket completed 4/9 | `backend/lib/engine/v4/ai/aiTactics.ts` findes i `origin/main`-treet; PR #4088 `MERGED` 21/8 | Label: `claude:todo`→`claude:done` |
| [#1837](https://github.com/NicolaiDolmer/CyclingZone/issues/1837) | Autobud/proxy-bud fra rytterprofil | Lukket completed 4/9 | `frontend/src/pages/RiderStatsPage.jsx` har komplet autobud-loft-UI (tilfoej/rediger/fjern) koblet til `auction_proxy_bids` (linje 577, 1230, 1274) | Label: `claude:todo`→`claude:done` |

**Ingen nye lukninger, ingen nye kommentarer** — kun de 6 label-overgange (verificeret efterfoelgende: alle 6 viser nu `claude:done`, `claude:todo` fjernet).

## Spand B — dubletter: BLOKERET, ikke eksekveret

Opgavebeskrivelsen for denne session angav "spand B (dubletter, 18 par)". Faktisk indhold af `docs/audits/stale-issues-audit-2026-09-04.md` §"Spand B — Dubletter" siger:

> **0 fundet.** ... ingen klare dubletpar dukkede op.

Verificeret direkte i filen (linje 26-28) og i filens git-historik (kun ét commit har nogensinde skrevet denne fil, indholdet har altid vaeret "0 fundet" — ingen tidligere version med 18 par). Der findes intet "18 par"-datasaet i repoet under `docs/audits/` der matcher beskrivelsen.

**Ingen issues lukket som dubletter i denne session** — der er intet i den navngivne fil at eksekvere.

Til orientering (IKKE eksekveret, kraever ejer-beslutning om scope): en anden, separat audit (`docs/audits/github-cleanup-candidates-2026-09-03.md`, §5) fandt via automatisk titel-lighed-scan **1 reelt dublet-par**: #3984 og #4071 (samme Discord-feedback, samme punkt genindtastet 2 dage senere). Denne session har ikke rørt det par, fordi mandatet eksplicit var scopet til `stale-issues-audit-2026-09-04.md`, som ikke indeholder det.

## Tal

- Lukket completed (denne session): **0** (alle 6 var allerede lukket forinden)
- Label-fix paa allerede-lukkede issues (denne session): **6**
- Lukket som dublet (denne session): **0**
- Ikke roert, hvorfor: Spand B — "18 par" i opgaven matcher ikke revisionens faktiske "0 fundet"; ingen datagrundlag at eksekvere paa.

## Won't-do-kandidater til ejeren

Ingen nye won't-do-kandidater identificeret i denne session ud over det allerede noterede dublet-par ovenfor (#3984/#4071), som kraever et ejer-valg om hvilket issue der er kanonisk foer det evt. lukkes som dublet.

## Blocker til orkestrator

"18 par" duplikater nævnt i opgavebeskrivelsen findes ikke i `stale-issues-audit-2026-09-04.md` (som eksplicit siger 0 fundet) eller andetsteds i `docs/audits/`. Beslut venligst om (a) tallet var en fejlantagelse og spand B reelt er tom, eller (b) der findes et andet, endnu ikke lokaliseret datasaet — og om #3984/#4071-parret fra den separate audit skal tages med i en fremtidig spand-B-kørsel.
