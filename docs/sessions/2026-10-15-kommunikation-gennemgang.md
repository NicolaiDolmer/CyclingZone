# Startprompt: samlet gennemgang af spillerkommunikation 15/10 (senere i dag)

Kopiér alt under linjen ind i en ledig session, når der er tid.

---

Gennemgå dagens spillerkommunikation med mig (Nicolai), ét beslutningskort ad gangen, på dansk. Kør først `git pull --ff-only`. Du sender, poster og udgiver ALDRIG noget selv. Jeg poster selv. Status og beslutninger skrives på #6319.

Alt er forberedt af sessionen "spillerkommunikation" på pc1. Gennemgå i denne rækkefølge, og vis hver tekst eller hvert billede i samme tur som spørgsmålet:

1. **Discord #patch-notes, 7.356-7.360** (`docs/drafts/discord-patch-7356-7360-2026-10-14.md`). To opslag, der ikke er postet. De skal op før 7.361.
2. **Roadbook** (`docs/drafts/roadbook-2026-10-15.png` + `docs/drafts/roadbook-discord-2026-10-15.md`, EN, rå kodeblok til #the-roadbook). Beskyt/spar (#6647) må IKKE nævnes offentligt.
3. **Svarlisten:** 44 svarudkast i ejerens private Artifact https://claude.ai/artifact/2xfBUeM4dJgfktCimNdoBr. Læs den med Artifact `read`. Personnavne må kun stå dér, aldrig i repoet. Tag de orange kort ("Din vurdering") først: to fairplay-sager fra feedback-formularen, to skærmbilleder, auktionsafstemningen og et løfte om #5851 før sæsonskiftet. Ret udkast efter mine svar, og republish til samme URL.
4. **Patch note 7.361:** kladde-PR #6661 (`frontend/src/data/patchNotes.js`, EN+DA) + `docs/drafts/discord-patch-7361-2026-10-15.md`.
   - Tilføj de motor-rettelser, der er merget siden 15/10 kl. 13:30: #6647, #6648, #5978, #6201 og #6155. Tjek `git log`.
   - Enkeltstarten (#6645) er merget, men virker kun under S5-profilerne. Nævn den kun, hvis den er live for spillerne.
   - Lav et før/efter-billede af /patch-notes på preview. Merge først på mit ordrette "merge". Skriv derefter "klar til merge-køen" på PR'en; merge-køen køres kun fra pc1-hovedsessionen.

Kendt løs ende til mit go (prod): known issue #5919 "outbid-mail ved eget bud" står som "checking", men 7.358 siger, at den er rettet. Den skal flyttes til "Rettet".
