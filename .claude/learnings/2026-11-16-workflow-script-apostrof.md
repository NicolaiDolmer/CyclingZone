# Workflow-script: apostrof i en '...'-streng (16/11)

**Hvad:** Workflow-scriptet "glemt-planlagt-arbejde" fejlede ved parse (21:235): en prompt-streng i enkelt-anførselstegn indeholdt "PR'er".
**Rodårsag:** danske ord med apostrof (PR'er, issue's) lukker en '...'-streng. Hurtigt rettet, men ejeren så fejlen.
**Forebyggelse:** I workflow-scripts skrives ALLE prompt-tekster som template-strenge (`...`), aldrig '...'. Kun korte nøgler/labels må stå i '...'.
**Også:** Workflow og hånd-Agent blokeres, mens en bølge kører (#5142). En undersøgelse under en bølge lægges ind som kind:'investigate'-spor via `wave-policy.mjs enqueue`.
**Også (samme dag):** spor-filer til `wave-policy.mjs enqueue` skrevet via bash-heredoc mistede dobbelte backslashes, så Windows-stier gav ugyldig JSON. Skriv stier med `/` i spor-JSON.
