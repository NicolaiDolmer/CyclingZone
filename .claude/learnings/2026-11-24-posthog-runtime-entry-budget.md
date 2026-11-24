# PostHog og bundle-budget for første indlæsning · #8682

Bundle-gaten fandt, at tilføjelsen af Web Vitals gjorde startpakken for stor. Den synkrone import fra logEvent gjorde selve PostHog-runtime til en del af første indlæsning, selv om SDK'et allerede blev indlæst dynamisk.

Eager event-kald bruger nu et lille interface. Det valgfrie PostHog-modul registrerer det eksisterende sendeflow, når modulet indlæses. Før registreringen svarer det, at PostHog er utilgængelig. Både aktivt samtykke og den identificerede konto kontrolleres fortsat af runtime. Sammenlign entry- og modulepreload-stykkerne ved nye analytics-events, og test indlæsning både før og efter registrering.
