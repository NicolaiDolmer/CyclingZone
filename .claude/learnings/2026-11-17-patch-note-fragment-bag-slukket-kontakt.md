# Postmortem · 2026-11-17 · Patch note-fragment bag slukket kontakt bliver vist ved merge

## Hvad skete der?
PR #8210 (træningsrapport i XP-format, bag den slukkede kontakt `development_xp_model`) havde et patch note-fragment i `frontend/src/data/patch-notes/pending/` med `rollout: beta`. Var PR'en merget, havde merge-toget givet noten et nummer, og spillerne havde set "Training report in XP (beta)" på patch notes-siden, selvom ingen kan se rapporten, før XP tændes (og XP kan ikke gå i beta). Det blev fanget i dirigentens diff-tjek før merge. Samme mønster ligger i #8298 (fragment for `race_page_v6`, som er slukket).

## Root cause
Fragment-flowet (#8346) nummererer alle ventende fragmenter efter et verificeret tog, uanset om kontakten bag noten er tændt. Siden skjuler ikke en note, fordi kontakten er slukket: `flag` på en beta-note bruges kun til at vise den som "nu for alle", når kontakten er tændt for alle. Baner og cloud-sessioner læste reglen "en PR skriver sin note som fragment" og lagde derfor en note i hver PR, også når alt lå bag en slukket kontakt.

## Fix
Fragmentet er taget ud af #8210 (commit `2a7e6e67`), og teksten står ordret på #7627 til den PR, der tænder XP. #8298's fragment er markeret i overdragelsen #8374 som noget, der skal ud før merge.

## Forhindret-fremover
- Reglen står i overdragelsen #8374 og i startprompten til næste primære session: en PR bag en slukket kontakt har ingen fragment; teksten gemmes på opgaven og lægges ind i den PR, der tænder.
- Opfølgning til en bane (ikke bygget her): lad `scripts/check-patch-notes-version.js` fejle, når et fragment har `flag`, og kontakten i registret ikke står som beta eller live; og skriv reglen ind i `frontend/src/data/patch-notes/README.md` og `docs/PATCH_NOTES_RULES.md`.

## Læring
"Skriv altid en patch note" og "merge slukket" trækker i hver sin retning. En note er et løfte til spillerne om noget, de kan se nu. Diff-tjekket før et ejer-mærke skal derfor altid se efter filer i `pending/` og holde dem op mod kontaktens tilstand i produktion.
