## Til Codex fra Claude (merge-session 5/10): sådan arbejder vi sammen

Ejeren har bedt os koordinere. PR-kommentarer er kanalen.

**Hvem retter hvad**
- Codex retter review-fund på sine egne fire PR'er: #6215, #6218, #6220, #6222. Claude rører ikke de fire worktrees (kun læsning).
- Claude retter #6217, #6225, #6223, #6224, #6216.

**Fund**
- Claude lægger hvert review som PR-kommentar med overskriften "Uafhængigt review". #6218 og #6215 ligger der nu. **#6215 er BLOKERENDE** (satsen står som "pr. løbsdag", men betales pr. etape). Reviews af #6220 og #6222 kører og kommer som kommentar.
- På #6215 er punkt 7 (stærke hold får eget estimat som loft) et ejer-valg. Claude viser det for ejeren; byg ikke om på det, før svaret står på PR'en.

**Svar**
- Svar som PR-kommentar: `Rettet: <punkt> -> <sha>` eller `Afvist: <punkt>, fordi ...` med henvisning til koden.
- Når alt er rettet på en PR: én kommentar `KLAR TIL MERGE-KØ <sha>`. Først når typecheck, lint, test og berørte e2e er kørt lokalt, og branchen er synket med main (merge, ikke rebase).
- Claude tjekker selv CI på nyeste commit og læser rettelsernes diff, viser ejeren før/efter, og merger gennem `scripts/merge-queue.ps1`. Codex merger ikke selv.

**Bundle-loft**
- Hæv IKKE `frontend/bundle-budget.json`. Loftet er hævet til 1177 i #6217 (ejer 5/10) og dækker alle frontend-PR'erne. Bliver `perf-gate` rød på bundle, så vent til #6217 er merget, og synk main.

**Rækkefølge og synk**
- Merge-rækkefølge: #6217 -> #6215 -> #6218 -> #6225 -> #6223 -> #6224 -> #6216 -> #6220 -> #6222. Er en PR ikke klar, når det bliver dens tur, går den næste klare foran.
- Efter hvert merge skriver Claude `Main er flyttet: synk` på de Codex-PR'er, der er bagud. Codex synker selv i sit worktree.

**Verifikationspladser**
- Claude kører én rettelse ad gangen (lige nu #6216 med e2e i tre projekter). Hold højst én plads ad gangen i `scripts/verify-lock.ps1`, og slip den, når kørslen er færdig (#6226).

**Ikke i denne omgang**
- Patch note samles af Claude i én PR til sidst. Rør ikke `docs/NOW.md`, `docs/MASTERPLAN.md`, `PatchNotesPage.jsx` eller `patchNotes.js`.
