# Planlægning: låst række mistede form (#5930)

Den låste etapeløbsrække viste kun match, mens den redigerbare række viste
match og aktuel form. Backend sendte allerede begge tal i samme payload;
det var to forskellige render-grene der lod informationen divergere.
Manglende overskrifter gjorde samtidig tallene vanskelige at fortolke.

Rettelsen deler talvisningen mellem de to grene og viser overskrifter plus
den ejer-valgte, altid synlige forklaring inde i løbskortet. Ukendt bruger
null-fallback; et målt nul må aldrig blive til en ukendt værdi eller omvendt.

Regressionen renderer det rigtige board med begge grene, begge sprog og
fixtures for ukendt, nul og kendt værdi. Før rettelsen fejlede testen på de
manglende kolonneoverskrifter. Testen kontrollerer også at den låste gren
viser form, og at ukendt ikke forskyder talkolonnerne. Uret sættes eksplicit.

Ved næste ændring af read-only-rækker: del deres information med den
redigerbare visning, og verificér forskellen i tilladte handlinger særskilt.
