# Rotationens plads efter Fable-dommen på #8624

Motoren behandlede et sandt svarobjekt fra kataloget som et gyldigt pas. Et objekt med `ok: false` kunne derfor rykke pladsen, selv om motoren brugte sin almindelige plan. Begge prognoser og motoren bruger nu katalogets `ok`. Den fastlåste katalogtilstand er en regressionstest.

Modellen havde samme ejer og hold ved sæsonskift, men læsefilteret afgrænsede historikken til den nye sæson. Den seneste kompatible kvittering læses nu pr. rytter på tværs af sæsoner. Sorteringen følger dato og stemplets afregningsrækkefølge. Sæsonprøven kører den rigtige aftenafregning mod en kvittering fra forrige sæson.
