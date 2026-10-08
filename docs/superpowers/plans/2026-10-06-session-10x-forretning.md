# Prompt: session "10x forretning" (6/10 aften)

Model: **Claude Opus 5.5** i Claude Code (har adgang til Supabase, Alunta, PostHog, GSC/Ahrefs og Clarity via MCP), indsats høj. Kopiér alt under stregen.

---

Ny session: **hvordan 10x'er vi hurtigst omsætning, brugere og betalende managers, så Cycling Zone bliver en bæredygtig forretning?** Udfordr status quo. Spørg hvad der er vigtigst her og nu, ikke hvad der er planlagt. Arbejdsform (ejer 6/10): langsigtet værdi, best practice, beslutninger som popup én ad gangen med anbefaling, ingen opfundne tal. Uden evidens skriver du "ingen evidens, antagelse: ...".

**Læs først:** `docs/MASTERPLAN.md`, `docs/OPERATING_PLAN.md`, `docs/ANALYTICS_STACK.md`, `docs/BILLING_STACK.md`, `docs/superpowers/specs/2026-10-06-ejer-beslutninger-stabilitet-10x.md` (beslutning 6: "når der er ro, er nye spillere igen prioritet nr. 1"), `docs/TONE_OF_VOICE.md`. Læs også de seneste ejer-kommentarer på #4321 (PostHog) og #4514 (betaling).

## 1. Mål nutiden (ingen gætteri)
- **Penge:** MRR, betalende, ARPU, churn og konvertering fra gratis til betalt (Alunta-MCP + `subscriptions`).
- **Tragten (Postgres er sandheden, ANALYTICS_STACK §1):** besøg → signup → hold → første bud → første løb → dag 2/7/30-retention, pr. kanal (`signup_attribution`).
- **Trafik:** GSC, Ahrefs (gratis-omfang), `traffic_events`. Edge-loggen 6/10 viste ~80 unikke browser-IP'er i spidstimen (#6275).
- **Hvor taber vi flest:** find det ene trin med størst absolut tab.

## 2. Udfordr status quo
- Bygger vi features, mens tragten lækker? Hvad ville en erfaren F2P/management-game-operatør stoppe med i morgen?
- Pris og pakke: er Pro det rigtige produkt, til den rigtige pris, på det rigtige tidspunkt i rejsen? (Priser er inkl. moms, #5215.)
- Kanaler: hvilke 1-2 kanaler kan realistisk give 10×? Fx SEO/indhold om cykelmanager-spil, Discord-fællesskab, creators/streamere, cykel-fora, betalt test, henvisning fra spillere, AI-assistenter (#4322 viser ChatGPT som top-5 signup-kilde).
- Hvad er "det magiske øjeblik" (første løb med eget hold?), og hvor hurtigt når en ny spiller dertil?

## 3. Leverance
- Én side: nutidens tal, den største flaskehals, **3 væddemål** rangeret efter forventet effekt pr. arbejdsdag (hver med målbart succeskriterium og stopregel), en stop-liste (hvad vi holder op med) og hvad der skal måles først.
- Popup-beslutninger til ejeren én ad gangen. Opret issues til de godkendte væddemål. Opdatér MASTERPLAN, men kun efter ejer-go på rækkefølgen.

Grænser: stabilitet først (DB må ikke gå ned, ejer 6/10). Sæsonskifte 25/10 og frontend-frys fra 18/10 gælder.
