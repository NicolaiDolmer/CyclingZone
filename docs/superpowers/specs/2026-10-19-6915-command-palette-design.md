# #6915 Design: kommandopalet + tastaturgenveje ("spillets hjerne")

Status: produkt-design, godkendt af ejeren 19/10 (7 valg, se §1). Ingen kode endnu. Bygges, når ejerens fokusliste giver plads (race engine, løbsfilm, ruter, beta→live, Udvikling 2.0, træning/udtagelse/form). SSOT for UI: `docs/design/TASTE.md` + `docs/design/PAGE_TEMPLATES.md`.

## 1. Ejer-valg 19/10 (låst)
1. **Paletten er spillets hjerne:** søg alt + handlinger + kontekst-forslag ("det vigtigste lige nu").
2. **Samme palet på mobil** (søge-knap i topbaren); desktop får genveje oveni.
3. **Alt med bekræftelse:** sikre handlinger med det samme; penge/ryttere (bud, salg, kontrakt, fyring) får et kort bekræft-trin med beløb.
4. **Smart søgning + naturligt sprog:** tolerant (stavefejl, accenter, EN+DA) og simple sætninger ("klatrere under 25", "billigste sprinter på markedet", "næste bjergetape"). Ingen AI-model i v1 (ingen ny løbende udgift); kan udvides senere.
5. **Læring:** hints når Ctrl/Cmd holdes, `?`-oversigtsark, én diskret "Prøv Ctrl+K" første gang på desktop, genvej vist ved hver handling i paletten.
6. **Egne genveje i trin 2:** Indstillinger → Genveje, optagelse med konfliktadvarsel, gemt på kontoen.
7. **Lynhurtig og levende:** åbner < 50 ms, resultater < 100 ms mens man skriver (data forudindlæst), rytterrækker med foto/rating/form, mini-højdeprofil ved løb. Måles i test.

## 2. Hvad spilleren oplever
- `Ctrl/Cmd+K` (eller søge-knap på mobil) → palet. Tom tilstand = **"Lige nu"**: 3-5 kontekst-forslag fra spillets tilstand (manglende udtagelse, auktion der slutter, uåbnet løbsrapport, træning ikke sat, bestyrelsesmål i fare).
- Skriv → grupperede resultater: Handlinger · Ryttere · Hold · Løb/etaper · Sider · Hjælp. Pil op/ned, Enter, Esc.
- Sætninger → filtrerede resultater (fx "klatrere under 25" = mine/markedets klatrere < 25 år, sorteret efter rating).
- Handling med penge/ryttere → bekræft-trin i paletten (beløb, konsekvens, Enter = bekræft).

## 3. Genveje (standard, desktop)
| Genvej | Handling |
|---|---|
| `Mod+K` | Palet |
| `?` | Oversigtsark |
| `/` | Søg på aktuel side |
| `G` `D/T/P/M/R/H` | Gå til Dashboard / Træning / Planlægning / Marked / Resultater / Hold |
| `J` / `K` | Næste / forrige rytter (rytterkort, lister) |
| Mellemrum, `←`/`→`, `1`-`9` | Løbsfilm: afspil/pause, spol, etape |
| `T` | Træn nu (træningssiden, med samme regler som knappen) |
| `B` | Byd minimum (auktion, altid bekræftelse) |
Regler: ingen genvej i tekstfelter; dialoger får eget scope (exclusive); skærmlæser-venligt; ingen browser-kollisioner (fx Ctrl+T/W).

## 4. Teknik
- **Bibliotek:** `@tanstack/react-hotkeys` (0.x, nyt). Fastlås en version ≥ 2 uger gammel; pak ind i ét modul `frontend/src/lib/hotkeys/` (eneste import-sted), så biblioteket kan skiftes. Brug `defineAppHotkeys`, `HotkeysProvider` (scopes), `formatForDisplay`, `useHotkeyHint`, `useAppHotkeyList`; trin 2 `useHotkeyRecorder` + `customHotkeys` gemt server-side.
- **Palet-UI:** egen komponent efter TASTE (hairlines, 5px radius, én gold primary = valgt handling, stroke-ikoner, tabular figures). Tilgængelig dialog (fokus-fælde, aria). Nye filer .ts/.tsx.
- **Søgeindeks:** forudindlæst klient-indeks (ryttere, hold, løb, sider, hjælp) med accent-/stavefejl-tolerant matching; opdateres i baggrunden. Store lister pagineres/trimmes; måles mod bundle-budgettet.
- **Naturligt sprog:** lille regelbaseret parser (rolle, alder, pris, terræn, "næste", "billigste", "mine") → filtre på eksisterende API'er. EN+DA ord-lister. Ingen LLM i v1.
- **Handlinger:** registreret ét sted (id, navn EN/DA, ikon, genvej, kræver-bekræftelse, tilgængelig-når). Bruger samme API-kald som knapperne, så regler aldrig divergerer.
- **Flag:** `command_palette` (off → beta → live).
- **Måling:** events for åbn, søg, valgt resultat, handling, genvej brugt (til at forbedre "Lige nu" og rangering).

## 5. Udførelsesplan (når vi er klar)
| Fase | Indhold | Verifikation |
|---|---|---|
| 0. Mockup | Klikbar mockup desktop + mobil af palet, "Lige nu", sætningssøgning, bekræft-trin, `?`-ark, hints | Ejer-go på billeder FØR byg |
| 1. Fundament | hotkeys-modul, `G`-navigation, `?`-ark, hints, `J/K`, løbsfilm-genveje | Playwright: alle genveje, ingen i tekstfelter, scopes |
| 2. Paletten | søgeindeks, grupperede resultater, navigation, mobil-knap | Ydelse: åbn < 50 ms, resultat < 100 ms (målt i CI) |
| 3. Handlinger + "Lige nu" | handlingsregister, bekræft-trin, kontekst-forslag | Test pr. handling; bekræftelse på alle penge/rytter-handlinger |
| 4. Naturligt sprog | parser EN+DA, 30+ eksempel-sætninger som golden test | Golden tests; ejer prøver 10 egne sætninger |
| 5. Beta | flag `command_palette` = beta, måling | Ejer + beta-testere i en uge |
| 6. Live + trin 2 | live for alle; egne genveje i Indstillinger | Patch note + Hjælp EN/DA |
Hver fase: én PR, før/efter-billede (desktop 1440 + mobil 375), lint/test/build/verify-affected, review-gate.

## 6. Åbne spørgsmål til senere
- Hvilke 3-5 "Lige nu"-forslag er vigtigst? (måles i beta)
- Skal paletten kunne bruges på det offentlige marketing-site? (antagelse: nej)
