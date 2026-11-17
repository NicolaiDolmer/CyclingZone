# Skitser byggede på forkert træningsmodel (16/11, #7947)

**Hvad:** To skitserunder (#8184, #8221) viste ét træningsvalg pr. rytter pr. dag. Spillet har 5 felter pr. dato (ét pr. løbsdag) siden datomodellen 29/9. Ejeren fangede det på billederne.
**Rodårsag:** briefen beskrev ikke domænemodellen; sporet kopierede en forenklet model fra den forrige skitse i stedet for at læse docs/TRAINING_RULES.md og den nuværende komponent.
**Forebyggelse:** enhver skitse- eller design-brief til en eksisterende flade skal (1) pege på SSOT-reglerne og den nuværende komponent og (2) kræve et afsnit "Domænemodel i dag" med fil:linje i PR'en, før skitserne laves. Reviewer afviser skitser, hvis model afviger fra koden uden ejerens valg.
