# 5/10-2026: Review før ejerens go, og "klar" betyder grøn CI

Samlet læring fra motor-design-sessionen 5/10 (#6157). Staging-delen står i `2026-10-05-staging-restore-afbrudt-og-rensning-fejlede.md`.

## Hvad gik galt
1. **Ejeren godkendte en PR, som bagefter viste sig at være forkert.** #6216 fik "merge, når CI er grøn" på et før/efter-billede. Det uafhængige review, der blev startet EFTER godkendelsen, fandt to blokerende fejl (en rytter, der kommer tilbage i udbruddet, blev stående som "sat af"; e2e var rød). Billedet viste en fixture, hvor fejlen ikke kunne ses.
2. **En lane meldte "klar" med rød typecheck.** #6217 havde seks tsc-fejl i sin egen testfil; lanen havde kørt test og lint, men ikke typecheck. Det blev først opdaget, da CI var færdig.
3. **Første udgave af et UI-mærke kunne kun ses med mus.** "Sat af" brugte samme ikon som "indhentet"; forskellen lå i tooltip. Ejeren har Android.
4. **To værktøjer sloges om verifikationspladserne.** Codex holdt begge pladser i over en time; tre Claude-laner så ud til at hænge (#6226).
5. **En lane døde på en serverfejl (529) og blev først genoptaget, da ejeren spurgte** (#6227).
6. **Deploy verify blev rød på et langsomt Railway-byg** (32 min) og stoppede merge-køen på et falsk signal (#6228).
7. **Nye laner blev sat i kø sent i en meget stor session**, så den ikke kunne lukkes, da ejeren ville starte en ny.
8. **Ejeren kunne ikke se mellemteksten** i en lang tur og måtte spørge tre gange efter noget at kopiere til Codex.

## Regler
- **Rækkefølgen er: byg → grøn CI på nyeste commit → uafhængigt review på diffen → billede → ejerens go → merge.** Aldrig billede før review.
- **"Klar" kræver typecheck + lint + test + berørte e2e, og orkestratoren tjekker selv CI**, før PR'en vises for ejeren. Lanens brief skal nævne typecheck ved navn.
- **Et UI-mærke skal kunne skelnes i FORM uden hover**, og tryk-adfærd tjekkes på mobil, før billedet vises.
- **Motorregler bygges bag en slukket regel-revision**; hjælpetekst og patch note følger den PR, der tænder revisionen, så spillerne aldrig læser noget, der ikke er live.
- **En merge-session bygger ikke nyt.** Byggesessioner og merge-sessioner har hver deres prompt og hver deres formål.
- **Sig det højt, før noget startes, der holder sessionen åben**, og foreslå selv en ny session med færdig prompt, når formålet er nået.
- **Svar, ejeren skal handle på, sendes som fil** med selve svaret i billedteksten, og filen indeholder kun den tekst, der skal kopieres.
- **Virkelige tal før mål:** når ejeren spørger "hvad sker der i virkeligheden?", hentes kildebelagte data, før der foreslås et tal (tidsmodellen #6199).

Refs #6157 #6216 #6217 #6226 #6227 #6228
