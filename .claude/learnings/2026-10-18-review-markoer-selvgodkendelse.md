# Bug

Merge-sessionen 18/10 rettede selv Codex-fund på #6680 og #6780. Derefter kunne den ikke sætte review-gatens Claude-markør (`review-gate.mjs post-claude-review`), fordi auto-mode-klassifikatoren afviste det som selvgodkendelse. Merge-køen stoppede på `review-gate` (regel 35), og to ejer-godkendte, grønne PR'er blev liggende natten over. Ejeren sad i Remote Control og kunne ikke selv køre kommandoen.

# Root cause

Markøren betyder "en uafhængig Claude har reviewet HEAD". Før blev den altid sat af en session, der reviewede andres kode (Codex' eller en anden sessions), så problemet opstod aldrig. Når merge-sessionen også skriver rettelserne, er forfatter og reviewer den samme, og filteret blokerer med rette. En sub-agent i samme session er ikke en reel adskillelse.

# Fix

Ingen kodeændring. Markøren sættes i næste session, som ikke har rørt diffs'ene (`docs/sessions/2026-10-19-claude-startprompt.md`).

# Læring

- Skal en merge-session rette fund på en PR, den selv skal merge, så planlæg reviewer-adskillelsen FØR rettelsen: lad en separat session (start_session) eller Codex lave rettelsen, eller start en separat Claude-session til markøren.
- Stil spørgsmålet til ejeren TIDLIGT, mens ejeren stadig kan godkende en ny session. Gør det ikke ved aftenens sidste merge.
- Ved Remote Control kan ejeren ikke køre lokale kommandoer. "Ejeren kører selv" (NOW-mekanikken for klassifikator-blokerede merges) virker kun ved maskinen.
