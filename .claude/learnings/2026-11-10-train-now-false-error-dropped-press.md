# 2026-11-10: Træn nu viste fejl, selvom træningen kørte (#7982)

**Hvad skete:** Samme aften som Træn nu kom på beta fik en beta-tester "Today could not be locked. Try again.", men træningen var kørt. Sentry var tom, fordi serveren lykkedes.

**Rodårsag:** POST /api/training/train-now tager 21-25 s i prod (Railway http-log). Telefonen giver op før svaret (fane i baggrunden / forbindelse lukket, én 499 efter 15 s). Klienten tolkede manglende svar som fejl og hentede ikke status igen, så siden så utrænet ud.

**Rettelse:** efter et tabt svar spørger klienten om status; låsen skrives tidligt i trykket, så `locked`/`settled` betyder at trykket landede. Instant-fejlteksten siger ikke længere "locked".

**Forebyggelse:**
1. En handling der kan tage >5 s må aldrig fortolke "intet svar" som "fejl" uden at tjekke serverens tilstand bagefter.
2. Ved tænding: læs Railway http-varighed for den nye route den første time (Sentry ser ikke langsomme succeser).
3. Rodårsagen (22 s) måles og designes i #7982 del 2.
