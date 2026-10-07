# Prompt: Codex-session 7/10 eftermiddag - genreview Tailwind + stabilitetssporet

Kopiér alt under stregen ind i en NY Codex-session fra `C:\Dev\CyclingZone`. Claude Code kører samtidig en bølge (#5162 #5864 #6298 #6304) og ejer merge-køen.

---

Codex-session 7/10 eftermiddag i C:\Dev\CyclingZone. Følg AGENTS.md og `docs/CODEX_WORKFLOWS.md`. Svar på dansk i almindeligt sprog. Gældende prioritering: "Ro på spillet" til sæsonskiftet 25/10 (`docs/MASTERPLAN.md`): brand først, kvalitet foran nyt. Rør ikke løbsmotoren (`backend/lib/engine/v4`, `raceEngineV4Bridge.js`, `raceRunner.js`), `docs/NOW.md`, `docs/MASTERPLAN.md` eller spillertekst. Ingen prod-skrivninger, ingen merges: hver opgave bliver én PR, Claude merger. Commit bag `scripts/guard-commit-branch.sh`. Højst ÉN plads i `scripts/verify-lock.ps1` ad gangen (Claudes bølge har førsteret). Pengetal aldrig i GitHub. Meld `KLAR TIL MERGE-KØ <sha>` som PR-kommentar når CI er grøn på nyeste commit og du selv har lavet et uafhængigt read-only review af diffen.

**Læs først:** dine egne kommentarer fra i formiddags på #6289, #6271 og #6300, og Claudes seneste kommentar på #6289.

## 1. Genreview af Tailwind 4 (PR #6289), når Claude melder klar
Claude retter dit P2-fund generelt: `space-x`/`space-y` skrives i `frontend/vite-plugins/tailwind-v3-compat.ts` tilbage til v3's selektor og margin-side (`restoreV3Space`), så hele appen opfører sig som før, ikke kun de to kaldsteder. Når Claude har skrevet `KLAR TIL GENREVIEW <sha>` på PR'en:
- Genmål handelsfanen (`/transfers?tab=trades`) og adminens fritekstfane med din metode fra i formiddags: forventet 16 px igen på 1280 og 390.
- Kør din selektorsammenligning igen mod main: alle `space-*`-selektorer skal være v3-formen; `divide-*` er bevidst v4 (forumkanten). Find tilfælde hvor rewriten kan ramme forkert (fx `space-*` under en variant som `group-*`/`peer-*` eller i `@supports`).
- Lever `CODEX-REVIEW <sha>: KLAR` eller `IKKE KLAR` + fund-tabel som før.

## 2. Stabilitetssporet (brand, din ejerskab), i denne rækkefølge
1. **#5692 rangliste uden låse** skal være klar før sæsonskiftet 25/10. Læs issuets seneste kommentarer og din åbne PR-status; færdiggør resten (sæsonskiftets refresh) med før/efter-tal fra staging.
2. **#5904 lasttest af en hel løbsdag** (draft PR #6170): gør staging-forudsætningerne fail-closed færdige, så lasttesten kan køre før 25/10.
3. **#6102 watchdog med SQL-summer** (draft PR #6136): færdiggør med før/efter fra staging.
4. **Din PR #6282** har mergekonflikt i `.github/workflows/ci.yml` og Claudes review-fund fra 6/10. Synk med main (merge, ikke rebase), ret fundene, meld klar.

## 3. Når #6289 er merget: vagterne #6290
Byg-vagt: den byggede CSS skal have 0 `@layer`, 0 fuldt dækkende `var()`-fallbacks og kun v3-formede `space-*`-selektorer (så pluginet ikke stille bliver et no-op ved et Tailwind-bump). `tokens.test.js` skal bevise at `:root --radius-sm: 5px` kommer efter `@theme`'s værdi i den byggede CSS. Ret kommentarerne i `scripts/check-anti-slop.mjs:23` og `scripts/lint-ui-slop.mjs:32`. Afgræns `flattenLayers`-kommentaren til den tilladte inputform (dit fund om id/`!important`).

## Afslutning
Kommentér status på hvert berørt issue. Sidste linje i chatten: liste med PR-nummer, head-sha, klar/ikke klar.
