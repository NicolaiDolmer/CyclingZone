# Startprompt 2: DOLMERPC 16/10 aften (parallelt med pc1)

Kopiér alt under linjen ind i en ny Claude Code-session på DOLMERPC (mappe `C:\dev\CyclingZone`).

---

Ny session på DOLMERPC. Kør `git pull --ff-only`, `npm run sync-deps` og derefter `npx playwright install` i `frontend` (den ældre browser blev fjernet). Læs `docs/NOW.md`. **pc1 er hovedsessionen og ejer merge-køen, `docs/NOW.md` og sine åbne PR'er (#6673, #6714, #6720).** Du merger intet og rører ikke de PR-branches. Svar på dansk, stil spørgsmål ét ad gangen med en anbefaling og et billede, og start intet ud over opgaven herunder uden mit ja.

## Opgave (ejer-godkendt 16/10, dag: i dag): #6717 UI-rettelser på dashboard og patch notes

Jeg har valgt løsning A på alle fire. Mockups og valg står på #6717:

1. **Bestyrelsens mål på dashboardet.** Målets navn står øverst og må fylde op til 2 linjer, men skæres aldrig af. Under navnet: status-mærke og procent, derefter bjælken. 2 kolonner, også på telefon.
2. **Divisionsstillingen på dashboardet.** Fjern "↓N" (rankMovement) og "+N" (pointsDelta). De regnes ud fra hele det senest afsluttede løb og kan ikke tolkes. Fjern også `computeDivisionMovement`/`dashboardMovementSignals` og fetch'en af `lastRaceDayPoints`, hvis de bliver død kode.
3. **"I GANG 15/18" under Kommende løb.** Brug spillets status-mærke med 5 px radius, samme anatomi som "Overgået", ikke en rund guld-pille.
4. **Patch notes.**
   - Én segment-række: Alle · Nyt · Forbedret · Rettet.
   - En lille "Kun beta"-kontakt.
   - "Nu for alle" fjernes.
   - Mobil skal have én linje under søgefeltet.

Følg `docs/design/PAGE_TEMPLATES.md` og `docs/design/TASTE.md`: hairlines, 5 px radius, ingen skygger, én guld-knap pr. view, tabulære tal og stroke-ikoner. Brug EN+DA i locales med tone efter `docs/TONE_OF_VOICE.md`. Nye filer skal være `.ts`/`.tsx`. Byg i en worktree: `pwsh -File scripts/new-worktree.ps1 -Branch fix/6717-dashboard-patchnotes-ui`. Kør `npm run lint`, `typecheck` og `node --test` på de berørte filer, `scripts/preflight-pr.ps1`, og `codex review --base origin/main` ÉN gang før `gh pr ready`.

Lav ét annoteret før/efter-billede (desktop 1440 + 375 px, lys) i `pr-screens/6717/` og send det til mig. Merge IKKE. Skriv "klar til merge-køen" på PR'en, når CI er grøn, og giv mig besked; pc1 merger. Patch note samles af pc1 ved close-out. Skriv en kort tekst EN+DA i din slutrapport.

Er der tid tilbage, så spørg mig, om du skal tage fund 4-11 og 13 fra #6728. Start dem ikke uden mit ja.

Afslut med en kommentar på #6717 og `pwsh -File scripts/close-out-cleanup.ps1`.
